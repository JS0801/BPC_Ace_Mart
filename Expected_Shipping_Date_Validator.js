/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define([], () => {
    const VALID_ITEM_TYPES = {
        Assembly: true,
        InvtPart: true,
        NonInvtPart: true,
        Service: true
    };

    const validateLine = (context) => {
        if (context.sublistId !== 'item') {
            return true;
        }

        const rec = context.currentRecord;

        const itemType = rec.getCurrentSublistValue({
            sublistId: 'item',
            fieldId: 'itemtype'
        });

        if (!VALID_ITEM_TYPES[itemType]) {
            return true;
        }

        const missingFields = [];

        const needByDate = rec.getCurrentSublistValue({
            sublistId: 'item',
            fieldId: 'custcol_ace_need_by_date'
        });

        const expectedShipDate = rec.getCurrentSublistValue({
            sublistId: 'item',
            fieldId: 'expectedshipdate'
        });

        if (!needByDate) {
            missingFields.push('Need By Date');
        }

        if (!expectedShipDate) {
            missingFields.push('Expected Ship Date');
        }

        if (missingFields.length > 0) {
            alert(`Please enter date in the following field(s): ${missingFields.join(', ')}.`);
            return false;
        }

        return true;
    };

    return {
        validateLine
    };
});