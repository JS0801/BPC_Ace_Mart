/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/search', 'N/record', 'N/log', 'N/ui/serverWidget', 'N/url', 'N/file'], function (search, record, log, ui, url, file) {

    var CUSTOM_REC_TYPE = 'customrecord_grouped_pos';
    var FIELD_PO_NUMBER = 'custrecord_po_number';
    var FIELD_PO_DETAILS = 'custrecord_bpc_po_details';
    var FIELD_INACTIVE = 'isinactive';
    var FIELD_GROUP_NUMBER = 'name';

    var PO_FIELD_GROUP_NUMBER = 'custbody_group_number';
    var PO_FIELD_VENDOR_MEMO = 'custbody_vendor_memo';

    function afterSubmit(context) {
        if (context.newRecord.type !== CUSTOM_REC_TYPE) return;
        if (context.type === context.UserEventType.DELETE) {
            return;
        }
        try {
          clearInactiveOrRemovedPoLinks(context);
        } catch (cleanupErr) {
          log.error('Grouped PO Link Cleanup Failed', cleanupErr);
        }

        try {
            var rec = context.newRecord;
            var fullRec = record.load({ type: CUSTOM_REC_TYPE, id: rec.id });
            var poIds = getPoIds(fullRec.getValue({ fieldId: FIELD_PO_NUMBER }));
            var detailsJson = JSON.stringify(buildPoDetails(poIds));
            var currentJson = fullRec.getValue({ fieldId: FIELD_PO_DETAILS }) || '';

            if (String(currentJson) === detailsJson) {
                return;
            }

            var values = {};
            values[FIELD_PO_DETAILS] = detailsJson;

            record.submitFields({
                type: CUSTOM_REC_TYPE,
                id: rec.id,
                values: values,
                options: { enableSourcing: false, ignoreMandatoryFields: true }
            });
        } catch (e) {
            log.error('Grouped PO Details JSON Failed', e);
        }
    }

    function buildPoDetails(poIds) {
        var details = {
            poCount: 0,
            totalAmount: 0,
            purchaseOrders: []
        };

        if (!poIds.length) {
            return details;
        }

        // Header memo must come from mainline; MAX(memo) across item rows can
        // select an item description instead of the transaction header memo.
        var headerMemos = {};
        search.create({type: 'purchaseorder', filters: [
            ['mainline','is','T'], 'AND', ['internalid','anyof',poIds]
        ], columns: ['internalid','memo','custbody_ace_po_instruction','createdfrom','custbody_am_created_frrom_so']}).run().each(function (row) {
            var memo = row.getValue('memo') || '';
            var instructions = row.getValue('custbody_ace_po_instruction') || '';
            var so = row.getText ? String(row.getText('custbody_am_created_frrom_so') || '').trim() : '';
            var sourceText = row.getText ? String(row.getText('createdfrom') || '') : '';
            if (!so && /^Sales Order\b/i.test(sourceText)) so = sourceText;
            headerMemos[String(row.id)] = {memo:memo, instructions:instructions, salesOrder:so};
            return true;
        });

        var poSearch = search.create({
            type: 'purchaseorder',
            settings: [{ name: 'consolidationtype', value: 'ACCTTYPE' }],
            filters: [
                ['type', 'anyof', 'PurchOrd'],
                'AND',
                ['internalid', 'anyof', poIds]
            ],
            columns: [
                search.createColumn({ name: 'internalid', summary: search.Summary.GROUP }),
                search.createColumn({ name: 'tranid', summary: search.Summary.MAX }),
                search.createColumn({ name: 'trandate', summary: search.Summary.MAX }),
                search.createColumn({ name: 'item', summary: search.Summary.COUNT }),
                search.createColumn({ name: 'custbody_vendor_memo', summary: search.Summary.MAX }),
                search.createColumn({ name: 'memo', summary: search.Summary.MAX }),
                search.createColumn({ name: 'total', summary: search.Summary.MAX })
            ]
        });

        poSearch.run().each(function (result) {
            var amount = toNumber(result.getValue({ name: 'total', summary: search.Summary.MAX }));

            var header = headerMemos[String(result.getValue({name:'internalid', summary:search.Summary.GROUP}))] || {};
            var memo = result.getValue({name:'custbody_vendor_memo',summary:search.Summary.MAX}) || header.memo || '';
            if (header.instructions && memo.indexOf(header.instructions) < 0) memo += (memo ? '\n' : '') + header.instructions;
            if (header.salesOrder && memo.indexOf(header.salesOrder) < 0) memo += (memo ? '\n' : '') + 'Mark for: ' + header.salesOrder;
            details.purchaseOrders.push({
                poInternalId: result.getValue({ name: 'internalid', summary: search.Summary.GROUP }) || '',
                poNumber: result.getValue({ name: 'tranid', summary: search.Summary.MAX }) || '',
                tranDate: result.getValue({ name: 'trandate', summary: search.Summary.MAX }) || '',
                lineCount: toNumber(result.getValue({ name: 'item', summary: search.Summary.COUNT })),
                vendorMemo: memo,
                salesOrder: header.salesOrder || '',
                amount: amount
            });

            details.totalAmount += amount;
            return true;
        });

        details.poCount = details.purchaseOrders.length;
        details.totalAmount = roundAmount(details.totalAmount);
        sortBySelectedPoOrder(details.purchaseOrders, poIds);

        return details;
    }

    function getPoIds(value) {
        var ids = [];

        if (Array.isArray(value)) {
            ids = value;
        } else if (value !== null && value !== undefined && value !== '') {
            ids = String(value).split(',');
        }

        var out = [];
        var seen = {};
        for (var i = 0; i < ids.length; i++) {
            var id = String(ids[i] || '').replace(/^\s+|\s+$/g, '');
            if (id && !seen[id]) {
                seen[id] = true;
                out.push(id);
            }
        }

        return out;
    }


  function clearInactiveOrRemovedPoLinks(context) {
    if (!context.oldRecord || !context.newRecord) {
        return;
    }

    // submitFields/XEDIT contains only changed fields. A PDF/status update must not unlink POs.
    var changedFields = context.newRecord.getFields();
    if (context.type === context.UserEventType.XEDIT && changedFields.indexOf(FIELD_PO_NUMBER) < 0 && changedFields.indexOf(FIELD_INACTIVE) < 0) return;
    var current = record.load({type:CUSTOM_REC_TYPE,id:context.newRecord.id});
    var oldPoIds = getPoIds(context.oldRecord.getValue({ fieldId: FIELD_PO_NUMBER }));
    var newPoIds = getPoIds(current.getValue({ fieldId: FIELD_PO_NUMBER }));
    var isInactive = isChecked(current.getValue({ fieldId: FIELD_INACTIVE }));
    var groupNumber = context.oldRecord.getValue({ fieldId: FIELD_GROUP_NUMBER }) ||
        current.getValue({ fieldId: FIELD_GROUP_NUMBER }) ||
        '';

    if (!groupNumber || !oldPoIds.length) {
        return;
    }

    if (isInactive) {
        clearPoFields(oldPoIds, groupNumber);
        return;
    }

    var removedPoIds = getRemovedPoIds(oldPoIds, newPoIds);
    if (removedPoIds.length) {
        clearPoFields(removedPoIds, groupNumber);
    }
}

function getRemovedPoIds(oldPoIds, newPoIds) {
    var newMap = {};
    var removed = [];

    for (var i = 0; i < newPoIds.length; i++) {
        newMap[String(newPoIds[i])] = true;
    }

    for (var j = 0; j < oldPoIds.length; j++) {
        var oldId = String(oldPoIds[j]);
        if (!newMap[oldId]) {
            removed.push(oldId);
        }
    }

    return removed;
}

function clearPoFields(poIds, expectedGroupNumber) {
    for (var i = 0; i < poIds.length; i++) {
        var poId = poIds[i];

        if (expectedGroupNumber && !poMatchesGroup(poId, expectedGroupNumber)) {
            continue;
        }

        record.submitFields({
            type: record.Type.PURCHASE_ORDER,
            id: poId,
            values: {
                custbody_group_number: '',
                custbody_vendor_memo: ''
            },
            options: {
                enableSourcing: false,
                ignoreMandatoryFields: true
            }
        });
    }
}

function poMatchesGroup(poId, expectedGroupNumber) {
    var lookup = search.lookupFields({
        type: search.Type.PURCHASE_ORDER,
        id: poId,
        columns: [PO_FIELD_GROUP_NUMBER]
    });

    return String(lookup[PO_FIELD_GROUP_NUMBER] || '') === String(expectedGroupNumber || '');
}

function isChecked(value) {
    return value === true || value === 'T';
}

    function sortBySelectedPoOrder(rows, poIds) {
        var order = {};
        for (var i = 0; i < poIds.length; i++) {
            order[String(poIds[i])] = i;
        }

        rows.sort(function (a, b) {
            var aIndex = order.hasOwnProperty(String(a.poInternalId)) ? order[String(a.poInternalId)] : 999999;
            var bIndex = order.hasOwnProperty(String(b.poInternalId)) ? order[String(b.poInternalId)] : 999999;
            return aIndex - bIndex;
        });
    }

    function toNumber(value) {
        var num = parseFloat(String(value || '0').replace(/,/g, ''));
        return isNaN(num) ? 0 : num;
    }

    function roundAmount(value) {
        return Math.round((Number(value) || 0) * 100) / 100;
    }

    function beforeLoad(context) {
        if (context.type !== context.UserEventType.VIEW) return;
        var rec = context.newRecord;
        var groupId = rec.type === CUSTOM_REC_TYPE ? rec.id : null;
        if (rec.type !== CUSTOM_REC_TYPE && rec.type !== 'purchaseorder') return;
        if (!groupId) {
            var groupNumber = rec.getValue({fieldId:'custbody_group_number'});
            if (!groupNumber) return;
            var found = search.create({type:CUSTOM_REC_TYPE, filters:[['name','is',groupNumber]], columns:['internalid']}).run().getRange({start:0,end:1});
            if (!found.length) return;
            groupId = found[0].id;
        }
        try {
            var group = record.load({type:CUSTOM_REC_TYPE,id:groupId});
            var ids = getPoIds(group.getValue({fieldId:FIELD_PO_NUMBER}));
            var groupUrl = url.resolveRecord({recordType:CUSTOM_REC_TYPE,recordId:groupId});
            var html = groupedPanelStyles() + '<section class="am-gpo-panel" aria-label="Grouped purchase order">';
            html += '<div class="am-gpo-heading">Grouped purchase order</div><div class="am-gpo-number">' + esc(group.getValue({fieldId:'name'})) + '</div>';
            html += '<div class="am-gpo-actions"><a href="' + esc(groupUrl) + '">Open group</a>';
            html += '<a href="' + esc(url.resolveScript({scriptId:'customscript_am_multiple_po_email_merge',deploymentId:'customdeploy_am_multiple_po_email_merge',params:{custpage_group_update:'T',custpage_group_id:String(groupId)}})) + '">Update shipping and tracking</a>';
            var pdfId = group.getValue({fieldId:'custrecord_generated_pdf'});
            if (pdfId) html += '<a target="_blank" rel="noopener noreferrer" href="' + esc(file.load({id:pdfId}).url) + '">View grouped PDF</a>';
            html += '</div><table class="am-gpo-details"><tbody><tr><th scope="row">Group memo</th><td class="am-gpo-memo">' + esc(group.getValue({fieldId:'custrecord_master_memo'}) || 'No memo entered') + '</td></tr>';
            if (ids.length) {
                // Match the sender order, which is sorted by PO number.
                var poRows = search.create({type:'purchaseorder',filters:[['mainline','is','T'],'AND',['internalid','anyof',ids]],columns:[search.createColumn({name:'tranid',sort:search.Sort.ASC})]}).run().getRange({start:0,end:1000});
                html += '<tr><th scope="row">Member POs</th><td><div class="am-gpo-members">';
                poRows.forEach(function (p,index) {
                    html += '<a href="' + esc(url.resolveRecord({recordType:'purchaseorder',recordId:p.id})) + '">' + esc(p.getValue('tranid')) + (index === 0 ? ' <span>(communication PO)</span>' : '') + '</a>';
                });
                html += '</div></td></tr>';
            }
            html += '</tbody></table><p class="am-gpo-help">Open the communication PO, then Communication &gt; Messages, to view the shared email and replies.</p>';
            html += renderSharedMessages(ids);
            html += '</section>';
            context.form.addField({id:'custpage_grouped_po_information',type:ui.FieldType.INLINEHTML,label:'Grouped PO'}).defaultValue = html;
        } catch (e) { log.error('Grouped PO display failed',e); }
    }
    function groupedPanelStyles() {
        return '<style>' +
            '.am-gpo-panel{box-sizing:border-box;width:100%;min-width:0;margin:8px 0 16px;border:1px solid #d8e0e8;border-radius:8px;background:#fff;color:#243746;font:13px/1.5 Arial,sans-serif;overflow:hidden;text-align:left}' +
            '.am-gpo-panel *{box-sizing:border-box}' +
            '.am-gpo-panel .am-gpo-heading{padding:16px 16px 2px;font-size:16px;font-weight:700;color:#20364b}' +
            '.am-gpo-panel .am-gpo-number{padding:0 16px 12px;font-size:12px;color:#53677a;overflow-wrap:anywhere}' +
            '.am-gpo-panel a{color:#145f96;text-decoration:none}.am-gpo-panel a:hover{text-decoration:underline}.am-gpo-panel a:focus-visible{outline:2px solid #145f96;outline-offset:2px}' +
            '.am-gpo-panel .am-gpo-actions{display:flex;flex-wrap:wrap;gap:8px;padding:0 16px 16px}' +
            '.am-gpo-panel .am-gpo-actions a{display:inline-block;padding:7px 11px;border:1px solid #c9d8e5;border-radius:5px;background:#f4f8fc;font-size:12px;font-weight:600}' +
            '.am-gpo-panel .am-gpo-details{width:100%;table-layout:fixed;border-collapse:collapse}' +
            '.am-gpo-panel .am-gpo-details th,.am-gpo-panel .am-gpo-details td{padding:11px 16px;border-top:1px solid #e4eaf0;text-align:left;vertical-align:top;font:13px/1.5 Arial,sans-serif;overflow-wrap:anywhere}' +
            '.am-gpo-panel .am-gpo-details th{width:125px;background:#f7f9fb;font-weight:600;color:#53677a}' +
            '.am-gpo-panel .am-gpo-memo{white-space:pre-wrap}.am-gpo-panel .am-gpo-members{display:flex;flex-wrap:wrap;gap:6px}' +
            '.am-gpo-panel .am-gpo-members a{padding:3px 8px;background:#edf4fa;border-radius:4px}.am-gpo-panel .am-gpo-members span{font-size:11px;color:#53677a}' +
            '.am-gpo-panel .am-gpo-help{margin:0;padding:12px 16px;color:#617284;font-size:12px}' +
            '.am-gpo-panel .am-gpo-title{margin:0;padding:12px 16px;border-top:1px solid #e4eaf0;font-size:14px;font-weight:700;background:#f7f9fb}' +
            '.am-gpo-panel .am-gpo-scroll{width:100%;overflow-x:auto}' +
            '.am-gpo-panel .am-gpo-messages{width:100%;min-width:650px;table-layout:fixed;border-collapse:collapse;font:12px/1.5 Arial,sans-serif}' +
            '.am-gpo-panel .am-gpo-messages th{background:#edf2f7;color:#43586b;font-weight:600;text-align:left}' +
            '.am-gpo-panel .am-gpo-messages th,.am-gpo-panel .am-gpo-messages td{padding:11px 12px;border-bottom:1px solid #dfe6ed;border-right:1px solid #e7edf2;vertical-align:top;overflow-wrap:anywhere;white-space:normal;text-align:left}' +
            '.am-gpo-panel .am-gpo-messages th:last-child,.am-gpo-panel .am-gpo-messages td:last-child{border-right:0}.am-gpo-panel .am-gpo-messages tbody tr:nth-child(even){background:#f8fafc}' +
            '.am-gpo-panel .am-gpo-direction{display:inline-block;padding:2px 7px;border-radius:4px;background:#eaf2fa;color:#245b85;font-size:11px;font-weight:600}.am-gpo-panel .am-gpo-incoming{background:#e9f5ef;color:#286345}' +
            '</style>';
    }
    function renderSharedMessages(ids) {
        if (!ids.length) return '';
        try {
            var cols = ['internalid','subject','messagedate','authoremail','recipientemail','isincoming'].map(function(name) {
                var c = {name:name,join:'messages'};
                if (name === 'messagedate') c.sort = search.Sort.DESC;
                return search.createColumn(c);
            });
            var rows = search.create({type:'purchaseorder',filters:[['mainline','is','T'],'AND',['internalid','anyof',ids]],columns:cols}).run().getRange({start:0,end:101});
            var html = '<h3 class="am-gpo-title">Shared PO communications</h3><div class="am-gpo-scroll" role="region" aria-label="Shared PO communications table" tabindex="0"><table class="am-gpo-messages"><colgroup><col style="width:16%"><col style="width:13%"><col style="width:31%"><col style="width:20%"><col style="width:20%"></colgroup><thead><tr><th scope="col">Date</th><th scope="col">Direction</th><th scope="col">Subject</th><th scope="col">From</th><th scope="col">To</th></tr></thead><tbody>', seen = {}, count = 0;
            rows.forEach(function(r) {
                var id = r.getValue(cols[0]);
                if (!id || seen[id] || count >= 100) return;
                seen[id] = true; count++;
                var incoming = r.getValue(cols[5]);
                html += '<tr><td>' + esc(r.getValue(cols[2])) + '</td><td>' + ('<span class="am-gpo-direction' + (incoming === true || incoming === 'T' ? ' am-gpo-incoming' : '') + '">' + (incoming === true || incoming === 'T' ? 'Received' : 'Sent') + '</span>') + '</td><td><a target="_blank" rel="noopener noreferrer" href="/app/crm/common/crmmessage.nl?id=' + encodeURIComponent(id) + '&amp;l=T">' + esc(r.getValue(cols[1]) || '(No subject)') + '</a></td><td>' + esc(r.getValue(cols[3])) + '</td><td>' + esc(r.getValue(cols[4])) + '</td></tr>';
            });
            html += '</tbody></table></div>';
            if (!count) html += '<p class="am-gpo-help">No messages linked to the member POs are visible to your role.</p>';
            if (rows.length > 100) html += '<p class="am-gpo-help">Showing the latest 100 results. Open the member PO communications for older messages.</p>';
            return html;
        } catch(e) {
            log.error('Shared PO message report unavailable',e);
            return '<p class="am-gpo-help">Shared message report is unavailable. Use the communication PO links above.</p>';
        }
    }
    function esc(value) {
        return String(value || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    return { afterSubmit: afterSubmit, beforeLoad: beforeLoad };
});
