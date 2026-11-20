/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */

define(['N/task', 'N/log'], (task, log) => {

    const afterSubmit = (context) => {
        try {

            if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT) return;

            const rec = context.newRecord;
            const irId = rec.id;

            log.debug("Item Receipt Created", irId);

            const mrTask = task.create({
                taskType: task.TaskType.MAP_REDUCE,
                scriptId: 'customscript_am_item_receipt_fsm_mr',
                deploymentId: 'customdeploy_am_item_receipt_to_fsm',
                params: {
                    custscript_am_ir_id: irId
                }
            });

            const taskId = mrTask.submit();

            log.debug("MR Task Submitted", taskId);

        } catch (e) {
            log.error("UE Error", e);
        }
    };

    return { afterSubmit };

});