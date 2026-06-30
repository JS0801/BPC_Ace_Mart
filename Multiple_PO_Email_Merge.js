/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
    'N/ui/serverWidget',
    'N/search',
    'N/render',
    'N/email',
    'N/runtime',
    'N/file',
    'N/xml',
    'N/record',
    'N/url',
    'N/log'
], function (
    serverWidget,
    search,
    render,
    email,
    runtime,
    file,
    xml,
    record,
    url,
    log
) {

    var TEMP_FOLDER_ID = 8768;

    /*
     * Create a script parameter on this Suitelet:
     * ID: custscript_po_email_html_file
     * Type: Free-Form Text or Integer Number
     * Value: internal id of po_email_sender_ui.html from File Cabinet
     */
    var PARAM_HTML_FILE_ID = 'custscript_po_email_html_file';

    var FIELD_EMAIL_SENT = 'custbody_email_sent';
    var FIELD_GROUP_NUMBER = 'custbody_group_number';
    var FIELD_VENDOR_MEMO = 'custbody_vendor_memo';

    var FLD_ACTION = 'custpage_action_mode';
    var FLD_SELECTED_IDS = 'custpage_selected_po_ids';

    var FLD_PO = 'custpage_filter_po';
    var FLD_PO_TEXT = 'custpage_filter_po_text';

    var FLD_VENDOR = 'custpage_filter_vendor';
    var FLD_VENDOR_TEXT = 'custpage_filter_vendor_text';

    var FLD_DATE_FROM = 'custpage_filter_date_from';
    var FLD_DATE_TO = 'custpage_filter_date_to';
    var FLD_EMAIL_STATUS = 'custpage_filter_email_status';
    var FLD_GROUP_NUMBER = 'custpage_filter_group_number';
    var FLD_RESEND_GROUP = 'custpage_filter_resend_group';
    var FLD_EMAIL_BODY_MEMO = 'custpage_email_body_memo';
    var FLD_AJAX = 'custpage_ajax';
    var FLD_AJAX_ACTION = 'custpage_ajax_action';

    var MAX_UI_PO_ROWS = 500;
    var MAX_PO_OPTION_ROWS = 100;
    var MAX_VENDOR_OPTION_ROWS = 500;

    var EMAIL_SUBJECT_PREFIX = 'Purchase Order';

    function onRequest(context) {
        var isAjax = false;

        try {
            var request = context.request;
            var params = request.parameters || {};

            isAjax = params[FLD_AJAX] === 'T';

            var filters = buildFiltersFromParams(params);
            var emailBodyMemo = params[FLD_EMAIL_BODY_MEMO] || '';
            var resultMessage = null;

            if (isAjax) {
                handleAjaxRequest(context, params, filters, emailBodyMemo);
                return;
            }

            if (request.method === 'POST') {
                var actionMode = params[FLD_ACTION] || 'filter';

                if (actionMode === 'send' || actionMode === 'resend') {
                    resultMessage = processSelectedPOs(params[FLD_SELECTED_IDS], actionMode, emailBodyMemo);
                }
            }

            showPage(context, filters, resultMessage, emailBodyMemo);

        } catch (e) {
            log.error('Suitelet Error', e);

            if (isAjax) {
                writeJson(context, {
                    success: false,
                    message: e.name + ' : ' + e.message
                });
                return;
            }

            context.response.write('<h3>Error</h3><pre>' + escapeHtml(e.name + ' : ' + e.message) + '</pre>');
        }
    }

    function buildFiltersFromParams(params) {
        return {
            poId: params[FLD_PO] || '',
            poText: params[FLD_PO_TEXT] || '',

            vendorId: params[FLD_VENDOR] || '',
            vendorText: params[FLD_VENDOR_TEXT] || '',

            dateFrom: params[FLD_DATE_FROM] || '',
            dateTo: params[FLD_DATE_TO] || '',
            emailStatus: params[FLD_EMAIL_STATUS] || '',
            groupNumber: params[FLD_GROUP_NUMBER] || '',
            resendGroup: params[FLD_RESEND_GROUP] === 'T' ? 'T' : ''
        };
    }

    function handleAjaxRequest(context, params, filters, emailBodyMemo) {
        var ajaxAction = params[FLD_AJAX_ACTION] || params[FLD_ACTION] || 'filter';
        var resultMessage = null;

        if (ajaxAction === 'send' || ajaxAction === 'resend') {
            resultMessage = processSelectedPOs(params[FLD_SELECTED_IDS], ajaxAction, emailBodyMemo);

            writeJson(context, {
                success: resultMessage.errors.length === 0,
                resultMessage: resultMessage,
                poData: [],
                poOptions: [],
                refreshTable: false
            });
            return;
        }

        writeJson(context, {
            success: true,
            poData: getPurchaseOrders(filters),
            poOptions: getPurchaseOrderOptions(filters),
            refreshTable: true
        });
    }

    function hasAnyFilter(filters) {
        if (!filters) {
            return false;
        }

        return !!(
            filters.poId ||
            filters.poText ||
            filters.vendorId ||
            filters.vendorText ||
            filters.dateFrom ||
            filters.dateTo ||
            filters.emailStatus ||
            filters.groupNumber ||
            filters.resendGroup === 'T'
        );
    }

    function showPage(context, filters, resultMessage, emailBodyMemo) {
        var form = serverWidget.createForm({
            title: ' '
        });

        var actionFld = form.addField({
            id: FLD_ACTION,
            type: serverWidget.FieldType.TEXT,
            label: 'Action'
        });
        actionFld.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN
        });

        var selectedFld = form.addField({
            id: FLD_SELECTED_IDS,
            type: serverWidget.FieldType.LONGTEXT,
            label: 'Selected PO IDs'
        });
        selectedFld.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN
        });

        var shouldLoadPoData = hasAnyFilter(filters) && !resultMessage;
        var poData = shouldLoadPoData ? getPurchaseOrders(filters) : [];
        var poOptions = shouldLoadPoData ? getPurchaseOrderOptions(filters) : [];
        var vendorOptions = getVendorOptions();

        var htmlFld = form.addField({
            id: 'custpage_inline_ui',
            type: serverWidget.FieldType.INLINEHTML,
            label: 'PO Email UI'
        });

        htmlFld.defaultValue = buildPageHtmlFromTemplate({
            poData: poData,
            poOptions: poOptions,
            vendorOptions: vendorOptions,
            filters: filters,
            resultMessage: resultMessage,
            emailBodyMemo: emailBodyMemo,
            suiteletUrl: getSuiteletUrl()
        });

        context.response.writePage(form);
    }

    function getSuiteletUrl() {
        var currentScript = runtime.getCurrentScript();

        return url.resolveScript({
            scriptId: currentScript.id,
            deploymentId: currentScript.deploymentId,
            returnExternalUrl: false
        });
    }

    function buildPageHtmlFromTemplate(dataObj) {
        var html = loadHtmlTemplate();

        var fieldIds = {
            action: FLD_ACTION,
            selectedIds: FLD_SELECTED_IDS,
            po: FLD_PO,
            poText: FLD_PO_TEXT,
            vendor: FLD_VENDOR,
            vendorText: FLD_VENDOR_TEXT,
            dateFrom: FLD_DATE_FROM,
            dateTo: FLD_DATE_TO,
            emailStatus: FLD_EMAIL_STATUS,
            groupNumber: FLD_GROUP_NUMBER,
            resendGroup: FLD_RESEND_GROUP,
            emailBodyMemo: FLD_EMAIL_BODY_MEMO,
            ajax: FLD_AJAX,
            ajaxAction: FLD_AJAX_ACTION
        };

        html = replaceTemplateToken(html, 'SUITELET_URL_JSON', safeJson(dataObj.suiteletUrl || ''));
        html = replaceTemplateToken(html, 'FIELD_IDS_JSON', safeJson(fieldIds));
        html = replaceTemplateToken(html, 'FILTERS_JSON', safeJson(dataObj.filters || {}));
        html = replaceTemplateToken(html, 'PO_DATA_JSON', safeJson(dataObj.poData || []));
        html = replaceTemplateToken(html, 'PO_OPTIONS_JSON', safeJson(dataObj.poOptions || []));
        html = replaceTemplateToken(html, 'VENDOR_OPTIONS_JSON', safeJson(dataObj.vendorOptions || []));
        html = replaceTemplateToken(html, 'RESULT_MESSAGE_JSON', safeJson(dataObj.resultMessage || null));
        html = replaceTemplateToken(html, 'EMAIL_BODY_MEMO_JSON', safeJson(dataObj.emailBodyMemo || ''));

        return html;
    }

    function loadHtmlTemplate() {
        var htmlFileId = runtime.getCurrentScript().getParameter({
            name: PARAM_HTML_FILE_ID
        });

        if (!htmlFileId) {
            throw new Error('Missing Suitelet parameter ' + PARAM_HTML_FILE_ID + '. Set it to the File Cabinet internal id of po_email_sender_ui.html.');
        }

        return file.load({
            id: htmlFileId
        }).getContents();
    }

    function replaceTemplateToken(html, token, value) {
        return String(html).split('{{' + token + '}}').join(value);
    }

    function safeJson(value) {
        return JSON.stringify(value).replace(/</g, '\\u003C');
    }

    function writeJson(context, obj) {
        context.response.setHeader({
            name: 'Content-Type',
            value: 'application/json; charset=UTF-8'
        });

        context.response.write(JSON.stringify(obj));
    }

    function getPurchaseOrders(filters) {
        var data = [];
        var vendorCache = {};

        if (!hasAnyFilter(filters)) {
            return data;
        }

        var poSearch = search.create({
            type: 'purchaseorder',
            settings: [
                {
                    name: 'consolidationtype',
                    value: 'ACCTTYPE'
                }
            ],
            filters: buildPurchaseOrderFilters(filters, false),
            columns: [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'tranid', sort: search.Sort.DESC }),
                search.createColumn({ name: 'entity' }),
                search.createColumn({ name: 'datecreated' }),
                search.createColumn({ name: 'memo' }),
                search.createColumn({ name: 'amount' }),
                search.createColumn({ name: FIELD_EMAIL_SENT }),
                search.createColumn({ name: FIELD_GROUP_NUMBER }),
                search.createColumn({ name: FIELD_VENDOR_MEMO })
            ]
        });

        runPagedSearchLimited(poSearch, MAX_UI_PO_ROWS, function (result) {
            var rowObj = buildPoDataFromResult(result, vendorCache);

            try {
                rowObj.poUrl = url.resolveRecord({
                    recordType: record.Type.PURCHASE_ORDER,
                    recordId: rowObj.poId,
                    isEditMode: false
                });
            } catch (linkErr) {
                rowObj.poUrl = '';
            }

            rowObj.dateCreated = result.getValue({ name: 'datecreated' }) || '';
            rowObj.amount = result.getValue({ name: 'amount' }) || '';

            data.push(rowObj);
        });

        return data;
    }

    function getPurchaseOrderOptions(filters) {
        var options = [];

        if (!hasAnyFilter(filters)) {
            return options;
        }

        var poSearch = search.create({
            type: 'purchaseorder',
            settings: [
                {
                    name: 'consolidationtype',
                    value: 'ACCTTYPE'
                }
            ],
            filters: buildPurchaseOrderFilters(filters, true),
            columns: [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'tranid', sort: search.Sort.DESC })
            ]
        });

        runPagedSearchLimited(poSearch, MAX_PO_OPTION_ROWS, function (result) {
            options.push({
                id: result.getValue({ name: 'internalid' }) || '',
                text: result.getValue({ name: 'tranid' }) || ''
            });
        });

        return options;
    }

    function getVendorOptions() {
        var options = [];

        var vendorSearch = search.create({
            type: search.Type.VENDOR,
            filters: [
                ['isinactive', 'is', 'F']
            ],
            columns: [
                search.createColumn({ name: 'entityid', sort: search.Sort.ASC }),
                search.createColumn({ name: 'altname' })
            ]
        });

        runPagedSearchLimited(vendorSearch, MAX_VENDOR_OPTION_ROWS, function (result) {
            var id = result.id;
            var entityId = result.getValue({ name: 'entityid' }) || '';
            var companyName = result.getValue({ name: 'altname' }) || '';
            var text = entityId;

            if (companyName) {
                text += ' - ' + companyName;
            }

            options.push({
                id: id,
                text: text
            });
        });

        return options;
    }

    function buildPurchaseOrderFilters(filters, ignorePoFilter) {
        var searchFilters = [
            ['type', 'anyof', 'PurchOrd'],
            'AND',
            ['mainline', 'is', 'T']
        ];

        if (filters.dateFrom && filters.dateTo) {
            searchFilters.push('AND');
            searchFilters.push([
                'datecreated',
                'within',
                convertHtmlDateToNsDate(filters.dateFrom),
                convertHtmlDateToNsDate(filters.dateTo)
            ]);
        } else if (filters.dateFrom) {
            searchFilters.push('AND');
            searchFilters.push(['datecreated', 'onorafter', convertHtmlDateToNsDate(filters.dateFrom)]);
        } else if (filters.dateTo) {
            searchFilters.push('AND');
            searchFilters.push(['datecreated', 'onorbefore', convertHtmlDateToNsDate(filters.dateTo)]);
        }

        if (filters.vendorId) {
            searchFilters.push('AND');
            searchFilters.push(['entity', 'anyof', filters.vendorId]);
        } else if (filters.vendorText) {
            var vendorIds = getVendorIdsByText(filters.vendorText);

            searchFilters.push('AND');

            if (vendorIds.length > 0) {
                searchFilters.push(['entity', 'anyof', vendorIds]);
            } else {
                searchFilters.push(['entity', 'anyof', '-999999']);
            }
        }

        if (filters.emailStatus === 'sent') {
            searchFilters.push('AND');
            searchFilters.push([FIELD_EMAIL_SENT, 'is', 'T']);
        }

        if (filters.emailStatus === 'not_sent') {
            searchFilters.push('AND');
            searchFilters.push([FIELD_EMAIL_SENT, 'is', 'F']);
        }

        if (filters.groupNumber) {
            searchFilters.push('AND');
            searchFilters.push([FIELD_GROUP_NUMBER, 'contains', filters.groupNumber]);
        }

        if (filters.resendGroup === 'T') {
            searchFilters.push('AND');
            searchFilters.push([FIELD_GROUP_NUMBER, 'isnotempty', '']);
        }

        if (!ignorePoFilter && filters.poId) {
            searchFilters.push('AND');
            searchFilters.push(['internalid', 'anyof', filters.poId]);
        } else if (filters.poText) {
            searchFilters.push('AND');
            searchFilters.push(['tranid', 'contains', filters.poText]);
        }

        return searchFilters;
    }

    function getVendorIdsByText(vendorText) {
        var ids = [];

        if (!vendorText) {
            return ids;
        }

        var vendorSearch = search.create({
            type: search.Type.VENDOR,
            filters: [
                ['isinactive', 'is', 'F'],
                'AND',
                [
                    ['entityid', 'contains', vendorText],
                    'OR',
                    ['altname', 'contains', vendorText]
                ]
            ],
            columns: [
                search.createColumn({ name: 'internalid' })
            ]
        });

        runPagedSearch(vendorSearch, function (result) {
            ids.push(result.id);
        });

        return ids;
    }

    function processSelectedPOs(selectedIdsText, actionMode, emailBodyMemo) {
        var response = {
            sent: [],
            skipped: [],
            errors: [],
            updatedIds: [],
            groupNumber: '',
            actionMode: actionMode || ''
        };

        var selectedIds = parseSelectedIds(selectedIdsText);

        if (selectedIds.length === 0) {
            response.errors.push('Please select at least one Purchase Order.');
            return response;
        }

        var poList = getSelectedPoDetails(selectedIds);

        if (poList.length === 0) {
            response.errors.push('Selected Purchase Orders were not found.');
            return response;
        }

        if (actionMode === 'resend') {
            var selectedGroupNumber = '';

            for (var rg = 0; rg < poList.length; rg++) {
                if (!poList[rg].groupNumber) {
                    response.errors.push('Resend Group is allowed only for Purchase Orders with Group Number populated.');
                    return response;
                }

                if (!selectedGroupNumber) {
                    selectedGroupNumber = poList[rg].groupNumber;
                } else if (String(selectedGroupNumber) !== String(poList[rg].groupNumber)) {
                    response.errors.push('Different Group Numbers are selected. Please select only one Group Number at a time.');
                    return response;
                }
            }

            poList = getPOsByGroupNumber(selectedGroupNumber);

            if (poList.length === 0) {
                response.errors.push('No Purchase Orders found for Group Number: ' + selectedGroupNumber);
                return response;
            }
        }

        var firstVendorId = poList[0].vendorId || '';
        var firstVendorName = poList[0].vendorName || '';
        var firstVendorEmail = poList[0].vendorEmail || '';

        for (var v = 0; v < poList.length; v++) {
            if (String(poList[v].vendorId || '') !== String(firstVendorId || '')) {
                response.errors.push('Different vendors selected. Please select Purchase Orders for only one vendor at a time.');
                return response;
            }
        }

        if (!firstVendorEmail) {
            response.errors.push('Vendor email address is missing for ' + firstVendorName + '.');
            return response;
        }

        var group = {
            vendorId: firstVendorId,
            vendorName: firstVendorName,
            vendorEmail: firstVendorEmail,
            poIds: [],
            poNumbers: [],
            poList: []
        };

        for (var i = 0; i < poList.length; i++) {
            var po = poList[i];

            if (actionMode === 'send') {
                if (po.emailSent || po.groupNumber) {
                    response.skipped.push(po.tranId + ' skipped because it already belongs to Group Number ' + po.groupNumber + '. Use Resend Group checkbox.');
                    continue;
                }
            }

            if (!po.vendorId) {
                response.skipped.push(po.tranId + ' skipped because vendor is missing.');
                continue;
            }

            group.poIds.push(po.poId);
            group.poNumbers.push(po.tranId);
            group.poList.push(po);
        }

        if (group.poIds.length === 0) {
            response.errors.push('No valid Purchase Orders found for email sending.');
            return response;
        }

        try {
            var groupNumber = '';

            if (actionMode === 'resend') {
                groupNumber = group.poList[0].groupNumber || '';
            } else {
                groupNumber = generateGroupNumber(group.vendorId);
            }

            var mergedPdf = createMergedPoPdf(group.poIds, group.vendorName);
            var emailBody = buildMemoEmailBody(group.poList, emailBodyMemo);

            email.send({
                author: runtime.getCurrentUser().id,
                recipients: Number(group.vendorId),
                subject: EMAIL_SUBJECT_PREFIX + ' - ' + group.poNumbers.join(', '),
                body: emailBody,
                attachments: [mergedPdf],
                relatedRecords: {
                    entityId: Number(group.vendorId)
                }
            });

            updatePOAfterEmail(group.poIds, groupNumber, emailBodyMemo);

            response.updatedIds = group.poIds;
            response.groupNumber = groupNumber;

            response.sent.push(group.vendorName + ' - ' + group.poNumbers.join(', ') + ' | Group Number: ' + groupNumber);

            log.audit('PO Email Sent', {
                actionMode: actionMode,
                vendorId: group.vendorId,
                vendorName: group.vendorName,
                vendorEmail: group.vendorEmail,
                poNumbers: group.poNumbers,
                groupNumber: groupNumber
            });

        } catch (e) {
            log.error('Email Send Error', {
                vendorId: group.vendorId,
                vendorName: group.vendorName,
                poNumbers: group.poNumbers,
                error: e
            });

            response.errors.push(group.vendorName + ' - ' + e.message);
        }

        return response;
    }

    function getSelectedPoDetails(selectedIds) {
        var data = [];
        var vendorCache = {};

        var poSearch = search.create({
            type: 'purchaseorder',
            filters: [
                ['type', 'anyof', 'PurchOrd'],
                'AND',
                ['mainline', 'is', 'T'],
                'AND',
                ['internalid', 'anyof', selectedIds]
            ],
            columns: [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'tranid' }),
                search.createColumn({ name: 'entity' }),
                search.createColumn({ name: 'memo' }),
                search.createColumn({ name: FIELD_EMAIL_SENT }),
                search.createColumn({ name: FIELD_GROUP_NUMBER }),
                search.createColumn({ name: FIELD_VENDOR_MEMO })
            ]
        });

        runPagedSearch(poSearch, function (result) {
            data.push(buildPoDataFromResult(result, vendorCache));
        });

        return data;
    }

    function getPOsByGroupNumber(groupNumber) {
        var data = [];
        var vendorCache = {};

        var poSearch = search.create({
            type: 'purchaseorder',
            filters: [
                ['type', 'anyof', 'PurchOrd'],
                'AND',
                ['mainline', 'is', 'T'],
                'AND',
                [FIELD_GROUP_NUMBER, 'is', groupNumber]
            ],
            columns: [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'tranid', sort: search.Sort.ASC }),
                search.createColumn({ name: 'entity' }),
                search.createColumn({ name: 'memo' }),
                search.createColumn({ name: FIELD_EMAIL_SENT }),
                search.createColumn({ name: FIELD_GROUP_NUMBER }),
                search.createColumn({ name: FIELD_VENDOR_MEMO })
            ]
        });

        runPagedSearch(poSearch, function (result) {
            data.push(buildPoDataFromResult(result, vendorCache));
        });

        return data;
    }

    function buildPoDataFromResult(result, vendorCache) {
        var poId = result.getValue({ name: 'internalid' });
        var vendorId = result.getValue({ name: 'entity' });
        var vendorInfo = getVendorInfo(vendorId, vendorCache);
        var emailSentValue = result.getValue({ name: FIELD_EMAIL_SENT });

        return {
            poId: poId,
            poUrl: '',
            tranId: result.getValue({ name: 'tranid' }) || '',
            vendorId: vendorId || '',
            vendorName: vendorInfo.name || result.getText({ name: 'entity' }) || '',
            vendorEmail: vendorInfo.email || '',
            dateCreated: '',
            memo: result.getValue({ name: 'memo' }) || '',
            vendorMemo: result.getValue({ name: FIELD_VENDOR_MEMO }) || '',
            groupNumber: result.getValue({ name: FIELD_GROUP_NUMBER }) || '',
            amount: '',
            emailSent: emailSentValue === true || emailSentValue === 'T'
        };
    }

    function getVendorInfo(vendorId, vendorCache) {
        if (!vendorId) {
            return {
                name: '',
                email: ''
            };
        }

        if (vendorCache[vendorId]) {
            return vendorCache[vendorId];
        }

        var info = {
            name: '',
            email: ''
        };

        try {
            var lookup = search.lookupFields({
                type: search.Type.VENDOR,
                id: vendorId,
                columns: [
                    'entityid',
                    'altname',
                    'email'
                ]
            });

            info.name = lookup.altname || lookup.entityid || '';
            info.email = lookup.email || '';

        } catch (e) {
            log.error('Vendor Lookup Error', {
                vendorId: vendorId,
                error: e
            });
        }

        vendorCache[vendorId] = info;
        return info;
    }

    function createMergedPoPdf(poIds, vendorName) {
        var tempFileIds = [];

        try {
            var pdfSetXml = '';

            pdfSetXml += '<?xml version="1.0"?>';
            pdfSetXml += '<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">';
            pdfSetXml += '<pdfset>';

            for (var i = 0; i < poIds.length; i++) {
                var poPdf = render.transaction({
                    entityId: Number(poIds[i]),
                    printMode: render.PrintMode.PDF
                });

                poPdf.name = 'TEMP_PO_' + poIds[i] + '_' + new Date().getTime() + '.pdf';
                poPdf.folder = TEMP_FOLDER_ID;
                poPdf.isOnline = true;

                var fileId = poPdf.save();
                tempFileIds.push(fileId);

                var savedFile = file.load({
                    id: fileId
                });

                var fullFileUrl = getFullFileUrl(savedFile.url);
                var safeFileUrl = escapeXmlAttribute(fullFileUrl);

                pdfSetXml += '<pdf src="' + safeFileUrl + '"/>';
            }

            pdfSetXml += '</pdfset>';

            log.debug('Final PDF Merge XML', pdfSetXml);

            var mergedPdf = render.xmlToPdf({
                xmlString: pdfSetXml
            });

            mergedPdf.name = cleanFileName('Merged_PO_' + vendorName + '.pdf');

            return mergedPdf;

        } finally {
            for (var j = 0; j < tempFileIds.length; j++) {
                try {
                    file.delete({
                        id: tempFileIds[j]
                    });
                } catch (deleteErr) {
                    log.error('Temp File Delete Error', {
                        fileId: tempFileIds[j],
                        error: deleteErr
                    });
                }
            }
        }
    }

    function buildMemoEmailBody(poList, emailBodyMemo) {
        if (emailBodyMemo) {
            return convertTextToHtml(emailBodyMemo);
        }

        if (poList.length > 0 && poList[0].vendorMemo) {
            return convertTextToHtml(poList[0].vendorMemo);
        }

        var body = '';

        if (poList.length === 1) {
            body = poList[0].memo || '';

            if (!body) {
                body = 'Please find attached the Purchase Order PDF.';
            }

            return convertTextToHtml(body);
        }

        body += '<div style="font-family:Arial, sans-serif; font-size:13px;">';
        body += '<p>Please find attached the Purchase Order PDF.</p>';
        body += '</div>';

        return body;
    }

    function updatePOAfterEmail(poIds, groupNumber, emailBodyMemo) {
        for (var i = 0; i < poIds.length; i++) {
            try {
                var valuesObj = {};

                valuesObj[FIELD_EMAIL_SENT] = true;
                valuesObj[FIELD_GROUP_NUMBER] = groupNumber;

                if (emailBodyMemo) {
                    valuesObj[FIELD_VENDOR_MEMO] = emailBodyMemo;
                }

                record.submitFields({
                    type: record.Type.PURCHASE_ORDER,
                    id: poIds[i],
                    values: valuesObj,
                    options: {
                        enableSourcing: false,
                        ignoreMandatoryFields: true
                    }
                });

            } catch (e) {
                log.error('PO Update After Email Error', {
                    poId: poIds[i],
                    groupNumber: groupNumber,
                    error: e
                });
            }
        }
    }

    function getFullFileUrl(fileUrl) {
        if (!fileUrl) {
            return '';
        }

        fileUrl = String(fileUrl);

        if (fileUrl.indexOf('https://') === 0 || fileUrl.indexOf('http://') === 0) {
            return fileUrl;
        }

        if (fileUrl.indexOf('//') === 0) {
            return 'https:' + fileUrl;
        }

        var domain = url.resolveDomain({
            hostType: url.HostType.APPLICATION
        });

        if (fileUrl.charAt(0) !== '/') {
            fileUrl = '/' + fileUrl;
        }

        return 'https://' + domain + fileUrl;
    }

    function escapeXmlAttribute(value) {
        if (value === null || value === undefined) {
            return '';
        }

        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/'/g, '&apos;');
    }

    function generateGroupNumber(vendorId) {
        var d = new Date();

        var year = d.getFullYear();
        var month = pad2(d.getMonth() + 1);
        var day = pad2(d.getDate());
        var hour = pad2(d.getHours());
        var minute = pad2(d.getMinutes());
        var second = pad2(d.getSeconds());

        return vendorId + '_' + year + month + day + '_' + hour + minute + second;
    }

    function pad2(value) {
        value = String(value);

        if (value.length < 2) {
            value = '0' + value;
        }

        return value;
    }

    function convertHtmlDateToNsDate(value) {
        if (!value) {
            return '';
        }

        value = String(value);

        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            var parts = value.split('-');
            return parts[1] + '/' + parts[2] + '/' + parts[0];
        }

        return value;
    }

    function parseSelectedIds(selectedIdsText) {
        var ids = [];

        if (!selectedIdsText) {
            return ids;
        }

        var parts = selectedIdsText.split(',');

        for (var i = 0; i < parts.length; i++) {
            var id = parts[i];

            if (id) {
                id = id.replace(/^\s+|\s+$/g, '');
            }

            if (id) {
                ids.push(id);
            }
        }

        return ids;
    }

    function runPagedSearchLimited(searchObj, maxRows, callback) {
        var pagedData = searchObj.runPaged({
            pageSize: 1000
        });
        var count = 0;

        for (var i = 0; i < pagedData.pageRanges.length; i++) {
            var page = pagedData.fetch({
                index: pagedData.pageRanges[i].index
            });

            for (var j = 0; j < page.data.length; j++) {
                if (maxRows && count >= maxRows) {
                    return;
                }

                callback(page.data[j]);
                count++;
            }
        }
    }

    function runPagedSearch(searchObj, callback) {
        var pagedData = searchObj.runPaged({
            pageSize: 1000
        });

        for (var i = 0; i < pagedData.pageRanges.length; i++) {
            var page = pagedData.fetch({
                index: pagedData.pageRanges[i].index
            });

            for (var j = 0; j < page.data.length; j++) {
                callback(page.data[j]);
            }
        }
    }

    function cleanFileName(name) {
        if (!name) {
            return 'Merged_PO.pdf';
        }

        return name.replace(/[\\\/:*?"<>|]/g, '_');
    }

    function convertTextToHtml(value) {
        if (!value) {
            return '';
        }

        return escapeHtml(value).replace(/\n/g, '<br/>');
    }

    function escapeHtml(value) {
        if (value === null || value === undefined) {
            return '';
        }

        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    return {
        onRequest: onRequest
    };
});