/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * PO Email Sender
 * ----------------
 * Lets a user filter Purchase Orders, email a merged PDF (cover page + PO
 * pages) to a vendor, and resend an already-sent group without duplicating
 * or losing its original Group Number / tracking record.
 *
 * File is organized top to bottom in the order things actually happen:
 *   1. Config / constants
 *   2. Entry point + request routing
 *   3. Page rendering (building the HTML the user sees)
 *   4. Loading Purchase Order data for the table/filters
 *   5. Send / Resend flow (the main action)
 *   6. PDF building (cover page + merge)
 *   7. Tracking custom record (customrecord_grouped_pos)
 *   8. Small shared utilities (kept at the bottom, used everywhere above)
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

    // ============================================================
    // 1. CONFIG / CONSTANTS
    // ============================================================

    var TEMP_FOLDER_ID = 8768;
    var PARAM_HTML_FILE_ID = 'custscript_po_email_html_file';

    // Purchase Order body fields
    var FIELD_EMAIL_SENT = 'custbody_email_sent';
    var FIELD_EMAIL_SENT_DATE = 'custbody_email_sent_date';
    var FIELD_GROUP_NUMBER = 'custbody_group_number';
    var FIELD_VENDOR_MEMO = 'custbody_vendor_memo';

    // Tracking custom record: customrecord_grouped_pos
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

    // Custom List option IDs for custrecord_email_status
    var STATUS_SENT_ID = 1;
    var STATUS_RESEND_ID = 2;

    // Page/UI field IDs (posted from the HTML template)
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


    // ============================================================
    // 2. ENTRY POINT + REQUEST ROUTING
    // ============================================================

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

            // AJAX requests (filtering, send, resend) return JSON and stop here.
            if (isAjax) {
                handleAjaxRequest(context, params, filters, emailBodyMemo);
                return;
            }

            // Non-AJAX POST: only happens if the page is submitted the classic
            // way (fallback). Same send/resend logic as the AJAX path.
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

    // Every AJAX call is one of: "filter" (reload the table) or "send"/"resend"
    // (process the selected POs). Both return JSON, never an HTML page.
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


    // ============================================================
    // 3. PAGE RENDERING
    // ============================================================
    // showPage() builds the NetSuite form, loads the HTML template file from
    // the File Cabinet, and swaps {{TOKEN}} placeholders for real JSON data
    // before writing it out as one inline HTML field.

    function showPage(context, filters, resultMessage, emailBodyMemo, emailSubject) {
        var form = serverWidget.createForm({ title: ' ' });

        var actionFld = form.addField({ id: FLD_ACTION, type: serverWidget.FieldType.TEXT, label: 'Action' });
        actionFld.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });

        var selectedFld = form.addField({ id: FLD_SELECTED_IDS, type: serverWidget.FieldType.LONGTEXT, label: 'Selected PO IDs' });
        selectedFld.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });

        // Only run the (potentially expensive) PO search if a filter is
        // actually set and we're not already showing a send/resend result.
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

    // Loads the HTML template and replaces each {{TOKEN}} with real data as
    // safe, escaped JSON (so the client script can just read it as a JS
    // variable - see FIELD_IDS/PO_DATA/etc. at the top of the template).
    function buildPageHtmlFromTemplate(dataObj) {
        var htmlFileId = runtime.getCurrentScript().getParameter({ name: PARAM_HTML_FILE_ID });
        if (!htmlFileId) {
            throw new Error('Missing Parameter setup configuration map file ID matching target UI elements.');
        }
        var html = file.load({ id: htmlFileId }).getContents();

        var fieldIds = {
            action: FLD_ACTION, selectedIds: FLD_SELECTED_IDS, po: FLD_PO, poText: FLD_PO_TEXT,
            vendor: FLD_VENDOR, vendorText: FLD_VENDOR_TEXT, dateFrom: FLD_DATE_FROM, dateTo: FLD_DATE_TO,
            emailStatus: FLD_EMAIL_STATUS, groupNumber: FLD_GROUP_NUMBER,
            emailBodyMemo: FLD_EMAIL_BODY_MEMO, emailSubject: FLD_EMAIL_SUBJECT, masterMemo: FLD_MASTER_MEMO, groupMemoMap: FLD_GROUP_MEMO_MAP,
            ajax: FLD_AJAX, ajaxAction: FLD_AJAX_ACTION
        };

        var tokens = {
            SUITELET_URL_JSON: dataObj.suiteletUrl || '',
            FIELD_IDS_JSON: fieldIds,
            FILTERS_JSON: dataObj.filters || {},
            PO_DATA_JSON: dataObj.poData || [],
            PO_OPTIONS_JSON: dataObj.poOptions || [],
            VENDOR_OPTIONS_JSON: dataObj.vendorOptions || [],
            RESULT_MESSAGE_JSON: dataObj.resultMessage || null,
            EMAIL_BODY_MEMO_JSON: dataObj.emailBodyMemo || '',
            EMAIL_SUBJECT_JSON: dataObj.emailSubject || ''
        };

        for (var token in tokens) {
            if (tokens.hasOwnProperty(token)) {
                var jsonValue = JSON.stringify(tokens[token]).replace(/</g, '\\u003C');
                html = html.split('{{' + token + '}}').join(jsonValue);
            }
        }

        return html;
    }


    // ============================================================
    // 4. LOADING PURCHASE ORDER DATA (for the table, filters, dropdowns)
    // ============================================================

    // custbody_email_sent_date can only be used as a search column once its
    // "Search" checkbox is enabled on the field definition. This checks that
    // once per request and only affects whether we READ it back via search -
    // writing it (record.submitFields) always happens regardless.
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
            log.audit('custbody_email_sent_date not searchable',
                'Enable the "Search" checkbox on this field to show it in search results. Error: ' + e.name + ': ' + e.message);
            _emailSentDateSearchable = false;
        }
        return _emailSentDateSearchable;
    }

    // Adds the Email Sent Date search column only when it's safe to do so.
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

    // "Email Sent Date" on the portal is sourced from the tracking record's
    // custrecord_date_sent (set once, on first send only) instead of the
    // PO's own field, since that field may not be searchable in this
    // account. All group numbers on screen are looked up in one search.
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
            var orFilter = [];
            for (var f = 0; f < uniqueGroups.length; f++) {
                if (f > 0) orFilter.push('OR');
                orFilter.push([CREC_GROUP_NUMBER, 'is', uniqueGroups[f]]);
            }

            var crecSearch = search.create({
                type: CUSTOM_REC_TYPE,
                filters: orFilter,
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

    // Main table data - every PO matching the current filters, with vendor
    // info, PO link, and the real Email Sent Date attached.
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

    // Dropdown options for the PO combo box (id + tranid text only).
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

    // Dropdown options for the Vendor combo box (all active vendors).
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

    // Turns the UI filter object into NetSuite search filter syntax.
    // ignorePoFilter=true is used for the PO dropdown, which should show
    // every PO regardless of which one is currently typed/selected.
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

    // Turns one search result row into the flat PO object the UI table uses.
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

    // Looks up (and caches per-request) a vendor's display name + email.
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


    // ============================================================
    // 5. SEND / RESEND FLOW
    // ============================================================
    // This is the main action. Steps, in order:
    //   1) Parse + load the selected POs
    //   2) If resend: lock in the original group number and reload the full
    //      group by that number (never regenerate/re-derive it)
    //   3) Validate: one vendor only, vendor has an email, skip already-sent
    //      POs on a fresh "send"
    //   4) Save/update the tracking record BEFORE building any PDF
    //   5) Build the cover page + merge with each PO's PDF
    //   6) Send the email
    //   7) Stamp the POs and attach the final PDF to the tracking record

    function processSelectedPOs(selectedIdsText, actionMode, emailBodyMemo, masterMemo, groupMemoMap, emailSubject) {
        groupMemoMap = groupMemoMap || {};
        masterMemo = masterMemo || '';
        emailSubject = emailSubject || '';

        var response = { sent: [], skipped: [], errors: [], updatedIds: [], groupNumber: '', actionMode: actionMode || '' };

        // --- Step 1: parse + load selected POs ---
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

        // --- Step 2: on resend, lock in the ORIGINAL group number once and
        // reload the full group by it. This value is never regenerated or
        // re-derived later - it is the single source of truth. ---
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

        // --- Step 3: validate vendor + skip POs that don't belong in this send ---
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
            if (actionMode === 'send' && (po.emailSent || po.groupNumber)) {
                response.skipped.push(po.tranId + ' skipped because it already belongs to Group Number ' + po.groupNumber + '. Select it to resend that group instead.');
                continue;
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
            var isResend = (actionMode === 'resend');
            var groupNumber = isResend ? resendGroupNumber : generateGroupNumber(group.vendorId);
            var emailBody = buildMemoEmailBody(group.poList, emailBodyMemo);
            var subjectToUse = emailSubject ? emailSubject : (EMAIL_SUBJECT_PREFIX + ' - ' + group.poNumbers.join(', '));

            // --- Step 4: save the tracking record BEFORE any PDF rendering.
            // Required because (a) renderNativeRecordPdf() needs a real saved
            // internal ID, and (b) the Advanced PDF/HTML Template reads field
            // values from the SAVED record, not from the in-memory data here. ---
            var trackingRecordResult = upsertTrackingRecord(groupNumber, isResend, {
                poIds: group.poIds,
                masterMemo: masterMemo,
                emailSubject: subjectToUse,
                emailBody: emailBody,
                vendorId: group.vendorId
            });
            var trackingRecordId = trackingRecordResult.id;

            // Mirrors every tracked field except custrecord_generated_pdf.
            // Used only as a fallback cover page if the native template
            // render fails - the native template reads straight off the
            // saved record instead of this object.
            var currentUser = runtime.getCurrentUser();
            var nowDisplay = formatDateForSummary(new Date());
            var summaryInfo = {
                groupNumber: groupNumber,
                poNumbers: group.poNumbers,
                masterMemo: masterMemo,
                emailSubject: subjectToUse,
                emailBody: emailBody,
                dateSentDisplay: trackingRecordResult.dateSent ? formatDateForSummary(trackingRecordResult.dateSent) : nowDisplay,
                lastSentDateDisplay: nowDisplay,
                sentByName: (currentUser && currentUser.name) ? currentUser.name : 'System',
                recipientDisplay: group.vendorName + (group.vendorEmail ? (' <' + group.vendorEmail + '>') : ''),
                vendorName: group.vendorName,
                emailStatusDisplay: isResend ? 'Resend' : 'Sent',
                revisionNumber: trackingRecordResult.revision
            };

            // --- Step 5: build the merged PDF (native/summary cover page + PO pages) ---
            var nativeRecordPdf = renderNativeRecordPdf(summaryInfo, trackingRecordId, group.poIds);
            var mergedPdf = createMergedPoPdf(group.poIds, group.vendorName, summaryInfo, nativeRecordPdf);

            // --- Step 6: send the email ---
            email.send({
                author: runtime.getCurrentUser().id,
                recipients: Number(group.vendorId),
                subject: subjectToUse,
                body: emailBody,
                attachments: [mergedPdf],
                relatedRecords: { entityId: Number(group.vendorId) }
            });

            // --- Step 7: stamp the POs + attach the final PDF to the tracking record ---
            stampPurchaseOrders(group.poIds, groupNumber, groupMemoMap, isResend);
            attachGeneratedPdfToTrackingRecord(trackingRecordId, mergedPdf);

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

    // Email body priority: typed body > saved Group Memo > native PO memo
    // (single PO only) > generic fallback text.
    function buildMemoEmailBody(poList, emailBodyMemo) {
        if (emailBodyMemo) return convertTextToHtml(emailBodyMemo);
        if (poList.length > 0 && poList[0].vendorMemo) return convertTextToHtml(poList[0].vendorMemo);

        if (poList.length === 1) {
            var body = poList[0].memo || '';
            return convertTextToHtml(body ? body : 'Please find attached the Purchase Order PDF.');
        }
        return '<div style="font-family:Arial, sans-serif; font-size:13px;"><p>Please find attached the Purchase Order PDF.</p></div>';
    }

    function generateGroupNumber(vendorId) {
        var d = new Date();
        var pad = function (value) { value = String(value); return value.length < 2 ? '0' + value : value; };
        return vendorId + '_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    }


    // ============================================================
    // 6. PDF BUILDING (cover page + merge)
    // ============================================================

    function formatDateForSummary(d) {
        try {
            return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
        } catch (e) {
            return String(d);
        }
    }

    // One row of the built-in fallback summary table. If multiline=true,
    // the value is split into real <br/> line breaks (for the Email Body).
    function summaryFieldRow(label, value, multiline) {
        if (!value) return '';

        var displayValue;
        if (multiline) {
            var plainText = stripHtmlToPlainText(value);
            if (!plainText) return '';
            var lines = plainText.split('\n');
            var escapedLines = [];
            for (var i = 0; i < lines.length; i++) {
                escapedLines.push(escapeHtml(lines[i]));
            }
            displayValue = escapedLines.join('<br/>');
        } else {
            displayValue = escapeHtml(value);
        }

        return '<tr>' +
            '<td style="width:150pt;font-weight:bold;padding:5pt 8pt;border-bottom:1pt solid #dddddd;vertical-align:top;">' + escapeHtml(label) + '</td>' +
            '<td style="padding:5pt 8pt;border-bottom:1pt solid #dddddd;vertical-align:top;">' + displayValue + '</td>' +
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

    // Built-in one-page cover PDF mirroring every tracked field. Used only
    // as a fallback if the native record PDF template isn't configured or
    // fails to render.
    function buildSummaryPageXml(summary) {
        var rows = '';
        rows += summaryFieldRow('Group Number', summary.groupNumber);
        rows += summaryFieldRow('Purchase Order(s)', (summary.poNumbers || []).join(', '));
        rows += summaryFieldRow('Vendor', summary.vendorName);
        rows += summaryFieldRow('Recipient', summary.recipientDisplay);
        rows += summaryFieldRow('Sender', summary.sentByName);
        rows += summaryFieldRow('Email Subject', summary.emailSubject);
        rows += summaryFieldRow('Email Body', summary.emailBody, true);
        rows += summaryFieldRow('Master Memo', summary.masterMemo);
        rows += summaryFieldRow('Email Status', summary.emailStatusDisplay);
        rows += summaryFieldRow('Date Sent', summary.dateSentDisplay);
        rows += summaryFieldRow('Last Sent Date', summary.lastSentDateDisplay);
        rows += summaryFieldRow('Revision Number', String(summary.revisionNumber));

        return '<?xml version="1.0"?>' +
            '<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">' +
            '<pdf>' +
            '<body padding="0.6in 0.7in" font-family="Helvetica">' +
            '<table style="width:100%;"><tr><td style="font-size:20pt;font-weight:bold;padding-bottom:16pt;">Purchase Order Email Summary</td></tr></table>' +
            '<table style="width:100%;border-collapse:collapse;font-size:10pt;">' + rows + '</table>' +
            '</body>' +
            '</pdf>';
    }

    // Fetches Amount / Memo / Status for each related PO, so the Advanced
    // PDF/HTML Template can show a real Related Purchase Orders table
    // instead of just the flattened List/Record display text that
    // custrecord_po_number gives on its own.
    function getRelatedPODetails(poInternalIds) {
        var details = [];
        if (!poInternalIds || poInternalIds.length === 0) return details;

        try {
            var poSearch = search.create({
                type: search.Type.PURCHASE_ORDER,
                filters: [['internalid', 'anyof', poInternalIds]],
                columns: ['tranid', 'amount', 'memo', 'status']
            });

            poSearch.run().each(function (result) {
                details.push({
                    id: result.id,
                    tranid: result.getValue('tranid'),
                    amount: result.getValue('amount'),
                    memo: result.getValue('memo'),
                    status: result.getText('status')
                });
                return true;
            });
        } catch (e) {
            log.error('Get Related PO Details Failed', { poInternalIds: poInternalIds, error: e });
        }

        return details;
    }

    // Renders the Advanced PDF/HTML Template against the ACTUAL saved
    // customrecord_grouped_pos record (trackingRecordId). The record must
    // already be saved with final values (done earlier in upsertTrackingRecord)
    // since the template reads ${record.custrecord_xxx} from the database.
    //
    // poIds (the group's PO internal IDs) is used ONLY to fetch each PO's
    // amount/memo/status via getRelatedPODetails() above and attach it as a
    // second data source (alias "poDetails") - custrecord_po_number itself
    // never carries that data, so the template can't get it any other way.
    //
    // Returns null (falling back to the built-in summary page) if the
    // template ID is blank, trackingRecordId is missing, or rendering fails.
    // Advanced PDF/HTML Template Script ID, hardcoded per request (the
    // script parameter route wasn't reliably reaching this deployment).
    // If you ever need to change templates, just update this string.
    function renderNativeRecordPdf(summaryInfo, trackingRecordId, poIds) {
        if (!summaryInfo || !trackingRecordId) return null;

        var templateId = 'CUSTTMPL_CUSTOM_GROUPED_POS_PDFHTML_TEMPLATE';
        if (!templateId) {
            log.audit('Native Record PDF', 'Template ID is blank - falling back to built-in summary page.');
            return null;
        }

        try {
            var trackingRec = record.load({ type: CUSTOM_REC_TYPE, id: trackingRecordId, isDynamic: false });
            var poDetails = getRelatedPODetails(poIds);

            var renderer = render.create();
            renderer.setTemplateByScriptId(templateId);
            renderer.addRecord({
                templateName: 'record', // must match the alias used in the template's FTL, e.g. ${record.custrecord_xxx}
                record: trackingRec
            });
            // addCustomDataSource only supports format: JSON, and the data
            // string must parse to a JSON OBJECT (starts with "{"), not a
            // bare array (starts with "["). So the array of PO detail rows
            // is wrapped under a "list" key here - in the template, read it
            // as poDetails.list (a sequence), not poDetails directly.
            renderer.addCustomDataSource({
                alias: 'poDetails',
                format: render.DataSource.JSON,
                data: JSON.stringify({ list: poDetails })
            });

            return renderer.renderAsPdf();
        } catch (e) {
            log.error('Native Record PDF Render Failed - falling back to built-in summary page', e);
            return null;
        }
    }

    function createSummaryPagePdf(summary) {
        try {
            return render.xmlToPdf({ xmlString: buildSummaryPageXml(summary) });
        } catch (e) {
            log.error('Summary Page Generation Failed', e);
            return null;
        }
    }

    // Cover page (native template, or built-in summary as fallback) + one
    // PDF per PO, merged into a single file.
    function createMergedPoPdf(poIds, vendorName, summaryInfo, nativeRecordPdf) {
        var pdfSetXml = '<?xml version="1.0"?><!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd"><pdfset>';

        var coverPdf = nativeRecordPdf || (summaryInfo ? createSummaryPagePdf(summaryInfo) : null);
        if (coverPdf) {
            pdfSetXml += '<pdf src="data:application/pdf;base64,' + coverPdf.getContents() + '"/>';
        }

        for (var i = 0; i < poIds.length; i++) {
            var poPdf = render.transaction({ entityId: Number(poIds[i]), printMode: render.PrintMode.PDF });
            pdfSetXml += '<pdf src="data:application/pdf;base64,' + poPdf.getContents() + '"/>';
        }
        pdfSetXml += '</pdfset>';

        var mergedPdf = render.xmlToPdf({ xmlString: pdfSetXml });
        mergedPdf.name = cleanFileName('Merged_PO_' + vendorName + '_' + new Date().getTime() + '.pdf');
        return mergedPdf;
    }


    // ============================================================
    // 7. TRACKING CUSTOM RECORD (customrecord_grouped_pos)
    // ============================================================

    // Finds the tracking record by Group Number. Uses search.each() (more
    // reliable than getRange) and trims whitespace to avoid missed matches.
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

    // Finds-or-creates the tracking record and writes every field EXCEPT
    // custrecord_generated_pdf (that file doesn't exist yet - it's built
    // AFTER this, using this record's own rendered PDF as its cover page).
    // Saves the record and returns { id, revision, dateSent, wasExisting }.
    function upsertTrackingRecord(groupNumber, isResend, fieldValues) {
        var existingId = findGroupCustomRecordId(groupNumber);
        var rec;
        var originalDateSent = null;

        if (existingId) {
            log.debug('Grouped PO Tracking', (isResend ? 'Resend' : 'Send') + ': found existing tracking record ' + existingId + ' for group ' + groupNumber + ' - updating it.');
            rec = record.load({ type: CUSTOM_REC_TYPE, id: existingId, isDynamic: true });
            originalDateSent = rec.getValue({ fieldId: CREC_DATE_SENT }) || null;
        } else {
            if (isResend) {
                log.audit('Grouped PO Tracking', 'Resend: no existing tracking record found for group ' + groupNumber + ' - creating a new one as fallback.');
            }
            rec = record.create({ type: CUSTOM_REC_TYPE, isDynamic: true });
            rec.setValue({ fieldId: CREC_GROUP_NUMBER, value: groupNumber });
            rec.setValue({ fieldId: CREC_DATE_SENT, value: new Date() });
        }

        // custrecord_po_number is a multi-select List/Record field pointing
        // to the PO transaction record - fieldValues.poIds is every PO's
        // internal ID in this group.
        rec.setValue({ fieldId: CREC_PO_NUMBER, value: fieldValues.poIds });
        rec.setValue({ fieldId: CREC_MASTER_MEMO, value: fieldValues.masterMemo });
        rec.setValue({ fieldId: CREC_EMAIL_SUBJECT, value: fieldValues.emailSubject });
        rec.setValue({ fieldId: CREC_EMAIL_BODY, value: fieldValues.emailBody }); // Rich Text field, renders the HTML directly
        rec.setValue({ fieldId: CREC_LAST_SENT_DATE, value: new Date() });

        if (runtime.getCurrentUser().id > 0) {
            rec.setValue({ fieldId: CREC_SENDER, value: runtime.getCurrentUser().id });
        }
        if (fieldValues.vendorId) {
            rec.setValue({ fieldId: CREC_RECIPIENT, value: fieldValues.vendorId });
            rec.setValue({ fieldId: CREC_VENDOR, value: fieldValues.vendorId }); // List/Record field - needs internal ID, not name
        }

        rec.setValue({ fieldId: CREC_EMAIL_STATUS, value: (isResend ? STATUS_RESEND_ID : STATUS_SENT_ID) });

        var currentRev = rec.getValue({ fieldId: CREC_REVISION_NUMBER });
        var newRev = (currentRev === '' || currentRev === null || currentRev === undefined) ? 0 : (parseInt(currentRev, 10) + 1);
        rec.setValue({ fieldId: CREC_REVISION_NUMBER, value: newRev });

        var savedId = rec.save({ enableSourcing: false, ignoreMandatoryFields: true });

        return { id: savedId, revision: newRev, dateSent: originalDateSent, wasExisting: !!existingId };
    }

    // Attaches the already-built merged PDF to the tracking record AFTER
    // the email is sent, via submitFields - no second full record.load()
    // needed since every other field was already saved above.
    function attachGeneratedPdfToTrackingRecord(trackingRecordId, mergedPdf) {
        if (!trackingRecordId || !mergedPdf) return;
        try {
            mergedPdf.folder = TEMP_FOLDER_ID;
            mergedPdf.isOnline = true;
            var attachedFileId = mergedPdf.save();

            var values = {};
            values[CREC_GENERATED_PDF] = attachedFileId;

            record.submitFields({
                type: CUSTOM_REC_TYPE,
                id: trackingRecordId,
                values: values,
                options: { enableSourcing: false, ignoreMandatoryFields: true }
            });
        } catch (e) {
            log.error('Attach Generated PDF Failed', { trackingRecordId: trackingRecordId, error: e });
        }
    }

    // PO-side stamping loop. The tracking record itself is handled entirely
    // by upsertTrackingRecord() / attachGeneratedPdfToTrackingRecord() above.
    function stampPurchaseOrders(poIds, groupNumber, groupMemoMap, isResend) {
        groupMemoMap = groupMemoMap || {};

        for (var i = 0; i < poIds.length; i++) {
            try {
                var poId = poIds[i];
                var key = String(poId);
                var valuesObj = {};

                valuesObj[FIELD_EMAIL_SENT] = true;
                valuesObj[FIELD_GROUP_NUMBER] = groupNumber;

                // Sent date is stamped only on the initial send - resend
                // never overwrites it.
                if (!isResend) {
                    valuesObj[FIELD_EMAIL_SENT_DATE] = new Date();
                }

                if (groupMemoMap.hasOwnProperty(key)) {
                    // Explicit per-PO memo from that PO's own Group Memo box
                    // in the UI - the only source for FIELD_VENDOR_MEMO.
                    valuesObj[FIELD_VENDOR_MEMO] = groupMemoMap[key] || '';
                }
                // If this PO isn't in groupMemoMap, FIELD_VENDOR_MEMO is left
                // out entirely so its existing memo is preserved.

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
    }


    // ============================================================
    // 8. SMALL SHARED UTILITIES
    // ============================================================

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

    // Runs a search page by page, capping the total rows returned.
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

    // Same as above, but returns every row (no cap).
    function runPagedSearch(searchObj, callback) {
        runPagedSearchLimited(searchObj, 0, callback);
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