/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/search', 'N/record', 'N/log'], function (search, record, log) {

    var CUSTOM_REC_TYPE = 'customrecord_grouped_pos';
    var FIELD_PO_NUMBER = 'custrecord_po_number';
    var FIELD_PO_DETAILS = 'custrecord_bpc_po_details';

    function afterSubmit(context) {
        if (context.type === context.UserEventType.DELETE) {
            return;
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
                search.createColumn({ name: 'total', summary: search.Summary.MAX })
            ]
        });

        poSearch.run().each(function (result) {
            var amount = toNumber(result.getValue({ name: 'total', summary: search.Summary.MAX }));

            details.purchaseOrders.push({
                poInternalId: result.getValue({ name: 'internalid', summary: search.Summary.GROUP }) || '',
                poNumber: result.getValue({ name: 'tranid', summary: search.Summary.MAX }) || '',
                tranDate: result.getValue({ name: 'trandate', summary: search.Summary.MAX }) || '',
                lineCount: toNumber(result.getValue({ name: 'item', summary: search.Summary.COUNT })),
                vendorMemo: result.getValue({ name: 'custbody_vendor_memo', summary: search.Summary.MAX }) || '',
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

    return { afterSubmit: afterSubmit };
});
