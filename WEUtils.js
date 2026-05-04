/**
 * WEUtils.js 
 * @NApiVersion 2.x
 * @NModuleScope TargetAccount
 */

define(['N/record', 'N/search', 'N/http', 'N/https', 'N/config', 'N/format', 'N/runtime'],

function (record, search, http, https, config, format, runtime) {

    /* Submits Download Queue (DLQ) Custom Record */
    function submitDlqRecord(recordType, idnum, action) {

        var dlqSearch = search.create({
            type: 'customrecord_a1wms_dnloadqueue',
            columns: ['internalid', 'custrecord_a1w_dlq_cstamp'],
            filters: [search.createFilter({ name: 'custrecord_a1w_dlq_docid', operator: search.Operator.IS, values: [idnum] }),
                      search.createFilter({ name: 'custrecord_a1w_dlq_doctype', operator: search.Operator.IS, values: [recordType] }),
                      search.createFilter({ name: 'custrecord_a1w_dlq_action', operator: search.Operator.IS, values: [action] })
            ]
        });

        var searchresults = new Array();

        dlqSearch.run().each(function (result) {
            searchresults.push(result);
        });

        if (searchresults.length > 0) { //&& searchresults[0].getValue('custrecord_a1w_dlq_cstamp')) {

            var searchresult = searchresults[0];

            var retry = 0;
            while (retry < 5) {
                var update = {
                    type: 'customrecord_a1wms_dnloadqueue', id: searchresult.id,
                    values: {
                        'custrecord_a1w_dlq_cstamp': null,
                        'custrecord_a1w_dlq_qstamp': null
                    }
                };
                var updateId = -1;
                try {
                    updateId = record.submitFields(update);  //Cost = 2
                    break;
                } catch (err) {
                    retry++;
                    log.debug({ title: 'Retry Update to DLQ ' + updateId, details: String(err) });
                }
            }
            return true;
        }

        var cinfo = config.load({ type: config.Type.COMPANY_INFORMATION }); //Cost = 10  

        var dlqRecord = record.create({ type: 'customrecord_a1wms_dnloadqueue' });
        dlqRecord.setValue({ fieldId: 'custrecord_a1w_dlq_docid', value: idnum });
        dlqRecord.setValue({ fieldId: 'custrecord_a1w_dlq_doctype', value: recordType });
        dlqRecord.setValue({ fieldId: 'custrecord_a1w_dlq_action', value: action });
        dlqRecord.setValue({ fieldId: 'custrecord_a1w_dlq_qstamp', value: format.format({ value: new Date(), type: 'DATETIMETZ', timezone: cinfo.getValue('timezone') }) });

        if (action != 'Delete') {
            if (recordType.indexOf('item') > -1) {
                dlqRecord.setValue({ fieldId: 'custrecord_a1w_dlq_item', value: idnum });
            }
            else {
                dlqRecord.setValue({ fieldId: 'custrecord_a1w_dlq_trans', value: idnum });
            }
        }

        log.debug('dlqRecord', JSON.stringify(dlqRecord));

        return dlqRecord.save(); //Cost = 4
    }

    /* Sends download command JSON to IF WCF endpoint */
    function requestDownload(internalId, recordType, action) {

        var output = '';
        var a1wIntParams = null;
        var endpointField = null;

        try { a1wIntParams = record.load({ type: 'customrecord_a1wms_params', id: '1' }); } //Cost = 2
        catch (err) {
            log.debug('Integration Params Lookup Error', err.message);
            return 1;
        }

        try { endpointField = a1wIntParams.getValue({ fieldId: 'custrecord_a1wms_int_wcf_endpoint' }); }
        catch (err) {
            log.debug('Integration Params Lookup Error', err.message);
            return 1;
        }

        if (!endpointField) {
        	log.debug('Download was not started - Please check Debug log for ScriptDeployment customrecord_a1wms_params');
        	return 1;
        }
        else {
            var queryString = String(endpointField + 'HandleEvent');

            var postHeaders = new Array();
            postHeaders['Content-Type'] = 'application/json';
            var postData = {}; //evidently this needs to be {} object not [] array
            postData['recordType'] = recordType;
            postData['internalId'] = internalId;
            postData['action'] = action;
            postData['account'] = runtime.accountId;

            output = 'JSON Sent: ' + JSON.stringify(postData) + '\n\n';
            try {
                var postBody = { url: queryString, body: JSON.stringify(postData), headers: postHeaders };
                var clientResponse = queryString.indexOf('https') > -1 ? https.post(postBody) : http.post(postBody); //Cost = 10
                output += 'Code: ' + clientResponse.code + '\n';
                output += 'Headers:\n';
                output += ': ' + JSON.stringify(clientResponse.headers) + '\n';
                output += '\n\nBody:\n\n';
                output += clientResponse.body;

                //log.debug('Warehouse Edge WCF Call', '\n' + output);
            }
            catch (err) {
                log.debug('Warehouse Edge WCF Call Failed', err + '\n' + output);
                return 1;
            }
            return 0;
        }
        return 1;
    }

    return {
        submitDlqRecord: submitDlqRecord,
        requestDownload: requestDownload
    };

});
