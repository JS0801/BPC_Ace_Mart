/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/runtime', 'N/error', 'N/record'], (runtime, error, record) => {
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
const EXPECTED_SHIP_DATE_FIELD = 'expectedshipdate'; // Item-level field

const afterSubmit = (context) => {
    log.audit({
        title: 'Expected Ship Date UE Started',
        details: {
            eventType: context.type,
            salesOrderId: context.newRecord.id
        }
    });

    if (context.type !== context.UserEventType.EDIT) {
        log.debug({
            title: 'Skipping non-EDIT event',
            details: `Event type: ${context.type}`
        });
        return;
    }

    try {
        const soId = context.newRecord.id;

        const soRec = record.load({
            type: record.Type.SALES_ORDER,
            id: soId,
            isDynamic: false
        });

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const lineCount = soRec.getLineCount({
            sublistId: 'item'
        });

        let hasChanges = false;

        log.debug({
            title: 'Sales Order loaded',
            details: {
                salesOrderId: soId,
                lineCount,
                today
            }
        });

        for (let line = 0; line < lineCount; line++) {
            const itemId = soRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'item',
                line
            });

            const rawNeedByDate = soRec.getSublistValue({
                sublistId: 'item',
                fieldId: NEED_BY_FIELD,
                line
            });

            const existingShipDate = soRec.getSublistValue({
                sublistId: 'item',
                fieldId: EXPECTED_SHIP_DATE_FIELD,
                line
            });

            log.debug({
                title: `Processing line ${line + 1}`,
                details: {
                    salesOrderId: soId,
                    line: line + 1,
                    itemId,
                    rawNeedByDate,
                    existingShipDate
                }
            });

            if (!rawNeedByDate) {
                log.debug({
                    title: `Skipping line ${line + 1}: no Need By Date`,
                    details: {
                        salesOrderId: soId,
                        itemId
                    }
                });
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

                // Expected Ship Date = Need By Date minus 3 days.
                let calculatedShipDate = new Date(needByDate);
                calculatedShipDate.setDate(calculatedShipDate.getDate() - 3);
                calculatedShipDate.setHours(0, 0, 0, 0);

                const calculatedDateBeforeFloor = new Date(calculatedShipDate);

                // Never use a date before today.
                if (calculatedShipDate < today) {
                    calculatedShipDate = new Date(today);

                    log.debug({
                        title: `Line ${line + 1}: calculated date was in the past`,
                        details: {
                            salesOrderId: soId,
                            itemId,
                            needByDate,
                            calculatedDateBeforeFloor,
                            replacementShipDate: calculatedShipDate
                        }
                    });
                }

                let existingDate = null;

                if (existingShipDate) {
                    existingDate = existingShipDate instanceof Date
                        ? new Date(existingShipDate)
                        : format.parse({
                            value: existingShipDate,
                            type: format.Type.DATE
                        });

                    existingDate.setHours(0, 0, 0, 0);
                }

                if (
                    existingDate &&
                    existingDate.getTime() === calculatedShipDate.getTime()
                ) {
                    log.debug({
                        title: `Line ${line + 1}: Expected Ship Date already correct`,
                        details: {
                            salesOrderId: soId,
                            itemId,
                            needByDate,
                            existingShipDate: existingDate,
                            calculatedShipDate
                        }
                    });
                    continue;
                }

                soRec.setSublistValue({
                    sublistId: 'item',
                    fieldId: EXPECTED_SHIP_DATE_FIELD,
                    line,
                    value: calculatedShipDate
                });

                hasChanges = true;

                log.audit({
                    title: `Line ${line + 1}: Expected Ship Date set`,
                    details: {
                        salesOrderId: soId,
                        itemId,
                        needByDate,
                        previousShipDate: existingDate,
                        newShipDate: calculatedShipDate
                    }
                });
            } catch (lineError) {
                log.error({
                    title: `Line ${line + 1}: Unable to calculate Expected Ship Date`,
                    details: {
                        salesOrderId: soId,
                        itemId,
                        rawNeedByDate,
                        errorName: lineError.name,
                        errorMessage: lineError.message,
                        stack: lineError.stack
                    }
                });
            }
        }

        if (!hasChanges) {
            log.audit({
                title: 'Expected Ship Date UE Complete: no changes required',
                details: {
                    salesOrderId: soId
                }
            });
            return;
        }

        const savedSoId = soRec.save({
            enableSourcing: false,
            ignoreMandatoryFields: true
        });

        log.audit({
            title: 'Expected Ship Date UE Complete: Sales Order saved',
            details: {
                salesOrderId: savedSoId,
                updatedLines: true
            }
        });
    } catch (error) {
        log.error({
            title: 'Expected Ship Date UE Failed',
            details: {
                salesOrderId: context.newRecord.id,
                errorName: error.name,
                errorMessage: error.message,
                stack: error.stack
            }
        });
    }
};

    return {
        beforeSubmit, afterSubmit
    };
});