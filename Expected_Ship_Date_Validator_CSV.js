/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/runtime', 'N/error'], (runtime, error) => {
    const beforeSubmit = (context) => {
        // Run validation ONLY for CSV Import
        if (runtime.executionContext !== runtime.ContextType.CSV_IMPORT) {
           // return;
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

    return {
        beforeSubmit
    };
});