/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/search', 'N/runtime', 'N/render', 'N/email', 'N/record'], function (
    search,
    runtime,
    render,
    email,
    record
) {
    const PARAM = {
        SEARCH_ID: 'custscript_am_invoice_email_search',
        DEFAULT_AUTHOR: 'custscript_am_default_email_author',
        MAX_ATTACHMENTS: 'custscript_am_max_attachments',
        MAX_EMAIL_MB: 'custscript_am_max_email_mb'
    };

    const FIELD = {
        INVOICE_EMAILED: 'custbody_am_invoice_emailed',
        INVOICE_EMAILED_DATE: 'custbody_am_invoice_emailed_date',
        INVOICE_EMAIL_ERROR: 'custbody_am_invoice_email_error',
        CUSTOMER_INVOICE_EMAIL: 'custentity_atlas_customer_invoice_email',
        CUSTOMER_AR_REP: 'custentity_bpc_assigned_ar_rep'
    };

    const DEFAULT_MAX_ATTACHMENTS = 10;
    const DEFAULT_MAX_EMAIL_MB = 9.5;

    function getInputData() {
        const script = runtime.getCurrentScript();
        const searchId = script.getParameter({ name: PARAM.SEARCH_ID });

        if (!searchId) {
            throw new Error('Missing required parameter: ' + PARAM.SEARCH_ID);
        }

        const invoiceSearch = search.load({ id: searchId });
        const pagedData = invoiceSearch.runPaged({ pageSize: 1000 });
        const groups = {};
        let invoiceCount = 0;

        pagedData.pageRanges.forEach(function (pageRange) {
            const page = pagedData.fetch({ index: pageRange.index });

            page.data.forEach(function (result) {
                const invoiceId = result.getValue({ name: 'internalid' });
                const customerId = result.getValue({ name: 'entity' });
                const customerName = result.getText({ name: 'entity' }) || '';
                const recipientEmail = result.getValue({
                    name: FIELD.CUSTOMER_INVOICE_EMAIL,
                    join: 'customerMain'
                });
                const assignedArRep = result.getValue({
                    name: FIELD.CUSTOMER_AR_REP,
                    join: 'customerMain'
                });

                if (!invoiceId || !customerId || !recipientEmail) {
                    log.error({
                        title: 'Invoice skipped - missing required search value',
                        details: {
                            invoiceId: invoiceId,
                            customerId: customerId,
                            recipientEmail: recipientEmail
                        }
                    });
                    return;
                }

                if (!groups[customerId]) {
                    groups[customerId] = {
                        customerId: customerId,
                        customerName: customerName,
                        recipientEmail: recipientEmail,
                        assignedArRep: assignedArRep,
                        invoices: []
                    };
                }

                groups[customerId].invoices.push({
                    id: invoiceId,
                    tranId: result.getValue({ name: 'tranid' }) || String(invoiceId),
                    customerId: customerId,
                    customerName: customerName,
                    tranDate: result.getValue({ name: 'trandate' }) || '',
                    dueDate: result.getValue({ name: 'duedate' }) || '',
                    amount: result.getValue({ name: 'total' }) || '0',
                    amountRemaining: result.getValue({ name: 'amountremaining' }) || '0'
                });

                invoiceCount += 1;
            });
        });

        const input = Object.keys(groups).map(function (customerId) {
            return groups[customerId];
        });

        log.audit({
            title: 'Grouped invoices for processing',
            details: {
                searchId: searchId,
                customerCount: input.length,
                invoiceCount: invoiceCount
            }
        });

        return input;
    }

    function map(context) {
        const script = runtime.getCurrentScript();
        const group = JSON.parse(context.value);
        const defaultAuthor = script.getParameter({ name: PARAM.DEFAULT_AUTHOR });
        const author = group.assignedArRep || defaultAuthor;
        const maxAttachments = Math.min(
            Math.max(Number(script.getParameter({ name: PARAM.MAX_ATTACHMENTS })) || DEFAULT_MAX_ATTACHMENTS, 1),
            DEFAULT_MAX_ATTACHMENTS
        );
        const maxEmailBytes = (Number(script.getParameter({ name: PARAM.MAX_EMAIL_MB })) || DEFAULT_MAX_EMAIL_MB) * 1024 * 1024;
        const stats = {
            customerId: group.customerId,
            customerName: group.customerName,
            invoicesReceived: group.invoices.length,
            pdfRendered: 0,
            renderFailed: 0,
            emailsSent: 0,
            emailSendFailed: 0,
            invoicesMarked: 0,
            invoiceMarkFailed: 0
        };

        log.audit({
            title: 'Customer processing started',
            details: {
                customerId: group.customerId,
                customerName: group.customerName,
                invoiceCount: group.invoices.length
            }
        });

        if (!author) {
            group.invoices.forEach(function (invoice) {
                writeInvoiceError(invoice.id, 'No Assigned AR Rep and no fallback email author configured.');
            });
            log.error({
                title: 'Customer skipped - missing sender',
                details: {
                    customerId: group.customerId,
                    customerName: group.customerName,
                    invoiceCount: group.invoices.length
                }
            });
            context.write({ key: group.customerId, value: JSON.stringify(stats) });
            return;
        }

        group.invoices.sort(function (a, b) {
            const dateCompare = String(a.tranDate).localeCompare(String(b.tranDate));
            return dateCompare || String(a.tranId).localeCompare(String(b.tranId));
        });

        const renderedInvoices = [];

        group.invoices.forEach(function (invoice) {
            try {
                const pdfFile = render.transaction({
                    entityId: Number(invoice.id),
                    printMode: render.PrintMode.PDF
                });

                pdfFile.name = safeFileName(invoice.tranId) + '.pdf';

                const pdfBytes = getFileBytes(pdfFile);
                if (pdfBytes > maxEmailBytes) {
                    throw new Error('Rendered PDF exceeds the configured email size limit.');
                }

                renderedInvoices.push({
                    invoice: invoice,
                    file: pdfFile,
                    bytes: pdfBytes
                });
                stats.pdfRendered += 1;
            } catch (e) {
                stats.renderFailed += 1;
                writeInvoiceError(invoice.id, 'PDF render failed: ' + errorMessage(e));
                log.error({
                    title: 'PDF render failed',
                    details: {
                        invoiceId: invoice.id,
                        tranId: invoice.tranId,
                        error: errorMessage(e)
                    }
                });
            }
        });

        const batches = [];
        let batch = [];
        let batchBytes = 0;

        renderedInvoices.forEach(function (item) {
            const wouldExceedCount = batch.length >= maxAttachments;
            const wouldExceedSize = batch.length > 0 && batchBytes + item.bytes > maxEmailBytes;

            if (wouldExceedCount || wouldExceedSize) {
                batches.push(batch);
                batch = [];
                batchBytes = 0;
            }

            batch.push(item);
            batchBytes += item.bytes;
        });

        if (batch.length > 0) {
            batches.push(batch);
        }

        batches.forEach(function (emailBatch, index) {
            const batchInvoices = emailBatch.map(function (item) {
                return item.invoice;
            });
            const attachments = emailBatch.map(function (item) {
                return item.file;
            });
            const totalBytes = emailBatch.reduce(function (sum, item) {
                return sum + item.bytes;
            }, 0);

            try {
                email.send({
                    author: Number(author),
                    recipients: group.recipientEmail,
                    subject: buildSubject(group.customerName),
                    body: buildEmailBody(group.customerName, batchInvoices),
                    attachments: attachments,
                    relatedRecords: {
                        entityId: Number(group.customerId)
                    }
                });
            } catch (e) {
                stats.emailSendFailed += 1;
                batchInvoices.forEach(function (invoice) {
                    writeInvoiceError(invoice.id, 'Email send failed: ' + errorMessage(e));
                });
                log.error({
                    title: 'Invoice email send failed',
                    details: {
                        customerId: group.customerId,
                        customerName: group.customerName,
                        batchNumber: index + 1,
                        invoiceIds: batchInvoices.map(function (invoice) {
                            return invoice.id;
                        }),
                        error: errorMessage(e)
                    }
                });
                return;
            }

            batchInvoices.forEach(function (invoice) {
                try {
                    markInvoiceSent(invoice.id);
                    stats.invoicesMarked += 1;
                } catch (e) {
                    stats.invoiceMarkFailed += 1;
                    log.error({
                        title: 'Invoice mark failed after email send',
                        details: {
                            invoiceId: invoice.id,
                            tranId: invoice.tranId,
                            error: errorMessage(e)
                        }
                    });
                }
            });

            stats.emailsSent += 1;
            log.audit({
                title: 'Invoice email sent',
                details: {
                    customerId: group.customerId,
                    customerName: group.customerName,
                    batchNumber: index + 1,
                    attachmentCount: attachments.length,
                    totalBytes: totalBytes,
                    invoiceIds: batchInvoices.map(function (invoice) {
                        return invoice.id;
                    })
                }
            });
        });

        context.write({ key: group.customerId, value: JSON.stringify(stats) });
    }

    function summarize(summary) {
        const totals = {
            customersProcessed: 0,
            invoicesReceived: 0,
            pdfRendered: 0,
            renderFailed: 0,
            emailsSent: 0,
            emailSendFailed: 0,
            invoicesMarked: 0,
            invoiceMarkFailed: 0
        };

        if (summary.inputSummary.error) {
            log.error({ title: 'Input error', details: summary.inputSummary.error });
        }

        summary.mapSummary.errors.iterator().each(function (key, error) {
            log.error({ title: 'Map error for key ' + key, details: error });
            return true;
        });

        summary.output.iterator().each(function (key, value) {
            const stats = JSON.parse(value);
            totals.customersProcessed += 1;
            totals.invoicesReceived += stats.invoicesReceived || 0;
            totals.pdfRendered += stats.pdfRendered || 0;
            totals.renderFailed += stats.renderFailed || 0;
            totals.emailsSent += stats.emailsSent || 0;
            totals.emailSendFailed += stats.emailSendFailed || 0;
            totals.invoicesMarked += stats.invoicesMarked || 0;
            totals.invoiceMarkFailed += stats.invoiceMarkFailed || 0;
            return true;
        });

        log.audit({ title: 'Consolidated invoice email summary', details: totals });
    }

    function buildSubject(customerName) {
        return (customerName || 'Customer') + '_Invoice_' + formatSubjectDate(new Date());
    }

    function buildEmailBody(customerName, invoices) {
        const rows = invoices.map(function (invoice) {
            return '' +
                '<tr>' +
                '<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827;">' + escapeHtml(invoice.tranId) + '</td>' +
                '<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;">' + escapeHtml(invoice.tranDate) + '</td>' +
                '<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;">' + escapeHtml(invoice.dueDate) + '</td>' +
                '<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827;text-align:right;">' + formatUsd(invoice.amount) + '</td>' +
                '<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827;text-align:right;font-weight:600;">' + formatUsd(invoice.amountRemaining) + '</td>' +
                '</tr>';
        }).join('');

        return '' +
            '<div style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#111827;">' +
            '<div style="max-width:760px;margin:0 auto;padding:24px;">' +
            '<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">' +
            '<div style="background:#0f766e;color:#ffffff;padding:20px 24px;">' +
            '<div style="font-size:20px;font-weight:700;line-height:1.3;">Ace Mart Invoice Documents</div>' +
            '<div style="font-size:13px;line-height:1.5;opacity:.9;margin-top:4px;">' + escapeHtml(formatDisplayDate(new Date())) + '</div>' +
            '</div>' +
            '<div style="padding:24px;">' +
            '<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;">Hello ' + escapeHtml(customerName || '') + ',</p>' +
            '<p style="margin:0 0 18px 0;font-size:15px;line-height:1.6;">Please find attached your invoice PDF(s) listed below. If you have any questions, please reply to this email.</p>' +
            '<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;font-size:13px;line-height:1.4;">' +
            '<thead>' +
            '<tr style="background:#f1f5f9;">' +
            '<th align="left" style="padding:10px 12px;border-bottom:1px solid #cbd5e1;color:#334155;">Invoice #</th>' +
            '<th align="left" style="padding:10px 12px;border-bottom:1px solid #cbd5e1;color:#334155;">Invoice Date</th>' +
            '<th align="left" style="padding:10px 12px;border-bottom:1px solid #cbd5e1;color:#334155;">Due Date</th>' +
            '<th align="right" style="padding:10px 12px;border-bottom:1px solid #cbd5e1;color:#334155;">Amount</th>' +
            '<th align="right" style="padding:10px 12px;border-bottom:1px solid #cbd5e1;color:#334155;">Amount Remaining</th>' +
            '</tr>' +
            '</thead>' +
            '<tbody>' + rows + '</tbody>' +
            '</table>' +
            '<p style="margin:20px 0 0 0;font-size:14px;line-height:1.6;color:#374151;">Thank you,<br>Ace Mart Accounts Receivable</p>' +
            '</div>' +
            '</div>' +
            '</div>' +
            '</div>';
    }

    function markInvoiceSent(invoiceId) {
        const values = {};
        values[FIELD.INVOICE_EMAILED] = true;
        values[FIELD.INVOICE_EMAILED_DATE] = new Date();
        values[FIELD.INVOICE_EMAIL_ERROR] = '';

        record.submitFields({
            type: record.Type.INVOICE,
            id: invoiceId,
            values: values,
            options: {
                enableSourcing: false,
                ignoreMandatoryFields: true
            }
        });
    }

    function writeInvoiceError(invoiceId, message) {
        const values = {};
        values[FIELD.INVOICE_EMAIL_ERROR] = String(message || '').substring(0, 3900);

        record.submitFields({
            type: record.Type.INVOICE,
            id: invoiceId,
            values: values,
            options: {
                enableSourcing: false,
                ignoreMandatoryFields: true
            }
        });
    }

    function getFileBytes(fileObj) {
        const size = Number(fileObj.size);
        if (size > 0) {
            return size;
        }
        const contents = fileObj.getContents ? fileObj.getContents() : '';
        return contents ? contents.length : 0;
    }

    function formatUsd(value) {
        const number = Number(String(value || '0').replace(/[^0-9.-]/g, ''));
        if (!isFinite(number)) {
            return '$0.00';
        }
        const parts = number.toFixed(2).split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return '$' + parts.join('.');
    }

    function formatSubjectDate(date) {
        return pad(date.getMonth() + 1) + '/' + pad(date.getDate()) + '/' + String(date.getFullYear()).slice(-2);
    }

    function formatDisplayDate(date) {
        return pad(date.getMonth() + 1) + '/' + pad(date.getDate()) + '/' + date.getFullYear();
    }

    function pad(value) {
        return String(value).length === 1 ? '0' + value : String(value);
    }

    function safeFileName(value) {
        return String(value || 'Invoice').replace(/[\\/:*?"<>|#%{}~&]/g, '-').substring(0, 120);
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function errorMessage(e) {
        return e && (e.message || e.name) ? (e.name ? e.name + ': ' : '') + e.message : String(e);
    }

    return {
        getInputData: getInputData,
        map: map,
        summarize: summarize
    };
});
