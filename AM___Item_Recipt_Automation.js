/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 *
 * Script Name: [AM] UE RMA Auto Item Receipt Creation
 *
 * Purpose:
 * Auto-create Item Receipt from Customer Return Authorization.
 *
 * Logic:
 * - Runs on CREATE 
 * - Checks RMA item lines
 * - Only receives lines where custcol_atlas_return_reason is populated
 * - Reason Code 4 = Inventory Status New 1
 * - All other reason codes = Inventory Status Hold 6
 * - Lines without reason code are skipped
 * - Uses line-level location from RMA
 * - Creates one consolidated Item Receipt
 * - Prevents duplicate Item Receipt creation
 */

define(['N/record', 'N/runtime', 'N/email', 'N/search', 'N/log'], function (record, runtime, email, search, log) {

    // --------------------------------------------------
    // CONSTANTS
    // --------------------------------------------------

    var RETURN_REASON_FIELD = 'custcol_atlas_return_reason';

    var scriptObj = runtime.getCurrentScript();
    var GOOD_RETURN_REASON_ID = scriptObj.getParameter({ name: 'custscript_return_reason' }) || '4';
    var INVENTORY_STATUS_NEW = scriptObj.getParameter({ name: 'custscript_inventory_status_new_id' }) || '1';
    var INVENTORY_STATUS_HOLD = scriptObj.getParameter({ name: 'custscript_inventory_status_hold_id' }) || '6';

    // Optional script parameters
    var PARAM_NOTIFY_RECIPIENTS = 'custscript_am_rma_ir_notify_recipients';
    var PARAM_EMAIL_AUTHOR = 'custscript_am_rma_ir_email_author';

    // --------------------------------------------------
    // AFTER SUBMIT
    // --------------------------------------------------

    function afterSubmit(context) {
        var rmaId = null;

        try {
            // Run only on CREATE 
            if (
                context.type !== context.UserEventType.CREATE 

            ) {
                log.debug('Skipped', 'Script only runs on CREATE.');
                return;
            }

            var newRec = context.newRecord;

            if (!newRec || newRec.type !== record.Type.RETURN_AUTHORIZATION) {
                log.debug('Skipped', 'Record is not Return Authorization.');
                return;
            }

            rmaId = newRec.id;

            log.audit('RMA Auto Item Receipt Started', {
                rmaId: rmaId,
                contextType: context.type
            });

            // Prevent duplicate Item Receipt
            if (hasExistingItemReceipt(rmaId)) {
                log.audit('Skipped', 'Item Receipt already exists for RMA: ' + rmaId);
                return;
            }

            var rmaRec = record.load({
                type: record.Type.RETURN_AUTHORIZATION,
                id: rmaId,
                isDynamic: false
            });

            var sourceData = buildRmaLineData(rmaRec);

            if (!sourceData || sourceData.eligibleCount <= 0) {
                log.audit('No Eligible Lines', 'No RMA lines have return reason. No Item Receipt created. RMA ID: ' + rmaId);
                return;
            }

            var irRec = record.transform({
                fromType: record.Type.RETURN_AUTHORIZATION,
                fromId: rmaId,
                toType: record.Type.ITEM_RECEIPT,
                isDynamic: true
            });

            var irLineCount = irRec.getLineCount({
                sublistId: 'item'
            });

            var receivedLineCount = 0;

            for (var i = 0; i < irLineCount; i++) {
                irRec.selectLine({
                    sublistId: 'item',
                    line: i
                });

                var sourceLine = findMatchingRmaLine(irRec, i, sourceData);

                if (!sourceLine || !sourceLine.isEligible) {
                    skipReceiptLine(irRec, i);

                    irRec.commitLine({
                        sublistId: 'item'
                    });

                    continue;
                }

                var inventoryStatusId = getInventoryStatusByReason(sourceLine.returnReason);

                setCurrentLineReceive(irRec, true);

                if (!isEmpty(sourceLine.location)) {
                    safeSetCurrentSublistValue(irRec, 'item', 'location', sourceLine.location);
                }

                var quantityToReceive = getCurrentQuantity(irRec, sourceLine.quantity);

                if (!isEmpty(quantityToReceive)) {
                    safeSetCurrentSublistValue(irRec, 'item', 'quantity', quantityToReceive);
                }

                applyInventoryStatusToCurrentLine(irRec, inventoryStatusId, quantityToReceive);

                sourceLine.used = true;
                receivedLineCount++;

                log.debug('Prepared Item Receipt Line', {
                    irLine: i,
                    sourceRmaLine: sourceLine.index,
                    item: sourceLine.item,
                    reasonCode: sourceLine.returnReason,
                    inventoryStatus: inventoryStatusId,
                    quantity: quantityToReceive,
                    location: sourceLine.location
                });

                irRec.commitLine({
                    sublistId: 'item'
                });
            }

            if (receivedLineCount <= 0) {
                log.audit('No Lines Received', 'No Item Receipt saved because no transformed lines were eligible. RMA ID: ' + rmaId);
                return;
            }

            var itemReceiptId = irRec.save({
                enableSourcing: true,
                ignoreMandatoryFields: false
            });

            log.audit('Item Receipt Created Successfully', {
                rmaId: rmaId,
                itemReceiptId: itemReceiptId,
                receivedLineCount: receivedLineCount
            });

        } catch (e) {
            log.error('RMA Auto Item Receipt Failed', {
                rmaId: rmaId,
                name: e.name,
                message: e.message,
                stack: e.stack
            });

            sendAdminNotification(rmaId, e);
        }
    }

    // --------------------------------------------------
    // BUILD RMA LINE DATA
    // --------------------------------------------------

    function buildRmaLineData(rmaRec) {
        var lineCount = rmaRec.getLineCount({
            sublistId: 'item'
        });

        var lines = [];
        var byIndex = {};
        var byLineUniqueKey = {};
        var byLineId = {};
        var eligibleCount = 0;

        for (var i = 0; i < lineCount; i++) {
            var returnReason = safeGetSublistValue(rmaRec, 'item', RETURN_REASON_FIELD, i);
            var item = safeGetSublistValue(rmaRec, 'item', 'item', i);
            var quantity = safeGetSublistValue(rmaRec, 'item', 'quantity', i);
            var location = safeGetSublistValue(rmaRec, 'item', 'location', i);
            var lineUniqueKey = safeGetSublistValue(rmaRec, 'item', 'lineuniquekey', i);
            var lineId = safeGetSublistValue(rmaRec, 'item', 'line', i);

            var isEligible = !isEmpty(returnReason);

            if (isEligible) {
                eligibleCount++;
            }

            var lineObj = {
                index: i,
                item: item,
                quantity: quantity,
                location: location,
                returnReason: returnReason,
                lineUniqueKey: lineUniqueKey,
                lineId: lineId,
                isEligible: isEligible,
                used: false
            };

            lines.push(lineObj);

            byIndex[String(i)] = lineObj;

            if (!isEmpty(lineUniqueKey)) {
                byLineUniqueKey[String(lineUniqueKey)] = lineObj;
            }

            if (!isEmpty(lineId)) {
                byLineId[String(lineId)] = lineObj;
            }

            log.debug('RMA Line Reviewed', lineObj);
        }

        return {
            lines: lines,
            byIndex: byIndex,
            byLineUniqueKey: byLineUniqueKey,
            byLineId: byLineId,
            eligibleCount: eligibleCount
        };
    }

    // --------------------------------------------------
    // MATCH ITEM RECEIPT LINE TO RMA LINE
    // --------------------------------------------------

    function findMatchingRmaLine(irRec, irLineIndex, sourceData) {
        var orderLine = safeGetCurrentSublistValue(irRec, 'item', 'orderline');
        var lineUniqueKey = safeGetCurrentSublistValue(irRec, 'item', 'lineuniquekey');
        var item = safeGetCurrentSublistValue(irRec, 'item', 'item');
        var location = safeGetCurrentSublistValue(irRec, 'item', 'location');

        if (!isEmpty(orderLine)) {
            if (sourceData.byLineId[String(orderLine)]) {
                return sourceData.byLineId[String(orderLine)];
            }

            if (sourceData.byLineUniqueKey[String(orderLine)]) {
                return sourceData.byLineUniqueKey[String(orderLine)];
            }
        }

        if (!isEmpty(lineUniqueKey) && sourceData.byLineUniqueKey[String(lineUniqueKey)]) {
            return sourceData.byLineUniqueKey[String(lineUniqueKey)];
        }

        if (sourceData.byIndex[String(irLineIndex)]) {
            return sourceData.byIndex[String(irLineIndex)];
        }

        // Fallback matching by item and location
        for (var i = 0; i < sourceData.lines.length; i++) {
            var lineObj = sourceData.lines[i];

            if (lineObj.used) {
                continue;
            }

            if (String(lineObj.item) === String(item)) {
                if (
                    isEmpty(location) ||
                    isEmpty(lineObj.location) ||
                    String(lineObj.location) === String(location)
                ) {
                    return lineObj;
                }
            }
        }

        return null;
    }

    // --------------------------------------------------
    // INVENTORY STATUS MAPPING
    // --------------------------------------------------

    function getInventoryStatusByReason(returnReason) {
        if (String(returnReason) === GOOD_RETURN_REASON_ID) {
            return INVENTORY_STATUS_NEW;
        }

        return INVENTORY_STATUS_HOLD;
    }

    // --------------------------------------------------
    // RECEIVE / SKIP LINE
    // --------------------------------------------------

    function setCurrentLineReceive(irRec, receiveFlag) {
        safeSetCurrentSublistValue(irRec, 'item', 'itemreceive', receiveFlag);
    }

    function skipReceiptLine(irRec, lineIndex) {
        log.debug('Skipping Item Receipt Line', {
            irLine: lineIndex,
            reason: 'No return reason on matching RMA line'
        });

        safeSetCurrentSublistValue(irRec, 'item', 'itemreceive', false);

        // Safety only. If quantity cannot be set to 0, itemreceive=false is still enough.
        safeSetCurrentSublistValue(irRec, 'item', 'quantity', 0);
    }

    function getCurrentQuantity(irRec, fallbackQuantity) {
        var currentQty = safeGetCurrentSublistValue(irRec, 'item', 'quantity');

        if (!isEmpty(currentQty)) {
            return currentQty;
        }

        return fallbackQuantity;
    }

    // --------------------------------------------------
    // INVENTORY DETAIL STATUS
    // --------------------------------------------------

    function applyInventoryStatusToCurrentLine(irRec, inventoryStatusId, quantityToReceive) {
        try {
            var invDetail = null;

            try {
                invDetail = irRec.getCurrentSublistSubrecord({
                    sublistId: 'item',
                    fieldId: 'inventorydetail'
                });
            } catch (subErr) {
                log.debug('No Inventory Detail Subrecord', {
                    message: subErr.message,
                    note: 'This may be okay for non-inventory lines.'
                });
                return;
            }

            if (!invDetail) {
                log.debug('No Inventory Detail', 'Inventory Detail not available on this line.');
                return;
            }

            var assignCount = invDetail.getLineCount({
                sublistId: 'inventoryassignment'
            });

            if (assignCount > 0) {
                for (var a = 0; a < assignCount; a++) {
                    invDetail.selectLine({
                        sublistId: 'inventoryassignment',
                        line: a
                    });

                    safeSetCurrentInventoryAssignmentValue(invDetail, 'inventorystatus', inventoryStatusId);

                    var assignmentQty = safeGetCurrentInventoryAssignmentValue(invDetail, 'quantity');

                    if (isEmpty(assignmentQty) && !isEmpty(quantityToReceive)) {
                        safeSetCurrentInventoryAssignmentValue(invDetail, 'quantity', quantityToReceive);
                    }

                    invDetail.commitLine({
                        sublistId: 'inventoryassignment'
                    });
                }
            } else {
                invDetail.selectNewLine({
                    sublistId: 'inventoryassignment'
                });

                safeSetCurrentInventoryAssignmentValue(invDetail, 'inventorystatus', inventoryStatusId);

                if (!isEmpty(quantityToReceive)) {
                    safeSetCurrentInventoryAssignmentValue(invDetail, 'quantity', quantityToReceive);
                }

                invDetail.commitLine({
                    sublistId: 'inventoryassignment'
                });
            }

        } catch (e) {
            log.error('Inventory Status Apply Failed', {
                inventoryStatusId: inventoryStatusId,
                quantityToReceive: quantityToReceive,
                name: e.name,
                message: e.message
            });

            throw e;
        }
    }

    // --------------------------------------------------
    // CHECK EXISTING ITEM RECEIPT
    // --------------------------------------------------

    function hasExistingItemReceipt(rmaId) {
        try {
            var irSearch = search.create({
                type: search.Type.ITEM_RECEIPT,
                filters: [
                    ['createdfrom', 'anyof', rmaId],
                    'AND',
                    ['mainline', 'is', 'T']
                ],
                columns: [
                    search.createColumn({
                        name: 'internalid'
                    })
                ]
            });

            var resultSet = irSearch.run().getRange({
                start: 0,
                end: 1
            });

            if (resultSet && resultSet.length > 0) {
                return true;
            }

            return false;

        } catch (e) {
            log.error('Existing Item Receipt Check Failed', {
                rmaId: rmaId,
                name: e.name,
                message: e.message
            });

            return false;
        }
    }

    // --------------------------------------------------
    // ADMIN EMAIL NOTIFICATION
    // --------------------------------------------------

    function sendAdminNotification(rmaId, errorObj) {
        try {
            var recipientsParam = scriptObj.getParameter({
                name: PARAM_NOTIFY_RECIPIENTS
            });

            if (isEmpty(recipientsParam)) {
                log.debug('Admin Notification Skipped', 'No recipient parameter configured.');
                return;
            }

            var authorParam = scriptObj.getParameter({
                name: PARAM_EMAIL_AUTHOR
            });

            var authorId = authorParam || runtime.getCurrentUser().id;

            var recipients = String(recipientsParam).split(',');

            var subject = '[AM] RMA Auto Item Receipt Failed - RMA ID ' + rmaId;

            var body = '';
            body += 'RMA Auto Item Receipt creation failed.\n\n';
            body += 'RMA Internal ID: ' + rmaId + '\n\n';
            body += 'Error Name: ' + errorObj.name + '\n';
            body += 'Error Message: ' + errorObj.message + '\n\n';

            if (errorObj.stack) {
                body += 'Stack:\n' + errorObj.stack + '\n';
            }

            email.send({
                author: authorId,
                recipients: recipients,
                subject: subject,
                body: body
            });

            log.audit('Admin Notification Sent', {
                rmaId: rmaId,
                recipients: recipients
            });

        } catch (emailErr) {
            log.error('Admin Notification Failed', {
                rmaId: rmaId,
                name: emailErr.name,
                message: emailErr.message
            });
        }
    }

    // --------------------------------------------------
    // SAFE GET / SET HELPERS
    // --------------------------------------------------

    function safeGetSublistValue(recObj, sublistId, fieldId, line) {
        try {
            return recObj.getSublistValue({
                sublistId: sublistId,
                fieldId: fieldId,
                line: line
            });
        } catch (e) {
            return '';
        }
    }

    function safeGetCurrentSublistValue(recObj, sublistId, fieldId) {
        try {
            return recObj.getCurrentSublistValue({
                sublistId: sublistId,
                fieldId: fieldId
            });
        } catch (e) {
            return '';
        }
    }

    function safeSetCurrentSublistValue(recObj, sublistId, fieldId, value) {
        try {
            recObj.setCurrentSublistValue({
                sublistId: sublistId,
                fieldId: fieldId,
                value: value,
                ignoreFieldChange: true
            });
        } catch (e) {
            log.debug('Set Current Sublist Value Failed', {
                sublistId: sublistId,
                fieldId: fieldId,
                value: value,
                message: e.message
            });
        }
    }

    function safeGetCurrentInventoryAssignmentValue(invDetail, fieldId) {
        try {
            return invDetail.getCurrentSublistValue({
                sublistId: 'inventoryassignment',
                fieldId: fieldId
            });
        } catch (e) {
            return '';
        }
    }

    function safeSetCurrentInventoryAssignmentValue(invDetail, fieldId, value) {
        try {
            invDetail.setCurrentSublistValue({
                sublistId: 'inventoryassignment',
                fieldId: fieldId,
                value: value,
                ignoreFieldChange: true
            });
        } catch (e) {
            log.debug('Set Inventory Assignment Value Failed', {
                fieldId: fieldId,
                value: value,
                message: e.message
            });
        }
    }

    function isEmpty(value) {
        return value === null || value === '' || value === undefined;
    }

    return {
        afterSubmit: afterSubmit
    };
});