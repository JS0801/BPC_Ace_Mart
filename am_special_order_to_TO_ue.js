/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/search', 'N/log', 'N/runtime'], (record, search, log, runtime) => {

    function afterSubmit(context) {
        try {
            // if (context.type !== context.UserEventType.CREATE) return;
            if (![context.UserEventType.CREATE, context.UserEventType.EDIT].includes(context.type)) return;

            const transferReason = runtime.getCurrentScript().getParameter({ name: 'custscript_transfer_reason_sp' }) || 5;

            const itemReceipt = record.load({
                type: record.Type.ITEM_RECEIPT,
                id: context.newRecord.id,
                isDynamic: true
            });

            const receiptLocation = itemReceipt.getValue('location');
            const poId = itemReceipt.getValue('createdfrom');
            if (!poId) return;

            // Verify if createdfrom is a PO
            const poLookup = search.lookupFields({
                type: search.Type.TRANSACTION,
                id: poId,
                columns: ['recordtype', 'createdfrom']
            });

            if (poLookup.recordtype !== 'purchaseorder') {
                log.debug('Not a PO', { poId, type: poLookup.recordtype });
                return;
            }

            const soId = poLookup.createdfrom && poLookup.createdfrom.length > 0 ? poLookup.createdfrom[0].value : null;
            if (!soId) return;

            // Load SO
            const soRec = record.load({
                type: record.Type.SALES_ORDER,
                id: soId
            });

            // Get PO items from search
            const poItems = getItemsWithPO(soId);

            // Group lines by destination location
            const groups = {}; // Key: soLocation, Value: array of { itemId, quantity, lineIndex }

            const lineCount = soRec.getLineCount({ sublistId: 'item' });
            for (let i = 0; i < lineCount; i++) {
                const soItem = soRec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
                const soQty = soRec.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i });
                let soLocation = soRec.getSublistValue({ sublistId: 'item', fieldId: 'location', line: i });

                if (!soLocation) {
                    soLocation = soRec.getValue('location');
                }

                // Only handle the line associated with the PO being received
                const poItemInfo = poItems.find(p => p.itemId === soItem.toString() && p.poId === poId.toString());
                if (!poItemInfo) {
                    continue;
                }

                // Verify item type is transferable (Inventory or Assembly)
                const type = poItemInfo.itemType || '';
                const isTransferable = ['invtpart', 'assembly'].includes(type.toLowerCase());
                if (!isTransferable) {
                    log.debug('Skipping non-transferable item', { itemId: soItem, type });
                    continue;
                }

                // Only handle special order items (skip dropship)
                const isDropship = soRec.getSublistValue({ sublistId: 'item', fieldId: 'isdropship', line: i });
                const createPo = soRec.getSublistValue({ sublistId: 'item', fieldId: 'createpo', line: i });
                const isLineDropship = (isDropship === true || isDropship === 'T' || (createPo && createPo.toString().toLowerCase() === 'dropship'));

                if (isLineDropship) {
                    log.debug('Skipping dropship line', { line: i, item: soItem });
                    continue;
                }

                // If mismatch between PO receipt location and SO line location → queue for TO creation
                if (soLocation && receiptLocation && soLocation.toString() !== receiptLocation.toString()) {
                    const destLocStr = soLocation.toString();
                    if (!groups[destLocStr]) {
                        groups[destLocStr] = [];
                    }
                    groups[destLocStr].push({
                        itemId: soItem,
                        quantity: soQty,
                        lineIndex: i
                    });
                }
            }

            let soNeedsSave = false;

            // Create Transfer Order for each destination location group
            for (const destLoc in groups) {
                const itemsToTransfer = groups[destLoc];
                if (itemsToTransfer.length === 0) continue;

                log.debug('Creating Transfer Order for location group', {
                    soId, poId, from: receiptLocation, to: destLoc, itemsCount: itemsToTransfer.length
                });

                try {
                    const toRec = record.create({
                        type: record.Type.TRANSFER_ORDER,
                        isDynamic: true
                    });

                    toRec.setValue({ fieldId: 'subsidiary', value: 4 });
                    toRec.setValue({ fieldId: 'custbody_am_transfer_reason', value: transferReason });
                    toRec.setValue('location', receiptLocation); // from location
                    toRec.setValue('transferlocation', parseInt(destLoc, 10)); // to location
                    toRec.setValue('custbody_am_related_sales_order', soId);

                    // Add all items in the group to the Transfer Order
                    itemsToTransfer.forEach(item => {
                        toRec.selectNewLine({ sublistId: 'item' });
                        toRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: item.itemId });
                        toRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: item.quantity });
                        toRec.commitLine({ sublistId: 'item' });
                    });

                    const toId = toRec.save();
                    log.audit('Transfer Order Created', { transferOrderId: toId, toLocation: destLoc });

                    // Update sales order lines with the created TO ID
                    itemsToTransfer.forEach(item => {
                        soRec.setSublistValue({
                            sublistId: 'item',
                            fieldId: 'custcol_bpc_created_to',
                            line: item.lineIndex,
                            value: toId
                        });
                    });
                    soNeedsSave = true;

                } catch (toErr) {
                    log.error('Error creating Transfer Order for group ' + destLoc, toErr);
                }
            }

            if (soNeedsSave) {
                soRec.save();
            }

        } catch (e) {
            log.error('Error in afterSubmit Item Receipt', e);
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
