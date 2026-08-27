/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define([], () => {

    const saveRecord = (context) => {
        const rec = context.currentRecord;

        // Header validation
        if (!rec.getValue({ fieldId: 'shipdate' })) {
            alert('Expected Ship Date is required at the Sales Order header level.');
            return false;
        }

        // Line validation
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
                alert(`Need By Date is required on line ${i + 1}.`);
                return false;
            }

            if (!expectedShipDate) {
                alert(`Expected Ship Date is required on line ${i + 1}.`);
                return false;
            }
        }

        return true;
    };

    return {
        saveRecord
    };
});