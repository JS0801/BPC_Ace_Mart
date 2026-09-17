/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/runtime', 'N/error'], (runtime, error) => {
    const beforeSubmit = (context) => {
        // Run validation ONLY for CSV Import
        if (runtime.executionContext !== runtime.ContextType.CSV_IMPORT) {
            return;
        }

        const VALID_ITEM_TYPES = {
            Assembly: true,
            InvtPart: true,
            NonInvtPart: true,
            Service: true
        };

        const rec = context.newRecord;
        const errors = [];

        // Header validation
        if (!rec.getValue({ fieldId: 'shipdate' })) {
            errors.push('Header: Expected Ship Date is required.');
        }

        const lineCount = rec.getLineCount({
            sublistId: 'item'
        });

        for (let i = 0; i < lineCount; i++) {
            const itemName = rec.getSublistText({
                sublistId: 'item',
                fieldId: 'item',
                line: i
            });

            const itemType = rec.getSublistValue({
                sublistId: 'item',
                fieldId: 'itemtype',
                line: i
            });

            const needByDate = rec.getSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_ace_need_by_date',
                line: i
            });
            log.debug('needByDate', needByDate)
          
            if (!VALID_ITEM_TYPES[itemType]) continue;

            const expectedShipDate = rec.getSublistValue({
                sublistId: 'item',
                fieldId: 'expectedshipdate',
                line: i
            });

            const missingFields = [];

            if (!needByDate) {
                missingFields.push('Need By Date');
            }

            if (!expectedShipDate) {
                missingFields.push('Expected Ship Date');
            }

            if (missingFields.length > 0) {
                errors.push(
                    `Line ${i + 1} - ${itemName}: ${missingFields.join(', ')} is required.`
                );
            }
        }

        if (errors.length > 0) {
            throw error.create({
                name: 'MISSING_REQUIRED_DATE_FIELDS',
                message: 'Please enter the following required date fields:\n\n' + errors.join('\n')
            });
        }
    };


const NEED_BY_FIELD = 'custcol_ace_need_by_date';
const EXPECTED_SHIP_DATE_FIELD = 'expectedshipdate'; // Item-line field

const afterSubmit = (context) => {
    if (context.type !== context.UserEventType.EDIT) {
        return;
    }

    try {
        const soRec = record.load({
            type: record.Type.SALES_ORDER,
            id: context.newRecord.id,
            isDynamic: false
        });

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const lineCount = soRec.getLineCount({ sublistId: 'item' });
        let hasChanges = false;

        for (let line = 0; line < lineCount; line++) {
            const rawNeedByDate = soRec.getSublistValue({
                sublistId: 'item',
                fieldId: NEED_BY_FIELD,
                line
            });

            // Leave the Expected Ship Date unchanged when Need By is blank.
            if (!rawNeedByDate) {
                continue;
            }

            try {
                const needByDate = rawNeedByDate instanceof Date
                    ? new Date(rawNeedByDate)
                    : format.parse({
                        value: rawNeedByDate,
                        type: format.Type.DATE
                    });

                needByDate.setHours(0, 0, 0, 0);

                // Expected Ship Date = Need By Date minus 3 days,
                // never earlier than today.
                const expectedShipDate = new Date(needByDate);
                expectedShipDate.setDate(expectedShipDate.getDate() - 3);

                if (expectedShipDate < today) {
                    expectedShipDate.setTime(today.getTime());
                }

                const existingShipDate = soRec.getSublistValue({
                    sublistId: 'item',
                    fieldId: EXPECTED_SHIP_DATE_FIELD,
                    line
                });

                const existingDate = existingShipDate
                    ? new Date(existingShipDate)
                    : null;

                if (existingDate) {
                    existingDate.setHours(0, 0, 0, 0);
                }

                if (
                    existingDate &&
                    existingDate.getTime() === expectedShipDate.getTime()
                ) {
                    continue;
                }

                soRec.setSublistValue({
                    sublistId: 'item',
                    fieldId: EXPECTED_SHIP_DATE_FIELD,
                    line,
                    value: expectedShipDate
                });

                hasChanges = true;
            } catch (parseError) {
                log.error({
                    title: `Unable to set Expected Ship Date on line ${line + 1}`,
                    details: {
                        salesOrderId: context.newRecord.id,
                        rawNeedByDate,
                        parseError
                    }
                });
            }
        }

        if (!hasChanges) {
            return;
        }

        soRec.save({
            enableSourcing: false,
            ignoreMandatoryFields: true
        });

        log.audit({
            title: 'Sales Order line Expected Ship Dates updated',
            details: {
                salesOrderId: context.newRecord.id
            }
        });
    } catch (error) {
        log.error({
            title: 'Error setting Sales Order line Expected Ship Dates',
            details: error
        });
    }
};

    return {
        beforeSubmit, afterSubmit
    };
});