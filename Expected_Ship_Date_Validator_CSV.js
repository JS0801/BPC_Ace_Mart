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

        const rec = context.newRecord;

        // Header Expected Ship Date
        if (!rec.getValue({ fieldId: 'shipdate' })) {
            throw error.create({
                name: 'MISSING_EXPECTED_SHIP_DATE',
                message: 'Expected Ship Date is required at the Sales Order header level.'
            });
        }

        const lineCount = rec.getLineCount({
            sublistId: 'item'
        });

        for (let i = 0; i < lineCount; i++) {

            const needByDate = rec.getSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_ace_need_by_date',
                line: i
            });

            const expectedShipDate = rec.getSublistValue({
                sublistId: 'item',
                fieldId: 'expectedshipdate',
                line: i
            });

            if (!needByDate) {
                throw error.create({
                    name: 'MISSING_NEED_BY_DATE',
                    message: `Need By Date is required on line ${i + 1}.`
                });
            }

            if (!expectedShipDate) {
                throw error.create({
                    name: 'MISSING_EXPECTED_SHIP_DATE',
                    message: `Expected Ship Date is required on line ${i + 1}.`
                });
            }
        }
    };

    return { beforeSubmit };
});