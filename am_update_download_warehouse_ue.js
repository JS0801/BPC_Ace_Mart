/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * Business Logic:
 * - If Sales Order Terms is POPULATED  -> no customer deposit required.
 *     custbody_am_deposit_paid_amount = SO Actual Bill Amount (total)
 *     custbody_am_so_remaining_amount = 0
 * - If Sales Order Terms is BLANK      -> deposit-driven flow (this script is
 *   also deployed on Customer Deposit CREATE/EDIT/DELETE).
 *     custbody_am_deposit_paid_amount = SUM of ALL Customer Deposits linked to the SO
 *     custbody_am_so_remaining_amount = Actual Bill Amount - total deposits paid
 * - custbody_a1wms_dnloadtowms is checked if Terms is populated OR at least
 *   one Customer Deposit exists for the SO.
 */
define(['N/record', 'N/search', 'N/log'], function (record, search, log) {

    var FIELD_DOWNLOAD_TO_WMS = 'custbody_a1wms_dnloadtowms';
    var FIELD_SO_REMAINING_AMOUNT = 'custbody_am_so_remaining_amount';
    var FIELD_SO_DEPOSIT_PAID_AMOUNT = 'custbody_am_deposit_paid_amount';

    // Actual bill amount source from Sales Order.
    // If "Actual Bill Amount" is a custom field, replace "total" with that field id.
    var FIELD_SO_ACTUAL_BILL_AMOUNT = 'total';

    function afterSubmit(context) {
        try {

            var triggerRec = context.newRecord || context.oldRecord;

            log.audit('SCRIPT START', {
                eventType: context.type,
                recordType: triggerRec ? triggerRec.type : '',
                recordId: triggerRec ? triggerRec.id : ''
            });

            if (
                context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.EDIT &&
                context.type !== context.UserEventType.DELETE
            ) {
                log.audit('SCRIPT EXIT', 'Not CREATE, EDIT, or DELETE');
                return;
            }

            var soId = null;
            var recordType = triggerRec.type;

            if (recordType === record.Type.SALES_ORDER) {

                if (context.type === context.UserEventType.DELETE) {
                    log.audit('SCRIPT EXIT', 'Sales Order delete skipped');
                    return;
                }

                soId = context.newRecord.id;

                log.debug('Triggered From Sales Order', {
                    salesOrderId: soId
                });

            } else if (recordType === record.Type.CUSTOMER_DEPOSIT) {

                if (context.type === context.UserEventType.DELETE) {

                    soId = context.oldRecord.getValue({
                        fieldId: 'salesorder'
                    });

                    log.debug('Triggered From Customer Deposit Delete', {
                        customerDepositId: context.oldRecord.id,
                        salesOrderId: soId
                    });

                } else {

                    soId = context.newRecord.getValue({
                        fieldId: 'salesorder'
                    });

                    log.debug('Triggered From Customer Deposit Create/Edit', {
                        customerDepositId: context.newRecord.id,
                        salesOrderId: soId
                    });
                }

                if (!soId) {
                    log.audit('SCRIPT EXIT', 'Customer Deposit is not linked with Sales Order');
                    return;
                }

            } else {
                log.audit('SCRIPT EXIT', {
                    reason: 'Unsupported record type',
                    recordType: recordType
                });
                return;
            }

            updateSalesOrderDownloadToWms(soId);

        } catch (e) {
            log.error('SCRIPT ERROR', {
                message: e.message,
                stack: e.stack
            });
        }
    }

    function updateSalesOrderDownloadToWms(soId) {
        try {

            var soRec = record.load({
                type: record.Type.SALES_ORDER,
                id: soId,
                isDynamic: false
            });

            var terms = soRec.getValue({
                fieldId: 'terms'
            });

            var termsPopulated = !!terms;

            // Single search call returns both "does a deposit exist" and
            // "total deposit amount across ALL deposits" for this SO.
            var depositSummary = getCustomerDepositSummary(soId);

            log.debug('Condition Values', {
                salesOrderId: soId,
                customerDepositExists: depositSummary.exists,
                depositCount: depositSummary.count,
                termsPopulated: termsPopulated
            });

            var shouldDownloadToWms = termsPopulated || depositSummary.exists;

            log.debug('Final Checkbox Value', {
                fieldId: FIELD_DOWNLOAD_TO_WMS,
                value: shouldDownloadToWms
            });

            var actualBillAmount = toNumber(soRec.getValue({
                fieldId: FIELD_SO_ACTUAL_BILL_AMOUNT
            }));

            var totalDepositPaidAmount;
            var remainingAmount;

            if (termsPopulated) {
                // Terms populated -> no deposit required.
                totalDepositPaidAmount = actualBillAmount;
                remainingAmount = 0;
            } else {
                // No terms -> deposit-driven flow, sum ALL customer deposits (multiple allowed).
                totalDepositPaidAmount = depositSummary.totalAmount;
                remainingAmount = roundAmount(actualBillAmount - totalDepositPaidAmount);
            }

            log.debug('Deposit Amount Calculation', {
                salesOrderId: soId,
                termsPopulated: termsPopulated,
                actualBillAmount: actualBillAmount,
                totalDepositPaidAmount: totalDepositPaidAmount,
                remainingAmount: remainingAmount
            });

            var needsUpdate = false;

            var currentDownloadToWms = soRec.getValue({
                fieldId: FIELD_DOWNLOAD_TO_WMS
            });

            if (currentDownloadToWms !== shouldDownloadToWms) {
                soRec.setValue({
                    fieldId: FIELD_DOWNLOAD_TO_WMS,
                    value: shouldDownloadToWms
                });
                needsUpdate = true;
            }

            var currentDepositPaidAmount = soRec.getValue({
                fieldId: FIELD_SO_DEPOSIT_PAID_AMOUNT
            });
          log.debug('currentDepositPaidAmount',currentDepositPaidAmount)

            if (!isSameAmount(currentDepositPaidAmount, totalDepositPaidAmount)) {
                soRec.setValue({
                    fieldId: FIELD_SO_DEPOSIT_PAID_AMOUNT,
                    value: totalDepositPaidAmount
                });
                needsUpdate = true;
            }

            var currentRemainingAmount = soRec.getValue({
                fieldId: FIELD_SO_REMAINING_AMOUNT
            });
            log.debug('currentRemainingAmount',currentRemainingAmount)
            if (!isSameAmount(currentRemainingAmount, remainingAmount)) {
                soRec.setValue({
                    fieldId: FIELD_SO_REMAINING_AMOUNT,
                    value: remainingAmount
                });
                needsUpdate = true;
            }

            if (!needsUpdate) {
                log.audit('SALES ORDER NOT UPDATED', {
                    salesOrderId: soId,
                    reason: 'All values are already correct',
                    downloadToWms: shouldDownloadToWms,
                    depositPaidAmount: totalDepositPaidAmount,
                    remainingAmount: remainingAmount
                });
                return;
            }

            var savedId = soRec.save({
                enableSourcing: false,
                ignoreMandatoryFields: true
            });

            log.audit('SALES ORDER UPDATED', {
                salesOrderId: savedId,
                downloadToWms: shouldDownloadToWms,
                depositPaidAmount: totalDepositPaidAmount,
                remainingAmount: remainingAmount
            });

        } catch (e) {
            log.error('Sales Order Update Error', {
                salesOrderId: soId,
                message: e.message,
                stack: e.stack
            });
        }
    }

    /**
     * Single optimized search using summary columns (COUNT + SUM) instead of
     * two separate searches with row-by-row .each() iteration. Handles
     * multiple Customer Deposits per Sales Order natively via SUM.
     */
    function getCustomerDepositSummary(soId) {
        var summary = {
            exists: false,
            count: 0,
            totalAmount: 0
        };

        try {

            log.debug('Customer Deposit Summary Search Start', {
                salesOrderId: soId
            });

            var depositSearch = search.create({
                type: search.Type.CUSTOMER_DEPOSIT,
                filters: [
                    ['salesorder', 'anyof', soId],
                    'AND',
                    ['mainline', 'is', 'T']
                ],
                columns: [
                    search.createColumn({
                        name: 'internalid',
                        summary: 'COUNT'
                    }),
                    search.createColumn({
                        name: 'amount',
                        summary: 'SUM'
                    })
                ]
            });

            var results = depositSearch.run().getRange({
                start: 0,
                end: 1
            });

            if (results && results.length > 0) {

                var count = toNumber(results[0].getValue({
                    name: 'internalid',
                    summary: 'COUNT'
                }));

                var sumAmount = toNumber(results[0].getValue({
                    name: 'amount',
                    summary: 'SUM'
                }));

                summary.count = count;
                summary.exists = count > 0;
                summary.totalAmount = roundAmount(sumAmount);
            }

            log.debug('Customer Deposit Summary Search End', {
                salesOrderId: soId,
                count: summary.count,
                totalAmount: summary.totalAmount
            });

        } catch (e) {
            log.error('Customer Deposit Summary Search Error', {
                salesOrderId: soId,
                message: e.message,
                stack: e.stack
            });
        }

        return summary;
    }

    function toNumber(value) {
        if (value == null || value == undefined || value == '' || value == 0 || value == '0.00') {
            return 0;
        }

        var cleanValue = String(value).replace(/,/g, '');
        var numberValue = parseFloat(cleanValue);

        if (isNaN(numberValue)) {
            return 0;
        }

        return numberValue;
    }

    function roundAmount(value) {
        return parseFloat(value).toFixed(2);
    }

    function isSameAmount(value1, value2) {
        if (value1 != value2) return true;
    }

    return {
        afterSubmit: afterSubmit
    };
});