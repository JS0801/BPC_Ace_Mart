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
    'N/log',
    'N/format'
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
    log,
    nsFormat
) {

    var TEMP_FOLDER_ID = 8768;
    var PARAM_HTML_FILE_ID = 'custscript_po_email_html_file';
    var PARAM_PO_LIST_SEARCH_ID = 'custscript_po_email_po_list_search';
    var GROUP_PDF_TEMPLATE_ID = 'CUSTTMPL_CUSTOM_GROUPED_POS_PDFHTML_TEMPLATE';
    var EMAIL_TEMPLATE_SCRIPT_ID = 'custemailtmpl_po_group_email';

    var FIELD_EMAIL_SENT = 'custbody_email_sent';
    var FIELD_GROUP_NUMBER = 'custbody_group_number';
    var FIELD_VENDOR_MEMO = 'custbody_vendor_memo';
    var FIELD_STOCK_PO = 'custbody_ace_join_stockpo';
    var FIELD_SUBSIDIARY = 'subsidiary';
    var FIELD_LOCATION = 'location';
    var FIELD_LOCATION_TYPE = 'locationtype';
    var FIELD_VENDOR_SEND_PO_EMAIL = 'custentity_am_send_group_po_email'; //custentity_bpc_send_group_po_email
    var FIELD_VENDOR_PO_EMAIL = 'custentity_am_po_email_address'; //custentity_bpc_po_email_address
    var WAREHOUSE_LOCATION_TYPE_ID = '2';
    var CUSTOM_REC_TYPE_NUMERIC_ID = '3438';

    var CUSTOM_REC_TYPE = 'customrecord_grouped_pos';
    var CREC_GROUP_NUMBER = 'name';
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
    var FLD_EMAIL_TO = 'custpage_email_to';
    var FLD_EMAIL_CC = 'custpage_email_cc';
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
            if (params.custpage_group_update === 'T') { showGroupUpdate(context); return; }
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

                if (action === 'recipient_options') {
                    writeJson(context, {success: true, options: getRecipientOptions(filters.vendorId)});
                    return;
                }

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

                if (action === 'send' || action === 'resend' || action === 'generate_pdf') {
                    if (request.method !== 'POST') throw new Error('Use POST for grouped PO actions.');
                    var resultMessage = processSelectedPOs({
                        generateOnly: action === 'generate_pdf',
                        recipientText: params[FLD_EMAIL_TO],
                        ccText: params[FLD_EMAIL_CC] || '',
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
                    poColumns: getPoListColumns(),
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
            poColumns: getPoListColumns(),
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
            emailTo: FLD_EMAIL_TO,
            emailCc: FLD_EMAIL_CC,
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
            PO_COLUMNS_JSON: dataObj.poColumns || getDefaultPoListColumns(),
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

    function getDefaultPoListColumns() {
        return [
            { label: 'Select', key: '_select', type: 'string', sortable: false, style: 'width:50px;', renderType: 'select' },
            { label: 'Email Status', key: 'emailStatus', type: 'string', style: 'width:120px;', renderType: 'status' },
            { label: 'PO Number', key: 'tranId', type: 'string', style: 'width:130px;', renderType: 'po_link' },
            { label: 'Vendor', key: 'vendorName', type: 'string', renderType: 'vendor_link' },
            { label: 'Vendor Email', key: 'vendorEmail', type: 'string', renderType: 'text' },
            { label: 'PO Date', key: 'tranDate', type: 'date', style: 'width:150px;', renderType: 'text' },
            { label: 'Email Sent Date', key: 'emailSentDate', type: 'date', style: 'width:150px;', renderType: 'sent_date' },
            { label: 'Send with Stock Purchase Order', key: 'stockPo', type: 'bool', style: 'width:150px;', renderType: 'bool' },
            { label: 'Group Number', key: 'groupNumber', type: 'string', renderType: 'group_link' },
            { label: 'Native Memo', key: 'memo', type: 'string', renderType: 'memo' },
            { label: 'Custom Memo', key: 'vendorMemo', type: 'string', renderType: 'custom_memo' },
            { label: 'Amount', key: 'amount', type: 'number', style: 'width:120px;text-align:right;', renderType: 'amount' }
        ];
    }

    function getSavedSearchSystemPoListColumns() {
        return [
            { label: 'Select', key: '_select', type: 'string', sortable: false, style: 'width:50px;', renderType: 'select' },
            { label: 'Email Status', key: 'emailStatus', type: 'string', style: 'width:120px;', renderType: 'status' },
            { label: 'Email Sent Date', key: 'emailSentDate', type: 'date', style: 'width:150px;', renderType: 'sent_date' }
        ];
    }

    function getPoListColumns() {
        return (getPoListSearchConfig().columns || getDefaultPoListColumns()).concat([{label:'Saved PDF', key:'savedPdf', renderType:'saved_pdf'}]);
    }

    function getPoListSearchConfig() {
        var savedSearchId = runtime.getCurrentScript().getParameter({ name: PARAM_PO_LIST_SEARCH_ID }) || '';
        if (!savedSearchId) {
            return {
                savedSearchId: '',
                searchColumns: [],
                resultColumns: [],
                columns: getDefaultPoListColumns()
            };
        }

        var poSearch = search.load({ id: savedSearchId });
        var searchColumns = poSearch.columns || [];
        if (!searchColumns.length) {
            throw new Error('PO List Saved Search ' + savedSearchId + ' does not have result columns.');
        }

        var resultColumns = buildSavedSearchPoListColumns(searchColumns);
        return {
            savedSearchId: savedSearchId,
            searchColumns: searchColumns,
            resultColumns: resultColumns,
            columns: getSavedSearchSystemPoListColumns().concat(getVisiblePoListColumns(resultColumns))
        };
    }

    function getVisiblePoListColumns(resultColumns) {
        var visibleColumns = [];

        for (var i = 0; i < (resultColumns || []).length; i++) {
            if (!resultColumns[i].hidden) {
                visibleColumns.push(resultColumns[i]);
            }
        }

        return visibleColumns;
    }

    function buildSavedSearchPoListColumns(searchColumns) {
        var columns = [];
        var usedKeys = {};

        for (var i = 0; i < searchColumns.length; i++) {
            var searchColumn = searchColumns[i];
            var hidden = isHiddenPoListSearchColumn(searchColumn);
            var key = getSavedSearchPoColumnKey(searchColumn, i, usedKeys);
            var renderType = getPoColumnRenderType(key);
            var type = getPoColumnType(searchColumn, key);

            columns.push({
                label: getSavedSearchPoColumnLabel(searchColumn, key, i),
                key: key,
                type: type,
                style: getPoColumnStyle(key, type),
                renderType: renderType,
                hidden: hidden
            });
        }

        return columns;
    }

    function isHiddenPoListSearchColumn(searchColumn) {
        var label = String((searchColumn && searchColumn.label) || '').replace(/^\s+|\s+$/g, '');
        return label.charAt(0) === '~';
    }

    function getSavedSearchPoColumnKey(searchColumn, index, usedKeys) {
        var knownKey = getKnownPoColumnKey(searchColumn);
        var key = knownKey || ('sscol_' + index);

        if (usedKeys[key]) {
            key = 'sscol_' + index;
        }

        usedKeys[key] = true;
        return key;
    }

    function getKnownPoColumnKey(searchColumn) {
        if (!searchColumn || searchColumn.formula) {
            return '';
        }

        var name = searchColumn.name || '';
        var join = String(searchColumn.join || '').toLowerCase();

        if (join === 'vendor' && name === FIELD_VENDOR_PO_EMAIL) return 'vendorEmail';
        if (join === 'vendor' && name === FIELD_VENDOR_SEND_PO_EMAIL) return 'vendorSendPoEmail';
        if (join) return '';

        if (name === 'internalid') return 'poId';
        if (name === 'tranid') return 'tranId';
        if (name === 'entity') return 'vendorName';
        if (name === 'trandate') return 'tranDate';
        if (name === 'memo') return 'memo';
        if (name === 'amount' || name === 'total') return 'amount';
        if (name === FIELD_EMAIL_SENT) return 'emailSent';
        if (name === FIELD_GROUP_NUMBER) return 'groupNumber';
        if (name === FIELD_VENDOR_MEMO) return 'vendorMemo';
        if (name === FIELD_STOCK_PO) return 'stockPo';
        return '';
    }

    function getSavedSearchPoColumnLabel(searchColumn, key, index) {
        if (searchColumn && searchColumn.label) {
            return searchColumn.label;
        }

        var labels = {
            poId: 'Internal ID',
            tranId: 'PO Number',
            vendorName: 'Vendor',
            tranDate: 'PO Date',
            memo: 'Native Memo',
            amount: 'Amount',
            emailSent: 'Email Sent',
            groupNumber: 'Group Number',
            vendorMemo: 'Custom Memo',
            stockPo: 'Send with Stock Purchase Order',
            vendorEmail: 'PO Email Address',
            vendorSendPoEmail: 'Send Group PO Email'
        };

        return labels[key] || (searchColumn && searchColumn.name) || ('Column ' + (index + 1));
    }

    function getPoColumnType(searchColumn, key) {
        if (key === 'amount') return 'number';
        if (key === 'tranDate' || key === 'emailSentDate') return 'date';
        if (key === 'stockPo' || key === 'emailSent' || key === 'vendorSendPoEmail') return 'bool';

        var name = String((searchColumn && searchColumn.name) || '').toLowerCase();
        if (name.indexOf('date') !== -1) return 'date';
        if (name.indexOf('amount') !== -1 || name.indexOf('total') !== -1 || name.indexOf('quantity') !== -1 || name.indexOf('rate') !== -1) return 'number';

        return 'string';
    }

    function getPoColumnRenderType(key) {
        if (key === 'emailStatus') return 'status';
        if (key === 'tranId') return 'po_link';
        if (key === 'vendorName') return 'vendor_link';
        if (key === 'groupNumber') return 'group_link';
        if (key === 'vendorMemo') return 'custom_memo';
        if (key === 'emailSentDate') return 'sent_date';
        if (key === 'memo') return 'memo';
        if (key === 'amount') return 'amount';
        if (key === 'stockPo' || key === 'emailSent' || key === 'vendorSendPoEmail') return 'bool';
        return 'text';
    }

    function getPoColumnStyle(key, type) {
        if (key === 'tranId') return 'width:130px;';
        if (key === 'tranDate' || key === 'emailSentDate') return 'width:150px;';
        if (key === 'stockPo') return 'width:150px;';
        if (key === 'vendorMemo') return 'min-width:220px;';
        if (type === 'number') return 'width:120px;text-align:right;';
        return '';
    }

    function getPurchaseOrders(filters) {
        var data = [];
        var vendorCache = {};
        if (!hasRequiredLocationFilters(filters)) return data;

        var poListSearchConfig = getPoListSearchConfig();
        if (poListSearchConfig.savedSearchId) {
            data = getPurchaseOrdersFromSavedSearch(filters, poListSearchConfig);
        } else {
            var poSearch = search.create({
                type: 'purchaseorder',
                settings: [{ name: 'consolidationtype', value: 'ACCTTYPE' }],
                filters: buildPurchaseOrderFilters(filters, false),
                columns: getDefaultPurchaseOrderSearchColumns(search.Sort.DESC)
            });

            runSearch(poSearch, MAX_UI_PO_ROWS, function (result) {
                data.push(buildPoRow(result, vendorCache));
            });
        }

        decoratePoListRows(data);
        return data;
    }

    function getDefaultPurchaseOrderSearchColumns(sortOrder) {
        return [
            search.createColumn({ name: 'internalid' }),
            search.createColumn({ name: 'tranid', sort: sortOrder || search.Sort.ASC }),
            search.createColumn({ name: 'entity' }),
            search.createColumn({ name: 'subsidiary' }),
            search.createColumn({ name: 'currency' }),
            search.createColumn({ name: 'trandate' }),
            search.createColumn({ name: 'memo' }),
            search.createColumn({ name: 'amount' }),
            search.createColumn({ name: FIELD_EMAIL_SENT }),
            search.createColumn({ name: FIELD_GROUP_NUMBER }),
            search.createColumn({ name: FIELD_VENDOR_MEMO }),
            search.createColumn({ name: FIELD_STOCK_PO })
        ];
    }

    function getPurchaseOrdersFromSavedSearch(filters, poListSearchConfig) {
        var ids = [];
        var seen = {};
        var displayValuesById = {};
        var poSearch = search.load({ id: poListSearchConfig.savedSearchId });

        poSearch.filterExpression = combineSearchExpressions(poSearch.filterExpression, buildPurchaseOrderFilters(filters, false));

        runSearch(poSearch, MAX_UI_PO_ROWS, function (result) {
            var poId = result.id || result.getValue({ name: 'internalid' }) || '';
            poId = String(poId || '');
            if (!poId || seen[poId]) return;

            seen[poId] = true;
            ids.push(poId);
            displayValuesById[poId] = buildSavedSearchDisplayValues(result, poListSearchConfig.searchColumns, poListSearchConfig.resultColumns);
        });

        if (!ids.length) {
            return [];
        }

        var coreRows = loadPOsByIds(ids);
        var coreRowsById = {};
        for (var i = 0; i < coreRows.length; i++) {
            coreRowsById[String(coreRows[i].poId)] = coreRows[i];
        }

        var data = [];
        for (var idIndex = 0; idIndex < ids.length; idIndex++) {
            var id = ids[idIndex];
            var row = coreRowsById[id] || {
                poId: id,
                poUrl: '',
                tranId: '',
                vendorId: '',
                vendorName: '',
                vendorUrl: '',
                vendorEmail: '',
                vendorSendPoEmail: false,
                tranDate: '',
                emailSentDate: '',
                emailStatus: '',
                trackingStatus: '',
                groupMemo: '',
                memo: '',
                vendorMemo: '',
                stockPo: false,
                groupNumber: '',
                groupRecordId: '',
                groupRecordUrl: '',
                amount: '',
                emailSent: false
            };

            row.displayValues = displayValuesById[id] || {};
            for (var key in row.displayValues) {
                if (row.displayValues.hasOwnProperty(key) && (row[key] === undefined || row[key] === null || row[key] === '')) {
                    row[key] = row.displayValues[key];
                }
            }
            data.push(row);
        }

        return data;
    }

    function buildSavedSearchDisplayValues(result, searchColumns, resultColumns) {
        var values = {};

        for (var i = 0; i < searchColumns.length; i++) {
            values[resultColumns[i].key] = getSearchResultDisplayValue(result, searchColumns[i]);
        }

        return values;
    }

    function getSearchResultDisplayValue(result, column) {
        var text = '';
        var value = '';

        try {
            text = result.getText(column) || '';
        } catch (e) {
            text = '';
        }

        try {
            value = result.getValue(column);
        } catch (e2) {
            value = '';
        }

        if (Array.isArray(text)) text = text.join(', ');
        if (Array.isArray(value)) value = value.join(', ');

        return text || value || '';
    }

    function combineSearchExpressions(baseExpression, additionalExpression) {
        baseExpression = baseExpression || [];
        additionalExpression = additionalExpression || [];

        if (!baseExpression.length) return additionalExpression;
        if (!additionalExpression.length) return baseExpression;

        return [baseExpression, 'AND', additionalExpression];
    }

    function decoratePoListRows(data) {
        data = data || [];
        var groupTrackingMap = getGroupTrackingMap(data);
        for (var i = 0; i < data.length; i++) {
            try {
                data[i].poUrl = url.resolveRecord({ recordType: record.Type.PURCHASE_ORDER, recordId: data[i].poId, isEditMode: false });
            } catch (e) {
                data[i].poUrl = '';
            }

            try {
                data[i].vendorUrl = data[i].vendorId ? url.resolveRecord({ recordType: record.Type.VENDOR, recordId: data[i].vendorId, isEditMode: false }) : '';
            } catch (e2) {
                data[i].vendorUrl = '';
            }

            if (data[i].groupNumber && groupTrackingMap[data[i].groupNumber]) {
                data[i].emailSentDate = groupTrackingMap[data[i].groupNumber].dateSent || '';
                data[i].trackingStatus = groupTrackingMap[data[i].groupNumber].statusId || '';
                data[i].groupMemo = groupTrackingMap[data[i].groupNumber].groupMemo || '';
                data[i].groupRecordId = groupTrackingMap[data[i].groupNumber].recordId || '';
                data[i].groupRecordUrl = groupTrackingMap[data[i].groupNumber].recordUrl || '';
                data[i].hasPdf = !!groupTrackingMap[data[i].groupNumber].pdfId;
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
            subsidiaryId: result.getValue({name:'subsidiary'}) || '',
            currencyId: result.getValue({name:'currency'}) || '',
            vendorName: vendorInfo.name || result.getText({ name: 'entity' }) || '',
            vendorUrl: '',
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
            groupRecordId: '',
            groupRecordUrl: '',
            amount: result.getValue({ name: 'amount' }) || '',
            emailSent: emailSentValue === true || emailSentValue === 'T'
        };
    }

    function getGroupRecordUrl(groupRecordId) {
        if (!groupRecordId) return '';

        try {
            return url.resolveRecord({
                recordType: CUSTOM_REC_TYPE,
                recordId: groupRecordId,
                isEditMode: false
            });
        } catch (e) {
            return '/app/common/custom/custrecordentry.nl?rectype=' + CUSTOM_REC_TYPE_NUMERIC_ID + '&id=' + encodeURIComponent(groupRecordId);
        }
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
        var poNumbers = [];
        var totalAmount = 0;
        var hasAmount = false;

        for (var i = 0; i < poList.length; i++) {
            var po = poList[i] || {};
            if (po.tranId) poNumbers.push(po.tranId);

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
        html += '<th style="text-align:center;padding:8px 10px;background:#f3f4f6;border:1px solid #d1d5db;">PO Number</th>';
        html += '<th style="text-align:center;padding:8px 10px;background:#f3f4f6;border:1px solid #d1d5db;">Date</th>';
        html += '<th style="text-align:center;padding:8px 10px;background:#f3f4f6;border:1px solid #d1d5db;">Memo</th>';
        html += '<th style="text-align:right;padding:8px 10px;background:#f3f4f6;border:1px solid #d1d5db;">Amount</th>';
        html += '</tr></thead><tbody>';

        var totalAmount = 0;
        var hasAmount = false;
        for (var i = 0; i < poList.length; i++) {
            var po = poList[i] || {};
            var amount = parseFloat(String(po.amount || '').replace(/[^0-9.\-]/g, ''));
            if (!isNaN(amount)) {
                totalAmount += amount;
                hasAmount = true;
            }

            html += '<tr>';
            html += '<td style="padding:8px 10px;border:1px solid #d1d5db;text-align:center;">' + escapeHtml(po.tranId || '') + '</td>';
            html += '<td style="padding:8px 10px;border:1px solid #d1d5db;text-align:center;">' + escapeHtml(po.tranDate || '') + '</td>';
            html += '<td style="padding:8px 10px;border:1px solid #d1d5db;text-align:center;">' + textToHtml(po.vendorMemo || po.memo || '') + '</td>';
            html += '<td style="padding:8px 10px;border:1px solid #d1d5db;text-align:right;">' + escapeHtml(formatMoney(po.amount)) + '</td>';
            html += '</tr>';
        }

        html += '<tr>';
        html += '<td colspan="3" style="padding:8px 10px;border:1px solid #d1d5db;text-align:right;font-weight:bold;background:#f9fafb;">Total</td>';
        html += '<td style="padding:8px 10px;border:1px solid #d1d5db;text-align:right;font-weight:bold;background:#f9fafb;">' + escapeHtml(hasAmount ? formatMoney(totalAmount) : '') + '</td>';
        html += '</tr>';

        html += '</tbody></table>';
        return html;
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
        var response = {sent: [], created: [], skipped: [], errors: [], notice: [], updatedIds: [], customMemoMap: options.customMemoMap || {}};
        var selectedIds = parseIds(options.selectedIdsText);
        var selected = selectedIds.length ? loadPOsByIds(selectedIds) : [];
        if (!selected.length || selected.length !== selectedIds.length) {
            response.errors.push('Select valid Purchase Orders and refresh the list before retrying.');
            return response;
        }
        var groupNumber = selected[0].groupNumber || '';
        var vendorId = String(selected[0].vendorId || '');
        var subsidiaryId = String(selected[0].subsidiaryId || '');
        var currencyId = String(selected[0].currencyId || '');
        var groupMemo = String(options.groupMemo || '').trim();
        if (!groupMemo) { response.errors.push('Group Memo is required.'); return response; }
        for (var i = 0; i < selected.length; i++) {
            if (String(selected[i].groupNumber || '') !== String(groupNumber) || String(selected[i].vendorId) !== vendorId) {
                response.errors.push('Select one vendor and one existing group, or only ungrouped POs.');
                return response;
            }
        }
        var poList = groupNumber ? loadPOsByGroupNumber(groupNumber) : selected;
        var ids = [], numbers = [];
        for (var p = 0; p < poList.length; p++) {
            if (String(poList[p].subsidiaryId || '') !== subsidiaryId || String(poList[p].currencyId || '') !== currencyId) { response.errors.push('A group must contain POs from one subsidiary and one currency.'); return response; }
            if (String(poList[p].vendorId) !== vendorId) { response.errors.push('The group contains different vendors.'); return response; }
            if (!groupNumber && poList[p].emailSent) { response.errors.push('An ungrouped PO is already marked sent. Review it first.'); return response; }
            ids.push(poList[p].poId); numbers.push(poList[p].tranId);
        }
        var generateOnly = !!options.generateOnly || !poList[0].vendorSendPoEmail;
        var to = [], cc = [];
        if (!generateOnly) {
            try {
                to = validateEmailList(options.recipientText === undefined ? poList[0].vendorEmail : options.recipientText);
                cc = validateEmailList(options.ccText).filter(function (value) { return to.indexOf(value) < 0; });
                if (!to.length) throw new Error('At least one To email address is required.');
                if (to.length + cc.length > 10) throw new Error('NetSuite permits a maximum of 10 addresses across To and CC.');
                if (!String(options.emailSubject || '').trim() || !hasHtmlContent(options.emailBodyText)) throw new Error('Email Subject and Email Body are required.');
            } catch (validationError) { response.errors.push(validationError.message); return response; }
        }
        groupNumber = groupNumber || generateGroupNumber(vendorId);
        var tracking = null, emailWasSent = false, savedPdf = null;
        response.groupNumber = groupNumber;
        response.groupMemo = groupMemo;
        response.actionMode = generateOnly ? 'generate_pdf' : 'send';
        try {
            tracking = saveTrackingRecord({
                groupNumber: groupNumber, poIds: ids, groupMemo: groupMemo,
                emailSubject: options.emailSubject || '', emailBody: options.emailBodyText || '',
                vendorId: vendorId, recipientEmail: to[0] || '',
                statusId: null, incrementRevision: false, preserveEmail: generateOnly
            });
            response.groupRecordId = tracking.id;
            response.groupRecordUrl = getGroupRecordUrl(tracking.id);
            var isResend = !!tracking.dateSent;
            response.actionMode = generateOnly ? 'generate_pdf' : (isResend ? 'resend' : 'send');
            // Preserve previous sent flags until a new email actually succeeds.
            stampPurchaseOrders(ids, groupNumber, response.customMemoMap, null, tracking.id);
            var nextRevision = tracking.revision + (generateOnly ? 0 : 1);
            var mergedPdf = createMergedPoPdf(ids, poList[0].vendorName, tracking.id, nextRevision);
            mergedPdf.name = cleanFileName('Grouped_PO_' + groupNumber + '_R' + nextRevision + '_' + Date.now() + '.pdf');
            savedPdf = attachGeneratedPdfToTrackingRecord(tracking.id, mergedPdf);
            response.pdfUrl = savedPdf.url;
            if (!generateOnly) {
                email.send({
                    author: runtime.getCurrentUser().id, recipients: to, cc: cc,
                    subject: options.emailSubject, body: options.emailBodyText,
                    attachments: [savedPdf.file],
                    relatedRecords: {entityId: Number(vendorId), transactionId: Number(ids[0])}
                });
                emailWasSent = true;
                // Persist delivery first. A subsequent PO update failure must not invite a duplicate send.
                markTrackingSent(tracking.id, isResend ? STATUS_RESEND_ID : STATUS_SENT_ID, tracking.dateSent, new Date(), nextRevision);
                stampPurchaseOrders(ids, groupNumber, {}, true, tracking.id, true);
                response.sent.push(poList[0].vendorName + ' - ' + numbers.join(', '));
            } else {
                response.created.push('PDF generated and saved for ' + numbers.join(', ') + '. No email sent.');
            }
            for (var f = 0; f < ids.length; f++) {
                try {
                    record.attach({record: {type: 'file', id: savedPdf.id}, to: {type: 'purchaseorder', id: Number(ids[f])}});
                } catch (attachmentError) {
                    log.error('PO PDF attachment failed', {poId: ids[f], error: attachmentError});
                    response.notice.push('PDF saved on the group, but could not attach it to PO ' + numbers[f] + '.');
                }
            }
            response.updatedIds = ids;
        } catch (e) {
            log.error('PO Email Process Failed', {groupNumber: groupNumber, error: e});
            if (tracking && !emailWasSent && !generateOnly) {
                try { markTrackingFailed(tracking.id, e); } catch (trackingError) { log.error('Tracking failure update failed', trackingError); }
            }
            response.errors.push(emailWasSent ? 'Email was sent, but tracking or PO updates failed. Review the first PO communication before retrying: ' + e.message : e.message);
        }
        return response;
    }

    function showGroupUpdate(context) {
        var p = context.request.parameters, groupId = String(p.custpage_group_id || '');
        if (!/^\d+$/.test(groupId)) throw new Error('A valid grouped PO record is required.');
        var group = record.load({type:CUSTOM_REC_TYPE,id:groupId});
        var ids = group.getValue({fieldId:CREC_PO_NUMBER}) || [];
        if (!Array.isArray(ids)) ids = parseIds(ids);
        var groupName = String(group.getValue({fieldId:CREC_GROUP_NUMBER}) || '');
        var form = serverWidget.createForm({title:'Update grouped purchase orders — ' + groupName});
        function hidden(id,value) { var f=form.addField({id:id,type:serverWidget.FieldType.TEXT,label:id}); f.updateDisplayType({displayType:serverWidget.FieldDisplayType.HIDDEN});f.defaultValue=value; }
        hidden('custpage_group_update','T'); hidden('custpage_group_id',groupId);
        var notes = String(p.custpage_group_notes || '').trim();
        var datestring = String(p.custpage_group_shipdate || '').trim();
        var noteDateOnly = p.custpage_group_date_note === 'T';
        var messages = [], failed = [], successful = [];
        if (context.request.method === 'POST') {
            var expected = parseIds(p.custpage_group_members || '').sort().join(',');
            if (ids.map(String).sort().join(',') !== expected) throw new Error('Group membership changed. Reload and review before updating.');
            if (!notes && !datestring) throw new Error('Enter notes or an expected shipping date.');
            if (noteDateOnly && !datestring) throw new Error('Enter the estimated shipping date to record in member memos.');
            if (notes.length > 3000) throw new Error('Keep the shared note below 3,000 characters.');
            var date = datestring ? nsFormat.parse({value:datestring,type:nsFormat.Type.DATE}) : null;
            if (date && (!(date instanceof Date) || isNaN(date.getTime()))) throw new Error('Enter a valid expected shipping date.');
            for (var i=0; i<ids.length; i++) {
                if (runtime.getCurrentScript().getRemainingUsage() < 80) { failed = failed.concat(ids.slice(i).map(String)); messages.push('The remaining POs were not updated because this request reached its processing limit.'); break; }
                try {
                    var po=record.load({type:'purchaseorder',id:ids[i]});
                    if (String(po.getValue({fieldId:FIELD_GROUP_NUMBER}) || '') !== groupName) throw new Error('PO group changed; refresh before retrying.');
                    var oldMemo=String(po.getValue({fieldId:'memo'}) || '');
                    var updates = {};
                    if (notes && oldMemo.indexOf(notes) < 0) updates.memo = oldMemo + (oldMemo ? '\n' : '') + notes;
                    if (date && noteDateOnly) {
                        var dateNote = 'Estimated shipping date: ' + datestring;
                        var nextMemo = updates.memo || oldMemo;
                        if (nextMemo.split(/\r?\n/).indexOf(dateNote) < 0) updates.memo = nextMemo + (nextMemo ? '\n' : '') + dateNote;
                    } else if (date) updates.shipdate = date;
                    if (Object.keys(updates).length) record.submitFields({type:'purchaseorder',id:ids[i],values:updates,options:{enableSourcing:false,ignoreMandatoryFields:false}});
                    successful.push(String(po.getValue({fieldId:'tranid'}) || ids[i]));
                } catch(e) {failed.push(String(ids[i]));messages.push('PO '+ids[i]+': '+e.message);}
            }
            if (successful.length) messages.unshift('Updated: '+successful.join(', ')+'. Existing notes were preserved. Regenerate the grouped PDF to reflect changes.');
            if (successful.length && date && noteDateOnly) messages.push('Estimated date recorded in member memos. The PO shipping date field was not changed.');
            if (failed.length) messages.push('Not updated: '+failed.join(', ')+'. Review these records before retrying. Repeating the identical note will not append it twice.');
        }
        hidden('custpage_group_members',ids.join(','));
        var n=form.addField({id:'custpage_group_notes',type:serverWidget.FieldType.LONGTEXT,label:'Confirmation / tracking notes — append to every PO memo'});n.defaultValue=notes;
        var d=form.addField({id:'custpage_group_shipdate',type:serverWidget.FieldType.DATE,label:'Expected shipping date — apply to every PO'});d.defaultValue=datestring;
        var opt=form.addField({id:'custpage_group_date_note',type:serverWidget.FieldType.CHECKBOX,label:'Record estimated date in PO memos only (leave shipping date field unchanged)'});opt.defaultValue=noteDateOnly?'T':'F';
        var html='<p>Applies to all '+ids.length+' POs in this group. Blank fields leave existing values unchanged.</p>';
        messages.forEach(function(m){html+='<p>'+escapeHtml(m)+'</p>';});
        html+='<p><a href="'+escapeHtml(getGroupRecordUrl(groupId))+'">Return to grouped PO</a></p>';
        form.addField({id:'custpage_group_update_result',type:serverWidget.FieldType.INLINEHTML,label:'Result'}).defaultValue=html;
        form.addSubmitButton({label:'Update all member POs'});
        context.response.writePage(form);
    }

    function validateEmailList(value) {
        var seen = {}, out = [];
        parseEmailRecipients(value).forEach(function (address) {
            address = address.toLowerCase();
            if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) throw new Error('Invalid email address: ' + address);
            if (!seen[address]) { seen[address] = true; out.push(address); }
        });
        return out;
    }

    function getRecipientOptions(vendorId) {
        var options = [], seen = {};
        function add(emailAddress, name, source) {
            if (!emailAddress || seen[String(emailAddress).toLowerCase()]) return;
            seen[String(emailAddress).toLowerCase()] = true;
            options.push({email: emailAddress, label: name + ' — ' + source + ' — ' + emailAddress});
        }
        if (vendorId) {
            var vendor = getVendorInfo(vendorId, {});
            parseEmailRecipients(vendor.email).forEach(function (address) { add(address, vendor.name, 'Vendor'); });
            runSearch(search.create({type: 'contact', filters: [['isinactive','is','F'],'AND',['company','anyof',vendorId],'AND',['email','isnotempty','']], columns: ['entityid','email']}), 1000, function (r) {
                add(r.getValue('email'), r.getValue('entityid'), 'Vendor contact');
            });
        }
        // Department names include their hierarchy, so Sales children and Retail are included.
        runSearch(search.create({type: 'employee', filters: [['isinactive','is','F'],'AND',['email','isnotempty','']], columns: ['entityid','email','department']}), 0, function (r) {
            var department = r.getText('department') || '';
            if (/(^|[:\s])sales($|[:\s])|purchasing|retail/i.test(department)) add(r.getValue('email'), r.getValue('entityid'), department);
        });
        return options.sort(function (a,b) { return a.label.localeCompare(b.label); });
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
            search.createColumn({ name: 'subsidiary' }),
            search.createColumn({ name: 'currency' }),
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

    // Read-only search fallback: workflow locks can reject even record.load().
    function loadPoForItemSummary(id) {
        try { return record.load({type:'purchaseorder',id:id}); }
        catch (loadError) {
            if (loadError.name !== 'RCRD_LOCKED_BY_WF') throw loadError;
        }
        var header = search.lookupFields({type:'purchaseorder',id:id,columns:['tranid','location','createdfrom','custbody_am_created_frrom_so']});
        function scalar(v) { return Array.isArray(v) ? (v[0] ? v[0].value : '') : v; }
        var typeColumn = search.createColumn({name:'formulatext',formula:'{item.type}'});
        var customerColumn = search.createColumn({name:'internalid',join:'customer'});
        var columns = [search.createColumn({name:'line',sort:search.Sort.ASC}),'item','quantityuom','netamount','taxamount','exchangerate','unit','location','memo','custcol_am_po_applied_discount',typeColumn,customerColumn];
        var lines = [];
        var lineSearch = search.create({type:'purchaseorder',filters:[['internalid','anyof',id],'AND',['mainline','is','F'],'AND',['taxline','is','F'],'AND',['shipping','is','F'],'AND',['cogs','is','F'],'AND',['item','noneof','@NONE@']],columns:columns});
        runSearch(lineSearch, 0, function(r) {
            var quantity = Number(r.getValue('quantityuom') || 0);
            var exchangeRate = Number(r.getValue('exchangerate'));
            if (!isFinite(exchangeRate) || exchangeRate <= 0) throw new Error('Invalid exchange rate on workflow-locked PO ' + id + '.');
            var amount = Math.round((Number(r.getValue('netamount') || 0) + Number(r.getValue('taxamount') || 0)) / exchangeRate * 100) / 100;
            var type = String(r.getValue(typeColumn) || '');
            var aliases = {'Inventory Item':'InvtPart','Non-inventory Item':'NonInvtPart','Other Charge':'OthCharge','Item Group':'Group','End of Item Group':'EndGroup'};
            lines.push({item:r.getValue('item'),itemText:r.getText('item'),itemtype:aliases[type] || type,
                quantity:quantity,amount:amount,rate:quantity ? Math.round(amount / quantity * 100000000) / 100000000 : '',
                units:r.getValue('unit') || '',location:r.getValue('location'),taxcode:'unverified-locked-tax:' + id + ':' + r.getValue('line'),
                description:r.getValue('memo') || '',customer:r.getValue(customerColumn),
                custcol_am_po_applied_discount:r.getValue('custcol_am_po_applied_discount')});
        });
        if (!lines.length) throw new Error('No readable item lines found for workflow-locked PO ' + id + '.');
        return {
            getValue:function(o){return scalar(header[o.fieldId]);},
            getSublistFields:function(){return Object.keys(lines[0]);},
            getLineCount:function(){return lines.length;},
            getSublistValue:function(o){return lines[o.line][o.fieldId];},
            getSublistText:function(o){return o.fieldId === 'item' ? lines[o.line].itemText : lines[o.line][o.fieldId];}
        };
    }

    function collectGroupedItems(poIds) {
        var rows = [], map = {};
        poIds.forEach(function(id) {
            var po = loadPoForItemSummary(id);
            var fields = po.getSublistFields({sublistId:'item'});
            var poNumber = String(po.getValue({fieldId:'tranid'}) || id);
            var salesOrder = String(po.getValue({fieldId:'custbody_am_created_frrom_so'}) || po.getValue({fieldId:'createdfrom'}) || '').trim();
            var headerLocation = String(po.getValue({fieldId:'location'}) || '');
            for (var line=0;line<po.getLineCount({sublistId:'item'});line++) {
                function value(field) {return fields.indexOf(field)<0 ? '' : po.getSublistValue({sublistId:'item',fieldId:field,line:line});}
                var type=String(value('itemtype'));
                if (['Subtotal','Description','Group','EndGroup'].indexOf(type)>=0) continue;
                var quantity=Number(value('quantity') || 0), amount=Number(value('amount') || 0);
                if (!isFinite(quantity) || !isFinite(amount)) throw new Error('Invalid item amount or quantity on '+poNumber+' line '+(line+1));
                var name=String(po.getSublistText({sublistId:'item',fieldId:'item',line:line}) || value('item'));
                var units=fields.indexOf('units')>=0 ? String(po.getSublistText({sublistId:'item',fieldId:'units',line:line}) || '') : '';
                var key=JSON.stringify([String(value('item') || ''),units,Number(value('rate') || 0),String(value('location') || headerLocation),String(value('taxcode') || ''),Number(String(value('custcol_am_po_applied_discount') || 0).replace('%','')),String(value('description') || '').trim(),String(value('customer') || ''),salesOrder]);
                // Non-quantity adjustments remain separate, preserving their meaning.
                if (quantity <= 0 || ['Discount','Markup'].indexOf(type)>=0) key += ':'+id+':'+line;
                if (!map[key]) {map[key]={item:name,description:String(value('description') || ''),quantity:0,units:units,rate:String(value('rate') || ''),amount:0,poNumbers:[],discount:String(value('custcol_am_po_applied_discount') || '')};rows.push(map[key]);}
                var row=map[key];row.quantity+=quantity;row.amount+=amount;
                if(row.poNumbers.indexOf(poNumber)<0)row.poNumbers.push(poNumber);
            }
        });
        return rows;
    }
    function renderGroupedItemSummary(poIds, vendorName) {
        var rows=collectGroupedItems(poIds), total=0;
        var xml='<?xml version="1.0"?><!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd"><pdf><head><style>body{font-family:Helvetica;font-size:9pt}th{background-color:#eeeeee;font-weight:bold}td,th{padding:5px;border-bottom:0.5px solid #cccccc}h1{font-size:17pt}</style></head><body size="Letter" padding="30px"><h1>Grouped PO — combined item quantities</h1><p>'+escapeHtml(vendorName)+'</p><p>Items with matching units, rates, discount and order context are combined below. Workflow-locked PO lines remain separate when their tax context cannot be verified. Source PO pages follow for reference; they are the same orders, not additional quantities.</p><table width="100%"><thead><tr><th width="35%">Item / description</th><th width="10%">Quantity</th><th width="10%">Units</th><th width="12%">Rate</th><th width="13%">Amount</th><th width="20%">Source POs</th></tr></thead><tbody>';
        rows.forEach(function(row){total+=row.amount;xml+='<tr><td>'+escapeHtml(row.item)+(row.description ? '<br/>'+escapeHtml(row.description) : '')+(row.discount ? '<br/>Discount: '+escapeHtml(row.discount)+'%' : '')+'</td><td align="right">'+escapeHtml(String(Math.round(row.quantity*1000000)/1000000))+'</td><td>'+escapeHtml(row.units)+'</td><td align="right">'+escapeHtml(row.rate)+'</td><td align="right">'+row.amount.toFixed(2)+'</td><td>'+escapeHtml(row.poNumbers.join(', '))+'</td></tr>';});
        xml+='</tbody></table><p align="right"><b>Item amount total: '+total.toFixed(2)+'</b></p><p>Taxes and any charges outside the item sublist remain on the source POs.</p></body></pdf>';
        return render.xmlToPdf({xmlString:xml});
    }

  function createMergedPoPdf(poIds, vendorName, trackingRecordId, revision) {
    var groupPdf = renderGroupedPoRecordPdf(trackingRecordId, revision);

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

    var itemSummary = renderGroupedItemSummary(poIds, vendorName);
    var summaryContents = itemSummary.getContents();
    estimatedBytes += getBase64ByteSize(summaryContents);
    checkMergedPdfLimit(estimatedBytes);
    pdfSetXml += '<pdf src="data:application/pdf;base64,' + summaryContents + '"/>';

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

function renderGroupedPoRecordPdf(trackingRecordId, revision) {
    if (!trackingRecordId) {
        throw new Error('Missing grouped PO tracking record ID.');
    }

    var groupRecord = record.load({
        type: CUSTOM_REC_TYPE,
        id: trackingRecordId,
        isDynamic: false
    });

    if (revision !== undefined) groupRecord.setValue({fieldId: CREC_REVISION_NUMBER, value: revision});
    var renderer = render.create();

    renderer.setTemplateByScriptId({
        scriptId: runtime.getCurrentScript().getParameter({name: 'custscript_po_group_record_pdf'}) || GROUP_PDF_TEMPLATE_ID
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
        if (!values.preserveEmail || !existingId) {
            rec.setValue({ fieldId: CREC_EMAIL_SUBJECT, value: values.emailSubject });
            rec.setValue({ fieldId: CREC_EMAIL_BODY, value: values.emailBody });
        }
        if (values.setLastSentDate) {
            rec.setValue({ fieldId: CREC_LAST_SENT_DATE, value: new Date() });
        }
        if (values.statusId !== null && values.statusId !== undefined) {
            rec.setValue({fieldId: CREC_EMAIL_STATUS, value: values.statusId});
        } else if (!existingId) {
            rec.setValue({fieldId: CREC_EMAIL_STATUS, value: STATUS_GROUPED_ID});
        }
        rec.setValue({ fieldId: CREC_ERROR_LOG, value: '' });

        if (!values.preserveEmail && runtime.getCurrentUser().id > 0) {
            rec.setValue({ fieldId: CREC_SENDER, value: runtime.getCurrentUser().id });
        }
        if (!values.preserveEmail || !existingId) rec.setValue({ fieldId: CREC_RECIPIENT, value: values.recipientEmail || '' });
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
       values[CREC_REVISION_NUMBER] = revision;
        values[CREC_ERROR_LOG] = '';

        record.submitFields({
            type: CUSTOM_REC_TYPE,
            id: trackingRecordId,
            values: values,
            options: { enableSourcing: false, ignoreMandatoryFields: true }
        });
    }

    function attachGeneratedPdfToTrackingRecord(trackingRecordId, mergedPdf) {
        if (!trackingRecordId || !mergedPdf) throw new Error('Missing group or PDF.');
        // Resolve by name: file-cabinet internal IDs differ across accounts.
        var folders = search.create({type: 'folder', filters: [['name','is','Multiple PO Email Merge']], columns: ['internalid']}).run().getRange({start:0,end:2});
        if (folders.length !== 1) throw new Error('Expected exactly one folder named Multiple PO Email Merge.');
        mergedPdf.folder = Number(folders[0].id);
        mergedPdf.isOnline = false;
        var pdfId = mergedPdf.save();
        var values = {};
        values[CREC_GENERATED_PDF] = pdfId;
        record.submitFields({type: CUSTOM_REC_TYPE, id: trackingRecordId, values: values, options: {enableSourcing:false, ignoreMandatoryFields:true}});
        var saved = file.load({id: pdfId});
        return {id: pdfId, file: saved, url: saved.url};
    }

    function stampPurchaseOrders(poIds, groupNumber, customMemoMap, markSent, groupid, skipDetailsRefresh) {
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

            var current = search.lookupFields({type:'purchaseorder',id:poId,columns:[FIELD_GROUP_NUMBER,FIELD_EMAIL_SENT,FIELD_VENDOR_MEMO,FIELD_STOCK_PO,'custbody_ace_po_instruction']});
            if (!skipDetailsRefresh) {
                if (current[FIELD_STOCK_PO] === true || current[FIELD_STOCK_PO] === 'T') {
                    var stockNote = 'COMBINE WITH STOCK PO FOR PROCESSING AND PREPAID SHIPMENT AS INVENTORY ALLOWS';
                    var existingInstructions = String(current.custbody_ace_po_instruction || '');
                    if (existingInstructions.replace(/\s+/g,' ').toUpperCase().indexOf(stockNote) < 0) values.custbody_ace_po_instruction = existingInstructions + (existingInstructions ? '\n' : '') + stockNote;
                }
            }
            // Existing grouped POs may be locked by approval workflows. Do not
            // submit unchanged values merely to regenerate or resend their PDF.
            Object.keys(values).forEach(function(field) {
                var before = current[field];
                var same = field === FIELD_EMAIL_SENT
                    ? (before === true || before === 'T') === values[field]
                    : String(before === null || before === undefined ? '' : before) === String(values[field]);
                if (same) delete values[field];
            });
            if (Object.keys(values).length) {
                try {
                    record.submitFields({
                        type: record.Type.PURCHASE_ORDER,
                        id: poId,
                        values: values,
                        options: { enableSourcing: false, ignoreMandatoryFields: true }
                    });
                } catch (poUpdateError) {
                    throw new Error('Could not update grouped PO ' + poId + ': ' + poUpdateError.message);
                }
            }
        }
        if (!skipDetailsRefresh) {
            var groupRec = record.load({type: CUSTOM_REC_TYPE, id: groupid});
            groupRec.save();
        }
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
                search.createColumn({ name: CREC_MASTER_MEMO }),
                search.createColumn({ name: CREC_GENERATED_PDF })
            ]
        });

        runSearch(trackingSearch, 0, function (result) {
            var groupNumber = result.getValue({ name: CREC_GROUP_NUMBER }) || '';
            if (groupNumber && !map[groupNumber]) {
                map[groupNumber] = {
                    recordId: result.id || '',
                    recordUrl: getGroupRecordUrl(result.id),
                    dateSent: result.getValue({ name: CREC_DATE_SENT }) || '',
                    statusId: result.getValue({ name: CREC_EMAIL_STATUS }) || '',
                    groupMemo: result.getValue({ name: CREC_MASTER_MEMO }) || '',
                    pdfId: result.getValue({name: CREC_GENERATED_PDF}) || ''
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
            if (id && ids.indexOf(id) < 0) ids.push(id);
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
