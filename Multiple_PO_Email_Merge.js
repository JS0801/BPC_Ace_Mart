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
    'N/record',
    'N/query',
    'N/url',
    'N/log'
], function (
    serverWidget,
    search,
    render,
    email,
    runtime,
    file,
    record,
    query,
    url,
    log
) {

    var TEMP_FOLDER_ID = 8768;
    var PARAM_HTML_FILE_ID = 'custscript_po_email_html_file';
    var GROUP_PDF_TEMPLATE_ID = 'CUSTTMPL_CUSTOM_GROUPED_POS_PDFHTML_TEMPLATE';
    var EMAIL_TEMPLATE_SCRIPT_ID = 'custemailtmpl_po_group_email';

    var FIELD_EMAIL_SENT = 'custbody_email_sent';
    var FIELD_GROUP_NUMBER = 'custbody_group_number';
    var FIELD_VENDOR_MEMO = 'custbody_vendor_memo';
    var FIELD_STOCK_PO = 'custbody_ace_join_stockpo';
    var FIELD_SUBSIDIARY = 'subsidiary';
    var FIELD_LOCATION = 'location';
    var FIELD_LOCATION_TYPE = 'locationtype';
    var FIELD_VENDOR_SEND_PO_EMAIL = 'custentity_bpc_send_group_po_email';
    var FIELD_VENDOR_PO_EMAIL = 'custentity_bpc_po_email_address';
    var WAREHOUSE_LOCATION_TYPE_ID = '2';

    var CUSTOM_REC_TYPE = 'customrecord_grouped_pos';
    var CREC_GROUP_NUMBER = 'custrecord_group_number';
    var CREC_PO_NUMBER = 'custrecord_po_number';
    var CREC_MASTER_MEMO = 'custrecord_master_memo';
    var CREC_EMAIL_SUBJECT = 'custrecord_email_subject';
    var CREC_EMAIL_BODY = 'custrecord_email_body';
    var CREC_DATE_SENT = 'custrecord_date_sent';
    var CREC_LAST_SENT_DATE = 'custrecord_last_sent_date';
    var CREC_SENDER = 'custrecord_sender';
    var CREC_RECIPIENT = 'custrecord_recipient';
    var CREC_VENDOR = 'custrecord_vendor';
    var CREC_EMAIL_STATUS = 'custrecord_email_status';
    var CREC_REVISION_NUMBER = 'custrecord_revision_number';
    var CREC_GENERATED_PDF = 'custrecord_generated_pdf';
    var CREC_ERROR_LOG = 'custrecord_bpc_error_log';

    var STATUS_SENT_ID = 1;
    var STATUS_RESEND_ID = 2;
    var STATUS_FAILED_ID = 3;
    var STATUS_GROUPED_ID = 4;

    var FLD_ACTION = 'custpage_action_mode';
    var FLD_SELECTED_IDS = 'custpage_selected_po_ids';
    var FLD_SUBSIDIARY = 'custpage_filter_subsidiary';
    var FLD_LOCATION = 'custpage_filter_location';
    var FLD_PO = 'custpage_filter_po';
    var FLD_PO_TEXT = 'custpage_filter_po_text';
    var FLD_VENDOR = 'custpage_filter_vendor';
    var FLD_VENDOR_TEXT = 'custpage_filter_vendor_text';
    var FLD_DATE_FROM = 'custpage_filter_date_from';
    var FLD_DATE_TO = 'custpage_filter_date_to';
    var FLD_EMAIL_STATUS = 'custpage_filter_email_status';
    var FLD_STOCK_PO = 'custpage_filter_stock_po';
    var FLD_GROUP_NUMBER = 'custpage_filter_group_number';
    var FLD_EMAIL_SUBJECT = 'custpage_email_subject';
    var FLD_EMAIL_BODY_MEMO = 'custpage_email_body_memo';
    var FLD_GROUP_MEMO = 'custpage_master_memo';
    var FLD_CUSTOM_MEMO_MAP = 'custpage_custom_memo_map';
    var FLD_TEMPLATE_CONTEXT = 'custpage_email_template_context';
    var FLD_AJAX = 'custpage_ajax';
    var FLD_AJAX_ACTION = 'custpage_ajax_action';

    var MAX_UI_PO_ROWS = 500;
    var MAX_SUBSIDIARY_OPTION_ROWS = 1000;
    var MAX_LOCATION_OPTION_ROWS = 10000;
    var MAX_PO_OPTION_ROWS = 10000;
    var MAX_VENDOR_OPTION_ROWS = 10000;
    var MAX_MERGED_PDF_BYTES = 9 * 1024 * 1024;
    var emailTemplateInternalId = null;

    function onRequest(context) {
        var request = context.request;
        var params = request.parameters || {};
        var isAjax = params[FLD_AJAX] === 'T';

        try {
            var filters = {
                subsidiaryId: params[FLD_SUBSIDIARY] || '',
                locationId: params[FLD_LOCATION] || '',
                poId: params[FLD_PO] || '',
                poText: params[FLD_PO_TEXT] || '',
                vendorId: params[FLD_VENDOR] || '',
                vendorText: params[FLD_VENDOR_TEXT] || '',
                dateFrom: params[FLD_DATE_FROM] || '',
                dateTo: params[FLD_DATE_TO] || '',
                emailStatus: params[FLD_EMAIL_STATUS] || '',
                stockPo: params[FLD_STOCK_PO] || '',
                groupNumber: params[FLD_GROUP_NUMBER] || ''
            };

            if (isAjax) {
                var action = params[FLD_AJAX_ACTION] || params[FLD_ACTION] || 'filter';

                if (action === 'merge_template') {
                    var emailTemplate = getEmailTemplatePreview({
                        selectedIdsText: params[FLD_SELECTED_IDS] || '',
                        filters: filters,
                        groupMemo: params[FLD_GROUP_MEMO] || '',
                        customMemoMap: parseJsonObject(params[FLD_CUSTOM_MEMO_MAP]),
                        templateContext: parseJsonObject(params[FLD_TEMPLATE_CONTEXT])
                    });

                    writeJson(context, {
                        success: !emailTemplate.error,
                        emailTemplate: emailTemplate,
                        emailSubject: emailTemplate.subject || '',
                        emailBody: emailTemplate.body || '',
                        message: emailTemplate.error || ''
                    });
                    return;
                }

                if (action === 'send' || action === 'resend') {
                    var resultMessage = processSelectedPOs({
                        selectedIdsText: params[FLD_SELECTED_IDS] || '',
                        emailSubject: params[FLD_EMAIL_SUBJECT] || '',
                        emailBodyText: params[FLD_EMAIL_BODY_MEMO] || '',
                        groupMemo: params[FLD_GROUP_MEMO] || '',
                        customMemoMap: parseJsonObject(params[FLD_CUSTOM_MEMO_MAP])
                    });

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
                    locationOptions: getLocationOptions(filters.subsidiaryId),
                    poData: hasRequiredLocationFilters(filters) ? getPurchaseOrders(filters) : [],
                    poOptions: hasRequiredLocationFilters(filters) ? getPurchaseOrderOptions(filters) : [],
                    refreshTable: true
                });
                return;
            }

            showPage(context, filters);
        } catch (e) {
            log.error('PO Email Sender Error', e);
            if (isAjax) {
                writeJson(context, { success: false, message: e.name + ' : ' + e.message });
                return;
            }
            context.response.write('<h3>Unexpected System Error Encountered</h3><pre>' + escapeHtml(e.name + ' : ' + e.message) + '</pre>');
        }
    }

    function showPage(context, filters) {
        var form = serverWidget.createForm({ title: ' ' });

        form.addField({ id: FLD_ACTION, type: serverWidget.FieldType.TEXT, label: 'Action' })
            .updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });

        form.addField({ id: FLD_SELECTED_IDS, type: serverWidget.FieldType.LONGTEXT, label: 'Selected PO IDs' })
            .updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });

        var shouldLoadPoData = hasRequiredLocationFilters(filters);
        var currentScript = runtime.getCurrentScript();
        var suiteletUrl = url.resolveScript({
            scriptId: currentScript.id,
            deploymentId: currentScript.deploymentId,
            returnExternalUrl: false
        });

        var htmlFld = form.addField({ id: 'custpage_inline_ui', type: serverWidget.FieldType.INLINEHTML, label: 'PO Email UI' });
        htmlFld.defaultValue = buildPageHtmlFromTemplate({
            suiteletUrl: suiteletUrl,
            filters: filters,
            poData: shouldLoadPoData ? getPurchaseOrders(filters) : [],
            poOptions: shouldLoadPoData ? getPurchaseOrderOptions(filters) : [],
            subsidiaryOptions: getSubsidiaryOptions(),
            locationOptions: getLocationOptions(filters.subsidiaryId),
            vendorOptions: getVendorOptions(),
            emailTemplate: getEmailTemplatePreview({
                selectedIdsText: '',
                filters: filters,
                groupMemo: '',
                customMemoMap: {}
            })
        });

        context.response.writePage(form);
    }

    function buildPageHtmlFromTemplate(dataObj) {
        var htmlFileId = runtime.getCurrentScript().getParameter({ name: PARAM_HTML_FILE_ID });
        if (!htmlFileId) {
            throw new Error('Missing HTML file script parameter: ' + PARAM_HTML_FILE_ID);
        }

        var html = file.load({ id: htmlFileId }).getContents();
        var fieldIds = {
            action: FLD_ACTION,
            selectedIds: FLD_SELECTED_IDS,
            subsidiary: FLD_SUBSIDIARY,
            location: FLD_LOCATION,
            po: FLD_PO,
            poText: FLD_PO_TEXT,
            vendor: FLD_VENDOR,
            vendorText: FLD_VENDOR_TEXT,
            dateFrom: FLD_DATE_FROM,
            dateTo: FLD_DATE_TO,
            emailStatus: FLD_EMAIL_STATUS,
            stockPo: FLD_STOCK_PO,
            groupNumber: FLD_GROUP_NUMBER,
            emailBodyMemo: FLD_EMAIL_BODY_MEMO,
            emailSubject: FLD_EMAIL_SUBJECT,
            masterMemo: FLD_GROUP_MEMO,
            customMemoMap: FLD_CUSTOM_MEMO_MAP,
            templateContext: FLD_TEMPLATE_CONTEXT,
            ajax: FLD_AJAX,
            ajaxAction: FLD_AJAX_ACTION
        };

        var tokens = {
            SUITELET_URL_JSON: dataObj.suiteletUrl || '',
            FIELD_IDS_JSON: fieldIds,
            FILTERS_JSON: dataObj.filters || {},
            PO_DATA_JSON: dataObj.poData || [],
            PO_OPTIONS_JSON: dataObj.poOptions || [],
            SUBSIDIARY_OPTIONS_JSON: dataObj.subsidiaryOptions || [],
            LOCATION_OPTIONS_JSON: dataObj.locationOptions || [],
            VENDOR_OPTIONS_JSON: dataObj.vendorOptions || [],
            EMAIL_TEMPLATE_JSON: dataObj.emailTemplate || {},
            RESULT_MESSAGE_JSON: null,
            EMAIL_BODY_MEMO_JSON: dataObj.emailTemplate && dataObj.emailTemplate.body ? dataObj.emailTemplate.body : '',
            EMAIL_SUBJECT_JSON: dataObj.emailTemplate && dataObj.emailTemplate.subject ? dataObj.emailTemplate.subject : ''
        };

        for (var token in tokens) {
            if (tokens.hasOwnProperty(token)) {
                html = html.split('{{' + token + '}}').join(JSON.stringify(tokens[token]).replace(/</g, '\\u003C'));
            }
        }

        return html;
    }

    function getPurchaseOrders(filters) {
        var data = [];
        var vendorCache = {};
        if (!hasRequiredLocationFilters(filters)) return data;

        var poSearch = search.create({
            type: 'purchaseorder',
            settings: [{ name: 'consolidationtype', value: 'ACCTTYPE' }],
            filters: buildPurchaseOrderFilters(filters, false),
            columns: [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'tranid', sort: search.Sort.DESC }),
                search.createColumn({ name: 'entity' }),
                search.createColumn({ name: 'trandate' }),
                search.createColumn({ name: 'memo' }),
                search.createColumn({ name: 'amount' }),
                search.createColumn({ name: FIELD_EMAIL_SENT }),
                search.createColumn({ name: FIELD_GROUP_NUMBER }),
                search.createColumn({ name: FIELD_VENDOR_MEMO }),
                search.createColumn({ name: FIELD_STOCK_PO })
            ]
        });

        runSearch(poSearch, MAX_UI_PO_ROWS, function (result) {
            var row = buildPoRow(result, vendorCache);
            try {
                row.poUrl = url.resolveRecord({ recordType: record.Type.PURCHASE_ORDER, recordId: row.poId, isEditMode: false });
            } catch (e) {
                row.poUrl = '';
            }
            row.tranDate = result.getValue({ name: 'trandate' }) || '';
            row.amount = result.getValue({ name: 'amount' }) || '';
            data.push(row);
        });

        var groupTrackingMap = getGroupTrackingMap(data);
        for (var i = 0; i < data.length; i++) {
            if (data[i].groupNumber && groupTrackingMap[data[i].groupNumber]) {
                data[i].emailSentDate = groupTrackingMap[data[i].groupNumber].dateSent || '';
                data[i].trackingStatus = groupTrackingMap[data[i].groupNumber].statusId || '';
                data[i].groupMemo = groupTrackingMap[data[i].groupNumber].groupMemo || '';
            }

            if (String(data[i].trackingStatus) === String(STATUS_FAILED_ID)) {
                data[i].emailStatus = 'failed';
            } else if (data[i].emailSent) {
                data[i].emailStatus = 'sent';
            } else if (data[i].groupNumber) {
                data[i].emailStatus = 'grouped';
            } else {
                data[i].emailStatus = 'not_sent';
            }
        }

        return data;
    }

    function getPurchaseOrderOptions(filters) {
        var options = [];
        if (!hasRequiredLocationFilters(filters)) return options;

        var poSearch = search.create({
            type: 'purchaseorder',
            settings: [{ name: 'consolidationtype', value: 'ACCTTYPE' }],
            filters: buildPurchaseOrderOptionFilters(filters),
            columns: [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'tranid', sort: search.Sort.DESC })
            ]
        });

        runSearch(poSearch, MAX_PO_OPTION_ROWS, function (result) {
            options.push({
                id: result.getValue({ name: 'internalid' }) || '',
                text: result.getValue({ name: 'tranid' }) || ''
            });
        });

        return options;
    }

    function getSubsidiaryOptions() {
        var options = [];
        var subsidiarySearch = search.create({
            type: search.Type.SUBSIDIARY,
            filters: [['isinactive', 'is', 'F'], 'AND', ["iselimination","is","F"]],
            columns: [search.createColumn({ name: 'namenohierarchy', sort: search.Sort.ASC })]
        });

        runSearch(subsidiarySearch, MAX_SUBSIDIARY_OPTION_ROWS, function (result) {
            options.push({
                id: result.id,
                text: result.getValue({ name: 'namenohierarchy' }) || ''
            });
        });

        return options;
    }

    function getLocationOptions(subsidiaryId) {
        var options = [];
        if (!subsidiaryId) return options;

        var locationSearch = search.create({
            type: search.Type.LOCATION,
            filters: [
                ['isinactive', 'is', 'F'],
                'AND',
                [FIELD_LOCATION_TYPE, 'anyof', WAREHOUSE_LOCATION_TYPE_ID],
                'AND',
                [FIELD_SUBSIDIARY, 'anyof', subsidiaryId]
            ],
            columns: [search.createColumn({ name: 'name', sort: search.Sort.ASC })]
        });

        runSearch(locationSearch, MAX_LOCATION_OPTION_ROWS, function (result) {
            options.push({
                id: result.id,
                text: result.getValue({ name: 'name' }) || ''
            });
        });

        return options;
    }

    function getVendorOptions() {
        var options = [];
        var vendorSearch = search.create({
            type: search.Type.VENDOR,
            filters: [['isinactive', 'is', 'F']],
            columns: [
                search.createColumn({ name: 'entityid', sort: search.Sort.ASC }),
                search.createColumn({ name: 'altname' }),
                search.createColumn({ name: FIELD_VENDOR_SEND_PO_EMAIL }),
                search.createColumn({ name: FIELD_VENDOR_PO_EMAIL })
            ]
        });

        runSearch(vendorSearch, MAX_VENDOR_OPTION_ROWS, function (result) {
            var entityId = result.getValue({ name: 'entityid' }) || '';
            var companyName = result.getValue({ name: 'altname' }) || '';
            options.push({
                id: result.id,
                text: companyName ? (entityId + ' - ' + companyName) : entityId,
                sendPoEmail: result.getValue({ name: FIELD_VENDOR_SEND_PO_EMAIL }) === true || result.getValue({ name: FIELD_VENDOR_SEND_PO_EMAIL }) === 'T',
                poEmailAddress: result.getValue({ name: FIELD_VENDOR_PO_EMAIL }) || ''
            });
        });

        return options;
    }

    function buildPurchaseOrderFilters(filters, ignorePoFilter) {
        var searchFilters = buildBasePurchaseOrderFilters(filters);

        if (filters.dateFrom && filters.dateTo) {
            searchFilters.push('AND', ['trandate', 'within', convertHtmlDateToNsDate(filters.dateFrom), convertHtmlDateToNsDate(filters.dateTo)]);
        } else if (filters.dateFrom) {
            searchFilters.push('AND', ['trandate', 'onorafter', convertHtmlDateToNsDate(filters.dateFrom)]);
        } else if (filters.dateTo) {
            searchFilters.push('AND', ['trandate', 'onorbefore', convertHtmlDateToNsDate(filters.dateTo)]);
        }

        if (filters.vendorId) {
            searchFilters.push('AND', ['entity', 'anyof', filters.vendorId]);
        } else if (filters.vendorText) {
            var vendorIds = getVendorIdsByText(filters.vendorText);
            searchFilters.push('AND', ['entity', 'anyof', vendorIds.length ? vendorIds : ['-999999']]);
        }

        if (filters.emailStatus === 'sent') {
            searchFilters.push('AND', [FIELD_EMAIL_SENT, 'is', 'T']);
        } else if (filters.emailStatus === 'not_sent') {
            searchFilters.push('AND', [FIELD_EMAIL_SENT, 'is', 'F'], 'AND', [FIELD_GROUP_NUMBER, 'isempty', '']);
        } else if (filters.emailStatus === 'grouped') {
            searchFilters.push('AND', [FIELD_EMAIL_SENT, 'is', 'F'], 'AND', [FIELD_GROUP_NUMBER, 'isnotempty', '']);
        } else if (filters.emailStatus === 'failed') {
            var failedGroups = getGroupNumbersByStatus(STATUS_FAILED_ID);
            searchFilters.push('AND');
            if (failedGroups.length) {
                var failedFilter = [];
                for (var fg = 0; fg < failedGroups.length; fg++) {
                    if (fg > 0) failedFilter.push('OR');
                    failedFilter.push([FIELD_GROUP_NUMBER, 'is', failedGroups[fg]]);
                }
                searchFilters.push(failedFilter);
            } else {
                searchFilters.push([FIELD_GROUP_NUMBER, 'is', '-NO_FAILED_GROUPS-']);
            }
        }

        if (filters.groupNumber) {
            searchFilters.push('AND', [FIELD_GROUP_NUMBER, 'contains', filters.groupNumber]);
        }

        if (filters.stockPo === 'yes') {
            searchFilters.push('AND', [FIELD_STOCK_PO, 'is', 'T']);
        } else if (filters.stockPo === 'no') {
            searchFilters.push('AND', [FIELD_STOCK_PO, 'is', 'F']);
        }

        if (!ignorePoFilter && filters.poId) {
            searchFilters.push('AND', ['internalid', 'anyof', filters.poId]);
        } else if (filters.poText) {
            searchFilters.push('AND', ['tranid', 'contains', filters.poText]);
        }

        return searchFilters;
    }

    function buildPurchaseOrderOptionFilters(filters) {
        return buildBasePurchaseOrderFilters(filters);
    }

    function buildBasePurchaseOrderFilters(filters) {
        var searchFilters = [['type', 'anyof', 'PurchOrd'], 'AND', ['mainline', 'is', 'T']];

        if (filters.subsidiaryId) {
            searchFilters.push('AND', [FIELD_SUBSIDIARY, 'anyof', filters.subsidiaryId]);
        }

        if (filters.locationId) {
            searchFilters.push('AND', [FIELD_LOCATION, 'anyof', filters.locationId]);
        }

        return searchFilters;
    }

    function getVendorIdsByText(vendorText) {
        var ids = [];
        var vendorSearch = search.create({
            type: search.Type.VENDOR,
            filters: [['isinactive', 'is', 'F'], 'AND', [['entityid', 'contains', vendorText], 'OR', ['altname', 'contains', vendorText]]],
            columns: [search.createColumn({ name: 'internalid' })]
        });

        runSearch(vendorSearch, 0, function (result) {
            ids.push(result.id);
        });

        return ids;
    }

    function getGroupNumbersByStatus(statusId) {
        var groups = [];
        var trackingSearch = search.create({
            type: CUSTOM_REC_TYPE,
            filters: [[CREC_EMAIL_STATUS, 'anyof', statusId]],
            columns: [search.createColumn({ name: CREC_GROUP_NUMBER })]
        });

        runSearch(trackingSearch, 0, function (result) {
            var groupNumber = result.getValue({ name: CREC_GROUP_NUMBER }) || '';
            if (groupNumber) groups.push(groupNumber);
        });

        return groups;
    }

    function buildPoRow(result, vendorCache) {
        var poId = result.getValue({ name: 'internalid' });
        var vendorId = result.getValue({ name: 'entity' });
        var vendorInfo = getVendorInfo(vendorId, vendorCache);
        var emailSentValue = result.getValue({ name: FIELD_EMAIL_SENT });
        var stockPoValue = result.getValue({ name: FIELD_STOCK_PO });

        return {
            poId: poId,
            poUrl: '',
            tranId: result.getValue({ name: 'tranid' }) || '',
            vendorId: vendorId || '',
            vendorName: vendorInfo.name || result.getText({ name: 'entity' }) || '',
            vendorEmail: vendorInfo.email || '',
            vendorSendPoEmail: !!vendorInfo.sendPoEmail,
            tranDate: result.getValue({ name: 'trandate' }) || '',
            emailSentDate: '',
            emailStatus: '',
            trackingStatus: '',
            groupMemo: '',
            memo: result.getValue({ name: 'memo' }) || '',
            vendorMemo: result.getValue({ name: FIELD_VENDOR_MEMO }) || '',
            stockPo: stockPoValue === true || stockPoValue === 'T',
            groupNumber: result.getValue({ name: FIELD_GROUP_NUMBER }) || '',
            amount: result.getValue({ name: 'amount' }) || '',
            emailSent: emailSentValue === true || emailSentValue === 'T'
        };
    }

    function getVendorInfo(vendorId, vendorCache) {
        if (!vendorId) return { name: '', email: '' };
        if (vendorCache[vendorId]) return vendorCache[vendorId];

        var info = { name: '', email: '', sendPoEmail: false };
        try {
            var lookup = search.lookupFields({
                type: search.Type.VENDOR,
                id: vendorId,
                columns: ['entityid', 'altname', FIELD_VENDOR_PO_EMAIL, FIELD_VENDOR_SEND_PO_EMAIL]
            });
            info.name = lookup.altname || lookup.entityid || '';
            info.email = lookup[FIELD_VENDOR_PO_EMAIL] || '';
            info.sendPoEmail = lookup[FIELD_VENDOR_SEND_PO_EMAIL] === true || lookup[FIELD_VENDOR_SEND_PO_EMAIL] === 'T';
        } catch (e) {
            log.error('Vendor Lookup Error', { vendorId: vendorId, error: e });
        }

        vendorCache[vendorId] = info;
        return info;
    }

    function getEmailTemplatePreview(options) {
        options = options || {};
        var templateId = '';

        try {
            var selectedIds = parseIds(options.selectedIdsText || '');
            var selectedPOs = selectedIds.length ? loadPOsByIds(selectedIds) : [];
            var clientContext = options.templateContext || {};
            var poList = getTemplatePoList(selectedPOs, options.filters || {}, clientContext);
            var context = buildEmailTemplateContext(poList, options.filters || {}, options.groupMemo || '', options.customMemoMap || {}, clientContext);
            templateId = resolveEmailTemplateInternalId();
            var mergeOptions = { templateId: Number(templateId) };

            if (context.vendorId) {
                mergeOptions.entity = { type: record.Type.VENDOR, id: Number(context.vendorId) };
                mergeOptions.recipient = { type: record.Type.VENDOR, id: Number(context.vendorId) };
            }

            if (context.transactionId) {
                mergeOptions.transactionId = Number(context.transactionId);
            }

            var mergeResult;
            try {
                mergeResult = render.mergeEmail(mergeOptions);
            } catch (mergeError) {
                log.audit('Email Template Merge Fallback', mergeError);
                mergeResult = loadRawEmailTemplate(templateId);
            }

            return {
                subject: replaceEmailTemplateTokens(mergeResult.subject || '', context, false),
                body: replaceEmailTemplateTokens(mergeResult.body || '', context, true),
                templateScriptId: EMAIL_TEMPLATE_SCRIPT_ID,
                templateId: templateId,
                error: ''
            };
        } catch (e) {
            log.error('Email Template Preview Error', e);
            return {
                subject: '',
                body: '',
                templateScriptId: EMAIL_TEMPLATE_SCRIPT_ID,
                templateId: '',
                error: e.name + ' : ' + e.message
            };
        }
    }

    function resolveEmailTemplateInternalId() {
        if (emailTemplateInternalId) {
            return emailTemplateInternalId;
        }

        if (/^\d+$/.test(String(EMAIL_TEMPLATE_SCRIPT_ID || ''))) {
            emailTemplateInternalId = Number(EMAIL_TEMPLATE_SCRIPT_ID);
            return emailTemplateInternalId;
        }

        try {
            var templateSearch = search.create({
                type: search.Type.EMAIL_TEMPLATE || 'emailtemplate',
                filters: [['scriptid', 'is', EMAIL_TEMPLATE_SCRIPT_ID]],
                columns: [search.createColumn({ name: 'internalid' })]
            });

            runSearch(templateSearch, 1, function (result) {
                emailTemplateInternalId = result.id;
            });
        } catch (searchError) {
            log.audit('Email Template Search Resolution Failed', searchError);
        }

        if (!emailTemplateInternalId && query && query.runSuiteQL) {
            try {
                var results = query.runSuiteQL({
                    query: 'SELECT id FROM emailtemplate WHERE scriptid = ?',
                    params: [EMAIL_TEMPLATE_SCRIPT_ID]
                }).asMappedResults();

                if (results && results.length && results[0].id) {
                    emailTemplateInternalId = results[0].id;
                }
            } catch (queryError) {
                log.audit('Email Template SuiteQL Resolution Failed', queryError);
            }
        }

        if (!emailTemplateInternalId) {
            throw new Error('Email template not found for script ID ' + EMAIL_TEMPLATE_SCRIPT_ID + '. render.mergeEmail requires the template internal ID, so confirm this script ID is deployed or change the constant to the numeric internal ID.');
        }

        return emailTemplateInternalId;
    }

    function loadRawEmailTemplate(templateId) {
        var templateRecord = record.load({
            type: record.Type.EMAIL_TEMPLATE || 'emailtemplate',
            id: Number(templateId)
        });

        var body = templateRecord.getValue({ fieldId: 'content' }) || '';
        var mediaItem = templateRecord.getValue({ fieldId: 'mediaitem' });

        if (mediaItem) {
            try {
                body = file.load({ id: mediaItem }).getContents();
            } catch (e) {
                log.audit('Email Template Media Load Failed', e);
            }
        }

        return {
            subject: templateRecord.getValue({ fieldId: 'subject' }) || '',
            body: body || ''
        };
    }

    function getTemplatePoList(selectedPOs, filters, clientContext) {
        selectedPOs = selectedPOs || [];
        filters = filters || {};
        clientContext = clientContext || {};

        if (clientContext.poList && clientContext.poList.length) {
            selectedPOs = normalizeClientPoRows(clientContext.poList);
        }

        if (!selectedPOs.length && filters.poId) {
            selectedPOs = loadPOsByIds([filters.poId]);
        }

        if (!selectedPOs.length) {
            return [];
        }

        var groupNumber = '';
        var hasUngrouped = false;
        var differentGroup = false;

        for (var i = 0; i < selectedPOs.length; i++) {
            if (selectedPOs[i].groupNumber) {
                if (!groupNumber) {
                    groupNumber = selectedPOs[i].groupNumber;
                } else if (String(groupNumber) !== String(selectedPOs[i].groupNumber)) {
                    differentGroup = true;
                }
            } else {
                hasUngrouped = true;
            }
        }

        if (groupNumber && !hasUngrouped && !differentGroup) {
            return loadPOsByGroupNumber(groupNumber);
        }

        return selectedPOs;
    }

    function normalizeClientPoRows(poList) {
        var rows = [];
        for (var i = 0; i < (poList || []).length; i++) {
            var po = poList[i] || {};
            rows.push({
                poId: po.poId || '',
                tranId: po.tranId || '',
                vendorId: po.vendorId || '',
                vendorName: po.vendorName || '',
                vendorEmail: po.vendorEmail || '',
                vendorSendPoEmail: !!po.vendorSendPoEmail,
                tranDate: po.tranDate || '',
                memo: po.memo || '',
                vendorMemo: po.vendorMemo || '',
                stockPo: !!po.stockPo,
                groupNumber: po.groupNumber || '',
                amount: po.amount || '',
                emailSent: !!po.emailSent
            });
        }
        return rows;
    }

    function buildEmailTemplateContext(poList, filters, groupMemo, customMemoMap, clientContext) {
        poList = poList || [];
        filters = filters || {};
        customMemoMap = customMemoMap || {};
        clientContext = clientContext || {};

        var firstPo = poList.length ? poList[0] : null;
        var vendorId = firstPo ? firstPo.vendorId : (clientContext.vendorId || filters.vendorId || '');
        var vendorName = firstPo ? firstPo.vendorName : (clientContext.vendorName || '');
        var vendorEmail = firstPo ? firstPo.vendorEmail : (clientContext.vendorEmail || '');
        var groupNumber = '';
        var poNumbers = [];
        var totalAmount = 0;
        var hasAmount = false;

        for (var i = 0; i < poList.length; i++) {
            var po = poList[i] || {};
            if (po.tranId) poNumbers.push(po.tranId);
            if (!groupNumber && po.groupNumber) groupNumber = po.groupNumber;

            var amount = parseFloat(String(po.amount || '').replace(/[^0-9.\-]/g, ''));
            if (!isNaN(amount)) {
                totalAmount += amount;
                hasAmount = true;
            }

            var key = String(po.poId || '');
            if (key && customMemoMap.hasOwnProperty(key)) {
                po.vendorMemo = customMemoMap[key] || '';
            }
        }

        var trackingInfo = { revision: '', groupMemo: '' };
        if (groupNumber) {
            trackingInfo = getTrackingInfoByGroupNumber(groupNumber);
        }

        if (groupNumber && !groupMemo) {
            groupMemo = trackingInfo.groupMemo || '';
        }

        if (!groupMemo && clientContext.groupMemo) {
            groupMemo = clientContext.groupMemo || '';
        }

        if (vendorId && (!vendorName || !vendorEmail)) {
            var vendorInfo = getVendorInfo(vendorId, {});
            vendorName = vendorName || vendorInfo.name || '';
            vendorEmail = vendorEmail || vendorInfo.email || '';
        }

        return {
            vendorId: vendorId,
            vendorName: vendorName,
            vendorEmail: vendorEmail,
            transactionId: firstPo ? firstPo.poId : '',
            poNumbers: poNumbers,
            poCount: poList.length,
            poTotalAmount: hasAmount ? formatMoney(totalAmount) : '',
            groupNumber: groupNumber || '',
            revisionNumber: trackingInfo.revision || '',
            groupMemo: groupMemo || '',
            poSummaryTable: buildEmailPoSummaryTable(poList),
            senderName: getCurrentUserName()
        };
    }

    function replaceEmailTemplateTokens(value, context, allowHtml) {
        var tokenValues = {
            vendor_name: allowHtml ? escapeHtml(context.vendorName) : stripHtmlText(context.vendorName),
            vendor_email: allowHtml ? escapeHtml(context.vendorEmail) : stripHtmlText(context.vendorEmail),
            po_numbers: allowHtml ? escapeHtml(context.poNumbers.join(', ')) : context.poNumbers.join(', '),
            po_count: String(context.poCount || ''),
            po_total_amount: context.poTotalAmount || '',
            group_number: allowHtml ? escapeHtml(context.groupNumber) : stripHtmlText(context.groupNumber),
            revision_number: context.revisionNumber || '',
            group_memo: allowHtml ? textToHtml(context.groupMemo) : stripHtmlText(context.groupMemo),
            po_summary_table: allowHtml ? context.poSummaryTable : stripHtmlText(context.poNumbers.join(', ')),
            sender_name: allowHtml ? escapeHtml(context.senderName) : stripHtmlText(context.senderName)
        };

        return String(value || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, function (match, rawToken) {
            var key = normalizeTemplateTokenName(rawToken);
            if (tokenValues.hasOwnProperty(key)) {
                return tokenValues[key];
            }
            return match;
        });
    }

    function normalizeTemplateTokenName(value) {
        return String(value || '')
            .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
            .replace(/[^a-zA-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .toLowerCase();
    }

    function buildEmailPoSummaryTable(poList) {
        poList = poList || [];
        if (!poList.length) {
            return '';
        }

        var html = '<table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:13px;">';
        html += '<thead><tr>';
        html += '<th style="text-align:left;padding:8px 10px;background:#f3f4f6;border:1px solid #d1d5db;">PO Number</th>';
        html += '<th style="text-align:left;padding:8px 10px;background:#f3f4f6;border:1px solid #d1d5db;">Date</th>';
        html += '<th style="text-align:right;padding:8px 10px;background:#f3f4f6;border:1px solid #d1d5db;">Amount</th>';
        html += '<th style="text-align:left;padding:8px 10px;background:#f3f4f6;border:1px solid #d1d5db;">Memo</th>';
        html += '</tr></thead><tbody>';

        for (var i = 0; i < poList.length; i++) {
            var po = poList[i] || {};
            html += '<tr>';
            html += '<td style="padding:8px 10px;border:1px solid #d1d5db;">' + escapeHtml(po.tranId || '') + '</td>';
            html += '<td style="padding:8px 10px;border:1px solid #d1d5db;">' + escapeHtml(po.tranDate || '') + '</td>';
            html += '<td style="padding:8px 10px;border:1px solid #d1d5db;text-align:right;">' + escapeHtml(formatMoney(po.amount)) + '</td>';
            html += '<td style="padding:8px 10px;border:1px solid #d1d5db;">' + textToHtml(po.vendorMemo || po.memo || '') + '</td>';
            html += '</tr>';
        }

        html += '</tbody></table>';
        return html;
    }

    function getTrackingInfoByGroupNumber(groupNumber) {
        var info = { revision: '', groupMemo: '' };
        if (!groupNumber) {
            return info;
        }

        var trackingSearch = search.create({
            type: CUSTOM_REC_TYPE,
            filters: [[CREC_GROUP_NUMBER, 'is', groupNumber]],
            columns: [
                search.createColumn({ name: CREC_REVISION_NUMBER }),
                search.createColumn({ name: CREC_MASTER_MEMO })
            ]
        });

        runSearch(trackingSearch, 1, function (result) {
            info.revision = result.getValue({ name: CREC_REVISION_NUMBER }) || '';
            info.groupMemo = result.getValue({ name: CREC_MASTER_MEMO }) || '';
        });

        return info;
    }

    function formatMoney(value) {
        if (value === null || value === undefined || value === '') {
            return '';
        }

        var amount = parseFloat(String(value).replace(/[^0-9.\-]/g, ''));
        if (isNaN(amount)) {
            return String(value || '');
        }

        return '$' + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function getCurrentUserName() {
        try {
            return runtime.getCurrentUser().name || '';
        } catch (e) {
            return '';
        }
    }

    function stripHtmlText(value) {
        return String(value || '')
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;|&#160;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/\s+/g, ' ')
            .replace(/^\s+|\s+$/g, '');
    }

    function processSelectedPOs(options) {
        var response = { sent: [], created: [], skipped: [], errors: [], updatedIds: [], groupNumber: '', groupMemo: '', customMemoMap: {}, actionMode: '' };
        var selectedIds = parseIds(options.selectedIdsText);
        var selectedPOs = selectedIds.length ? loadPOsByIds(selectedIds) : [];
        var customMemoMap = options.customMemoMap || {};

        if (!selectedPOs.length) {
            response.errors.push('Please select at least one Purchase Order.');
            return response;
        }

        var hasGrouped = false;
        var hasUngrouped = false;
        var groupNumber = '';

        for (var i = 0; i < selectedPOs.length; i++) {
            if (selectedPOs[i].groupNumber) {
                hasGrouped = true;
                if (!groupNumber) groupNumber = selectedPOs[i].groupNumber;
                if (String(groupNumber) !== String(selectedPOs[i].groupNumber)) {
                    response.errors.push('Different Group Numbers are selected. Please select only one Group Number at a time.');
                    return response;
                }
            } else {
                hasUngrouped = true;
            }
        }

        if (hasGrouped && hasUngrouped) {
            response.errors.push('Grouped and ungrouped Purchase Orders cannot be sent together.');
            return response;
        }

        var groupMemo = options.groupMemo || '';

        if (!String(groupMemo).replace(/^\s+|\s+$/g, '')) {
            response.errors.push('Group Memo is required.');
            return response;
        }

        var poList = hasGrouped ? loadPOsByGroupNumber(groupNumber) : selectedPOs;
        if (!poList.length) {
            response.errors.push('No Purchase Orders found for the selected group.');
            return response;
        }

        if (!groupNumber) {
            groupNumber = generateGroupNumber(poList[0].vendorId || '');
        }

        var firstVendorId = poList[0].vendorId || '';
        var firstVendorName = poList[0].vendorName || '';
        var firstVendorEmail = poList[0].vendorEmail || '';
        var vendorSendPoEmail = !!poList[0].vendorSendPoEmail;
        var emailRecipients = parseEmailRecipients(firstVendorEmail);
        var emailBody = options.emailBodyText || '';
        var emailSubject = options.emailSubject || '';
        var poIds = [];
        var poNumbers = [];
        var anyEmailSent = false;

        for (var p = 0; p < poList.length; p++) {
            if (String(poList[p].vendorId || '') !== String(firstVendorId || '')) {
                response.errors.push('Different vendors selected. Please select Purchase Orders for only one vendor at a time.');
                return response;
            }

            if (!hasGrouped && (poList[p].emailSent || poList[p].groupNumber)) {
                response.errors.push('Selected PO already has Email Sent or Group Number.');
                return response;
            }

            if (poList[p].emailSent) anyEmailSent = true;
            poIds.push(poList[p].poId);
            poNumbers.push(poList[p].tranId);
        }

        if (vendorSendPoEmail) {
            if (!emailRecipients.length) {
                response.errors.push('Vendor email address is missing for ' + firstVendorName + '.');
                return response;
            }

            var missingEmailFields = [];
            if (!String(emailSubject).replace(/^\s+|\s+$/g, '')) missingEmailFields.push('Email Subject');
            if (!hasHtmlContent(emailBody)) missingEmailFields.push('Email Body');

            if (missingEmailFields.length) {
                response.errors.push(missingEmailFields.join(' and ') + (missingEmailFields.length > 1 ? ' are' : ' is') + ' required before sending email.');
                return response;
            }
        }

        var isResend = anyEmailSent;
        var createOnly = !vendorSendPoEmail;
        var actionMode = createOnly ? 'create_group' : (isResend ? 'resend' : 'send');
        var tracking = null;
        var mergedPdf = null;
        var pdfAttached = false;
        var emailWasSent = false;

        try {
            tracking = saveTrackingRecord({
                groupNumber: groupNumber,
                poIds: poIds,
                groupMemo: groupMemo,
                emailSubject: emailSubject,
                emailBody: emailBody,
                vendorId: firstVendorId,
                recipientEmail: emailRecipients[0] || firstVendorEmail || '',
                statusId: STATUS_GROUPED_ID,
                setDateSent: false,
                setLastSentDate: false,
                incrementRevision: true
            });

            var groupid = tracking.id;

            if (createOnly) {
                stampPurchaseOrders(poIds, groupNumber, customMemoMap, false, groupid);
                response.updatedIds = poIds;
                response.groupNumber = groupNumber;
                response.groupMemo = groupMemo;
                response.customMemoMap = customMemoMap;
                response.actionMode = actionMode;
                response.created.push(firstVendorName + ' - ' + poNumbers.join(', ') + ' | Group Number: ' + groupNumber + ' | Email not sent because vendor is not enabled for grouped PO email.');
                return response;
            }

            var sendDate = new Date();
            var finalDateSent = tracking.dateSent || sendDate;
            var finalRevision = tracking.revision + (isResend ? 1 : 0);
            stampPurchaseOrders(poIds, groupNumber, customMemoMap, true, groupid, finalRevision);

            mergedPdf = createMergedPoPdf(poIds, firstVendorName, tracking.id);            

            pdfAttached = attachGeneratedPdfToTrackingRecord(tracking.id, mergedPdf);

            email.send({
                author: runtime.getCurrentUser().id,
                recipients: emailRecipients,
                subject: emailSubject,
                body: emailBody,
                attachments: [mergedPdf],
                relatedRecords: { entityId: Number(firstVendorId) }
            });
            emailWasSent = true;

            markTrackingSent(tracking.id, isResend ? STATUS_RESEND_ID : STATUS_SENT_ID, finalDateSent, sendDate, finalRevision);
            

            response.updatedIds = poIds;
            response.groupNumber = groupNumber;
            response.groupMemo = groupMemo;
            response.customMemoMap = customMemoMap;
            response.actionMode = actionMode;
            response.sent.push(firstVendorName + ' - ' + poNumbers.join(', ') + ' | Group Number: ' + groupNumber);
        } catch (e) {
            log.error('PO Email Process Failed', { groupNumber: groupNumber, vendorId: firstVendorId, poNumbers: poNumbers, error: e });

            if (tracking && tracking.id) {
                if (mergedPdf && !pdfAttached) {
                    attachGeneratedPdfToTrackingRecord(tracking.id, mergedPdf);
                }
                if (!emailWasSent) {
                    markTrackingFailed(tracking.id, e);
                }
            }

            response.groupNumber = groupNumber;
            response.groupMemo = groupMemo;
            response.customMemoMap = customMemoMap;
            response.actionMode = actionMode;
            if (emailWasSent) {
                response.errors.push(firstVendorName + ' - Email was sent, but updating the tracking record or Purchase Orders failed: ' + e.message + '. Please review before retrying.');
            } else {
                response.errors.push(firstVendorName + ' - ' + e.message);
            }
        }

        return response;
    }

    function loadPOsByIds(ids) {
        return loadPOs([['type', 'anyof', 'PurchOrd'], 'AND', ['mainline', 'is', 'T'], 'AND', ['internalid', 'anyof', ids]], search.Sort.ASC);
    }

    function loadPOsByGroupNumber(groupNumber) {
        return loadPOs([['type', 'anyof', 'PurchOrd'], 'AND', ['mainline', 'is', 'T'], 'AND', [FIELD_GROUP_NUMBER, 'is', groupNumber]], search.Sort.ASC);
    }

    function loadPOs(filters, sortOrder) {
        var data = [];
        var vendorCache = {};
        var poSearch = search.create({
            type: 'purchaseorder',
            filters: filters,
            columns: [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'tranid', sort: sortOrder || search.Sort.ASC }),
                search.createColumn({ name: 'entity' }),
                search.createColumn({ name: 'trandate' }),
                search.createColumn({ name: 'memo' }),
                search.createColumn({ name: 'amount' }),
                search.createColumn({ name: FIELD_EMAIL_SENT }),
                search.createColumn({ name: FIELD_GROUP_NUMBER }),
                search.createColumn({ name: FIELD_VENDOR_MEMO }),
                search.createColumn({ name: FIELD_STOCK_PO })
            ]
        });

        runSearch(poSearch, 0, function (result) {
            data.push(buildPoRow(result, vendorCache));
        });

        return data;
    }

    // function createMergedPoPdf(poIds, vendorName, summary) {
    //     var coverPdf = createSummaryPagePdf(summary);
    //     var pdfSetXml = '<?xml version="1.0"?><!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd"><pdfset>';
    //     var estimatedBytes = 0;

    //     if (coverPdf) {
    //         var coverContents = coverPdf.getContents();
    //         estimatedBytes += getBase64ByteSize(coverContents);
    //         checkMergedPdfLimit(estimatedBytes);
    //         pdfSetXml += '<pdf src="data:application/pdf;base64,' + coverContents + '"/>';
    //     }

    //     for (var i = 0; i < poIds.length; i++) {
    //         var poPdf = render.transaction({ entityId: Number(poIds[i]), printMode: render.PrintMode.PDF });
    //         var poContents = poPdf.getContents();
    //         estimatedBytes += getBase64ByteSize(poContents);
    //         checkMergedPdfLimit(estimatedBytes);
    //         pdfSetXml += '<pdf src="data:application/pdf;base64,' + poContents + '"/>';
    //     }

    //     pdfSetXml += '</pdfset>';

    //     var mergedPdf = render.xmlToPdf({ xmlString: pdfSetXml });
    //     checkMergedPdfLimit(getBase64ByteSize(mergedPdf.getContents()));
    //     mergedPdf.name = cleanFileName('Merged_PO_' + vendorName + '_' + new Date().getTime() + '.pdf');
    //     return mergedPdf;
    // }

  function createMergedPoPdf(poIds, vendorName, trackingRecordId) {
    var groupPdf = renderGroupedPoRecordPdf(trackingRecordId);

    var pdfSetXml = '<?xml version="1.0"?>' +
        '<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">' +
        '<pdfset>';

    var estimatedBytes = 0;

    if (groupPdf) {
        var groupContents = groupPdf.getContents();
        estimatedBytes += getBase64ByteSize(groupContents);
        checkMergedPdfLimit(estimatedBytes);
        pdfSetXml += '<pdf src="data:application/pdf;base64,' + groupContents + '"/>';
    }

    for (var i = 0; i < poIds.length; i++) {
        var poPdf = render.transaction({
            entityId: Number(poIds[i]),
            printMode: render.PrintMode.PDF
        });

        var poContents = poPdf.getContents();
        estimatedBytes += getBase64ByteSize(poContents);
        checkMergedPdfLimit(estimatedBytes);

        pdfSetXml += '<pdf src="data:application/pdf;base64,' + poContents + '"/>';
    }

    pdfSetXml += '</pdfset>';

    var mergedPdf = render.xmlToPdf({ xmlString: pdfSetXml });
    checkMergedPdfLimit(getBase64ByteSize(mergedPdf.getContents()));

    mergedPdf.name = cleanFileName('Merged_PO_' + vendorName + '_' + new Date().getTime() + '.pdf');
    return mergedPdf;
}

function renderGroupedPoRecordPdf(trackingRecordId) {
    if (!trackingRecordId) {
        throw new Error('Missing grouped PO tracking record ID.');
    }

    var groupRecord = record.load({
        type: CUSTOM_REC_TYPE,
        id: trackingRecordId,
        isDynamic: false
    });

    var renderer = render.create();

    renderer.setTemplateByScriptId({
        scriptId: GROUP_PDF_TEMPLATE_ID
    });

    renderer.addRecord({
        templateName: 'record',
        record: groupRecord
    });

    var pdfXml = renderer.renderAsString();

    return render.xmlToPdf({
        xmlString: pdfXml
    });
}

    function createSummaryPagePdf(summary) {
        function row(label, value, multiline) {
            if (!value) return '';
            var displayValue = multiline ? stripHtml(value) : escapeHtml(value);
            if (!displayValue) return '';
            return '<tr>' +
                '<td style="width:150pt;font-weight:bold;padding:5pt 8pt;border-bottom:1pt solid #dddddd;vertical-align:top;">' + escapeHtml(label) + '</td>' +
                '<td style="padding:5pt 8pt;border-bottom:1pt solid #dddddd;vertical-align:top;">' + displayValue + '</td>' +
                '</tr>';
        }

        var rows = '';
        rows += row('Group Number', summary.groupNumber);
        rows += row('Purchase Order(s)', (summary.poNumbers || []).join(', '));
        rows += row('Vendor', summary.vendorName);
        rows += row('Recipient', summary.recipient);
        rows += row('Sender', summary.sender);
        rows += row('Email Subject', summary.emailSubject);
        rows += row('Email Body', summary.emailBody, true);
        rows += row('Group Memo', summary.groupMemo);
        rows += row('Email Status', summary.status);
        rows += row('Date Sent', summary.dateSent);
        rows += row('Last Sent Date', summary.lastSentDate);
        rows += row('Revision Number', String(summary.revision));

        var xml = '<?xml version="1.0"?>' +
            '<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">' +
            '<pdf><body padding="0.6in 0.7in" font-family="Helvetica">' +
            '<table style="width:100%;"><tr><td style="font-size:20pt;font-weight:bold;padding-bottom:16pt;">Purchase Order Email Summary</td></tr></table>' +
            '<table style="width:100%;border-collapse:collapse;font-size:10pt;">' + rows + '</table>' +
            '</body></pdf>';

        return render.xmlToPdf({ xmlString: xml });
    }

    function saveTrackingRecord(values) {
        var existingId = findTrackingRecord(values.groupNumber);
        var rec;
        var dateSent = null;

        if (existingId) {
            rec = record.load({ type: CUSTOM_REC_TYPE, id: existingId, isDynamic: true });
            dateSent = rec.getValue({ fieldId: CREC_DATE_SENT }) || null;
        } else {
            rec = record.create({ type: CUSTOM_REC_TYPE, isDynamic: true });
            rec.setValue({ fieldId: CREC_GROUP_NUMBER, value: values.groupNumber });
        }

        if (values.setDateSent && !dateSent) {
            dateSent = new Date();
            rec.setValue({ fieldId: CREC_DATE_SENT, value: dateSent });
        }

        rec.setValue({ fieldId: CREC_PO_NUMBER, value: values.poIds });
        rec.setValue({ fieldId: CREC_MASTER_MEMO, value: values.groupMemo });
        rec.setValue({ fieldId: CREC_EMAIL_SUBJECT, value: values.emailSubject });
        rec.setValue({ fieldId: CREC_EMAIL_BODY, value: values.emailBody });
        if (values.setLastSentDate) {
            rec.setValue({ fieldId: CREC_LAST_SENT_DATE, value: new Date() });
        }
        rec.setValue({ fieldId: CREC_EMAIL_STATUS, value: values.statusId });
        rec.setValue({ fieldId: CREC_ERROR_LOG, value: '' });

        if (runtime.getCurrentUser().id > 0) {
            rec.setValue({ fieldId: CREC_SENDER, value: runtime.getCurrentUser().id });
        }
        rec.setValue({ fieldId: CREC_RECIPIENT, value: values.recipientEmail || '' });
        if (values.vendorId) {
            rec.setValue({ fieldId: CREC_VENDOR, value: values.vendorId });
        }

        var currentRev = rec.getValue({ fieldId: CREC_REVISION_NUMBER });
        var revision = (currentRev === '' || currentRev === null || currentRev === undefined) ? 0 : parseInt(currentRev, 10);
        if (isNaN(revision)) {
            revision = 0;
        }
        if (values.incrementRevision) {
            revision++;
        }
        rec.setValue({ fieldId: CREC_REVISION_NUMBER, value: revision });

        return {
            id: rec.save({ enableSourcing: false, ignoreMandatoryFields: true }),
            revision: revision,
            dateSent: dateSent,
            dateSentDisplay: formatDateTime(dateSent)
        };
    }

    function findTrackingRecord(groupNumber) {
        var foundId = null;
        if (!groupNumber) return foundId;

        var trackingSearch = search.create({
            type: CUSTOM_REC_TYPE,
            filters: [[CREC_GROUP_NUMBER, 'is', String(groupNumber).replace(/^\s+|\s+$/g, '')]],
            columns: [search.createColumn({ name: 'internalid' })]
        });

        trackingSearch.run().each(function (result) {
            foundId = result.getValue({ name: 'internalid' }) || result.id;
            return false;
        });

        return foundId;
    }

    function markTrackingFailed(trackingRecordId, errorObj) {
        var values = {};
        values[CREC_EMAIL_STATUS] = STATUS_FAILED_ID;
        values[CREC_ERROR_LOG] = (errorObj.name ? (errorObj.name + ': ') : '') + (errorObj.message || String(errorObj));

        record.submitFields({
            type: CUSTOM_REC_TYPE,
            id: trackingRecordId,
            values: values,
            options: { enableSourcing: false, ignoreMandatoryFields: true }
        });
    }

    function markTrackingSent(trackingRecordId, statusId, dateSent, lastSentDate, revision) {
        var values = {};
        values[CREC_EMAIL_STATUS] = statusId;
        values[CREC_DATE_SENT] = dateSent || new Date();
        values[CREC_LAST_SENT_DATE] = lastSentDate || new Date();
       // values[CREC_REVISION_NUMBER] = revision;
        values[CREC_ERROR_LOG] = '';

        record.submitFields({
            type: CUSTOM_REC_TYPE,
            id: trackingRecordId,
            values: values,
            options: { enableSourcing: false, ignoreMandatoryFields: true }
        });
    }

    function attachGeneratedPdfToTrackingRecord(trackingRecordId, mergedPdf) {
        if (!trackingRecordId || !mergedPdf) return false;

        try {
            mergedPdf.folder = TEMP_FOLDER_ID;
            mergedPdf.isOnline = true;

            var values = {};
            values[CREC_GENERATED_PDF] = mergedPdf.save();

            record.submitFields({
                type: CUSTOM_REC_TYPE,
                id: trackingRecordId,
                values: values,
                options: { enableSourcing: false, ignoreMandatoryFields: true }
            });

            return true;
        } catch (e) {
            log.error('Attach Generated PDF Failed', { trackingRecordId: trackingRecordId, error: e });
            return false;
        }
    }

    function stampPurchaseOrders(poIds, groupNumber, customMemoMap, markSent, groupid) {
        customMemoMap = customMemoMap || {};

        for (var i = 0; i < poIds.length; i++) {
            var poId = poIds[i];
            var key = String(poId);
            var values = {};
            values[FIELD_GROUP_NUMBER] = groupNumber;

            if (markSent !== null && markSent !== undefined) {
                values[FIELD_EMAIL_SENT] = !!markSent;
            }

            if (customMemoMap.hasOwnProperty(key)) {
                values[FIELD_VENDOR_MEMO] = customMemoMap[key] || '';
            }

            record.submitFields({
                type: record.Type.PURCHASE_ORDER,
                id: poId,
                values: values,
                options: { enableSourcing: false, ignoreMandatoryFields: true }
            });
        }
        var groupRec = record.load({type: 'customrecord_grouped_pos', id: groupid});
        groupRec.save();
    }

    function getGroupTrackingMap(poData) {
        var map = {};
        var groups = [];
        var seen = {};

        for (var i = 0; i < poData.length; i++) {
            if (poData[i].groupNumber && !seen[poData[i].groupNumber]) {
                seen[poData[i].groupNumber] = true;
                groups.push(poData[i].groupNumber);
            }
        }

        if (!groups.length) return map;

        var groupFilters = [];
        for (var g = 0; g < groups.length; g++) {
            if (g > 0) groupFilters.push('OR');
            groupFilters.push([CREC_GROUP_NUMBER, 'is', groups[g]]);
        }

        var trackingSearch = search.create({
            type: CUSTOM_REC_TYPE,
            filters: groupFilters,
            columns: [
                search.createColumn({ name: CREC_GROUP_NUMBER }),
                search.createColumn({ name: CREC_DATE_SENT }),
                search.createColumn({ name: CREC_EMAIL_STATUS }),
                search.createColumn({ name: CREC_MASTER_MEMO })
            ]
        });

        runSearch(trackingSearch, 0, function (result) {
            var groupNumber = result.getValue({ name: CREC_GROUP_NUMBER }) || '';
            if (groupNumber && !map[groupNumber]) {
                map[groupNumber] = {
                    dateSent: result.getValue({ name: CREC_DATE_SENT }) || '',
                    statusId: result.getValue({ name: CREC_EMAIL_STATUS }) || '',
                    groupMemo: result.getValue({ name: CREC_MASTER_MEMO }) || ''
                };
            }
        });

        return map;
    }

    function hasAnyFilter(filters) {
        return !!(filters && (filters.subsidiaryId || filters.locationId || filters.poId || filters.poText || filters.vendorId || filters.vendorText || filters.dateFrom || filters.dateTo || filters.emailStatus || filters.stockPo || filters.groupNumber));
    }

    function hasRequiredLocationFilters(filters) {
        return !!(filters && filters.subsidiaryId && filters.locationId);
    }

    function generateGroupNumber(vendorId) {
        var d = new Date();
        function pad(value, length) {
            value = String(value);
            length = length || 2;
            while (value.length < length) {
                value = '0' + value;
            }
            return value;
        }
        return vendorId + '_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + pad(d.getMilliseconds(), 3) + '_' + pad(Math.floor(Math.random() * 1000), 3);
    }

    function runSearch(searchObj, maxRows, callback) {
        var pagedData = searchObj.runPaged({ pageSize: 1000 });
        var count = 0;

        for (var i = 0; i < pagedData.pageRanges.length; i++) {
            var page = pagedData.fetch({ index: pagedData.pageRanges[i].index });
            for (var j = 0; j < page.data.length; j++) {
                if (maxRows && count >= maxRows) return;
                callback(page.data[j]);
                count++;
            }
        }
    }

    function parseIds(text) {
        var ids = [];
        var parts = text ? text.split(',') : [];
        for (var i = 0; i < parts.length; i++) {
            var id = String(parts[i] || '').replace(/^\s+|\s+$/g, '');
            if (id) ids.push(id);
        }
        return ids;
    }

    function parseEmailRecipients(text) {
        var recipients = [];
        var parts = text ? String(text).split(/[;,]/) : [];
        for (var i = 0; i < parts.length; i++) {
            var emailAddress = String(parts[i] || '').replace(/^\s+|\s+$/g, '');
            if (emailAddress) recipients.push(emailAddress);
        }
        return recipients;
    }

    function getBase64ByteSize(value) {
        var text = String(value || '').replace(/\s/g, '');
        if (!text) return 0;

        var padding = 0;
        if (text.slice(-2) === '==') {
            padding = 2;
        } else if (text.slice(-1) === '=') {
            padding = 1;
        }

        return Math.floor((text.length * 3) / 4) - padding;
    }

    function checkMergedPdfLimit(sizeBytes) {
        if (sizeBytes > MAX_MERGED_PDF_BYTES) {
            throw new Error('The combined PDF is ' + formatFileSize(sizeBytes) + ', which exceeds the 9 MB limit. Please reduce the PO selection and try again.');
        }
    }

    function formatFileSize(sizeBytes) {
        var mb = sizeBytes / (1024 * 1024);
        return mb.toFixed(2) + ' MB';
    }

    function parseJsonObject(text) {
        if (!text) return {};
        try {
            var value = JSON.parse(text);
            return value && typeof value === 'object' ? value : {};
        } catch (e) {
            return {};
        }
    }

    function convertHtmlDateToNsDate(value) {
        if (!value) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            var parts = String(value).split('-');
            return parts[1] + '/' + parts[2] + '/' + parts[0];
        }
        return value;
    }

    function formatDateTime(value) {
        try {
            return value ? new Date(value).toLocaleDateString() + ' ' + new Date(value).toLocaleTimeString() : '';
        } catch (e) {
            return String(value || '');
        }
    }

    function cleanFileName(name) {
        return name ? name.replace(/[\\\/:*?"<>|]/g, '_') : 'Merged_PO.pdf';
    }

    function textToHtml(value) {
        return value ? escapeHtml(value).replace(/\n/g, '<br/>') : '';
    }

    function stripHtml(value) {
        var text = String(value || '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/\n{2,}/g, '\n')
            .replace(/^\s+|\s+$/g, '');

        var lines = text.split('\n');
        for (var i = 0; i < lines.length; i++) {
            lines[i] = escapeHtml(lines[i]);
        }
        return lines.join('<br/>');
    }

    function hasHtmlContent(value) {
        return !!String(value || '')
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<\/(p|div|li|tr|h[1-6])>/gi, ' ')
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;|&#160;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/\s+/g, ' ')
            .replace(/^\s+|\s+$/g, '');
    }

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function writeJson(context, obj) {
        context.response.setHeader({ name: 'Content-Type', value: 'application/json; charset=UTF-8' });
        context.response.write(JSON.stringify(obj));
    }

    return { onRequest: onRequest };
});
