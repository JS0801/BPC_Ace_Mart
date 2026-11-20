/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */

define(['N/search', 'N/record', 'N/runtime', 'N/log'],
    (search, record, runtime, log) => {


        const INPUT_FIELD_MAPPING = {
            customer: "entity",
            case: "supportcase",
            asset: "custevent_nx_task_asset",
            project: "custevent_nx_project",
            technician: "assigned"
        }

        const getInputData = () => {

            try {
                const irId = runtime.getCurrentScript().getParameter({
                    name: 'custscript_am_ir_id'
                });

                log.debug('irId', irId);

                return search.create({
                    type: "itemreceipt",
                    filters: [
                        ["internalid", "anyof", irId],
                        "AND",
                        ["createdfrom.type", "anyof", "RtnAuth"],
                        "AND",
                        ["mainline", "is", "T"],
                        "AND",
                        ["createdfrom.custbody_am_rma_service_type", "anyof", "1"]
                    ],
                    columns: [
                        "internalid",
                        "tranid",
                        "trandate",
                        "createdfrom",
                        search.createColumn({
                            name: "tranid",
                            join: "createdFrom"
                        }),
                        search.createColumn({
                            name: "createdfrom",
                            join: "createdFrom"
                        }),
                        search.createColumn({
                            name: "custbody_am_related_case",
                            join: "createdFrom"
                        })
                    ]
                });
            } catch (error) {
                log.debug('error', error);
            }

        };

        const map = (context) => {

            try {

                const result = JSON.parse(context.value);

                const irId = result.values.internalid.value;
                const irTranId = result.values.tranid;
                const raId = result.values.createdfrom.value;
                const raTranId = result.values["tranid.createdFrom"];
                const irDate = result.values.trandate;
                const soField = result.values["createdfrom.createdFrom"];
                const salesOrderId = soField ? soField.value : null;

                const caseField = result.values["custbody_am_related_case.createdFrom"];
                let caseId = null;
                if (caseField) {
                    caseId = typeof caseField === 'object' ? caseField.value : caseField;
                }

                if (!caseId && salesOrderId) {
                    const supportcaseSearchObj = search.create({
                        type: "supportcase",
                        filters: [
                            ["stage", "anyof", "OPEN", "ESCALATED"],
                            "AND",
                            ["custevent_am_orig_sales_trans", "anyof", salesOrderId]
                        ],
                        columns: [
                            search.createColumn({ name: "internalid" }),
                            search.createColumn({ name: "casenumber", label: "Number" })
                        ]
                    });

                    const caseResults = supportcaseSearchObj.run().getRange({ start: 0, end: 1 });
                    if (caseResults && caseResults.length > 0) {
                        caseId = caseResults[0].id;
                    }
                }

                const irRec = record.load({
                    type: record.Type.ITEM_RECEIPT,
                    id: irId
                });

                // Duplicate prevention
                const taskCreated = irRec.getValue("custbody_am_fsm_task_created");
                if (taskCreated) {
                    log.debug("FSM Task Already Created", irId);
                    return;
                }

                const createdFromSo = irRec.getValue("custbody_am_created_frrom_so");

                let finalSoId = salesOrderId || createdFromSo;

                // If the ID we found is an Item Fulfillment, try to get its parent Sales Order
                if (finalSoId) {
                    const lookup = search.lookupFields({
                        type: 'transaction',
                        id: finalSoId,
                        columns: ['type', 'createdfrom']
                    });

                    // If it's an Item Fulfillment (itemfulfillment), get its createdfrom
                    if (lookup.type && lookup.type[0] && lookup.type[0].value === 'itemfulfillment') {
                        if (lookup.createdfrom && lookup.createdfrom[0]) {
                            finalSoId = lookup.createdfrom[0].value;
                            log.debug("Found SO from IF", finalSoId);
                        }
                    }
                }

                log.debug("Processing IR", {
                    irId: irId,
                    caseId: caseId,
                    finalSoId: finalSoId
                });

                let customer = irRec.getValue("entity");
                let technician = null;
                let asset = null;
                let project = null;

                // -----------------------
                // Load Support Case
                // -----------------------

                if (caseId) {

                    const caseRec = record.load({
                        type: record.Type.SUPPORT_CASE,
                        id: caseId
                    });

                    customer = caseRec.getValue("company") || customer;
                    technician = caseRec.getValue("assigned");
                    asset = caseRec.getValue("asset");
                    project = caseRec.getValue("custevent_nx_project");

                } else {
                    log.debug('Case not found', irId);
                    return;
                }

                const lineCount = irRec.getLineCount({ sublistId: 'item' });

                for (let i = 0; i < lineCount; i++) {

                    const itemId = irRec.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'item',
                        line: i
                    });

                    const qty = irRec.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'quantity',
                        line: i
                    });

                    if (!itemId) continue;

                    log.debug("Task Creation Logger", {
                        customer,
                        caseId,
                        asset,
                        project,
                        technician,
                        irId,
                        raId,
                        irDate,
                        itemId,
                        qty
                    });

                    createFSMTask({
                        customer,
                        caseId,
                        asset,
                        project,
                        technician,
                        irId,
                        irTranId,
                        raId,
                        raTranId,
                        irDate,
                        itemId,
                        qty,
                        createdFromSo: finalSoId
                    });

                }

                // Mark IR as processed
                record.submitFields({
                    type: record.Type.ITEM_RECEIPT,
                    id: irId,
                    values: {
                        custbody_am_fsm_task_created: true
                    }
                });

                log.debug("IR Processed Successfully", irId);

            } catch (e) {

                log.error("Map Error", e);

            }

        };

        const createFSMTask = (data) => {

            try {

                const scriptObj = runtime.getCurrentScript();
                const TASK_TYPE_SERVICE = scriptObj.getParameter({ name: 'custscript_task_service_type' });
                const TASK_FORM = scriptObj.getParameter({ name: 'custscript_task_form' });
                const TASK_STATUS_NOT_STARTED = scriptObj.getParameter({ name: 'custscript_task_status' });

                const task = record.create({
                    type: "task",
                    isDynamic: true,
                    defaultValues: {
                        customform: TASK_FORM
                    }
                });

                task.setValue({
                    fieldId: "title",
                    value: 'Service - RMA# ' + (data.raTranId || data.raId)
                });

                // Customer
                if (data.customer) {
                    const customerId = Number(data.customer);
                    task.setValue({
                        fieldId: "company",
                        value: customerId
                    });

                    try {
                        task.setValue({
                            fieldId: "custevent_nx_customer",
                            value: customerId
                        });
                    } catch (e) {
                        log.debug("Notice: Could not explicitly set custevent_nx_customer", e.message);
                    }
                }

                // Support Case
                if (data.caseId) {
                    task.setValue({
                        fieldId: INPUT_FIELD_MAPPING.case,
                        value: data.caseId
                    });
                }

                // Asset
                if (data.asset) {
                    task.setValue({
                        fieldId: INPUT_FIELD_MAPPING.asset,
                        value: data.asset
                    });
                }

                // Project
                if (data.project) {
                    task.setValue({
                        fieldId: INPUT_FIELD_MAPPING.project,
                        value: data.project
                    });
                }

                // Assigned Technician
                if (data.technician) {
                    task.setValue({
                        fieldId: INPUT_FIELD_MAPPING.technician,
                        value: data.technician
                    });
                }

                // Start Date (Item Receipt Date)
                task.setValue({
                    fieldId: "startdate",
                    value: new Date(data.irDate)
                });

                // Status
                task.setValue({
                    fieldId: "status",
                    value: TASK_STATUS_NOT_STARTED
                });

                // Task Type
                task.setValue({
                    fieldId: "custevent_nx_task_type",
                    value: TASK_TYPE_SERVICE
                });

                // Originating RA
                task.setValue({
                    fieldId: "custevent_am_originating_return_authori",
                    value: data.raId
                });

                // Originating IR
                task.setValue({
                    fieldId: "custevent_am_originating_item_receipt",
                    value: data.irId
                });

                // Item
                task.setValue({
                    fieldId: "relateditem",
                    value: data.itemId
                });

                // Original Sales Transaction
                // We set this LAST to ensure it is not overwritten by auto-sourcing from Company or Case
                if (data.createdFromSo) {
                    log.debug("Setting Original Sales Transaction", data.createdFromSo);
                    task.setValue({
                        fieldId: "custevent_ace_orig_sales_transaction",
                        value: data.createdFromSo
                    });
                }

                const taskId = task.save({
                    enableSourcing: false,
                    ignoreMandatoryFields: true
                });

                // Final Insurance: Use submitFields to overwrite any User Event logic that might have triggered on save
                if (data.createdFromSo) {
                    try {
                        record.submitFields({
                            type: "task",
                            id: taskId,
                            values: {
                                "custevent_ace_orig_sales_transaction": data.createdFromSo
                            },
                            options: {
                                enableSourcing: false,
                                ignoreMandatoryFields: true
                            }
                        });
                        log.debug("Final submitFields update successful", taskId);
                    } catch (submitErr) {
                        log.debug("Notice: Final submitFields failed", submitErr.message);
                    }
                }

                log.debug("FSM Task Created", taskId);

            } catch (e) {

                log.error("FSM Task Creation Error", e);
                throw e;

            }

        };

        return {
            getInputData,
            map
        };

    });