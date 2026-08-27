/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define([], () => {
    const saveRecord = (context) => {
        const rec = context.currentRecord;
        const errors = [];

        // Header validation
        if (!rec.getValue({ fieldId: 'shipdate' })) {
            errors.push('Header: Expected Ship Date is required.');
        }

        // Line validation
        const lineCount = rec.getLineCount({
            sublistId: 'item'
        });

        for (let i = 0; i < lineCount; i++) {
            const itemName = rec.getSublistText({
                sublistId: 'item',
                fieldId: 'item',
                line: i
            }) || 'Unknown Item';

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
            alert('Please enter the following required date fields:\n\n' + errors.join('\n'));
            return false;
        }

        return true;
    };

    return {
        saveRecord
    };
});