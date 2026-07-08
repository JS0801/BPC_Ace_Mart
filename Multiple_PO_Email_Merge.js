/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * ===================== FIX CHANGELOG =====================
 * 1) Memo override bug:
 *    - Client: Master Memo autofill was looping over ALL loaded PO_DATA rows
 *      (not just checked/selected ones), silently overwriting the Group Memo
 *      of unrelated or already-sent POs sitting in the filtered table.
 *      Fixed in the HTML/JS template (bindMasterMemo).
 *    - Server: the "else if (masterMemo)" fallback in updatePOAndCustomRecord
 *      would blanket-apply Master Memo to ANY PO returned by the group-number
 *      lookup during resend, even ones not explicitly reviewed/selected this
 *      round. Now that fallback only applies on a brand-new "send", never on
 *      "resend" - resend only writes memo for POs explicitly present in the
 *      groupMemoMap; everything else is left untouched.
 *
 * 2) Resend was creating a NEW custom record instead of finding/updating the
 *    existing one:
 *    - Rewrote the lookup into findGroupCustomRecordId() with a trimmed,
 *      defensive search (search.each instead of getRange) plus clear audit
 *      logging so any future "not found" case is visible/diagnosable instead
 *      of silently creating a duplicate.
 *
 * 3) Resend was changing the Group Number:
 *    - The group number was being re-derived from group.poList[0].groupNumber
 *      AFTER the PO list got re-fetched by getPOsByGroupNumber(), which was an
 *      unnecessary (and risky) indirection. The original, validated group
 *      number is now captured ONCE up front (resendGroupNumber), trimmed,
 *      guaranteed non-empty, and used as-is for the entire resend operation -
 *      it is never regenerated or blanked out.
 *
 * 4) Email Sent Date never saved / never showed on the portal:
 *    - A runtime "does this field exist?" pre-check (isEmailSentDateFieldValid)
 *      was gating BOTH the read (search column) and write (submitFields) of
 *      custbody_email_sent_date, and was unreliable, causing it to be
 *      silently skipped. Removed the gate entirely - the field is always
 *      read and always set on initial send.
 * ===========================================================
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
    var PARAM_HTML_FILE_ID = 'custscript_po_email_html_file';

    // --- Core Transaction Fields ---
    var FIELD_EMAIL_SENT = 'custbody_email_sent';
    var FIELD_EMAIL_SENT_DATE = 'custbody_email_sent_date'; 
    var FIELD_GROUP_NUMBER = 'custbody_group_number';
    var FIELD_VENDOR_MEMO = 'custbody_vendor_memo'; 

    // --- Custom Record Fields ---
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

    // --- List Option Settings (Verify with your account Custom List setup IDs) ---
    var STATUS_SENT_ID = 1;   
    var STATUS_RESEND_ID = 2; 

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
    var FLD_EMAIL_SUBJECT = 'custpage_email_subject';
    var FLD_EMAIL_BODY_MEMO = 'custpage_email_body_memo';
    var FLD_MASTER_MEMO = 'custpage_master_memo';       
    var FLD_GROUP_MEMO_MAP = 'custpage_group_memo_map';  
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
            var emailSubject = params[FLD_EMAIL_SUBJECT] || '';
            var masterMemo = params[FLD_MASTER_MEMO] || '';
            var groupMemoMap = parseGroupMemoMap(params[FLD_GROUP_MEMO_MAP]);
            var resultMessage = null;

            if (isAjax) {
                handleAjaxRequest(context, params, filters, emailBodyMemo);
                return;
            }

            if (request.method === 'POST') {
                var actionMode = params[FLD_ACTION] || 'filter';
                if (actionMode === 'send' || actionMode === 'resend') {
                    resultMessage = processSelectedPOs(params[FLD_SELECTED_IDS], actionMode, emailBodyMemo, masterMemo, groupMemoMap, emailSubject);
                }
            }

            showPage(context, filters, resultMessage, emailBodyMemo, emailSubject);
        } catch (e) {
            log.error('Suitelet Error', e);
            if (isAjax) {
                writeJson(context, { success: false, message: e.name + ' : ' + e.message });
                return;
            }
            context.response.write('<h3>Unexpected System Error Encountered</h3><pre>' + escapeHtml(e.name + ' : ' + e.message) + '</pre>');
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
            groupNumber: params[FLD_GROUP_NUMBER] || ''
        };
    }

    function handleAjaxRequest(context, params, filters, emailBodyMemo) {
        var ajaxAction = params[FLD_AJAX_ACTION] || params[FLD_ACTION] || 'filter';
        if (ajaxAction === 'send' || ajaxAction === 'resend') {
            var masterMemo = params[FLD_MASTER_MEMO] || '';
            var emailSubject = params[FLD_EMAIL_SUBJECT] || '';
            var groupMemoMap = parseGroupMemoMap(params[FLD_GROUP_MEMO_MAP]);
            var resultMessage = processSelectedPOs(params[FLD_SELECTED_IDS], ajaxAction, emailBodyMemo, masterMemo, groupMemoMap, emailSubject);

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
        if (!filters) return false;
        return !!(filters.poId || filters.poText || filters.vendorId || filters.vendorText || filters.dateFrom || filters.dateTo || filters.emailStatus || filters.groupNumber);
    }

    function showPage(context, filters, resultMessage, emailBodyMemo, emailSubject) {
        var form = serverWidget.createForm({ title: ' ' });

        var actionFld = form.addField({ id: FLD_ACTION, type: serverWidget.FieldType.TEXT, label: 'Action' });
        actionFld.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });

        var selectedFld = form.addField({ id: FLD_SELECTED_IDS, type: serverWidget.FieldType.LONGTEXT, label: 'Selected PO IDs' });
        selectedFld.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });

        var shouldLoadPoData = hasAnyFilter(filters) && !resultMessage;
        var poData = shouldLoadPoData ? getPurchaseOrders(filters) : [];
        var poOptions = shouldLoadPoData ? getPurchaseOrderOptions(filters) : [];
        var vendorOptions = getVendorOptions();

        var htmlFld = form.addField({ id: 'custpage_inline_ui', type: serverWidget.FieldType.INLINEHTML, label: 'PO Email UI' });
        htmlFld.defaultValue = buildPageHtmlFromTemplate({
            poData: poData,
            poOptions: poOptions,
            vendorOptions: vendorOptions,
            filters: filters,
            resultMessage: resultMessage,
            emailBodyMemo: emailBodyMemo,
            emailSubject: emailSubject,
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
            action: FLD_ACTION, selectedIds: FLD_SELECTED_IDS, po: FLD_PO, poText: FLD_PO_TEXT,
            vendor: FLD_VENDOR, vendorText: FLD_VENDOR_TEXT, dateFrom: FLD_DATE_FROM, dateTo: FLD_DATE_TO,
            emailStatus: FLD_EMAIL_STATUS, groupNumber: FLD_GROUP_NUMBER,
            emailBodyMemo: FLD_EMAIL_BODY_MEMO, emailSubject: FLD_EMAIL_SUBJECT, masterMemo: FLD_MASTER_MEMO, groupMemoMap: FLD_GROUP_MEMO_MAP,
            ajax: FLD_AJAX, ajaxAction: FLD_AJAX_ACTION
        };

        html = replaceTemplateToken(html, 'SUITELET_URL_JSON', safeJson(dataObj.suiteletUrl || ''));
        html = replaceTemplateToken(html, 'FIELD_IDS_JSON', safeJson(fieldIds));
        html = replaceTemplateToken(html, 'FILTERS_JSON', safeJson(dataObj.filters || {}));
        html = replaceTemplateToken(html, 'PO_DATA_JSON', safeJson(dataObj.poData || []));
        html = replaceTemplateToken(html, 'PO_OPTIONS_JSON', safeJson(dataObj.poOptions || []));
        html = replaceTemplateToken(html, 'VENDOR_OPTIONS_JSON', safeJson(dataObj.vendorOptions || []));
        html = replaceTemplateToken(html, 'RESULT_MESSAGE_JSON', safeJson(dataObj.resultMessage || null));
        html = replaceTemplateToken(html, 'EMAIL_BODY_MEMO_JSON', safeJson(dataObj.emailBodyMemo || ''));
        html = replaceTemplateToken(html, 'EMAIL_SUBJECT_JSON', safeJson(dataObj.emailSubject || ''));

        return html;
    }

    function loadHtmlTemplate() {
        var htmlFileId = runtime.getCurrentScript().getParameter({ name: PARAM_HTML_FILE_ID });
        if (!htmlFileId) {
            throw new Error('Missing Parameter setup configuration map file ID matching target UI elements.');
        }
        return file.load({ id: htmlFileId }).getContents();
    }

    function replaceTemplateToken(html, token, value) {
        return String(html).split('{{' + token + '}}').join(value);
    }

    function safeJson(value) {
        return JSON.stringify(value).replace(/</g, '\\u003C');
    }

    // FIX #4 (corrected): custbody_email_sent_date is not currently usable as a
    // SEARCH COLUMN in this account (SSS_INVALID_SRCH_COL) - this almost always
    // means the "Search" checkbox is unchecked on that custom field's
    // definition (Customization > Lists, Records, & Fields > Transaction Body
    // Fields > custbody_email_sent_date), or the field ID here doesn't exactly
    // match what's in the account.
    //
    // This guard ONLY affects whether we try to READ the field back via search
    // (so the script doesn't crash). It does NOT affect writing the field -
    // record.submitFields writes body fields directly and does not require the
    // "Search" flag, so the date is still always SET on initial send further
    // down in updatePOAndCustomRecord(). Once the field's "Search" checkbox is
    // enabled in NetSuite (or the field ID corrected), this will automatically
    // start showing up in search results too - no code change needed.
    var _emailSentDateSearchable = null;
    function isEmailSentDateSearchable() {
        if (_emailSentDateSearchable !== null) return _emailSentDateSearchable;
        try {
            search.create({
                type: 'purchaseorder',
                filters: [['internalid', 'anyof', '-99999999']],
                columns: [search.createColumn({ name: FIELD_EMAIL_SENT_DATE })]
            }).run().getRange({ start: 0, end: 1 });
            _emailSentDateSearchable = true;
        } catch (e) {
            log.audit(
                'custbody_email_sent_date not searchable',
                'This field cannot be used as a search column in this account (' + e.name + ': ' + e.message + '). ' +
                'The date is still being SAVED on every send, but it will not appear in the UI table until the field\'s ' +
                '"Search" checkbox is enabled (Customization > Lists, Records, & Fields > Transaction Body Fields), or the ' +
                'field ID is corrected if it differs from custbody_email_sent_date.'
            );
            _emailSentDateSearchable = false;
        }
        return _emailSentDateSearchable;
    }

    function poBaseColumnsWithDate(baseColumns) {
        if (isEmailSentDateSearchable()) {
            baseColumns.push(search.createColumn({ name: FIELD_EMAIL_SENT_DATE }));
        }
        return baseColumns;
    }

    function parseGroupMemoMap(text) {
        if (!text) return {};
        try {
            var obj = JSON.parse(text);
            return (obj && typeof obj === 'object') ? obj : {};
        } catch (e) {
            return {};
        }
    }

    function writeJson(context, obj) {
        context.response.setHeader({ name: 'Content-Type', value: 'application/json; charset=UTF-8' });
        context.response.write(JSON.stringify(obj));
    }

    function buildOrFilterExact(fieldId, values) {
        var filterExpr = [];
        for (var i = 0; i < values.length; i++) {
            if (i > 0) filterExpr.push('OR');
            filterExpr.push([fieldId, 'is', values[i]]);
        }
        return filterExpr;
    }

    // Portal's "Email Sent Date" column is now sourced from the tracking
    // custom record's custrecord_date_sent (set once, on the very first send,
    // and never touched again on resend) rather than the PO's own
    // custbody_email_sent_date field, since that field currently isn't usable
    // as a search column in this account. Batches ALL group numbers in the
    // current result set into a single search instead of one lookup per row.
    function getDateSentMapByGroupNumbers(groupNumbers) {
        var map = {};
        var uniqueGroups = [];
        var seen = {};

        for (var i = 0; i < groupNumbers.length; i++) {
            var g = groupNumbers[i];
            if (g && !seen[g]) {
                seen[g] = true;
                uniqueGroups.push(g);
            }
        }

        if (uniqueGroups.length === 0) return map;

        try {
            var crecSearch = search.create({
                type: CUSTOM_REC_TYPE,
                filters: buildOrFilterExact(CREC_GROUP_NUMBER, uniqueGroups),
                columns: [
                    search.createColumn({ name: CREC_GROUP_NUMBER }),
                    search.createColumn({ name: CREC_DATE_SENT })
                ]
            });

            runPagedSearch(crecSearch, function (result) {
                var g = result.getValue({ name: CREC_GROUP_NUMBER }) || '';
                if (g && !map.hasOwnProperty(g)) {
                    map[g] = result.getValue({ name: CREC_DATE_SENT }) || '';
                }
            });
        } catch (e) {
            log.error('Date Sent Lookup Failed', e);
        }

        return map;
    }

    function applyDateSentFromCustomRecord(data) {
        var groupNumbers = [];
        for (var i = 0; i < data.length; i++) {
            if (data[i].groupNumber) groupNumbers.push(data[i].groupNumber);
        }

        var dateSentMap = getDateSentMapByGroupNumbers(groupNumbers);

        for (var j = 0; j < data.length; j++) {
            var row = data[j];
            if (row.groupNumber && dateSentMap.hasOwnProperty(row.groupNumber) && dateSentMap[row.groupNumber]) {
                row.emailSentDate = dateSentMap[row.groupNumber];
            }
        }

        return data;
    }

    function getPurchaseOrders(filters) {
        var data = [];
        var vendorCache = {};
        if (!hasAnyFilter(filters)) return data;

        var baseCols = [
            search.createColumn({ name: 'internalid' }),
            search.createColumn({ name: 'tranid', sort: search.Sort.DESC }),
            search.createColumn({ name: 'entity' }),
            search.createColumn({ name: 'datecreated' }),
            search.createColumn({ name: 'memo' }),
            search.createColumn({ name: 'amount' }),
            search.createColumn({ name: FIELD_EMAIL_SENT }),
            search.createColumn({ name: FIELD_GROUP_NUMBER }),
            search.createColumn({ name: FIELD_VENDOR_MEMO })
        ];

        var poSearch = search.create({
            type: 'purchaseorder',
            settings: [{ name: 'consolidationtype', value: 'ACCTTYPE' }],
            filters: buildPurchaseOrderFilters(filters, false),
            columns: poBaseColumnsWithDate(baseCols)
        });

        runPagedSearchLimited(poSearch, MAX_UI_PO_ROWS, function (result) {
            var rowObj = buildPoDataFromResult(result, vendorCache);
            try {
                rowObj.poUrl = url.resolveRecord({ recordType: record.Type.PURCHASE_ORDER, recordId: rowObj.poId, isEditMode: false });
            } catch (linkErr) {
                rowObj.poUrl = '';
            }
            rowObj.dateCreated = result.getValue({ name: 'datecreated' }) || '';
            rowObj.amount = result.getValue({ name: 'amount' }) || '';
            data.push(rowObj);
        });

        return applyDateSentFromCustomRecord(data);
    }

    function getPurchaseOrderOptions(filters) {
        var options = [];
        if (!hasAnyFilter(filters)) return options;

        var poSearch = search.create({
            type: 'purchaseorder',
            settings: [{ name: 'consolidationtype', value: 'ACCTTYPE' }],
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
            filters: [['isinactive', 'is', 'F']],
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
            if (companyName) text += ' - ' + companyName;

            options.push({ id: id, text: text });
        });
        return options;
    }

    function buildPurchaseOrderFilters(filters, ignorePoFilter) {
        var searchFilters = [['type', 'anyof', 'PurchOrd'], 'AND', ['mainline', 'is', 'T']];

        if (filters.dateFrom && filters.dateTo) {
            searchFilters.push('AND');
            searchFilters.push(['datecreated', 'within', convertHtmlDateToNsDate(filters.dateFrom), convertHtmlDateToNsDate(filters.dateTo)]);
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
            searchFilters.push(['entity', 'anyof', vendorIds.length > 0 ? vendorIds : ['-999999']]);
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
        if (!vendorText) return ids;

        var vendorSearch = search.create({
            type: search.Type.VENDOR,
            filters: [['isinactive', 'is', 'F'], 'AND', [['entityid', 'contains', vendorText], 'OR', ['altname', 'contains', vendorText]]],
            columns: [search.createColumn({ name: 'internalid' })]
        });

        runPagedSearch(vendorSearch, function (result) { ids.push(result.id); });
        return ids;
    }

    function processSelectedPOs(selectedIdsText, actionMode, emailBodyMemo, masterMemo, groupMemoMap, emailSubject) {
        groupMemoMap = groupMemoMap || {};
        masterMemo = masterMemo || '';
        emailSubject = emailSubject || '';

        var response = { sent: [], skipped: [], errors: [], updatedIds: [], groupNumber: '', actionMode: actionMode || '' };
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

        // FIX #3: capture the ORIGINAL, validated group number ONCE, up front.
        // This is the single source of truth used for the entire resend
        // operation below - it is never re-derived from re-fetched records,
        // never regenerated, and never allowed to be blank.
        var resendGroupNumber = '';

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

            resendGroupNumber = String(selectedGroupNumber || '').replace(/^\s+|\s+$/g, '');
            if (!resendGroupNumber) {
                response.errors.push('Unable to determine Group Number for resend.');
                return response;
            }

            poList = getPOsByGroupNumber(resendGroupNumber);
            if (poList.length === 0) {
                response.errors.push('No Purchase Orders found for Group Number: ' + resendGroupNumber);
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

        var group = { vendorId: firstVendorId, vendorName: firstVendorName, vendorEmail: firstVendorEmail, poIds: [], poNumbers: [], poList: [] };

        for (var i = 0; i < poList.length; i++) {
            var po = poList[i];
            if (actionMode === 'send') {
                if (po.emailSent || po.groupNumber) {
                    response.skipped.push(po.tranId + ' skipped because it already belongs to Group Number ' + po.groupNumber + '. Select it to resend that group instead.');
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
            // FIX #3: reuse the exact original group number on resend - never
            // regenerate or re-derive it from the (re-fetched) PO list.
            var groupNumber = (actionMode === 'resend') ? resendGroupNumber : generateGroupNumber(group.vendorId);
            var emailBody = buildMemoEmailBody(group.poList, emailBodyMemo);
            var subjectToUse = emailSubject ? emailSubject : (EMAIL_SUBJECT_PREFIX + ' - ' + group.poNumbers.join(', '));

            // Cover/summary page data - mirrors EVERY field tracked on the
            // customrecord_grouped_pos record except custrecord_generated_pdf
            // (no need for that one here since this IS the merged PDF).
            // Rendered as page 1 of the merged PDF, ahead of the PO pages.
            var currentUser = runtime.getCurrentUser();
            var trackingSnapshot = getExistingTrackingSnapshot(groupNumber, actionMode === 'resend');
            var nowDisplay = formatDateForSummary(new Date());
            var summaryInfo = {
                groupNumber: groupNumber,                                        // custrecord_group_number
                poNumbers: group.poNumbers,                                      // custrecord_po_number
                masterMemo: masterMemo,                                          // custrecord_master_memo
                emailSubject: subjectToUse,                                      // custrecord_email_subject
                emailBody: emailBody,                                            // custrecord_email_body
                dateSentDisplay: trackingSnapshot.dateSent ? formatDateForSummary(trackingSnapshot.dateSent) : nowDisplay, // custrecord_date_sent
                lastSentDateDisplay: nowDisplay,                                 // custrecord_last_sent_date
                sentByName: (currentUser && currentUser.name) ? currentUser.name : 'System', // custrecord_sender
                recipientDisplay: group.vendorName + (group.vendorEmail ? (' <' + group.vendorEmail + '>') : ''), // custrecord_recipient
                vendorName: group.vendorName,                                    // custrecord_vendor
                emailStatusDisplay: (actionMode === 'resend') ? 'Resend' : 'Sent', // custrecord_email_status
                revisionNumber: trackingSnapshot.revision                        // custrecord_revision_number
            };

            // OPTIMIZED: Accelerated PDF building
            var mergedPdf = createMergedPoPdf(group.poIds, group.vendorName, summaryInfo);

            email.send({
                author: runtime.getCurrentUser().id,
                recipients: Number(group.vendorId),
                subject: subjectToUse,
                body: emailBody,
                attachments: [mergedPdf],
                relatedRecords: { entityId: Number(group.vendorId) }
            });

            updatePOAndCustomRecord(group.poIds, groupNumber, {
                groupMemoMap: groupMemoMap,
                masterMemo: masterMemo,
                emailSubject: subjectToUse,
                emailBody: emailBody,
                actionMode: actionMode || '',
                vendorId: group.vendorId,
                vendorName: group.vendorName,
                mergedPdf: mergedPdf,
                firstPoDetails: group.poList[0],
                poNumbersList: group.poNumbers.join(', ') 
            });

            response.updatedIds = group.poIds;
            response.groupNumber = groupNumber;
            response.sent.push(group.vendorName + ' - ' + group.poNumbers.join(', ') + ' | Group Number: ' + groupNumber);

        } catch (e) {
            log.error('Email Process Failure', { vendorId: group.vendorId, poNumbers: group.poNumbers, error: e });
            response.errors.push(group.vendorName + ' - ' + e.message);
        }

        return response;
    }

    function getSelectedPoDetails(selectedIds) {
        var data = [];
        var vendorCache = {};
        var baseCols = [
            search.createColumn({ name: 'internalid' }),
            search.createColumn({ name: 'tranid' }),
            search.createColumn({ name: 'entity' }),
            search.createColumn({ name: 'memo' }),
            search.createColumn({ name: FIELD_EMAIL_SENT }),
            search.createColumn({ name: FIELD_GROUP_NUMBER }),
            search.createColumn({ name: FIELD_VENDOR_MEMO })
        ];

        var poSearch = search.create({
            type: 'purchaseorder',
            filters: [['type', 'anyof', 'PurchOrd'], 'AND', ['mainline', 'is', 'T'], 'AND', ['internalid', 'anyof', selectedIds]],
            columns: poBaseColumnsWithDate(baseCols)
        });

        runPagedSearch(poSearch, function (result) { data.push(buildPoDataFromResult(result, vendorCache)); });
        return data;
    }

    function getPOsByGroupNumber(groupNumber) {
        var data = [];
        var vendorCache = {};
        var baseCols = [
            search.createColumn({ name: 'internalid' }),
            search.createColumn({ name: 'tranid', sort: search.Sort.ASC }),
            search.createColumn({ name: 'entity' }),
            search.createColumn({ name: 'memo' }),
            search.createColumn({ name: FIELD_EMAIL_SENT }),
            search.createColumn({ name: FIELD_GROUP_NUMBER }),
            search.createColumn({ name: FIELD_VENDOR_MEMO })
        ];

        var poSearch = search.create({
            type: 'purchaseorder',
            filters: [['type', 'anyof', 'PurchOrd'], 'AND', ['mainline', 'is', 'T'], 'AND', [FIELD_GROUP_NUMBER, 'is', groupNumber]],
            columns: poBaseColumnsWithDate(baseCols)
        });

        runPagedSearch(poSearch, function (result) { data.push(buildPoDataFromResult(result, vendorCache)); });
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
            emailSentDate: isEmailSentDateSearchable() ? (result.getValue({ name: FIELD_EMAIL_SENT_DATE }) || '') : '',
            memo: result.getValue({ name: 'memo' }) || '',
            vendorMemo: result.getValue({ name: FIELD_VENDOR_MEMO }) || '',
            groupNumber: result.getValue({ name: FIELD_GROUP_NUMBER }) || '',
            amount: '',
            emailSent: emailSentValue === true || emailSentValue === 'T'
        };
    }

    function getVendorInfo(vendorId, vendorCache) {
        if (!vendorId) return { name: '', email: '' };
        if (vendorCache[vendorId]) return vendorCache[vendorId];

        var info = { name: '', email: '' };
        try {
            var lookup = search.lookupFields({
                type: search.Type.VENDOR,
                id: vendorId,
                columns: ['entityid', 'altname', 'email']
            });
            info.name = lookup.altname || lookup.entityid || '';
            info.email = lookup.email || '';
        } catch (e) {
            log.error('Vendor Lookup Error', { vendorId: vendorId, error: e });
        }

        vendorCache[vendorId] = info;
        return info;
    }

    /**
     * HIGHLY OPTIMIZED PDF MERGE
     * Generates files purely in memory without File Cabinet I/O disk writes
     */
    function formatDateForSummary(d) {
        try {
            return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
        } catch (e) {
            return String(d);
        }
    }

    function summaryFieldRow(label, value) {
        if (!value) return '';
        return '<tr>' +
            '<td style="width:150pt;font-weight:bold;padding:5pt 8pt;border-bottom:1pt solid #dddddd;vertical-align:top;">' + escapeHtml(label) + '</td>' +
            '<td style="padding:5pt 8pt;border-bottom:1pt solid #dddddd;vertical-align:top;">' + escapeHtml(value) + '</td>' +
            '</tr>';
    }

    function stripHtmlToPlainText(html) {
        if (!html) return '';
        var text = String(html)
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"');
        return text.replace(/\n{2,}/g, '\n').replace(/^\s+|\s+$/g, '');
    }

    // Like summaryFieldRow, but for values that may span multiple lines
    // (Email Body) - converts to plain text first, then rebuilds real <br/>
    // line breaks (each line individually escaped) instead of relying on
    // literal newline characters, which most PDF/HTML renderers collapse.
    function summaryMultilineFieldRow(label, htmlOrText) {
        var plainText = stripHtmlToPlainText(htmlOrText);
        if (!plainText) return '';

        var lines = plainText.split('\n');
        var escapedLines = [];
        for (var i = 0; i < lines.length; i++) {
            escapedLines.push(escapeHtml(lines[i]));
        }

        return '<tr>' +
            '<td style="width:150pt;font-weight:bold;padding:5pt 8pt;border-bottom:1pt solid #dddddd;vertical-align:top;">' + escapeHtml(label) + '</td>' +
            '<td style="padding:5pt 8pt;border-bottom:1pt solid #dddddd;vertical-align:top;">' + escapedLines.join('<br/>') + '</td>' +
            '</tr>';
    }

    // Builds a one-page PDF/HTML (BFO report XML) summary that mirrors EVERY
    // field tracked on customrecord_grouped_pos except custrecord_generated_pdf
    // (not applicable here since this cover page becomes part of that same
    // merged PDF). Prepended as page 1 of the merged PDF, ahead of the PO
    // pages.
    function buildSummaryPageXml(summary) {
        var rows = '';
        rows += summaryFieldRow('Group Number', summary.groupNumber);                          // custrecord_group_number
        rows += summaryFieldRow('Purchase Order(s)', (summary.poNumbers || []).join(', '));     // custrecord_po_number
        rows += summaryFieldRow('Vendor', summary.vendorName);                                  // custrecord_vendor
        rows += summaryFieldRow('Recipient', summary.recipientDisplay);                         // custrecord_recipient
        rows += summaryFieldRow('Sender', summary.sentByName);                                  // custrecord_sender
        rows += summaryFieldRow('Email Subject', summary.emailSubject);                         // custrecord_email_subject
        rows += summaryMultilineFieldRow('Email Body', summary.emailBody);                      // custrecord_email_body
        rows += summaryFieldRow('Master Memo', summary.masterMemo);                             // custrecord_master_memo
        rows += summaryFieldRow('Email Status', summary.emailStatusDisplay);                    // custrecord_email_status
        rows += summaryFieldRow('Date Sent', summary.dateSentDisplay);                          // custrecord_date_sent
        rows += summaryFieldRow('Last Sent Date', summary.lastSentDateDisplay);                 // custrecord_last_sent_date
        rows += summaryFieldRow('Revision Number', String(summary.revisionNumber));             // custrecord_revision_number

        return '<?xml version="1.0"?>' +
            '<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">' +
            '<pdf>' +
            '<body padding="0.6in 0.7in" font-family="Helvetica">' +
            '<table style="width:100%;"><tr><td style="font-size:20pt;font-weight:bold;padding-bottom:16pt;">Purchase Order Email Summary</td></tr></table>' +
            '<table style="width:100%;border-collapse:collapse;font-size:10pt;">' + rows + '</table>' +
            '</body>' +
            '</pdf>';
    }

    function createSummaryPagePdf(summary) {
        try {
            var summaryXml = buildSummaryPageXml(summary);
            return render.xmlToPdf({ xmlString: summaryXml });
        } catch (e) {
            log.error('Summary Page Generation Failed', e);
            return null;
        }
    }

    function createMergedPoPdf(poIds, vendorName, summaryInfo) {
        var pdfSetXml = '<?xml version="1.0"?><!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd"><pdfset>';

        // Prepend the summary/cover page as the very first page, before any
        // PO pages. If it fails for any reason, log it and continue without
        // it rather than blocking the whole send.
        if (summaryInfo) {
            var summaryPdf = createSummaryPagePdf(summaryInfo);
            if (summaryPdf) {
                var summaryBase64 = summaryPdf.getContents();
                pdfSetXml += '<pdf src="data:application/pdf;base64,' + summaryBase64 + '"/>';
            }
        }

        for (var i = 0; i < poIds.length; i++) {
            var poPdf = render.transaction({ 
                entityId: Number(poIds[i]), 
                printMode: render.PrintMode.PDF 
            });
            
            // Performance trick: Extract base64 and feed via XML URI schema to bypass file.save() entirely
            var base64Str = poPdf.getContents();
            pdfSetXml += '<pdf src="data:application/pdf;base64,' + base64Str + '"/>';
        }
        pdfSetXml += '</pdfset>';

        var mergedPdf = render.xmlToPdf({ xmlString: pdfSetXml });
        mergedPdf.name = cleanFileName('Merged_PO_' + vendorName + '_' + new Date().getTime() + '.pdf');
        return mergedPdf;
    }

    function buildMemoEmailBody(poList, emailBodyMemo) {
        if (emailBodyMemo) return convertTextToHtml(emailBodyMemo);
        if (poList.length > 0 && poList[0].vendorMemo) return convertTextToHtml(poList[0].vendorMemo);
        
        var body = '';
        if (poList.length === 1) {
            body = poList[0].memo || '';
            return convertTextToHtml(body ? body : 'Please find attached the Purchase Order PDF.');
        }
        return '<div style="font-family:Arial, sans-serif; font-size:13px;"><p>Please find attached the Purchase Order PDF.</p></div>';
    }

    // FIX #2: robust, well-logged lookup for the tracking custom record by
    // Group Number. Uses search.each() (more reliable than getRange) and
    // trims the group number to avoid whitespace-mismatch misses. Logs
    // clearly whenever it can't find an existing record on a resend, so this
    // is diagnosable going forward instead of silently creating duplicates.
    // Looks up the existing tracking record (on resend only) purely to read
    // its current Revision Number and original Date Sent, so the summary
    // page can show the RESULTING values before the actual update happens
    // later in updatePOAndCustomRecord. Read-only - does not modify anything.
    function getExistingTrackingSnapshot(groupNumber, isResend) {
        if (!isResend) {
            return { revision: 0, dateSent: null };
        }

        var existingId = findGroupCustomRecordId(groupNumber);
        if (!existingId) {
            return { revision: 0, dateSent: null };
        }

        try {
            var rec = record.load({ type: CUSTOM_REC_TYPE, id: existingId, isDynamic: false });
            var rev = rec.getValue({ fieldId: CREC_REVISION_NUMBER });
            var revNum = (rev === '' || rev === null || rev === undefined) ? 0 : parseInt(rev, 10);
            var dateSent = rec.getValue({ fieldId: CREC_DATE_SENT }) || null;
            return { revision: revNum + 1, dateSent: dateSent };
        } catch (e) {
            log.error('Tracking Snapshot Lookup Failed', { groupNumber: groupNumber, error: e });
            return { revision: 0, dateSent: null };
        }
    }

    function findGroupCustomRecordId(groupNumber) {
        var cleanGroupNumber = String(groupNumber || '').replace(/^\s+|\s+$/g, '');
        if (!cleanGroupNumber) return null;

        try {
            var foundId = null;
            var customRecSearch = search.create({
                type: CUSTOM_REC_TYPE,
                filters: [[CREC_GROUP_NUMBER, 'is', cleanGroupNumber]],
                columns: [search.createColumn({ name: 'internalid' })]
            });

            customRecSearch.run().each(function (result) {
                foundId = result.getValue({ name: 'internalid' }) || result.id;
                return false; // stop after first match
            });

            log.debug('Grouped PO Tracking Lookup', 'Group ' + cleanGroupNumber + ' -> ' + (foundId ? ('found record ' + foundId) : 'no existing record found'));
            return foundId;
        } catch (e) {
            log.error('Grouped PO Tracking Lookup Failed', { groupNumber: cleanGroupNumber, error: e });
            return null;
        }
    }

    function updatePOAndCustomRecord(poIds, groupNumber, opts) {
        var groupMemoMap = opts.groupMemoMap || {};
        var masterMemo = opts.masterMemo || '';
        var emailSubject = opts.emailSubject || '';
        var emailBody = opts.emailBody || '';
        var isResend = opts.actionMode === 'resend';
        var vendorId = opts.vendorId;
        var vendorName = opts.vendorName || '';
        var mergedPdf = opts.mergedPdf;
        var firstPoDetails = opts.firstPoDetails;
        var poNumbersList = opts.poNumbersList || '';

        // 1. Transactional Loop
        for (var i = 0; i < poIds.length; i++) {
            try {
                var poId = poIds[i];
                var key = String(poId);
                var valuesObj = {};

                valuesObj[FIELD_EMAIL_SENT] = true;
                valuesObj[FIELD_GROUP_NUMBER] = groupNumber;

                // FIX #4: always stamp the sent date on the initial send (no
                // more fragile field-existence pre-check gating this).
                if (!isResend) {
                    valuesObj[FIELD_EMAIL_SENT_DATE] = new Date();
                }

                if (groupMemoMap.hasOwnProperty(key)) {
                    // Explicit per-PO memo value captured from the UI for this
                    // exact PO's own Group Memo box - the ONLY source for
                    // FIELD_VENDOR_MEMO now. Master Memo is no longer mapped
                    // into Group Memo at all - it is only kept as a note on
                    // the tracking custom record (CREC_MASTER_MEMO) below.
                    valuesObj[FIELD_VENDOR_MEMO] = groupMemoMap[key] || '';
                }
                // If this PO isn't in groupMemoMap, FIELD_VENDOR_MEMO is left
                // out of valuesObj entirely, preserving whatever memo already
                // exists on that PO. Master Memo is never used as a fallback.

                record.submitFields({
                    type: record.Type.PURCHASE_ORDER,
                    id: poId,
                    values: valuesObj,
                    options: { enableSourcing: false, ignoreMandatoryFields: true }
                });
            } catch (e) {
                log.error('PO Stamping Loop Failed', { poId: poIds[i], error: e });
            }
        }

        // 2. Custom Record Tracking Block
        try {
            // FIX #2 & #3: on resend, look up the existing tracking record by
            // the (locked-in, trimmed) group number and UPDATE it. Only fall
            // back to creating a new one if genuinely not found - and log
            // that clearly so it's diagnosable.
            var customRecId = isResend ? findGroupCustomRecordId(groupNumber) : null;
            var customRecordObj = null;

            if (customRecId) {
                log.debug('Grouped PO Tracking', 'Resend: found existing tracking record ' + customRecId + ' for group ' + groupNumber + ' - updating it.');
                customRecordObj = record.load({ type: CUSTOM_REC_TYPE, id: customRecId, isDynamic: true });
            } else {
                if (isResend) {
                    log.audit('Grouped PO Tracking', 'Resend: no existing tracking record found for group ' + groupNumber + ' - creating a new one as fallback.');
                }
                customRecordObj = record.create({ type: CUSTOM_REC_TYPE, isDynamic: true });
                customRecordObj.setValue({ fieldId: CREC_GROUP_NUMBER, value: groupNumber });
                customRecordObj.setValue({ fieldId: CREC_DATE_SENT, value: new Date() });
            }

            // OPTIMIZED STAMPING VALUE: Safe cast validation fallback wrapper string values
            // custrecord_po_number was changed to a List/Record type field,
            // which requires internal IDs, not a text string of PO numbers.
            // Assumes this is set up as a MULTI-SELECT field pointing to the
            // Purchase Order/Transaction record - poIds is the array of
            // internal IDs for every PO in this group.
            customRecordObj.setValue({ fieldId: CREC_PO_NUMBER, value: poIds });
            customRecordObj.setValue({ fieldId: CREC_MASTER_MEMO, value: masterMemo });
            customRecordObj.setValue({ fieldId: CREC_EMAIL_SUBJECT, value: emailSubject });
            // Store the plain-text version (real line breaks) here rather
            // than the raw HTML used for the actual email - otherwise this
            // field shows literal "<br/>" tags instead of separated lines.
            // The PDF summary already does this same conversion via
            // stripHtmlToPlainText for the same reason.
            customRecordObj.setValue({ fieldId: CREC_EMAIL_BODY, value: stripHtmlToPlainText(emailBody) });
            customRecordObj.setValue({ fieldId: CREC_LAST_SENT_DATE, value: new Date() });

            if (runtime.getCurrentUser().id > 0) {
                customRecordObj.setValue({ fieldId: CREC_SENDER, value: runtime.getCurrentUser().id });
            }
            if (vendorId) {
                customRecordObj.setValue({ fieldId: CREC_RECIPIENT, value: vendorId });
                // custrecord_vendor is a List/Record field pointing to the
                // Vendor record (confirmed by INVALID_FLD_VALUE when a name
                // string was passed) - it needs the internal ID, not the
                // display name.
                customRecordObj.setValue({ fieldId: CREC_VENDOR, value: vendorId });
            }

            customRecordObj.setValue({ fieldId: CREC_EMAIL_STATUS, value: (isResend ? STATUS_RESEND_ID : STATUS_SENT_ID) });

            var currentRev = customRecordObj.getValue({ fieldId: CREC_REVISION_NUMBER });
            if (currentRev === '' || currentRev === null || undefined === currentRev) {
                customRecordObj.setValue({ fieldId: CREC_REVISION_NUMBER, value: 0 });
            } else {
                customRecordObj.setValue({ fieldId: CREC_REVISION_NUMBER, value: parseInt(currentRev, 10) + 1 });
            }

            if (mergedPdf) {
                mergedPdf.folder = TEMP_FOLDER_ID; 
                mergedPdf.isOnline = true;
                var attachedFileId = mergedPdf.save();
                customRecordObj.setValue({ fieldId: CREC_GENERATED_PDF, value: attachedFileId });
            }

            customRecordObj.save({ enableSourcing: false, ignoreMandatoryFields: true });
        } catch (err) {
            log.error('Grouped PO Custom Tracking Error', { groupNumber: groupNumber, error: err });
        }
    }

    function getFullFileUrl(fileUrl) {
        if (!fileUrl) return '';
        fileUrl = String(fileUrl);
        if (fileUrl.indexOf('https://') === 0 || fileUrl.indexOf('http://') === 0) return fileUrl;
        if (fileUrl.indexOf('//') === 0) return 'https:' + fileUrl;

        var domain = url.resolveDomain({ hostType: url.HostType.APPLICATION });
        if (fileUrl.charAt(0) !== '/') fileUrl = '/' + fileUrl;
        return 'https://' + domain + fileUrl;
    }

    function escapeXmlAttribute(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;');
    }

    function generateGroupNumber(vendorId) {
        var d = new Date();
        return vendorId + '_' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
    }

    function pad2(value) {
        value = String(value);
        return value.length < 2 ? '0' + value : value;
    }

    function convertHtmlDateToNsDate(value) {
        if (!value) return '';
        value = String(value);
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            var parts = value.split('-');
            return parts[1] + '/' + parts[2] + '/' + parts[0];
        }
        return value;
    }

    function parseSelectedIds(selectedIdsText) {
        var ids = [];
        if (!selectedIdsText) return ids;
        var parts = selectedIdsText.split(',');
        for (var i = 0; i < parts.length; i++) {
            var id = parts[i];
            if (id) id = id.replace(/^\s+|\s+$/g, '');
            if (id) ids.push(id);
        }
        return ids;
    }

    function runPagedSearchLimited(searchObj, maxRows, callback) {
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

    function runPagedSearch(searchObj, callback) {
        var pagedData = searchObj.runPaged({ pageSize: 1000 });
        for (var i = 0; i < pagedData.pageRanges.length; i++) {
            var page = pagedData.fetch({ index: pagedData.pageRanges[i].index });
            for (var j = 0; j < page.data.length; j++) { callback(page.data[j]); }
        }
    }

    function cleanFileName(name) {
        return name ? name.replace(/[\\\/:*?"<>|]/g, '_') : 'Merged_PO.pdf';
    }

    function convertTextToHtml(value) {
        return value ? escapeHtml(value).replace(/\n/g, '<br/>') : '';
    }

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    return { onRequest: onRequest };
});