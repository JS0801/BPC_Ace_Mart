/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * Sandbox: create one Transfer Order per new Item Receipt/source/destination.
 * Uses receipt quantities, skips EDIT, and logs ambiguous item-to-SO matches.
 * custcol_am_related_to stores HTML links to all TOs appended by this version.
 * custcol_bpc_created_to is populated only when blank, preserving the first TO link.
 */
define(['N/record', 'N/search', 'N/log', 'N/runtime', 'N/url'], (record, search, log, runtime, url) => {
    const ALL_TO_FIELD = 'custcol_am_related_to';
    const id = value => value == null ? '' : String(value);
    const checked = value => value === true || value === 'T';
    const lineValue = (rec, fieldId, line) => rec.getSublistValue({ sublistId: 'item', fieldId, line });

    const errorDetails = error => ({
        name: error && error.name,
        message: error && error.message ? error.message : String(error),
        stack: error && error.stack
    });

    const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);

    // Preserve existing history; append each TO once. Limit matches Text Area's 4000 bytes.
    function appendToLinks(current, transferIds, linkCache) {
        let html = id(current);
        [...new Set(transferIds.filter(Boolean).map(String))].forEach(toId => {
            if (!/^\d+$/.test(toId)) throw new Error('Invalid TO internal ID: ' + toId);
            const alreadyLinked = new RegExp('data-am-to=["\']' + toId + '["\']').test(html) ||
                new RegExp('(?:[?&]|&amp;)id=' + toId + '(?=[&#"\'\\s]|$)').test(html);
            if (alreadyLinked) return;
            if (!linkCache[toId]) {
                const details = search.lookupFields({ type: search.Type.TRANSFER_ORDER, id: toId, columns: ['tranid'] });
                const href = url.resolveRecord({ recordType: record.Type.TRANSFER_ORDER, recordId: toId, isEditMode: false });
                linkCache[toId] = '<a data-am-to="' + toId + '" href="' + escapeHtml(href) +
                    '" target="_blank" rel="noopener noreferrer">' + escapeHtml(details.tranid || ('TO ' + toId)) + '</a>';
            }
            html += (html ? '<br />' : '') + linkCache[toId];
        });
        const byteLength = encodeURIComponent(html).replace(/%[A-F\d]{2}/gi, 'x').length;
        if (byteLength > 4000) throw new Error(ALL_TO_FIELD + ' exceeds 4000 bytes; existing links retained. New TO links require manual review.');
        return html;
    }

    function afterSubmit(context) {
        const receiptId = context.newRecord.id;
        if (context.type !== context.UserEventType.CREATE) {
            log.debug('Receipt event skipped', { receiptId, eventType: context.type, reason: 'CREATE only' });
           // return;
        }
        const startedAt = Date.now();
        const summary = { receiptId, createdTOs: [], duplicateGroups: 0, groupErrors: 0, linksSet: 0, linksPreserved: 0, allToLinksUpdated: 0, linkErrors: 0, soSaved: false };
        let stage = 'load receipt';
        log.audit('Receipt processing started', { receiptId, eventType: context.type });
        try {
            const transferReason = runtime.getCurrentScript().getParameter({ name: 'custscript_transfer_reason_sp' }) || 5;
            const receipt = record.load({ type: record.Type.ITEM_RECEIPT, id: receiptId });
            const poId = receipt.getValue('createdfrom');
            log.debug('Receipt loaded', { receiptId, poId, receiptLocation: receipt.getValue('location'), lineCount: receipt.getLineCount({ sublistId: 'item' }), transferReason });
            if (!poId) {
                summary.skipReason = 'No created-from transaction';
                return;
            }
            stage = 'look up PO';
            const poLookup = search.lookupFields({
                type: search.Type.TRANSACTION, id: poId, columns: ['recordtype', 'createdfrom']
            });
            if (poLookup.recordtype !== 'purchaseorder') {
                summary.skipReason = 'Created-from transaction is not a PO';
                log.debug('Non-PO receipt skipped', { receiptId, poId, recordType: poLookup.recordtype });
                return;
            }
            const soId = poLookup.createdfrom && poLookup.createdfrom.length ? poLookup.createdfrom[0].value : null;
            if (!soId) {
                summary.skipReason = 'PO has no source SO';
                return;
            }
            summary.poId = poId;
            summary.soId = soId;
            stage = 'load SO and match lines';
            log.debug('Receipt PO and SO resolved', { receiptId, poId, soId });

            const soRec = record.load({ type: record.Type.SALES_ORDER, id: soId });
            const poItems = getItemsWithPO(soId, receiptId);
            const candidates = {};
            for (let i = 0; i < soRec.getLineCount({ sublistId: 'item' }); i++) {
                const itemId = id(lineValue(soRec, 'item', i));
                const lineId = id(lineValue(soRec, 'line', i));
                // Match the SO search result to its actual line, not just its item.
                const info = poItems.find(p => p.lineId === lineId && p.itemId === itemId && p.poId === id(poId));
                if (!info) {
                    log.debug('SO line skipped - no matching PO search row', { receiptId, poId, soId, soLineIndex: i, lineId, itemId });
                    continue;
                }
                if (!candidates[itemId]) candidates[itemId] = [];
                candidates[itemId].push({
                    lineIndex: i,
                    location: lineValue(soRec, 'location', i) || soRec.getValue('location'),
                    transferable: ['invtpart', 'assembly'].includes((info.itemType || '').toLowerCase()),
                    dropship: checked(lineValue(soRec, 'isdropship', i)) ||
                        id(lineValue(soRec, 'createpo', i)).toLowerCase() === 'dropship'
                });
            }

            log.debug('SO candidates prepared', { receiptId, soId, searchRows: poItems.length, itemCount: Object.keys(candidates).length });
            stage = 'group received lines';
            const groups = {};
            for (let i = 0; i < receipt.getLineCount({ sublistId: 'item' }); i++) {
                const received = lineValue(receipt, 'itemreceive', i);
                const quantity = Number(lineValue(receipt, 'quantity', i));
                log.debug('Receipt line inspected', { receiptId, receiptLineIndex: i, itemId: lineValue(receipt, 'item', i), received, quantity });
                if (!checked(received) || !Number.isFinite(quantity) || quantity <= 0) {
                    log.debug('Receipt line skipped - not received or invalid quantity', { receiptId, receiptLineIndex: i, received, quantity });
                    continue;
                }
                const itemId = id(lineValue(receipt, 'item', i));
                const matches = candidates[itemId] || [];
                if (!matches.length) {
                    log.debug('Receipt line skipped - no matching SO candidate', { receiptId, poId, soId, receiptLineIndex: i, itemId });
                    continue;
                }
                if (matches.length !== 1) {
                    log.error('Ambiguous receipt item - manual transfer required', {
                        receiptId, poId, soId, receiptLine: i, itemId, quantity,
                        salesOrderLines: matches.map(m => m.lineIndex),
                        reason: 'Multiple SO lines for this item/PO; receipt quantity was not allocated.'
                    });
                    continue;
                }
                const match = matches[0];
                if (!match.transferable || match.dropship) {
                    log.debug('Receipt line skipped - item eligibility', { receiptId, receiptLineIndex: i, itemId, transferable: match.transferable, dropship: match.dropship });
                    continue;
                }
                const from = lineValue(receipt, 'location', i) || receipt.getValue('location');
                const to = match.location;
                if (!from || !to) {
                    log.error('Missing transfer location - manual transfer required', { receiptId, receiptLine: i, itemId, from, to });
                    continue;
                }
                if (id(from) === id(to)) {
                    log.debug('Receipt line skipped - same location', { receiptId, receiptLineIndex: i, itemId, from, to });
                    continue;
                }
                const key = id(from) + '_' + id(to);
                if (!groups[key]) groups[key] = { from, to, items: [] };
                groups[key].items.push({
                    itemId, quantity, lineIndex: match.lineIndex,
                    // Receipt units can be returned as text; preserve them before setting quantity.
                    units: lineValue(receipt, 'units', i)
                });
            }

            log.debug('Transfer groups prepared', { receiptId, groupCount: Object.keys(groups).length });
            if (!Object.keys(groups).length) summary.skipReason = 'No eligible transfer groups; see line logs';
            let soNeedsSave = false;
            const linkCache = {};
            for (const key in groups) {
                const group = groups[key];
                const externalId = 'AM_SP_IR_' + receiptId + '_' + key;
                let groupStage = 'duplicate check';
                let savedToId = null;
                try {
                    log.debug('Transfer group processing', { receiptId, externalId, from: group.from, to: group.to, lineCount: group.items.length });
                    // Per-receipt key permits later partial receipts, but avoids replaying this group.
                    const existing = search.create({
                        type: search.Type.TRANSFER_ORDER,
                        filters: [['mainline', 'is', 'T'], 'AND', ['externalidstring', 'is', externalId]],
                        columns: ['internalid']
                    }).run().getRange({ start: 0, end: 1 });
                    if (existing.length) {
                        summary.duplicateGroups++;
                        log.audit('Receipt transfer already exists', { receiptId, externalId, transferOrderId: existing[0].id });
                        continue;
                    }
                    groupStage = 'create TO and set fields';
                    const toRec = record.create({ type: record.Type.TRANSFER_ORDER, isDynamic: true });
                    toRec.setValue({ fieldId: 'subsidiary', value: 4 });
                    toRec.setValue({ fieldId: 'externalid', value: externalId });
                    toRec.setValue({ fieldId: 'custbody_am_transfer_reason', value: transferReason });
                    toRec.setValue({ fieldId: 'location', value: group.from });
                    toRec.setValue({ fieldId: 'transferlocation', value: Number(group.to) });
                    toRec.setValue({ fieldId: 'custbody_am_related_sales_order', value: soId });
                    toRec.setValue({ fieldId: 'memo', value: 'Special order partial receipt | Item Receipt ' + receiptId + ' | PO ' + poId });
                    group.items.forEach(item => {
                        groupStage = 'add TO item ' + item.itemId + ' from SO line index ' + item.lineIndex;
                        log.debug('Adding TO line', { receiptId, externalId, ...item });
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
                    groupStage = 'save TO';
                    log.debug('Saving TO', { receiptId, externalId });
                    const toId = toRec.save();
                    savedToId = toId;
                    summary.createdTOs.push(toId);
                    groupStage = 'update SO line links';
                    log.audit('Transfer Order Created', {
                        receiptId, poId, soId, transferOrderId: toId, from: group.from, to: group.to,
                        items: group.items.map(item => ({ itemId: item.itemId, quantity: item.quantity, units: item.units }))
                    });
                    group.items.forEach(item => {
                        // Later partial receipts still create TOs, but keep the first SO line link.
                        const existingLink = lineValue(soRec, 'custcol_bpc_created_to', item.lineIndex);
                        if (existingLink !== null && existingLink !== undefined && existingLink !== '') {
                            summary.linksPreserved++;
                            log.debug('First SO TO link preserved', { receiptId, soId, soLineIndex: item.lineIndex, existingTO: existingLink, newTO: toId });
                        } else {
                        soRec.setSublistValue({ sublistId: 'item', fieldId: 'custcol_bpc_created_to', line: item.lineIndex, value: toId });
                        soNeedsSave = true;
                        summary.linksSet++;
                        log.debug('First SO TO link staged for save', { receiptId, soId, soLineIndex: item.lineIndex, transferOrderId: toId });
                        }
                        try {
                            const current = id(lineValue(soRec, ALL_TO_FIELD, item.lineIndex));
                            const updated = appendToLinks(current, [existingLink, toId], linkCache);
                            if (updated !== current) {
                                soRec.setSublistValue({ sublistId: 'item', fieldId: ALL_TO_FIELD, line: item.lineIndex, value: updated });
                                soNeedsSave = true;
                                summary.allToLinksUpdated++;
                                log.debug('All TO links staged for save', { receiptId, soId, soLineIndex: item.lineIndex, fieldId: ALL_TO_FIELD, transferOrderId: toId });
                            }
                        } catch (error) {
                            summary.linkErrors++;
                            log.error('All TO links update failed - TO already created', { receiptId, soId, soLineIndex: item.lineIndex, transferOrderId: toId, fieldId: ALL_TO_FIELD, error: errorDetails(error) });
                        }
                    });
                } catch (error) {
                    summary.groupErrors++;
                    log.error('Receipt transfer failed - review required', { receiptId, poId, soId, externalId, stage: groupStage, savedToId, error: errorDetails(error) });
                }
            }
            if (soNeedsSave) {
                stage = 'save SO links';
                log.debug('Saving TO links on SO', { receiptId, soId, linksSet: summary.linksSet, allToLinksUpdated: summary.allToLinksUpdated });
                soRec.save();
                summary.soSaved = true;
                log.audit('SO TO links saved', { receiptId, soId, linksSet: summary.linksSet, allToLinksUpdated: summary.allToLinksUpdated });
            } else {
                log.debug('SO save not required', { receiptId, soId, reason: 'No TO link fields changed' });
            }
        } catch (error) {
            summary.fatalError = errorDetails(error);
            log.error('Error in afterSubmit Item Receipt', { receiptId, stage, createdTOs: summary.createdTOs, error: errorDetails(error) });
        } finally {
            log.audit('Receipt processing ended', { ...summary, elapsedMs: Date.now() - startedAt });
        }
    }

    const getItemsWithPO = (soId, receiptId) => {
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
            log.error('Error in getItemsWithPO', { receiptId, soId, error: errorDetails(e) });
        }
        log.debug('SO PO item search completed', { receiptId, soId, rowCount: poItems.length });
        return poItems;
    };

    return { afterSubmit };
});
