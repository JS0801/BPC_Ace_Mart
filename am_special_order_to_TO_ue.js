/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * Sandbox: create one Transfer Order per new Item Receipt/source/destination.
 * Uses receipt quantities, skips EDIT, and logs ambiguous item-to-SO matches.
 * custcol_bpc_created_to is populated only when blank, preserving the first TO link.
 */
define(['N/record', 'N/search', 'N/log', 'N/runtime'], (record, search, log, runtime) => {
    const id = value => value == null ? '' : String(value);
    const checked = value => value === true || value === 'T';
    const lineValue = (rec, fieldId, line) => rec.getSublistValue({ sublistId: 'item', fieldId, line });

    function afterSubmit(context) {
        if (context.type !== context.UserEventType.CREATE) return;
        const receiptId = context.newRecord.id;
        try {
            const transferReason = runtime.getCurrentScript().getParameter({ name: 'custscript_transfer_reason_sp' }) || 5;
            const receipt = record.load({ type: record.Type.ITEM_RECEIPT, id: receiptId });
            const poId = receipt.getValue('createdfrom');
            if (!poId) return;
            const poLookup = search.lookupFields({
                type: search.Type.TRANSACTION, id: poId, columns: ['recordtype', 'createdfrom']
            });
            if (poLookup.recordtype !== 'purchaseorder') return;
            const soId = poLookup.createdfrom && poLookup.createdfrom.length ? poLookup.createdfrom[0].value : null;
            if (!soId) return;

            const soRec = record.load({ type: record.Type.SALES_ORDER, id: soId });
            const poItems = getItemsWithPO(soId);
            const candidates = {};
            for (let i = 0; i < soRec.getLineCount({ sublistId: 'item' }); i++) {
                const itemId = id(lineValue(soRec, 'item', i));
                const lineId = id(lineValue(soRec, 'line', i));
                // Match the SO search result to its actual line, not just its item.
                const info = poItems.find(p => p.lineId === lineId && p.itemId === itemId && p.poId === id(poId));
                if (!info) continue;
                if (!candidates[itemId]) candidates[itemId] = [];
                candidates[itemId].push({
                    lineIndex: i,
                    location: lineValue(soRec, 'location', i) || soRec.getValue('location'),
                    transferable: ['invtpart', 'assembly'].includes((info.itemType || '').toLowerCase()),
                    dropship: checked(lineValue(soRec, 'isdropship', i)) ||
                        id(lineValue(soRec, 'createpo', i)).toLowerCase() === 'dropship'
                });
            }

            const groups = {};
            for (let i = 0; i < receipt.getLineCount({ sublistId: 'item' }); i++) {
                const received = lineValue(receipt, 'itemreceive', i);
                const quantity = Number(lineValue(receipt, 'quantity', i));
                if (!checked(received) || !Number.isFinite(quantity) || quantity <= 0) continue;
                const itemId = id(lineValue(receipt, 'item', i));
                const matches = candidates[itemId] || [];
                if (!matches.length) continue;
                if (matches.length !== 1) {
                    log.error('Ambiguous receipt item - manual transfer required', {
                        receiptId, poId, soId, receiptLine: i, itemId, quantity,
                        salesOrderLines: matches.map(m => m.lineIndex),
                        reason: 'Multiple SO lines for this item/PO; receipt quantity was not allocated.'
                    });
                    continue;
                }
                const match = matches[0];
                if (!match.transferable || match.dropship) continue;
                const from = lineValue(receipt, 'location', i) || receipt.getValue('location');
                const to = match.location;
                if (!from || !to) {
                    log.error('Missing transfer location - manual transfer required', { receiptId, receiptLine: i, itemId, from, to });
                    continue;
                }
                if (id(from) === id(to)) continue;
                const key = id(from) + '_' + id(to);
                if (!groups[key]) groups[key] = { from, to, items: [] };
                groups[key].items.push({
                    itemId, quantity, lineIndex: match.lineIndex,
                    // Receipt units can be returned as text; preserve them before setting quantity.
                    units: lineValue(receipt, 'units', i)
                });
            }

            let soNeedsSave = false;
            for (const key in groups) {
                const group = groups[key];
                const externalId = 'AM_SP_IR_' + receiptId + '_' + key;
                try {
                    // Per-receipt key permits later partial receipts, but avoids replaying this group.
                    const existing = search.create({
                        type: search.Type.TRANSFER_ORDER,
                        filters: [['mainline', 'is', 'T'], 'AND', ['externalidstring', 'is', externalId]],
                        columns: ['internalid']
                    }).run().getRange({ start: 0, end: 1 });
                    if (existing.length) {
                        log.audit('Receipt transfer already exists', { receiptId, externalId, transferOrderId: existing[0].id });
                        continue;
                    }
                    const toRec = record.create({ type: record.Type.TRANSFER_ORDER, isDynamic: true });
                    toRec.setValue({ fieldId: 'subsidiary', value: 4 });
                    toRec.setValue({ fieldId: 'externalid', value: externalId });
                    toRec.setValue({ fieldId: 'custbody_am_transfer_reason', value: transferReason });
                    toRec.setValue({ fieldId: 'location', value: group.from });
                    toRec.setValue({ fieldId: 'transferlocation', value: Number(group.to) });
                    toRec.setValue({ fieldId: 'custbody_am_related_sales_order', value: soId });
                    toRec.setValue({ fieldId: 'memo', value: 'Special order partial receipt | Item Receipt ' + receiptId + ' | PO ' + poId });
                    group.items.forEach(item => {
                        toRec.selectNewLine({ sublistId: 'item' });
                        toRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: Number(item.itemId) });
                        if (item.units !== null && item.units !== undefined && item.units !== '') {
                            if (/^\d+$/.test(String(item.units))) {
                                toRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'units', value: Number(item.units) });
                            } else {
                                toRec.setCurrentSublistText({ sublistId: 'item', fieldId: 'units', text: String(item.units) });
                            }
                        }
                        toRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: item.quantity });
                        toRec.commitLine({ sublistId: 'item' });
                    });
                    const toId = toRec.save();
                    log.audit('Transfer Order Created', {
                        receiptId, poId, soId, transferOrderId: toId, from: group.from, to: group.to,
                        items: group.items.map(item => ({ itemId: item.itemId, quantity: item.quantity, units: item.units }))
                    });
                    group.items.forEach(item => {
                        // Later partial receipts still create TOs, but keep the first SO line link.
                        const existingLink = lineValue(soRec, 'custcol_bpc_created_to', item.lineIndex);
                        if (existingLink !== null && existingLink !== undefined && existingLink !== '') return;
                        soRec.setSublistValue({ sublistId: 'item', fieldId: 'custcol_bpc_created_to', line: item.lineIndex, value: toId });
                        soNeedsSave = true;
                    });
                } catch (error) {
                    log.error('Receipt transfer failed - review required', { receiptId, poId, soId, externalId, error });
                }
            }
            if (soNeedsSave) soRec.save();
        } catch (error) {
            log.error('Error in afterSubmit Item Receipt', { receiptId, error });
        }
    }

    const getItemsWithPO = (soId) => {
        const poItems = [];
        try {
            const salesorderSearchObj = search.create({
                type: "salesorder",
                settings: [{ "name": "consolidationtype", "value": "ACCTTYPE" }],
                filters: [
                    ["type", "anyof", "SalesOrd"],
                    "AND",
                    ["internalid", "anyof", soId],
                    "AND",
                    ["mainline", "is", "F"],
                    "AND",
                    ["cogs", "is", "F"],
                    "AND",
                    ["shipping", "is", "F"],
                    "AND",
                    ["taxline", "is", "F"]
                ],
                columns: [
                    search.createColumn({ name: "line", label: "SO Line ID" }),
                    search.createColumn({ name: "purchaseorder", label: "Purchase Order" }),
                    search.createColumn({ name: "item", label: "Item" }),
                    search.createColumn({ name: "type", join: "item", label: "Item Type" })
                ]
            });

            salesorderSearchObj.run().each((result) => {
                const po = result.getValue({ name: 'purchaseorder' });
                const itemId = result.getValue({ name: 'item' });
                const itemType = result.getValue({ name: 'type', join: 'item' });
                if (po && itemId) {
                    poItems.push({
                        lineId: String(result.getValue({ name: 'line' })),
                        itemId: itemId.toString(),
                        poId: po.toString(),
                        itemType: itemType
                    });
                }
                return true;
            });
        } catch (e) {
            log.error('Error in getItemsWithPO', { soId, error: e });
        }
        return poItems;
    };

    return { afterSubmit };
});
