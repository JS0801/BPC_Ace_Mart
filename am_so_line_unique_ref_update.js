/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/log'], function (record, log) {

    function afterSubmit(context) {

        try {

            var newRec = context.newRecord;
            var recType = newRec.type;
            var recId = newRec.id;

            log.audit('SCRIPT STARTED', {
                eventType: context.type,
                recordType: recType,
                recordId: recId
            });

            if (
                context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.EDIT
            ) {
                log.audit('SKIPPED', 'Not create/edit event');
                return;
            }

            // Only run for Sales Order and Cash Sale
            if (
                recType !== record.Type.SALES_ORDER &&
                recType !== record.Type.CASH_SALE
            ) {
                log.audit('SKIPPED', 'Record type is not Sales Order or Cash Sale');
                return;
            }

            var tranRec = record.load({
                type: recType,
                id: recId,
                isDynamic: false
            });

            var lineCount = tranRec.getLineCount({
                sublistId: 'item'
            });

            log.audit('LINE COUNT', lineCount);

            var updated = false;

            for (var i = 0; i < lineCount; i++) {

                var lineUniqueKey = tranRec.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'lineuniquekey',
                    line: i
                });

                var existingValue = tranRec.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_so_line_ref',
                    line: i
                });

                log.debug('LINE CHECK', {
                    lineIndex: i,
                    lineUniqueKey: lineUniqueKey,
                    existingValue: existingValue
                });

                if (lineUniqueKey && !existingValue) {

                    tranRec.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_so_line_ref',
                        line: i,
                        value: String(lineUniqueKey)
                    });

                    updated = true;

                    log.audit('LINE UPDATED', {
                        lineIndex: i,
                        valueSet: lineUniqueKey
                    });
                }
            }

            if (updated) {

                var savedId = tranRec.save({
                    enableSourcing: false,
                    ignoreMandatoryFields: true
                });

                log.audit('RECORD SAVED', {
                    recordType: recType,
                    recordId: savedId
                });

            } else {
                log.audit('NO UPDATE NEEDED', 'All lines already have value');
            }

        } catch (e) {
            log.error('ERROR populating transaction line ref', {
                name: e.name,
                message: e.message,
                stack: e.stack
            });
        }
    }

    return {
        afterSubmit: afterSubmit
    };
});