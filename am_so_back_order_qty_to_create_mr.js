/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/record', 'N/search', 'N/log', 'N/runtime', 'N/format'], (record, search, log, runtime, format) => {

    // 1. Search SO lines with backordered qty
    const getInputData = () => {
        return search.create({
            type: "salesorder",
            settings: [{ "name": "consolidationtype", "value": "ACCTTYPE" }],
            filters:
                [
                    ["type", "anyof", "SalesOrd"],
                    "AND",
                    ["mainline", "is", "F"],
                    "AND",
                    ["status", "anyof", "SalesOrd:B", "SalesOrd:D"],
                    "AND",
                    ["custcol_bpc_created_to", "anyof", "@NONE@"],
                    "AND",
                    ["custcol_fulfill_from_stock", "is", "F"],
                    "AND",
                    ["item.type", "anyof", "Assembly", "InvtPart"],
                    "AND",
                    ["datecreated", "onorafter", "6/1/2026"]
                ],
            columns:
                [
                    search.createColumn({ name: "tranid", label: "Document Number" }),
                    search.createColumn({ name: "location", label: "Location" }),
                    search.createColumn({ name: "location", join: null, label: "Header Location" }),
                    search.createColumn({ name: "item", label: "Item" }),
                    search.createColumn({ name: "quantityshiprecv", label: "Quantity Fulfilled/Received" }),
                    search.createColumn({ name: "quantity", label: "Quantity" }),
                    search.createColumn({ name: "custcol_ace_need_by_date" })
                ]
        });
    };

    // 2. Map each SO line
    const map = (context) => {
        try {
            const result = JSON.parse(context.value);

            log.debug('Parsed Values', context.value);

            const soId = result.id;  // sales order internal ID
            const itemId = result.values.item.value;

            const lineLocation = result.values.location?.value;
            const headerLocation = getSalesOrderHeaderLocation(soId);

            const toLocation = lineLocation || headerLocation;

            if (!toLocation) {
                log.debug("Destination Location not found");
                return;
            }

            const qtyOrdered = parseFloat(result.values.quantity) || 0;
            const qtyFulfilled = parseFloat(result.values.quantityshiprecv) || 0;
            const qtyToTransfer = qtyOrdered - qtyFulfilled;

            if (qtyToTransfer <= 0) {
                log.debug("No quantity to transfer", qtyToTransfer);
                return;
            }

            const needByDateRaw = result.values.custcol_ace_need_by_date;
            const needByDate = typeof needByDateRaw === 'object' && needByDateRaw !== null ? (needByDateRaw.value || '') : (needByDateRaw || '');

            context.write({
                key: `${soId}|${toLocation}`,
                value: JSON.stringify({ itemId, qtyToTransfer, needByDate })
            });

        } catch (error) {
            log.error('Error in mapping', error);
        }
    };

    // 3. Reduce: create TO for each SO/location
    const reduce = (context) => {
        try {
            const [soId, toLocation] = context.key.split('|');
            const items = context.values.map(v => JSON.parse(v));
            const scriptObj = runtime.getCurrentScript();
            const DISTRIBUTION_CENTER_ID = scriptObj.getParameter({ name: 'custscript_distribution_center' });
            const SOLD_STOCK_INTERNAL_ID = scriptObj.getParameter({ name: 'custscript_transfer_reason' });

            if (soId == "261530") {
                log.audit('Reduce logger', {
                    soId: soId,
                    DISTRIBUTION_CENTER_ID: DISTRIBUTION_CENTER_ID,
                    SOLD_STOCK_INTERNAL_ID: SOLD_STOCK_INTERNAL_ID,
                    toLocation: toLocation
                });
            }

            if (toLocation != DISTRIBUTION_CENTER_ID) {
                // Get items with PO attached
                const poItems = getItemsWithPO(soId);
                log.debug('poItems found', poItems);

                // Filter items to keep only those without an attached PO
                const validItems = items.filter(item => {
                    const hasPO = poItems.indexOf(item.itemId.toString()) !== -1;
                    if (hasPO) {
                        log.debug('Skipping item with attached PO', item.itemId);
                    }
                    return !hasPO;
                });

                if (validItems.length === 0) {
                    log.audit('No valid items to transfer (all had POs attached)', { soId });
                    return;
                }

                const toRec = record.create({
                    type: record.Type.TRANSFER_ORDER,
                    isDynamic: true
                });

                toRec.setValue({ fieldId: 'subsidiary', value: 4 });
                toRec.setValue({ fieldId: 'custbody_am_transfer_reason', value: SOLD_STOCK_INTERNAL_ID }); // "Sold Stock"
                toRec.setValue('location', DISTRIBUTION_CENTER_ID); // FROM
                toRec.setValue('transferlocation', toLocation); // TO
                toRec.setValue('custbody_am_related_sales_order', soId);
                toRec.setValue('useitemcostastransfercost', true);

                validItems.forEach(item => {
                    log.debug('item', item);
                    const itemId = Number(item.itemId); // force numeric

                    if (!itemId) {
                        log.debug('Skipping line: no valid itemId', item);
                        return;
                    }
                    toRec.selectNewLine({ sublistId: 'item' });
                    toRec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'item',
                        value: itemId
                    });
                    toRec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'quantity',
                        value: item.qtyToTransfer
                    });

                    let calculatedDate;
                    let today = new Date();
                    today.setHours(0, 0, 0, 0);

                    let tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    tomorrow.setHours(0, 0, 0, 0);

                    if (item.needByDate) {
                        try {
                            calculatedDate = format.parse({
                                value: item.needByDate,
                                type: format.Type.DATE
                            });
                            calculatedDate.setHours(0, 0, 0, 0);
                            calculatedDate.setDate(calculatedDate.getDate() - 21); // Subtract 3 weeks

                            if (calculatedDate < today) {
                                calculatedDate = tomorrow;
                            }
                        } catch (parseErr) {
                            log.error('Failed to parse needByDate: ' + item.needByDate, parseErr);
                            calculatedDate = tomorrow;
                        }
                    } else {
                        calculatedDate = tomorrow;
                    }

                    toRec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'expectedshipdate',
                        value: calculatedDate
                    });

                    const receiptDate = new Date(calculatedDate);
                    receiptDate.setDate(receiptDate.getDate() + 3);
                    toRec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'expectedreceiptdate',
                        value: receiptDate
                    });

                    toRec.commitLine({ sublistId: 'item' });
                });

                const toId = toRec.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: true
                });

                const soRec = record.load({
                    type: record.Type.SALES_ORDER,
                    id: soId,
                    isDynamic: false
                });

                const lineCount = soRec.getLineCount({ sublistId: 'item' });

                validItems.forEach(item => {
                    for (let i = 0; i < lineCount; i++) {
                        const lineItemId = soRec.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'item',
                            line: i
                        });

                        if (lineItemId == item.itemId) {
                            soRec.setSublistValue({
                                sublistId: 'item',
                                fieldId: 'custcol_bpc_created_to',
                                line: i,
                                value: toId
                            });
                        }
                    }
                });

                soRec.save({ enableSourcing: true, ignoreMandatoryFields: true });
                log.audit('Transfer Order Created', { transferOrderId: toId, soId, toLocation });
            } else {
                // log.audit('Skip TO creation for same source location');
                return;
            }

        } catch (e) {
            log.error('Error in reduce creating TO', {
                error: e,
                key: context.key
            });
        }
    };

    const getSalesOrderHeaderLocation = (soId) => {
        try {
            const lookup = search.lookupFields({
                type: search.Type.SALES_ORDER,
                id: soId,
                columns: ['location']
            });

            if (lookup.location && lookup.location.length > 0) {
                return lookup.location[0].value;
            }

            return null;

        } catch (e) {
            log.error('Error fetching header location', { soId, error: e });
            return null;
        }
    };

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
                    search.createColumn({ name: "item", label: "Item" })
                ]
            });

            salesorderSearchObj.run().each((result) => {
                const po = result.getValue({ name: 'purchaseorder' });
                const itemId = result.getValue({ name: 'item' });
                if (po && itemId) {
                    poItems.push(itemId.toString());
                }
                return true;
            });
        } catch (e) {
            log.error('Error in getItemsWithPO', { soId, error: e });
        }
        return poItems;
    };


    return { getInputData, map, reduce };
});