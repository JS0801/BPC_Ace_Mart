/**
 * @NApiVersion 2.x
 * @NScriptType workflowactionscript
 */
define(['./WEUtils'],

function (WEUtils) {

    /**
     * Definition of the Suitelet script trigger point.
     *
     * @param {Object} scriptContext
     * @param {Record} scriptContext.newRecord - New record
     * @param {Record} scriptContext.oldRecord - Old record
     * @Since 2016.1
     */
    function onAction(scriptContext) {
    	
        var recordType = scriptContext.newRecord.type.toLowerCase();
        var idnum = scriptContext.newRecord.id;
        var action = 'Delete';
        
        if (!idnum || idnum == -1) {  //Bug 84954
        	log.debug('exiting - idnum: ' + idnum, 'orderstatus: ' + scriptContext.newRecord.getValue({ fieldId: 'orderstatus' }));
            return;
        }

        log.debug('Delete record ' + idnum, 'Status: ' + scriptContext.newRecord.getValue({ fieldId: 'status' }));

        /** Submit Download Queue Record **/
        var dlqId = WEUtils.submitDlqRecord(recordType, String(idnum), action);

        var dnloadResult = WEUtils.requestDownload(String(idnum), scriptContext.newRecord.type, action);

    }

    return {
        onAction: onAction
    };

});
