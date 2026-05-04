/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define([
    'N/record',
    'N/search',
    'N/runtime'
], function (record, search, runtime) {


    const CONTROLLER_ROLE = 1416;
    const ADMINISTRATOR_ROLE = 3;

    function beforeSubmit(context) {
        try {

            if (context.type != context.UserEventType.CREATE) return;

            var newRec = context.newRecord;

            var customerId = newRec.getValue('entity');
            var subsidiaryId = newRec.getValue('subsidiary');
            var orderTotal = parseFloat(newRec.getValue('total')) || 0;

            if (!customerId || !subsidiaryId) return;

            // -------------------------------------------------------
            // 1. Get Credit Limit Field for this subsidiary
            // -------------------------------------------------------
            var creditLimitFieldId = getCreditLimitField(subsidiaryId);
            var creditLimitData = getCustomerCreditLimit(customerId, creditLimitFieldId);

            var creditLimit = creditLimitData.creditLimit;
            var creditLimitHold = creditLimitData.creditLimitHold;

            if (!creditLimit) return;

            // -------------------------------------------------------
            // 2. Get Customer Open Balance for this subsidiary
            // -------------------------------------------------------
            var openBalance = runSubsidiaryCreditSearch(customerId, subsidiaryId);

            // -------------------------------------------------------
            // 3. Calculate available credit
            // -------------------------------------------------------
            var projectedBalance = openBalance + orderTotal;
            var overageAmount = projectedBalance - creditLimit;

            // Reset field by default
            newRec.setValue({
                fieldId: 'custbody_am_credit_limit_violation',
                value: false
            });

            // --------------------------
            // 4. VALIDATION LOGIC
            // --------------------------
            if (overageAmount > 0 || creditLimitHold) {

                newRec.setValue({
                    fieldId: 'custbody_am_credit_limit_violation',
                    value: true
                });

                // ---------------------------------------------------
                // If user CANNOT override → Set status to Pending Approval
                // ---------------------------------------------------
                if (!canOverrideCredit(runtime.getCurrentUser())) {
                    newRec.setValue({
                        fieldId: 'orderstatus',
                        value: 'A' // Pending Approval
                    });
                }
            }

        } catch (err) {
            log.error("UE beforeSubmit Error", err);
        }
    }

    // ----------------------
    // Helper Functions
    // ----------------------
    function getCreditLimitField(subsidiaryId) {
        var fieldMap = {
            "1": "custentity_am_credit_limit",
            "3": "custentity_am_credit_limit",
            "4": "custentity_am_credit_limit",
            "11": "custentity_am_credit_limit",
            "10": "custentity_am_credit_limit",
            "8": "custentity_adi_credit_limit",
            "13": "custentity_adi_credit_limit",
            "12": "custentity_adi_credit_limit",
            "9": "custentity_rn_credit_limit",
            "2": "custentity_spi_credit_limit"
        };
        return fieldMap[subsidiaryId];
    }

    function getCustomerCreditLimit(customerId, creditField) {
        try {
            if (!customerId || !creditField) {
                log.debug("Missing data", { customerId: customerId, creditField: creditField });
                return 0;
            }

            var customerSearch = search.create({
                type: "customer",
                filters: [
                    ["internalid", "anyof", customerId]
                ],
                columns: [
                    search.createColumn({ name: creditField }),
                    search.createColumn({ name: 'custentity_am_cred_lim_hold' })
                ]
            });

            var result = customerSearch.run().getRange(0, 1);

            if (!result || !result[0]) {
                return 0;
            }

            var creditLimit = result[0].getValue(creditField);
            var creditLimitHold = result[0].getValue('custentity_am_cred_lim_hold');

            log.debug('creditLimit', creditLimit);
            log.debug('creditLimitHold', creditLimitHold);

            return {
                creditLimit: parseFloat(creditLimit) || 0,
                creditLimitHold: creditLimitHold
            }
        } catch (error) {
            log.debug('error', error);
        }
    }

    function runSubsidiaryCreditSearch(customerId, subsidiaryId) {
        var openBalance = 0;

        var transactionSearchObj = search.create({
            type: "transaction",
            settings: [{ name: "consolidationtype", value: "ACCTTYPE" }],
            filters: [
                ["type", "anyof", "CustCred", "Deposit", "CustDep", "CustInvc"],
                "AND",
                ["status", "anyof", "CustCred:A", "CustDep:A", "CustInvc:A"],
                "AND",
                ["mainline", "is", "T"],
                "AND",
                ["subsidiary", "anyof", subsidiaryId],
                "AND",
                ["entity", "anyof", customerId]
            ],
            columns: [
                search.createColumn({
                    name: "formulacurrency",
                    summary: "SUM",
                    formula: "CASE WHEN {type} LIKE '%Credit%' OR {type} LIKE '%Deposit%' THEN {amountremaining} * -1 ELSE {amountremaining} END"
                })
            ]
        });

        var result = transactionSearchObj.run().getRange({ start: 0, end: 1 });

        if (result && result.length > 0) {
            openBalance = parseFloat(result[0].getValue({ name: "formulacurrency", summary: "SUM" })) || 0;
        }

        return openBalance;
    }

    function canOverrideCredit(user) {
        if (user.role == CONTROLLER_ROLE) return true;

        return false;
    }

    function beforeLoad(scriptContext) {
        if (scriptContext.type === scriptContext.UserEventType.VIEW) {
            handleFsmErrorUI(scriptContext);
        }
    }

    function handleFsmErrorUI(scriptContext) {
        try {
            var newRec = scriptContext.newRecord;
            var fsmError = newRec.getValue('custbody_am_fsm_error');

            if (fsmError) {
                scriptContext.form.addPageInitMessage({
                    type: 'ERROR',
                    title: 'FSM Automation Error',
                    message: fsmError
                });
            }
        } catch (e) {
            log.error('Error in handleFsmErrorUI', e);
        }
    }

    return {
        beforeLoad: beforeLoad,
        beforeSubmit: beforeSubmit
    };
});
