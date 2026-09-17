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
    const EXPECTED_SHIP_DATE_FIELD = 'shipdate'; // Standard SO Expected Ship Date

    const afterSubmit = (context) => {
        if (context.type != context.UserEventType.EDIT) return;

        try {
            const soRec = record.load({
                type: record.Type.SALES_ORDER,
                id: context.newRecord.id,
                isDynamic: false
            });

            const lineCount = soRec.getLineCount({ sublistId: 'item' });
            let earliestNeedByDate = null;

            for (let line = 0; line < lineCount; line++) {
                const rawNeedByDate = soRec.getSublistValue({
                    sublistId: 'item',
                    fieldId: NEED_BY_FIELD,
                    line
                });

                if (!rawNeedByDate) {
                    continue;
                }

                let needByDate;

                try {
                    needByDate = rawNeedByDate instanceof Date
                        ? new Date(rawNeedByDate)
                        : format.parse({
                            value: rawNeedByDate,
                            type: format.Type.DATE
                        });

                    needByDate.setHours(0, 0, 0, 0);

                    if (!earliestNeedByDate || needByDate < earliestNeedByDate) {
                        earliestNeedByDate = needByDate;
                    }
                } catch (parseError) {
                    log.error({
                        title: `Unable to parse Need By Date on line ${line + 1}`,
                        details: { rawNeedByDate, parseError }
                    });
                }
            }

            if (!earliestNeedByDate) {
                log.audit({
                    title: 'Expected Ship Date not set',
                    details: `Sales Order ${context.newRecord.id} has no valid Need By Date.`
                });
                return;
            }

            const expectedShipDate = new Date(earliestNeedByDate);
            expectedShipDate.setDate(expectedShipDate.getDate() - 3);

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // Do not set a ship date in the past.
            if (expectedShipDate < today) {
                expectedShipDate = today;
            }

            const existingShipDate = soRec.getValue({
                fieldId: EXPECTED_SHIP_DATE_FIELD
            });

            // Avoid an unnecessary second save / repeat processing.
            if (
                existingShipDate instanceof Date &&
                existingShipDate.getTime() === expectedShipDate.getTime()
            ) {
                return;
            }

            soRec.setValue({
                fieldId: EXPECTED_SHIP_DATE_FIELD,
                value: expectedShipDate
            });

            soRec.save({
                enableSourcing: false,
                ignoreMandatoryFields: true
            });

            log.audit({
                title: 'Sales Order Expected Ship Date updated',
                details: {
                    salesOrderId: context.newRecord.id,
                    needByDate: earliestNeedByDate,
                    expectedShipDate
                }
            });
        } catch (error) {
            log.error({
                title: 'Error setting Sales Order Expected Ship Date',
                details: error
            });
        }
    };

    return {
        beforeSubmit, afterSubmit
    };
});