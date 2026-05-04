/**
 * @NApiVersion 2.0
 * @NScriptType UserEventScript
 * @NModuleScope Public
 */
/**
 * Suitetax V3.4.2
 * VertexTransactionUE2.js 
 * 
 * Module Description: 
 * vertexBeforeLoad
 *      Reset Vertex Related fields on Copy
 * vertexBeforeSubmit
 *      Set Nexus based on ship address/location/subsidiary ship address if it is associated associated to the entity subsidiary
 * afterSubmit 
 *      Link Vertex Call details record 
 *      CUT implementation on Vendor Bill 
 *      Post Accrual Request for Vendor Payment 
 *      Source Purchase Class on PO's created from Blanket PO's; beforeSubmit won't trigger, so use aftersubmit
 * 
 * Version  Date        Author  Remarks
 * 1.00     8/10/2017   IA      Initial release. 
 * 1.02     11/18/2019  HH      CNSAPI-62 - fix CUT action and thresholds
 * 1.03     11/18/2019  HH      CNSAPI-64 - fix currency issue
 * 1.04     11/19/2019  HH      CNSAPI-66 - fix mapping for vendor administrative origin and physical origin and buyer admin dest
 * 1.05     01/20/2020  IA      CNSAPI-75 CUTimplementation Error Please enter value(s) for: Supplier. Set ignoreMandatoryFields and add make mandatory field as sourced field
 * 1.05     01/20/2020  IA      CNSAPI-75 JE's being created for $0 - Do not create Journal if the accrual request is returning 0 tax
 * 1.06     01/20/2020  IA      CNSAPI-Set Nexus based on ship address/location/subsidiary ship address
 * 1.07     06/12/2020  IA      Update convertCountry function to not default NA for countries other than US and CA 
 * 1.08     06/19/2020  IA      V2.2 CNSAPI-84 Apply CUTimplementation logic to Bill Credit 
 * 1.09     06/19/2020  IA      V2.2 CNSAPI-85 Do not set the Nexus if the Nexus based on ship address is not associated to the entity subsidiary
 * 1.10     08/11/2020  IA      V2.2 CNSAPI Extend the logic for overriding the Nexus to edit as well.
 * 1.11     09/25/2020  IA      V2.2 CNSAPI-93 Handle To Be Generated/blank tranid on posting transactions; 
 *                              Post InvoiceRequest with tranid on aftersubmit on relevant documents.
 * 1.12     10/10/2020  IA      V2.2 Use URL from Subsidiary 
 * 1.14     12/07/2020  IA      V2.3.0 CNSAPI-133 Source Product Class on Purchase Orders created from Blanket POs - beforeSubmit won't trigger, so update on aftersubmit.
 * 1.15     04/01/2021  IA      V2.4.0 Support Token Based Authentication
 * 1.16     05/10/2021  IA      V2.4.0 CNSAPI-58 Distribute tax functionality 
 * 1.17     05/10/2021  IA      V2.4.0 CNSAPI-768 Tax Only Adjustment
 * 1.18     09/09/2021  IA      V2.5.0 CNSAPI-1101 Post negative request on deleting posting transactions
 * 1.19     10/08/2001  IA      V2.6.0 RQ-66083 CNSAPI-1208 Distribute Tax message should include Extended Price
 * 1.20     02/22/2021  IA      V2.6.1 CORST-173 Currency enhancement   
 * 1.21     03/04/2022  IA      V2.7.0 CORST-163 Support address latitude and longitude   
 * 1.22     03/16/2022  HH      v2.7.0 CORST-194 fix distribute tax, line item discount
 * 1.23     06/06/2022  IA      V2.8.0 CORST-493 New logic to handle Pay Vendor tax, set action as Pay Vendor Tax 
 *                                      and set the flag custbody_add_vendor_tax_vt so plugin can split the Vendor tax across items
 * 1.24     08/22/2022 IA       V2.8.1 CORST-493 Handle use case - Pay Vendor Tax and Vendor tax is 0, 
 *                                  Get the Vertex tax from the usertaxtotal field instead of custbody_vertex_tax_vt
 *                                  Remove adjustment item on copy and create
 * 1.25     08/24/2022 IA       V2.8.2 CORST-493 Handle use case - Pay & Accrue and Within Threshold
 *                                  and set action as Within Threshold and set the flag custbody_add_vendor_tax_vt so plugin can split the Vendor tax across items
 * 1.25     09/29/2022 IA       V3.00 support suitescript 1.0 and 2.0 - if addVendorTaxFlag value is 'T', set the flag to true 
 * 1.26     10/13/2022 IA       V2.8.4 RQ-85327 Fix Accrual issue in after submit, get the Vertex tax from custbody_vertex_tax_vt, not usertaxtotal, no afterSubmit needed for Pay Vendor Tax 
 * 1.26     10/13/2022 IA       Remove getText reference from getAssociatedBillsData
 * 1.27     10/15/2022 HH       V3.1.0 Support REST call to Vertex
 * 1.28     11/03/2022 SS       CORST-704 Added Vertex Disable CUT field Condition from the subsidiary record level
 * 1.29     11/03/2022 SP       CORST-439 Included new test company code field id on few functions
 * 1.30     11/29/2022 IA       V3.1.0 Redesign Accrual process to not use custbody_add_vendor_tax_vt flag
 *                              plugin - add code to set the CUT fields 
 *                              beforeSubmit - remove Accrual logic
 *                              afterSubmit - add/remove adjustment item on relevant scenario, RQ-86899
 * 1.31     12/28/2022  IA      V3.1.0 RQ-88718 Set Nexus based on the location from the first expense/item line 
 * 1.32     01/30/2023  IA      V3.1.2 RQ-90584 CORST-1241 If the customer decides to Disable CUT, no tax call on purchase side  
 * 1.33		03/22/2023	SS		V3.1.3 CORST-1123 DPP DEV: Code Change, DPPAPPLIED
 * 1.34     05/02/2023  IA      V3.3.0 RQ-96193/CORST-1623 Resolve Mass Update error
 * 1.35     05/12/2023  IA      V3.3.0 RQ-96895/CORST-1637 Purchase Orders from Blanket Purchase Orders should populate Product Class trigger SourceProductClass for context.type orderitems
 * 1.36     05/31/2023  IA      V3.3.0 RQ-97600/CORST-1708 Cannot call method "getValue" of undefined error on Credit Memo with a description item
 * 1.37     07/24/2023  IA      V3.3.0 RQ-96895 Ignore mandatory fields on SourceProductClass, trigger updateVertexCallDetails for context.type orderitems
 * 1.38     07/31/2023  IA      RQ-100329 post Negative request only if the original request is a success.
 * 1.39     08/04/2023  IA      RQ-98099/CORST-1990 SSS_USAGE_LIMIT_EXCEEDED replace load API's with one search.
 * 1.40		08/24/2023	IA 		V3.4.0 CORST-1606 Enhancement - Add "Pay No Vendor Tax and Accrue" to VT CUT Tax Action list
 * 1.48     09/09/2023	IA 		V3.4.0 Add do not call vertex checkbox.
 * 1.49     09/25/2023	IA 		V3.4.0 Fix issue with Pay & Accrue scenario.
 * 1.50     09/26/2023  HH      V3.4.0 Fix issue, tax adjustment won't resend 
 * 1.51		9/28/2023	SS		V3.4.0 CORST-2047 flex fields missing with Distribute tax request
 * 1.52		03/14/2024	SS		V3.4.1 CORST-2921 SuiteTax: Tax Only Adjustment credit doesn't update the transaction record with a new address
 * 1.53		03/26/2024	SP		V3.4.1 CORST-2941 SuiteTax: TaxOnlyAdjustmentIndicator Issue in XML Requests
 * 1.54		04/26/2024	SS		V3.4.1 RQ-114896 Nine Energy Service, Inc. - Suitetax API 3.4.0 - Error when applying credit to vendor bill with CUT disabled
 * 1.55		04/26/2024	SS		V3.4.1 RQ-115566 Mike Albert Leasing Inc. - Do Not Call Vertex creates an error - Netsuite Suitetax API 3.4.0
 * 1.56     03/05/2024  SP      CORST-3093 AccrualProcess Error FIELD_1_IS_NOT_A_SUBRECORD_FIELD, message: Field billingaddress is not a subrecord field.
 * 1.57		05/23/2024  IA		V3.4.2 CORST-3063 Support entity as a flex field
 * 1.58		7/1/2024    IA		CORST-3256 If Vertex Disable CUT flag is checked, set the Tax Override only on purchase transactions.
 * 1.59     8/7/2024    SP      CORST-3114 Enhancement Request to add "Vertex Disable CUT" to Vendor records
 * 1.60		08/17/2024  IA		Update Nexus based on ship country if it cannot find a Nexus matching the shipstate.
 * 1.61		08/29/2024  SP		CORST-3525 NetSuite: Class from Vendor record is not transferring over to the PO or Bill record
 * 1.62     09/03/2024	SP		CORST-3479 SuiteTax - Flexible Fields Not Being Passed from NetSuite to Vertex
 * 1.63     09/03/2024	SP		CORST-3847 SuiteTax - DEV - Nexus and Tag Registration 
 * 1.64		02/01/2025	IA		CORST-3914 Optimize SuiteQL Query to Fetch Country Codes for Improved Performance
 * 1.65     04/01/2025  RJ      CORST-4417 SuiteTax : Issues identified with Vendor/Customer class Value
 * 1.66     04/16/2025  SP      CORST-4480 NetSuite - SuiteTax: Enhanced Control for Tax Calls to Vertex
 * 1.67     04/16/2025  RJ      CORST-4553 Eliminate the usage of unnecessary escape function in the SuiteTax repository
 * 1.68     05/13/2025  RJ      CORST-4682 Nexus Override Control
 * 1.69     06/20/2025  JS      CORST-4815 RLI - CSV import returning an error when Vertex is enabled
 * 1.70     07/09/2025  RJ      CORST-4874 Nexus Override Checkbox - Include User Checkbox for Nexus Override
 * 1.71     07/21/2025  SP      CORST-4961 DayForce US, Inc - Germany VAT charges Ireland taxes when customer VAT# for Ireland is present
 * 1.72     09/08/2025  RJ      CORST-5127 Sales Order Creation for International Sale sets Nexus Override - Netsuite Suitetax API
 * 1.73     09/25/2025  SP      CORST-5266 SuiteTax DEV: "Vertex Disable CUT" checkbox missing from subsidiary   
 * 1.74     10/07/2025  SS      CORST-5391 RQ-141904 SuiteTax :NetSuite Tax Detail Override Box
 * 1.75     10/16/2025  RG      CORST-5316 Trusted id field should not be empty value when using REST Format
 * 1.76     11/17/2025  SP      CORST-5582 Vertex Script is called on subsidiary not using Vertex as tax engine
 * 1.77     11/28/2025  SP      CORST-5647 SuiteScript error on edit of payment record
 * 1.78	 	01/29/2026  SP      CORST-5882 SuiteTax: DEV - Reversal was NOT triggered during deletion
 * 1.79     01/30/2026  SS      CORST-5513 SuiteTax: Vendor Bill Creation with Vertex API Integration - With Feature Flag
 * 1.80     02/03/2026  RG      CORST-5926 Procurement Delete and void Functionality
 * 1.81     02/13/2026  SS      CORST-5927 NetSuite: SuiteTax: Health Equity Inc. - Accrual requests are not getting fired when action is to Accrue on Vendor Bill - Netsuite Suitetax 3.9.0
*/
/**
* @NApiVersion 2.0
* @NScriptType UserEventScript
*/
define(['N/search', 'N/currentRecord', 'N/record', 'N/runtime', 'N/log', 'N/https', 'N/xml', 'N/format', 'N/config', 'N/error','N/task', 'N/ui/serverWidget', './VertexAPILibV2.0.js'],
    function (search, currentRecord, record, runtime, log, https, xml, format, config, error,task,serverWidget, lib) {
        function vertexBeforeLoad(context) {
            var curRecord = context.newRecord;
            var recordType = curRecord.type;
          var form = context.form;
            var isCUT = false;
            var entityType = 'customer';
		    var entityDisableCUT = '';
		    var entityId = curRecord.getValue({ fieldId: 'entity' });
		    var scriptObject = runtime.getCurrentScript();
            var vtOneWorldFlag = scriptObject.getParameter('custscript_oneworldflag_vt');
            var subsidiaryid = curRecord.getValue({ fieldId: 'subsidiary' });
            if (recordType == record.Type.PURCHASE_ORDER || recordType == record.Type.VENDOR_BILL
                || recordType == record.Type.VENDOR_RETURN_AUTHORIZATION
                || recordType == record.Type.VENDOR_CREDIT)
                {
                    isCUT = true;
                    entityType = 'vendor';
                }
            var nexusVal = curRecord.getValue({ fieldId: 'nexus' });
			var configData = config.load({
					type: config.Type.COMPANY_INFORMATION
				});
			if(nexusVal)
			{
				var b_vtPlugin = vertexPluginCheck(vtOneWorldFlag,subsidiaryid,nexusVal,configData)
				if(!b_vtPlugin)
					return;
			}
            if(entityId && (context.type == context.UserEventType.COPY || context.type == context.UserEventType.CREATE || context.type == context.UserEventType.EDIT))
                {
                    var subsidiarySearch = {};
                    if(vtOneWorldFlag == 'T' || vtOneWorldFlag == true)
                    {
                        subsidiarySearch = search.lookupFields({
                            type: search.Type.SUBSIDIARY,
                            id: subsidiaryid,
                            columns: ['custrecord_disable_cut_vt','custrecord_disable_sales_vt','custrecord_canada_procurement_vt']
                        });
					} 
                          
                    var entitySearch = search.lookupFields(
                        {
                            type: entityType,
                            id: entityId,
                            columns: 'custentity_vt_vendor_disable_cut'
                        });
                    entityDisableCUT  = entitySearch.custentity_vt_vendor_disable_cut; 
                    var disableCUT = subsidiarySearch.custrecord_disable_cut_vt;
                    var disableSales = subsidiarySearch.custrecord_disable_sales_vt;
                    if (recordType != record.Type.VENDOR_PAYMENT && ((isCUT && (disableCUT == true || disableCUT == 'T'))|| entityDisableCUT == true || entityDisableCUT == 'T' || (!isCUT && (disableSales == true || disableSales == 'T'))))
                    {
                        curRecord.setValue({ fieldId: 'taxdetailsoverride', value: true });
                    }
                }
				if(context.type == context.UserEventType.EDIT || context.type == context.UserEventType.VIEW)
					{
						var subsidiarySearch = {};
					  var canadaprocurement ='';
					  if(subsidiaryid){
						subsidiarySearch = search.lookupFields({
									type: search.Type.SUBSIDIARY,
									id: subsidiaryid,
									columns: ['custrecord_canada_procurement_vt']
								});
								  canadaprocurement = subsidiarySearch.custrecord_canada_procurement_vt;
					  }
						if((canadaprocurement || canadaprocurement == true) && (recordType == record.Type.VENDOR_BILL
						|| recordType == record.Type.VENDOR_RETURN_AUTHORIZATION
						|| recordType == record.Type.VENDOR_CREDIT))
						{
						
							var undercharge = form.getField({
								id: 'custbody_undercharge_action_vt'
							});
							var overcharge = form.getField({
								id: 'custbody_overcharge_action_vt'
							});
							var cutaction = form.getField({
								id: 'custbody_cut_tax_action_vt'
							});
							var taxvariance = form.getField({
								id: 'custbody_tax_variance_vt'
							});

							if (undercharge) {
								undercharge.updateDisplayType({
									displayType: serverWidget.FieldDisplayType.HIDDEN
								});
							}

							if (cutaction) {
								cutaction.updateDisplayType({
									displayType: serverWidget.FieldDisplayType.HIDDEN
								});
							}
								if (overcharge) {
								overcharge.updateDisplayType({
									displayType: serverWidget.FieldDisplayType.HIDDEN
								});
							}
							if (taxvariance) {
								taxvariance.updateDisplayType({
									displayType: serverWidget.FieldDisplayType.HIDDEN
								});
							}
						}
						
					}
            if (context.type == context.UserEventType.COPY || context.type == context.UserEventType.CREATE) {
                 var subsidiarySearch = {};
              var canadaprocurement ='';
              if(subsidiaryid){
				subsidiarySearch = search.lookupFields({
                            type: search.Type.SUBSIDIARY,
                            id: subsidiaryid,
                            columns: ['custrecord_canada_procurement_vt']
                        });
						  canadaprocurement = subsidiarySearch.custrecord_canada_procurement_vt;
              }
                //log.debug('VertexBeforeLoad2.0', 'record: '+ record + ' JSON: '+JSON.stringify(record));
                log.debug('VertexBeforeLoad2.0', 'recordType: ' + recordType);
                removeAdjustmentItemOnCreate(curRecord, context);
					
                // do not clear the values for Vendor Credit and Vendor return auth
                // because the values should source from Vendor Bill
                if (recordType != record.Type.VENDOR_RETURN_AUTHORIZATION
                    && recordType != record.Type.VENDOR_CREDIT) {
                    const curRecordFields = curRecord.getFields();
                    //log.debug('VertexBeforeLoad2.0', 'currentRecordFields:' + JSON.stringify(curRecordFields));
                    if (curRecordFields.indexOf('custbody_tax_result_vt') >= 0) curRecord.setValue({ fieldId: 'custbody_tax_result_vt', value: '' });
                    if (curRecordFields.indexOf('custbody_associated_tran_vt') >= 0) curRecord.setValue({ fieldId: 'custbody_associated_tran_vt', value: '' });
                    if (curRecordFields.indexOf('custbody_cut_tax_action_vt') >= 0) curRecord.setValue({ fieldId: 'custbody_cut_tax_action_vt', value: '' });
                    if (curRecordFields.indexOf('custbody_undercharge_action_vt') >= 0) curRecord.setValue({ fieldId: 'custbody_undercharge_action_vt', value: '' });
                    if (curRecordFields.indexOf('custbody_overcharge_action_vt') >= 0) curRecord.setValue({ fieldId: 'custbody_overcharge_action_vt', value: '' });
                    if (curRecordFields.indexOf('custbody_process_date_vt_2') >= 0) curRecord.setValue({ fieldId: 'custbody_process_date_vt_2', value: '' });
                    if (curRecordFields.indexOf('custbody_request_vt') >= 0) curRecord.setValue({ fieldId: 'custbody_request_vt', value: '' });
                    if (curRecordFields.indexOf('custbody_distributed_tax_vt') >= 0) curRecord.setValue({ fieldId: 'custbody_distributed_tax_vt', value: '' });
                    if (curRecordFields.indexOf('custbody_add_vendor_tax_vt') >= 0) curRecord.setValue({ fieldId: 'custbody_add_vendor_tax_vt', value: false });
                    if (curRecordFields.indexOf('custbody_distributetax_vt') >= 0) curRecord.setValue({ fieldId: 'custbody_distributetax_vt', value: false });
                }
                // Make Vendor Tax Mandatory on Vendor Bill and Vendor Return on create
                if (recordType == record.Type.VENDOR_BILL
                    || recordType == record.Type.VENDOR_RETURN_AUTHORIZATION
                    || recordType == record.Type.VENDOR_CREDIT) {
                    var vendorTaxField = curRecord.getField({ fieldId: 'custbody_vendor_tax_vt' });
                    if (vendorTaxField)
                        vendorTaxField.isMandatory = true;
                }
                if ((recordType == record.Type.VENDOR_BILL || recordType == record.Type.PURCHASE_ORDER)
                    && context.type == context.UserEventType.COPY) {
                    curRecord.setValue({ fieldId: 'custbody_vertex_tax_vt', value: '' });
                    // CORST-1123 story changes by SYED
                    curRecord.setValue({ fieldId: 'custbody_dpp_applied_vt', value: false });
                }
                if (recordType == record.Type.VENDOR_BILL) {
                    if(!canadaprocurement || canadaprocurement == false){
                        var scriptObject = runtime.getCurrentScript();
                        var overChargeAction = scriptObject.getParameter('custscript_overcharge_action_vt');
                        var underChargeAction = scriptObject.getParameter('custscript_undercharge_action_vt');
                        curRecord.setValue({ fieldId: 'custbody_tax_variance_vt', value: '' });
                        curRecord.setValue({ fieldId: 'custbody_overcharge_action_vt', value: overChargeAction });
                        curRecord.setValue({ fieldId: 'custbody_undercharge_action_vt', value: underChargeAction });
                    }
                
				if((canadaprocurement || canadaprocurement == true) && (recordType == record.Type.VENDOR_BILL
                    || recordType == record.Type.VENDOR_RETURN_AUTHORIZATION
                    || recordType == record.Type.VENDOR_CREDIT))
					{
						
							var undercharge = form.getField({
								id: 'custbody_undercharge_action_vt'
							});
							var overcharge = form.getField({
								id: 'custbody_overcharge_action_vt'
							});
							var cutaction = form.getField({
								id: 'custbody_cut_tax_action_vt'
							});
							var taxvariance = form.getField({
								id: 'custbody_tax_variance_vt'
							});

							if (undercharge) {
								undercharge.updateDisplayType({
									displayType: serverWidget.FieldDisplayType.HIDDEN
								});
							}

							if (cutaction) {
								cutaction.updateDisplayType({
									displayType: serverWidget.FieldDisplayType.HIDDEN
								});
							}
								if (overcharge) {
								overcharge.updateDisplayType({
									displayType: serverWidget.FieldDisplayType.HIDDEN
								});
							}
							if (taxvariance) {
								taxvariance.updateDisplayType({
									displayType: serverWidget.FieldDisplayType.HIDDEN
								});
							}
				
						curRecord.setValue({ fieldId: 'custbody_tax_evaluation_result_vt', value: '' });
						curRecord.setValue({ fieldId: 'custbody_tax_evaluation_action_result', value: '' });
						curRecord.setValue({ fieldId: 'custbody_tax_evaluation_hold_reason_vt', value: '' });
						if (recordType == record.Type.VENDOR_BILL) 
						curRecord.setValue({ fieldId: 'paymenthold', value: false });
						curRecord.setValue({ fieldId: 'custbody_canada_post_to_journal_vt', value: false });
						curRecord.setValue({ fieldId: 'custbody_transaction_unique_id_vt', value: '' });
						
                        }
					}
                log.debug('VertexBeforeLoad2.0', 'Before load complete');
            }
        }
        /**
         * removeAdjustmentItemOnCreate
         * @param 
         * @returns
         */
        function removeAdjustmentItemOnCreate(curRecord, context) {
            var scriptObj = runtime.getCurrentScript();
            var taxAdjustmentItem = scriptObj.getParameter('custscript_tax_adjustment_item_vt');
            var taxAdjustmentItemIdx = curRecord.findSublistLineWithValue({
                sublistId: 'item',
                fieldId: 'item',
                value: taxAdjustmentItem
            });
            if (taxAdjustmentItemIdx >= 0) {
                curRecord.removeLine({
                    sublistId: 'item',
                    line: taxAdjustmentItemIdx,
                    ignoreRecalc: true
                });
            }
            //nlapiLogExecution('DEBUG', 'vertexBeforeLoad', 'Remove Adjustment item on copy'); 
        }
        function vertexBeforeSubmit(context) {
            //log.debug('VertexBeforeSubmit2.0', "Start before submit");
            var oldRecord = context.oldRecord;
            var newRecord = context.newRecord;
            var recordType = newRecord.type;
            var startTimeVt = new Date();
            var recordId = newRecord.id;
            var isCUT = false;
            var entityType = 'customer';
            var entityDisableCUT = '';
            var subsidiaryId = newRecord.getValue({ fieldId: 'subsidiary' });
			var entityId = newRecord.getValue({ fieldId: 'entity' });            
			var scriptObject = runtime.getCurrentScript();
			var oneWorldVT = scriptObject.getParameter('custscript_oneworldflag_vt');
            var nexusVal = newRecord.getValue({ fieldId: 'nexus' });
            var configData = config.load({
					type: config.Type.COMPANY_INFORMATION
				});
			if(nexusVal)
			{
				var b_vtPlugin = vertexPluginCheck(oneWorldVT,subsidiaryId,nexusVal,configData)
				if(!b_vtPlugin)
					return;
			}
            if (recordType == record.Type.PURCHASE_ORDER || recordType == record.Type.VENDOR_BILL
                || recordType == record.Type.VENDOR_RETURN_AUTHORIZATION
                || recordType == record.Type.VENDOR_CREDIT || recordType == record.Type.VENDOR_PAYMENT)
            {
                isCUT = true;
                entityType = 'vendor'
            }

            if (context.type != context.UserEventType.CREATE && context.type != context.UserEventType.EDIT
                && context.type != context.UserEventType.DELETE)
                return;
            var transaction = {};
            var preferencesObj = {};
            transaction.isCUT = isCUT;
            var donotCallVertex = newRecord.getValue({ fieldId: 'custbody_do_not_call_vt' });
            if (donotCallVertex == true || donotCallVertex == 'T')
            {
                newRecord.setValue({ fieldId: 'taxdetailsoverride', value: true });
                return;
            }
            //RQ-90584 CORST-1241 If the customer decide to Disable CUT, no tax call on purchase side
            
            if (entityId && (context.type == context.UserEventType.COPY || context.type == context.UserEventType.CREATE || context.type == context.UserEventType.EDIT)) {
                var subsidiarySearch = {};
                if(oneWorldVT == 'T' || oneWorldVT == true)
                {
                    subsidiarySearch = lookup(search.Type.SUBSIDIARY, subsidiaryId, ['custrecord_disable_cut_vt','state','country','custrecord_disable_sales_vt']);
				}
                var entitySearch = search.lookupFields(
                {
                    type: entityType,
                    id: entityId,
                    columns: 'custentity_vt_vendor_disable_cut'
                });
				var disableCUT = subsidiarySearch.custrecord_disable_cut_vt;
                var disableSales = subsidiarySearch.custrecord_disable_sales_vt;
                var entityDisableCUT  = entitySearch.custentity_vt_vendor_disable_cut;
                if ((isCUT && (disableCUT == true || disableCUT == 'T'))|| entityDisableCUT == true || entityDisableCUT == 'T' || (!isCUT && (disableSales == true || disableSales == 'T')))
                {
                    newRecord.setValue({ fieldId: 'custbody_vertex_tax_vt', value: 0 });
                    newRecord.setValue({ fieldId: 'taxdetailsoverride', value: true });
                    log.debug('VertexBeforeSubmit2.0 ', 'Exiting the script since the user choose not to call Vertex.');
                    return;
                }
            }
            log.debug('VertexBeforeSubmit2.0',
                ' Start - type: ' + context.type + ' recType: ' + recordType
                + ' internalid: ' + recordId
                + ' context: ' + runtime.executionContext
                + ' Starttime:' + startTimeVt);
            //CNSAPI-768 Tax Only Adjustment
            if (recordType == record.Type.CREDIT_MEMO)
                taxOnlyAdjustValidation(newRecord, oldRecord, recordType);
            //CNSAPI-1101 Post negative request on deleting posting transaction
            var prevRequest = lib.convertNullToBlank(newRecord.getValue({ fieldId: 'custbody_request_vt' }));
            var prevCallSuccess = newRecord.getValue({ fieldId: 'custbody_tax_result_vt' });
            //RQ-100329 post Negative request only if the original request is a success.
            if(context.type == context.UserEventType.DELETE)
            {
                prevRequest = lib.convertNullToBlank(oldRecord.getValue({ fieldId: 'custbody_request_vt' }));
                prevCallSuccess = oldRecord.getValue({ fieldId: 'custbody_tax_result_vt' });
                var canadaPostedToJournal = oldRecord.getValue({ fieldId: 'custbody_canada_post_to_journal_vt' });
                newRecord = oldRecord;
                getAfterSubmitPreferences(newRecord, transaction, preferencesObj);
                if((preferencesObj.canadaprocurement==true || preferencesObj.canadaprocurement=='true') && (canadaPostedToJournal==true || canadaPostedToJournal=='true') )
                {
                    var uniqId=newRecord.getValue({ fieldId: 'custbody_transaction_unique_id_vt' });
                    transaction.trandate=oldRecord.getValue({ fieldId: 'trandate' });
                    transaction.oldRequest = oldRecord.getValue({fieldId:"custbody_request_vt"});
                    var reversalProcessed = lib.handleVendorBillReversal(recordType, recordId,transaction,preferencesObj,uniqId);
                    if (reversalProcessed)
                        log.debug('VertexAfterSubmit2.0', 'Vendor bill DELETEreversal completed');
                    return;
                } 
            }
            if (context.type == context.UserEventType.DELETE && prevRequest && lib.isPostingTransaction(recordType)
                && prevCallSuccess == 'Success') {
                var recordId = newRecord.id;                
                getTransactionDetails(transaction, preferencesObj, recordId, recordType, false);
                postNegativeRequest(newRecord, prevRequest, transaction, preferencesObj);
                return;
            }
            //update nexus only if not taxOverride
            var taxOverride = newRecord.getValue({ fieldId: 'taxdetailsoverride' });
            var nexusOverride = newRecord.getValue({ fieldId: 'taxregoverride' });
            var userNexusOverride = newRecord.getValue({ fieldId: 'custbody_user_nexus_override_vt' });
             //if (!taxOverride && (!nexusOverride || !userNexusOverride))
            if (!taxOverride && (!nexusOverride || !userNexusOverride) && (recordType != record.Type.VENDOR_PAYMENT))
                updateNexus(transaction, newRecord, subsidiarySearch);
            var endTimeVt = new Date();
            var secondsUsed = (endTimeVt - startTimeVt) / 1000;
            //var scriptObj = runtime.getCurrentScript();
            log.debug({
                title: 'VertexBeforeSubmit2.0',
                details: 'BeforeSubmit secondsUsed: ' + secondsUsed
            });
        } 

function vertexPluginCheck(oneWorldVT,subsidiaryId,nexusVal,configData)
{
    if((oneWorldVT == true || oneWorldVT == 'T') && subsidiaryId)
    {
        var subsRec = record.load({
                type: record.Type.SUBSIDIARY,
                id: subsidiaryId
            });
        }
    else if(!oneWorldVT)
    {
        var subsRec = configData;
    }

        var taxRegCount = subsRec.getLineCount({
            sublistId: 'taxregistration'
        });
        if(taxRegCount>0)
        {
            var lineNumber = subsRec.findSublistLineWithValue({
                sublistId: 'taxregistration',
                fieldId: 'nexus',
                value: nexusVal
            });
            if(lineNumber >= 0)
            {
                var taxEngine = subsRec.getSublistText({
                sublistId: 'taxregistration',
                fieldId: 'taxengine',
                line: lineNumber
                });
                if (!taxEngine || taxEngine.indexOf('Vertex') != 0) {
                    log.debug('Vertex Plugin check', 'Exiting the script since the nexus is not associated with Vertex Plugin');
                    return false;
                }
            }
        }
        else if(taxRegCount<=0)
        {
            log.debug('Vertex Plugin check', 'Exiting the script since there is no tax registration record for the subsidiary');
            return false;
        }
        return true;
    }

        /**
     * @param 
     * For a deleted transaction, back out the original posting. 
     */
        function postNegativeRequest(curRecord, prevRequest, transaction, preferencesObj) {
            try {
                var serviceURL = lib.getServiceUrl(transaction, preferencesObj);
                var negInvoiceRequest;

                if (preferencesObj.useRest || preferencesObj.useRest == true)  {
                    negInvoiceRequest = generateRestReverseRequest(curRecord, prevRequest, preferencesObj, transaction);
                } else {
                    negInvoiceRequest = generateReverseRequest(curRecord, prevRequest, preferencesObj);
                }

                if (preferencesObj.useRest && !preferencesObj.isSoapFormat) {
                    if (negInvoiceRequest.lineItems[0].buyer && negInvoiceRequest.lineItems[0].buyer != undefined) {
                        serviceURL = serviceURL + '/v2/procurement';
                    } else {
                        serviceURL = serviceURL + '/v2/supplies';
                    }
                    log.debug({ title: 'Delete2.0', details: 'URL Reverse Request: ' + serviceURL });
                    //Token based auth additional logic

                    if (transaction.useToken) {
                        //Get token params if saved in custom record otherwise post token request and save params in custom record.
                        var useTokenStatus = lib.tokenLogic(transaction);
                        if (!useTokenStatus)
                            return '';
                        log.debug('postNegativeRequest', 'transaction.tokenParams: ' + JSON.stringify(transaction.tokenParams));
                        log.debug('postNegativeRequest', 'transaction.tokenHeader: ' + JSON.stringify(transaction.tokenHeader));
                    }

                    var headers = {};
                    headers['Content-Type'] = 'application/json';
                    headers['Authorization'] = transaction.tokenHeader.authorization;
                    headers['Accept'] = 'application/json';
                    log.debug('postNegativeRequest', 'headers: ' + JSON.stringify(headers));

                    var vertexResponse = https.post({
                        url: serviceURL,
                        body: JSON.stringify(negInvoiceRequest),
                        headers: headers
                    });
                    if (transaction.useToken && vertexResponse) {
                        var responseCode = vertexResponse.code;
                        if (responseCode == 401 || responseCode == 403 || (responseCode == 500 && vertexResponse.body && vertexResponse.body.message && vertexResponse.body.message.contains('expired'))) {
                            log.debug('VertexAfterSubmit2.0', ' Token expired', 'Retry with new token ');
                            var postToken = lib.postTokenRequest(transaction);
                            if (!postToken) {
                                log.debug('VertexAfterSubmit2.0', 'Token', 'Unsuccessful token call');
                                return;
                            }
                            lib.saveTokenInCustomRecord(transaction);
                            transaction.tokenHeader = lib.getTokenFromCustomRecord();
                            headers['Authorization'] = transaction.tokenHeader.authorization;
                            log.debug('postNegativeRequest', 'headers: ' + JSON.stringify(headers));
                            vertexResponse = https.post({ url: serviceURL, body: JSON.stringify(negInvoiceRequest), headers: headers });                            
                        }
                    }
                    if (vertexResponse.code != 200) {
                        log.debug({ title: 'VertexReverseResponse2.0', details: JSON.stringify(vertexResponse.body) });
                        var faultString = faultNode[0].textContent;
                        if (vertexResponse.body.errors && vertexResponse.body.errors != undefined) {
                            faultString = vertexResponse.body.errors[0].message;
                        }
                        log.debug('VertexReverseResponse2.0', 'Error with response: ' + faultString);
                    } else {
                        log.debug({ title: 'vertexReverseResponse2.0', details: JSON.stringify(vertexResponse.body) });
                    }
                } else {
                    var soapHead = new Array();
                    soapHead['Content-Type'] = 'text/xml';
                    log.debug({ title: 'Delete2.0', details: 'URL Reverse Request: ' + serviceURL });
                    var vertexResponse = https.post({
                        url: serviceURL,
                        body: negInvoiceRequest,
                        headers: soapHead
                    });
                    if (vertexResponse.code != 200) {
                        log.debug({ title: 'VertexReverseResponse2.0', details: vertexResponse.body });
                        var soapXML = xml.Parser.fromString({
                            text: vertexResponse.body
                        });
                        var faultNode = xml.XPath.select({
                            node: soapXML,
                            xpath: "//*[name()='faultstring']"
                        });
                        var faultString = faultNode[0].textContent;
                    } else {
                        log.debug({ title: 'vertexReverseResponse2.0', details: vertexResponse.body });
                    }
                }
                log.debug({ title: 'ReverseRequest2.0', details: negInvoiceRequest });
            } catch (e) {
                //todo uncomment??
                // log.error({title: 'VertexReverseResponseCode2.0', details: `code: ${e.getCode()}, details: ${e.getDetails()}`});
            }
            return;
        }

        /**
         * Link Vertex Call details record CUT implementation on Vendor Bill Post
         * Accrual Request for Vendor Payment
         * 
         * @param type
         * @returns
         */
        function vertexAfterSubmit(context) {
            //RQ-96193/CORST-1623 Resolve Mass Update error  
            if (context.type != 'orderitems' && context.type != context.UserEventType.PAYBILLS && context.type != context.UserEventType.CREATE && context.type != context.UserEventType.EDIT)
              return;
            var startTimeVt = new Date();
            var transaction = {};
            var preferencesObj = {};
            var newRecord = context.newRecord;
             var oldRecord = context.oldRecord;
            var recordType = newRecord.type;
            var recordId = newRecord.id;
            var donotCallVertex = newRecord.getValue({ fieldId: 'custbody_do_not_call_vt' });
           var prevRequest ='';
			var prevCallSuccess ='';
			var canadaPostToJournal = '';
			if(oldRecord){
				  prevRequest = oldRecord.getValue({ fieldId: 'custbody_request_vt' });
				  prevCallSuccess = oldRecord.getValue({ fieldId: 'custbody_tax_result_vt' });
			}

			log.debug("canadaPostToJournal",canadaPostToJournal)
            if (donotCallVertex == true || donotCallVertex == 'T')
                return;
            //RQ-90584 CORST-1241 If the customer decide to Disable CUT, no tax call on purchase side
            var subsidiaryId = newRecord.getValue({ fieldId: 'subsidiary' });
            var entityId = newRecord.getValue({ fieldId: 'entity' });  
            var isCUT = false;
			var entityType = 'customer';
            if (recordType == record.Type.PURCHASE_ORDER || recordType == record.Type.VENDOR_BILL
                || recordType == record.Type.VENDOR_RETURN_AUTHORIZATION
                || recordType == record.Type.VENDOR_CREDIT || recordType == record.Type.VENDOR_PAYMENT)
            {
                isCUT = true;
                entityType = 'vendor';
            }        
			transaction.isCUT = isCUT;			
            var nexusVal = newRecord.getValue({ fieldId: 'nexus' });
			var scriptObject = runtime.getCurrentScript();
			var configData = config.load({
					type: config.Type.COMPANY_INFORMATION
				});
            log.debug('VertexAfterSubmit2.0', "Start after submit");
            getAfterSubmitPreferences(newRecord, transaction, preferencesObj);
            if(nexusVal)
			{
				var b_vtPlugin = vertexPluginCheck(preferencesObj.vtOneWorldFlag,subsidiaryId,nexusVal,configData)
				if(!b_vtPlugin)
					return;
			}
			if (entityId && (context.type == context.UserEventType.CREATE || context.type == context.UserEventType.EDIT || context.type == context.UserEventType.COPY)) {
                
                if(preferencesObj.vtOneWorldFlag)
                {
					var disableCUT = transaction.subRecord.getValue('custrecord_disable_cut_vt');
                    var disableSales = transaction.subRecord.getValue('custrecord_disable_sales_vt');
                }
                var entitySearch = search.lookupFields(
                {    
                    type: entityType,    
                    id: entityId,    
                    columns: 'custentity_vt_vendor_disable_cut'    
                });    
                var entityDisableCUT = entitySearch.custentity_vt_vendor_disable_cut;
                if ((isCUT && (disableCUT == true || disableCUT == 'T'))|| entityDisableCUT == true || entityDisableCUT == 'T' || (!isCUT && (disableSales == true || disableSales == 'T')))
                {
                    newRecord.setValue({ fieldId: 'custbody_vertex_tax_vt', value: 0 });
                    newRecord.setValue({ fieldId: 'taxdetailsoverride', value: true });
                    log.debug('vertexAfterSubmit2.0 ', 'Exiting the script since the user choose not to call Vertex.');
                    return;
                }
            }
            if (context.type == context.UserEventType.DELETE)
                return;
            log.debug('VertexAfterSubmit2.0', 'recordId: ' + recordId + ';;recordType:' + recordType + ';;type: ' + context.type);
            //distributeTax
            if (distributeTaxEligible(newRecord, recordType, context.type)) {
                distributeTax(transaction, preferencesObj, newRecord, recordType, recordId, context.type);
                return;
            }
            // CNSAPI-133 Source Product Class on POs created from Blanket POs
            if (recordType == record.Type.PURCHASE_ORDER && context.type == 'orderitems' && purchaseClassMissing(newRecord))
                SourceProductClass(transaction, newRecord, recordId);
            // LINK VERTEX CALL DETAILS RECORD
            if ((context.type == context.UserEventType.CREATE || context.type == context.UserEventType.EDIT || context.type == 'orderitems') && recordType != record.Type.VENDOR_PAYMENT) {
                try {
                    updateVertexCallDetails(transaction, newRecord, recordType, recordId, context, preferencesObj);
                } catch (err) {
                    var errorDetailMsg = lib.logExecutionMsg(err,
                        "updateVertexCallDetailsError");
                    log.error('VertexAfterSubmit2.0', recordType + ';' + recordId + ';' + errorDetailMsg);
                    lib.submitField(recordType, recordId, 'custbody_tax_result_vt',
                        errorDetailMsg);
                }
            }
            // CUT IMPLEMENTATION
            if ((context.type == context.UserEventType.CREATE || context.type == context.UserEventType.EDIT)
                && (recordType == record.Type.VENDOR_BILL || recordType == record.Type.VENDOR_CREDIT || recordType == record.Type.VENDOR_RETURN_AUTHORIZATION)) {
                try {
                    CUTimplementation(recordType, recordId, context);
                } catch (err) {
                    var errorDetailMsg = lib.logExecutionMsg(err, "CUTimplementation Error");
                    log.error('VertexAfterSubmit2.0', recordType + ';' + recordId + ';' + errorDetailMsg);
                    lib.submitField(recordType, recordId, 'custbody_tax_result_vt',
                        errorDetailMsg);
                }
            }
            // POST ACCRUAL REQUEST TO VERTEX
            if ((context.type == context.UserEventType.CREATE || context.type == context.UserEventType.PAYBILLS) &&recordType == record.Type.VENDOR_PAYMENT) {
                if (newRecord.getValue({ fieldId: 'custbody_associated_tran_vt' }))
                    return;
                try {
                    log.debug('VertexAfterSubmit2.0',
                        'before accrualProcess; recordType ' + recordType
                        + ';;recordId:' + recordId + ';;type:' + context.type);
                    accrualProcess(transaction, preferencesObj, recordType, recordId, newRecord);
                } catch (err) {
                    var errorDetailMsg = lib.logExecutionMsg(err, "AccrualProcess Error");
                    log.error('VertexAfterSubmit2.0', recordType + ';'
                        + recordId + ';' + errorDetailMsg);
                    lib.submitField(recordType, recordId, 'custbody_tax_result_vt',
                        errorDetailMsg);
                }
            }

            if(preferencesObj.canadaprocurement || preferencesObj.canadaprocurement == true)
			{
                var voidTriggered=false;
                var transactionRec=record.load({type: recordType,id:recordId,isDynamic: true});
                var voided=transactionRec.getValue({ fieldId: 'voided' });
                var uniqId=transactionRec.getValue({ fieldId: 'custbody_transaction_unique_id_vt' });

                if(voided==true || voided=='T')
                {
                    getAfterSubmitPreferences(newRecord, transaction, preferencesObj);
                    transaction.trandate=newRecord.getValue({ fieldId: 'trandate' });
                    transaction.oldRequest = oldRecord.getValue({fieldId:"custbody_request_vt"});
                    transaction.voided = "yes"
                    
                    var filters=[];

                    filters[0] = search.createFilter({name: 'custrecord_transaction_internalid_vt',operator: search.Operator.EQUALTO,values: recordId});
                    filters[1] = search.createFilter({name: 'custrecord_request_type_vt',operator: search.Operator.IS,values: "ConditionalProcurement"});
                    
                    var columns = [];
                    
                    columns[0]=search.createColumn({name: "internalid",sort:search.Sort.DESC});
                    columns[1]=search.createColumn({name: "custrecord_canada_unique_id"});
                    columns[2]=search.createColumn({name: "custrecord_request_vt"});
                        
                    var calldetailsSearch = getSearchResults('customrecord_call_details_vt', filters, columns);
                    
                    if(calldetailsSearch && calldetailsSearch != null && calldetailsSearch != '' && calldetailsSearch != undefined)
                    {
                        uniqId= calldetailsSearch[0].getValue({name:"custrecord_canada_unique_id"});
                    }
                    if(uniqId.indexOf("-") != -1)
                    {
                        var recexactId = uniqId.split("-")[0];
                        var recuniqueId = uniqId.split("-")[1];
                        var incNumber=parseInt(recuniqueId)+parseInt(1);
                        uniqId= recexactId+'-'+incNumber;
                    }
                    else
                        uniqId=uniqId+'-'+1;
                    
                    voidTriggered=true;
                }

                var scriptTask = task.create({
                taskType: task.TaskType.MAP_REDUCE
                });
                scriptTask.scriptId = 'customscript_update_call_details_mr'; 
                scriptTask.deploymentId = 'customdeploy_update_call_details_mr';
                if(voidTriggered==true || voidTriggered == 'true'){
					preferencesObj.uniqueId=uniqId;
					scriptTask.params = {
						'custscript_record_id_vt': recordId,
						'custscript_unique_id_vt':uniqId,
						'custscript_transactions_type_vt':recordType,
						'custscript_transaction_vt':transaction,
						'custscript_preference_vt':preferencesObj
					};
				}
                else
                {
                    scriptTask.params = {
                        'custscript_record_id_vt': recordId,
                    };
                }
                var scriptTaskId = scriptTask.submit();
            }
            var endTimeVt = new Date();
            var secondsUsed = (endTimeVt - startTimeVt) / 1000;
            log.debug('VertexAfterSubmit2.0', 'AfterSubmit SecondsUsed: ' + secondsUsed
                + ' recordType: ' + recordType + '; recordId: ' + recordId
                + ' startTime: ' + startTimeVt + ' endTime: ' + endTimeVt);
        }

        function getAfterSubmitPreferences(curRecord, transaction, preferencesObj) {
            //log.debug('getAfterSubmitPreferences', 'start');

            var scriptObject = runtime.getCurrentScript();
            transaction.useToken = scriptObject.getParameter('custscript_use_token_vt');
            preferencesObj.useRest = scriptObject.getParameter('custscript_use_rest_vt');
            if (preferencesObj.useRest) {
                preferencesObj.serviceURL = scriptObject.getParameter('custscript_rest_base_url_vt');
            } else {
                preferencesObj.serviceURL = scriptObject.getParameter('custscript_taxserviceurl_vt');
            }
            preferencesObj.vtOneWorldFlag = scriptObject.getParameter('custscript_oneworldflag_vt');

            if (preferencesObj.vtOneWorldFlag) {
                //log.debug('getAfterSubmitPreferences', 'is one world');

                transaction.subsidiary = curRecord.getValue('subsidiary');
                log.debug('getAfterSubmitPreferences', 'subsidiary: ' + transaction.subsidiary);

                transaction.subRecord = record.load({ type: record.Type.SUBSIDIARY, id: transaction.subsidiary });
                preferencesObj.useRest = transaction.subRecord.getValue('custrecord_use_rest_vt');
                if (!preferencesObj.useRest) {
                    preferencesObj.serviceURL = transaction.subRecord.getValue('custrecord_taxserviceurl_vt');
                } else {
                    preferencesObj.serviceURL = transaction.subRecord.getValue('custrecord_rest_base_url_vt');
                }
                transaction.useToken = transaction.subRecord.getValue('custrecord_use_token_vt');
                preferencesObj.canadaprocurement = transaction.subRecord.getValue('custrecord_canada_procurement_vt');
            }
        }

        /**
         * Check if purchase class is missing on any expense lines
         * 
         * @param
         * @returns boolean
         */
        function purchaseClassMissing(curRecord) {
            try {
                var expenseCount = curRecord.getLineCount('expense');
                if (expenseCount == 0)
                    return false;
                for (var idx = 0; idx < expenseCount; idx++) {
                    var expenseCategory = curRecord.getSublistValue({ sublistId: 'expense', fieldId: 'category', line: idx });
                    var purchaseClass = curRecord.getSublistValue({ sublistId: 'expense', fieldId: 'custrecord_purchase_class_vt', line: idx });
                    if (expenseCategory && !purchaseClass)
                        return true;
                }
            } catch (err) {
                log.error('Purchase Class Missing Check Error',
                    lib.logExecutionMsg(err, ''));
            }
            return false;
        }

        /**
         * CNSAPI-133 Source Product Class on Purchase Orders created from Blanket POs
         * 
         * @param
         * @returns
         */
        function SourceProductClass(transaction, curRecord, recordId) {
            try {
                transaction.expenseCategories = getAllExpenseCategories();
                var expenseCount = curRecord.getLineCount('expense');
                var submitRecord = false;
                var poRecord = record.load({ type: 'purchaseorder', id: recordId });
                for (var idx = 0; idx < expenseCount; idx++) {
                    var expenseCategory = curRecord.getSublistValue({ sublistId: 'expense', fieldId: 'category', line: idx });
                    //log.debug('expenseCategory:' + expenseCategory);
                    var productClass = curRecord.getSublistValue({ sublistId: 'expense', fieldId: 'custrecord_purchase_class_vt', line: idx });
                    if (expenseCategory && !productClass) {
                        productClass = getPurchaseClass(transaction.expenseCategories, expenseCategory);
                        if (productClass) {
                            poRecord.setSublistValue({ sublistId: 'expense', fieldId: 'custcol_taxproductclass_vt', line: idx, value: productClass });
                            submitRecord = true;
                        }
                    }
                }
                if (submitRecord)
                    poRecord.save({
                        enableSourcing: true,
                        ignoreMandatoryFields: true
                    });
            } catch (err) {
                log.error('Source Product Class Error',
                    lib.logExecutionMsg(err, ''));
            }
            return;
        }
        /**
         * CNSAPI-133 Source Product Class on Purchase Orders created from Blanket POs
         * 
         * @param
         * @returns
         */
        function getLineLocation(newRecord) {
            var lineLocation = '';
            var expenseCount = newRecord.getLineCount('expense');
            if (expenseCount > 0)
                lineLocation = newRecord.getSublistValue({ sublistId: 'expense', fieldId: 'location', line: 0 });
            if (lineLocation)
                return lineLocation;
            var itemCount = newRecord.getLineCount('item');
            if (itemCount > 0)
                lineLocation = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'location', line: 0 });
            if (lineLocation)
                return lineLocation;
            else
                return '';
        }
        /**
         * updateNexus Set the Nexus based on transaction address. For Sales documents,
         * set the Nexus based on the shipaddress state. For Procurement documents, if
         * there is location set the Nexus based on the location state. If not set the
         * Nexus based on the subsidiary shipaddress state.
         * 
         * @param type
         * @returns
         */
        function updateNexus(transaction, newRecord, subsidiarySearch) {
            var recordType = '';
            try {
                recordType = newRecord.type;
                var subsidiary = newRecord.getValue({ fieldId: 'subsidiary' });
                var isCUT = false;
                if (recordType == record.Type.PURCHASE_ORDER || recordType == record.Type.VENDOR_BILL
                    || recordType == record.Type.VENDOR_RETURN_AUTHORIZATION
                    || recordType == record.Type.VENDOR_CREDIT)
                    isCUT = true;
                var transactionState = '';
                var nexusState = '';
                var transactionCountry = '';
                var nexusCountry = '';
                var lookupData;
                if (!isCUT){
                    transactionState = newRecord.getValue({ fieldId: 'shipstate' });
                    transactionCountry = newRecord.getValue({ fieldId: 'shipcountry' });
                    log.debug('VertexUpdateNexus', 'tranState||country: ' + transactionState+'||'+transactionCountry);
                }else {
                    //set Nexus based on the location from the first expense/item line               
                    var location = getLineLocation(newRecord);
                    log.debug('LineLoc###', location);
                    if (!location) {
                        location = newRecord.getValue({ fieldId: 'location' });
                        //log.debug('HeaderLoc###', location);
                    }
                    if (location) {
                        // transactionState = search.lookupFields({
                        //     type: search.Type.LOCATION, id: location,
                        //     columns: 'state'
                        // });
                        lookupData = lookup(search.Type.LOCATION, location, ['state', 'country']);    
                        transactionState = lookupData.state;
                        transactionCountry = lookupData.country;
                        log.debug('VertexUpdateNexus','locState||country: '+ transactionState+'||'+transactionCountry);
                    }
                    else if (subsidiary) {
                        //transactionState = getSubsidiaryShipState(transaction, subsidiary);
                        lookupData = subsidiarySearch;
                        transactionState = lookupData.state;
                        transactionCountry = lookupData.country;
                        log.debug('VertexUpdateNexus','subsidState||country: '+ transactionState+'||'+transactionCountry+ ' json: '+JSON.stringify(lookupData));
                    }
                }
                var nexus = newRecord.getValue({ fieldId: 'nexus' });
                if (nexus){
                    //nexusState = search.lookupFields({ type: search.Type.NEXUS, id: nexus, columns: 'state' });
                    lookupData = lookup(search.Type.NEXUS, nexus, ['state', 'country']);    
                    nexusState = lookupData.state;
                    nexusCountry = lookupData.country;
                    log.debug('VertexUpdateNexus','nexusState||country: '+  nexusState +'||'+nexusCountry + ' json: '+JSON.stringify(lookupData));
                }
                //log.debug('VertexUpdateNexus', 'nexusState: '+nexusState);
                // transactionState: {"state":"MD"}. Nexus:54 NexusState:{"state":[{"value":"MD","text":"Maryland"}]}
                if (isCUT && typeof transactionState == 'object' && transactionState && transactionState[0]) {
                    transactionState = transactionState[0].value;
                    log.debug('VertexUpdateNexus', 'transactionState:'+transactionState);            
                }

                if (typeof nexusState == 'object'&& nexusState && nexusState[0]) {
                        nexusState = nexusState[0].value;
                        log.debug('VertexUpdateNexus', 'nexusState:'+nexusState);
                }
                if (transactionState =='' || nexusState==''){
                    log.debug('VertexUpdateNexus',  'empty transactionState or nexusState');
                    //Update Nexus based on ship country if it cannot find a Nexus matching the shipstate.
                    updateCountryNexus(transactionCountry, nexusCountry, subsidiary, newRecord, transaction, isCUT, transactionState);
                    return;
                }  
                if (transactionState == nexusState)
                    return;
                log.debug('VertexUpdateNexus',
                    'Nexus state different from transaction state: '
                    + JSON.stringify(transactionState) + '. Nexus is ' + nexus
                    + ', NexusState:' + JSON.stringify(nexusState));
                // Search to get the Nexus based on the transaction state
                var filters = [];
                filters[0] = search.createFilter({
                    name: 'state',
                    operator: search.Operator.ANYOF,
                    values: transactionState
                });
                filters[1] = search.createFilter({
                    name: 'isinactive',
                    operator: search.Operator.IS,
                    values: 'F'
                });
                var columns = [];
                columns[0] = search.createColumn({
                    name: 'internalid'
                });
                var searchResults = search.create({
                    type: search.Type.NEXUS,
                    filters: filters,
                    columns: columns
                }).run().getRange({
                    start: 0,
                    end: 1000
                });

                var newNexus = '';
                if (searchResults && searchResults != undefined && searchResults.length > 0) {
                    newNexus = searchResults[0].getValue({ name: 'internalId' });
                    log.debug('VertexBeforeSubmit2.0', 'newNexus:' + newNexus);
                    // It will throw Invalid nexus reference key xx for subsidiary yy if
                    // the subsidiary do not have the Nexus under Tax Registrations.
                    // Do not set the Nexus if the Nexus based on ship address is not
                    // associated to the entity subsidiary
                    if (!nexusSubsidiaryRelated(transaction, subsidiary, newNexus)) {
                        log.debug('VertexBeforeSubmit2.0', 'newNexus: '
                            + newNexus + ' is not associated to subsidiary '
                            + subsidiary);
                        return;
                    }
                    newRecord.setValue({ fieldId: 'taxregoverride', value: true });
                    newRecord.setValue({ fieldId: 'nexus', value: newNexus });
                    log.debug('VertexBeforeSubmit2.0', 'Updating nexus: '
                        + newNexus);
                }
            } catch (err) {
                var errorDetailMsg = lib.logExecutionMsg(err, 'Update Nexus ');
                log.error('VertexBeforeSubmit2.0', recordType + ';'
                    + errorDetailMsg);
            }
        }
        function updateCountryNexus(tranCountry, nexusCountry, subsidiary, newRecord,transaction, isCUT, transactionState){
            if (isCUT && typeof tranCountry == 'object' && tranCountry && tranCountry[0]) {
                tranCountry = tranCountry[0].value;
                log.debug('VertexupdateNexus', 'updateNexus tranCountry:'+tranCountry);            
            }
            if (typeof nexusCountry == 'object'&& nexusCountry && nexusCountry[0]) {
                nexusCountry = nexusCountry[0].value;
                log.debug('VertexupdateNexus', 'updateNexus nexusCountry:'+nexusCountry);
            }
            if (tranCountry == nexusCountry)
                return;
            // Search to get the Nexus based on the transaction state
            var filters = [];
            filters[0] = search.createFilter({
                name: 'country',
                operator: search.Operator.ANYOF,
                values: tranCountry
            });
            filters[1] = search.createFilter({
                name: 'isinactive',
                operator: search.Operator.IS,
                values: 'F'
            });
            if (transactionState) {
                filters.push(search.createFilter({
                    name: 'state',
                    operator: search.Operator.IS,
                    values: transactionState
                }));
            }
            var columns = [];
            columns[0] = search.createColumn({
                name: 'internalid'
            });
            columns[1] = search.createColumn({
                name: 'state'
            });
            var searchResults = search.create({
                type: search.Type.NEXUS,
                filters: filters,
                columns: columns
            }).run().getRange({
                start: 0,
                end: 1000
            });

            // If no results and state filter was used, remove state filter and retry
            if ((!searchResults || searchResults.length === 0) && transactionState) {
                filters.pop(); // Remove the state filter
                searchResults = search.create({
                    type: search.Type.NEXUS,
                    filters: filters,
                    columns: columns
                }).run().getRange({ start: 0, end: 1000 });
        
                // Pick only the country-level Nexus (blank state)
                var countryLevelResults = [];
                for (var i = 0; searchResults && i < searchResults.length; i++) {
                    var stateValue = searchResults[i].getValue({ name: 'state' });
                    if (!stateValue) {
                        countryLevelResults.push(searchResults[i]);
                        break;
                    }
                }
                searchResults = countryLevelResults;
            }

            var newNexus = '';
            if (searchResults && searchResults != undefined && searchResults.length > 0) {
                newNexus = searchResults[0].getValue({ name: 'internalId' });
                log.debug('VertexUpdateNexus', 'newNexus:' + newNexus);
                // It will throw Invalid nexus reference key xx for subsidiary yy if
                // the subsidiary do not have the Nexus under Tax Registrations.
                // Do not set the Nexus if the Nexus based on ship address is not
                // associated to the entity subsidiary
                if (!nexusSubsidiaryRelated(transaction, subsidiary, newNexus)) {
                    log.debug('VertexUpdateNexus', 'newNexus: '
                        + newNexus + ' is not associated to subsidiary '
                        + subsidiary);
                    return;
                }
                newRecord.setValue({ fieldId: 'taxregoverride', value: true });
                newRecord.setValue({ fieldId: 'nexus', value: newNexus });
                log.debug('VertexUpdateNexus', 'Updated nexus based on country '+tranCountry
                    + ' nexus id: '+ newNexus);
            }      
        }
        /*
		 * lookup given record
		 * 
		 * @param record @param id @param fields @returns string
		 */
		function lookup(record, id, fields) {
			var value = '';
			try {
				// 10 POINTS
				value = search.lookupFields({
					type: record,
					id: id,
					columns: fields
				});
				// value = search.lookupFields({
				// 	type: search.Type.SALES_ORDER,
				// 	id: id,
				// 	columns: fields
				// });
			} catch (err) {
				errorDetailMsg = lib.logExecutionMsg(err, "Lookup Error. ");
				log.error(record + "; " + id + " Lookup Error",
					errorDetailMsg);
			}
			return value;
		}
        function nexusSubsidiaryRelated(transaction, subsidiary, nexus) {
            var subsidiaryRec = '';
            var subsidiaryNexus = '';
            if (transaction.subRecord)
                subsidiaryRec = transaction.subRecord;
            else
                subsidiaryRec = record.load({ type: record.Type.SUBSIDIARY, id: subsidiary });
            var taxRegCount = subsidiaryRec.getLineCount('taxregistration');
            for (var taxRegIdx = 0; taxRegCount > 0 && taxRegIdx < taxRegCount; taxRegIdx++) {
                subsidiaryNexus = subsidiaryRec.getSublistValue('taxregistration',
                    'nexus', taxRegIdx);
                if (subsidiaryNexus == nexus) {
                    log.debug('VertexUpdateNexus', 'Nexus is associated to Subsidiary.');
                    return true;
                }
            }
            return false;
        }

        function getSubsidiaryShipState(transaction, subsidiary) {
            try {
                var subsidiaryShipState = '';
                var subRecord = record.load({ type: record.Type.SUBSIDIARY, id: subsidiary });
                transaction.subRecord = subRecord;
                subsidiaryShipState = subRecord.getValue({ fieldId: 'shipstate' });
                return subsidiaryShipState;
            } catch (err) {
                var errorDetailMsg = lib.logExecutionMsg(err, 'Subsidiary search error ');
                log.error('VertexBeforeSubmit2.0', errorDetailMsg);
                return '';
            }
        }

        /**
         * @param type
         * @returns
         */
        function accrualProcess(transaction, preferencesObj, recordType, recordId, newRecord) {
            //var paymentRecord = record.load({ type: recordType, id: recordId });
            var billsData = getAssociatedBillsData(recordId);
            var taxVariance = billsData.taxVariance;
            var subTotal = billsData.subtotal;
            var vendorTax = billsData.vendorTax;
            var appliedBills = billsData.appliedBills;
            var chargedTax = billsData.chargedTax;
            // CORST-1123 story changes by SYED
            var dppApplied = billsData.dppapplied;
            log.debug('VertexAfterSubmit2.0',
                'accrualProcess recordType: ' + recordType + ' recordId:'
                + recordId + ' taxVariance: '
                + taxVariance + ' subTotal:' + subTotal + ' vendorTax:'
                + vendorTax);
            // CORST-1123 story changes by SYED
            if (taxVariance > 0 || (dppApplied == true || dppApplied == 'T')) {
                var journalParams = createJournalParams(newRecord, taxVariance);
                if (journalParams) {
                    // send accrual request to vertex for the accrual amount
                    var accrualDetails = sendVertexAccrual(transaction, preferencesObj, recordId, recordType, vendorTax,
                        appliedBills, newRecord, dppApplied, chargedTax);
                    // GET TOTALTAX FROM ACCRUAL REQUEST AND CREATE JE FOR THAT AMOUNT
                    journalParams.amount = accrualDetails.TotalTax;
                    // CNSAPI-75 JE's being created for $0 - Do not create Journal if
                    // the accrual request is returning 0 tax
                    if (accrualDetails.status == 'Request failed to post to Vertex.') {
                        lib.submitField(recordType, recordId, ['custbody_tax_result_vt'],
                            [accrualDetails.status]);
                    } else if (getFloat(journalParams.amount) > 0) {
                        var journalId = createJournalEntry(journalParams);
                        lib.submitField(recordType, recordId, ['custbody_tax_result_vt',
                            'custbody_associated_tran_vt',
                            'custbody_accrual_amount_vt'], [
                            accrualDetails.status, journalId,
                            accrualDetails.TotalTax]);
                    } else {
                        lib.submitField(recordType, recordId, ['custbody_tax_result_vt',
                            'custbody_accrual_amount_vt'], [
                            'Success. TotalTax is 0, no Journal Entry.',
                            accrualDetails.TotalTax]);
                    }
                }
            }
        }

        /**
         * GET DATA FROM ASSOCIATED VENDOR BILLS
         * 
         * @param type
         * @returns
         */
        function getAssociatedBillsData(paymentInternalId) {
            //log.debug('getBillsDataFromSearch', 'paymentInternalId: '+paymentInternalId);
            var billsData = {
                taxVariance: 0,
                subtotal: 0,
                vendorTax: 0,
                appliedBills: [],
                dppapplied: false,
                chargedTax: 0
            };
            var filters = [];
            filters[0] = search.createFilter({
                name: 'internalid',
                operator: search.Operator.IS,
                values: paymentInternalId
            });
            filters[1] = search.createFilter({
                name: 'type',
                operator: search.Operator.IS,
                values: 'VendPymt'
            });
            filters[2] = search.createFilter({
                name: 'appliedtotransaction',
                operator: search.Operator.NONEOF,
                values: '@NONE@'
            });
            var columns = [];
            columns[0] = search.createColumn({ name: 'appliedtotransaction' });
            columns[1] = search.createColumn({ name: 'custbody_cut_tax_action_vt', join: 'appliedToTransaction' });
            columns[2] = search.createColumn({ name: 'custbody_tax_variance_vt', join: 'appliedToTransaction' });
            columns[3] = search.createColumn({ name: 'custbody_dpp_applied_vt', join: 'appliedToTransaction' });
            columns[4] = search.createColumn({ name: 'custbody_vendor_tax_vt', join: 'appliedToTransaction' });
            columns[5] = search.createColumn({ name: 'total', join: 'appliedToTransaction' });
            columns[6] = search.createColumn({ name: 'taxtotal', join: 'appliedToTransaction' });//search.createColumn('taxamount');??check

            var billsSearch = getSearchResults(search.Type.VENDOR_PAYMENT, filters, columns);
            //log.debug('getBillsDataFromSearch', 'billsSearch.length: '+billsSearch.length);
            for (var billsSearchIdx = 0; billsSearch && billsSearchIdx < billsSearch.length; billsSearchIdx++) {
                var taxAction = billsSearch[billsSearchIdx].getValue({ name: 'custbody_cut_tax_action_vt', join: 'appliedToTransaction' });
                var taxVariance = getFloat(billsSearch[billsSearchIdx].getValue({ name: 'custbody_tax_variance_vt', join: 'appliedToTransaction' }));
                //log.debug('$$$$taxVariance'+taxVariance);
                var dppappliedData = billsSearch[billsSearchIdx].getValue({ name: 'custbody_dpp_applied_vt', join: 'appliedToTransaction' });
                var billInternalId = billsSearch[billsSearchIdx].getValue({ name: 'appliedtotransaction' });
                billsData.appliedBills.push(billInternalId);
                //Accrual request is posted only for Pay & Accrue & Pay no Vendor Tax and Accrue
                if ((taxAction != '3' && taxAction != '7') || taxVariance <= 0)
                    continue;
                var vendorTax = getFloat(billsSearch[billsSearchIdx].getValue({ name: 'custbody_vendor_tax_vt', join: 'appliedToTransaction' }));
                var total = getFloat(billsSearch[billsSearchIdx].getValue({ name: 'total', join: 'appliedToTransaction' }));
                var usertaxtotal = Math.abs(getFloat(billsSearch[billsSearchIdx].getValue({ name: 'taxtotal', join: 'appliedToTransaction' })));//taxamount shows negative
                //getFloat(Math.abs(billRecord.getValue('taxamount')));
                var subtotal = (total - usertaxtotal);

                log.debug('getBillsDataFromSearch', billsSearchIdx + ' of ' + billsSearch.length + ' billInternalId: ' + billInternalId
                    + ' taxAction: ' + taxAction
                    + ' vendorTax: ' + vendorTax
                    + ' taxVariance: ' + taxVariance
                    + ' dppappliedData: ' + dppappliedData
                    + ' total: ' + total
                    + ' usertaxtotal: ' + usertaxtotal);

                billsData.taxVariance += taxVariance;
                billsData.subtotal += subtotal;
                billsData.vendorTax += vendorTax;
                if(taxAction == '3')//Pay & Accrue
                    billsData.chargedTax += vendorTax;
            }
            if (dppappliedData)
                billsData.dppapplied = dppappliedData;
            return billsData;
        }
        /**
         * @param appliedBills
         * @returns
         */
        function getAssociatedBillsItemsExpenses(transaction, preferencesObj, appliedBills) {
            if (appliedBills)
                log.debug('appliedBills#: ' + appliedBills.length, appliedBills);
            var lineItems = {
                expenses: [],
                items: []
            };
            var filters = [];
            filters[0] = search.createFilter({
                name: 'internalid',
                operator: search.Operator.IS,
                values: appliedBills
            });
            filters[1] = search.createFilter({
                name: 'mainline',
                operator: search.Operator.IS,
                values: 'F'
            });
            // filters[2] = search.createFilter({
            //     name: 'amount',
            //     operator: search.Operator.GREATERTHAN,
            //     values: '0.00'
            // });
            var columns = [];
            columns[0] = search.createColumn({ name: 'item' });
            columns[1] = search.createColumn({ name: 'rate' });
            columns[2] = search.createColumn({ name: 'itemtype' });
            columns[3] = search.createColumn({ name: 'account' });
            columns[4] = search.createColumn({ name: 'quantity' });
            columns[5] = search.createColumn({ name: 'amount' });
            columns[6] = search.createColumn({ name: 'location' });
            columns[7] = search.createColumn({ name: 'custcol_unspsc_code_vt' });
            columns[8] = search.createColumn({ name: 'expensecategory' });
            columns[9] = search.createColumn({ name: 'custcol_taxproductclass_vt' });
            columns[10] = search.createColumn({ name: 'custcol_itemname_vt' });
            columns[11] = search.createColumn({ name: 'expensecategory' });
            columns[12] = search.createColumn({ name: 'taxamount' });
            var billsSearch = getSearchResults(search.Type.VENDOR_BILL, filters, columns);
            // if(billsSearch)
            //     log.debug('getAssociatedBillsItemsExpenses length',billsSearch.length);
            for (var i = 0; billsSearch && i < billsSearch.length; i++) {
                var billRecord = billsSearch[i];
                var itemInternalId = billRecord.getValue('item');
                var isTaxAdjustmentItem = (itemInternalId == preferencesObj.taxAdjustmentItem);
                var item = {};
                if (!isTaxAdjustmentItem) {
                    if (!itemInternalId) {
                        var accountInternalId = billRecord.getValue('account');
                        item.account = findAccountInfoBy(transaction, 'internalid', accountInternalId, 'name');
                    } else
                        item.account = '';
                    item.rate = billRecord.getValue('rate');
                    item.quantity = billRecord.getValue('quantity');
                    item.category = billRecord.getValue('expensecategory');
                    item.location = billRecord.getValue('location');
                    item.itemType = billRecord.getValue('itemtype');
                    item.productClass = billRecord.getValue('custcol_taxproductclass_vt');
                    item.UNSPSCcode = billRecord.getValue('custcol_unspsc_code_vt');
                    item.amount = getFloat(billRecord.getValue('amount'));
                    //in some environment, amount and taxamount shows negative
                    if (item.amount)
                        item.amount = Math.abs(item.amount);
                    item.taxamount = getFloat(billRecord.getValue('taxamount'));
                    if (item.taxamount)
                        item.taxamount = Math.abs(item.taxamount);
                    item.itemName = billRecord.getValue('custcol_itemname_vt');
                    //log.debug( "itemName: " + item.itemName);
                    if (!item.quantity) {
                        item.quantity = 1;
                        item.rate = item.amount;
                    }
                    if (!item.itemName) {
                        item.itemName = 'expense';
                        item.sublistType = 'expense';
                    } else
                        item.sublistType = 'item';
                    if (item.productClass) {
                        item.productClass = findProductClassInfoBy(transaction, 'internalid', item.productClass, 'name');
                    }
                    if (item.UNSPSCcode) {
                        item.UNSPSCcode = findUNSPCcodeInfoBy(transaction, 'internalid', item.UNSPSCcode, 'name');
                    }
                    if (item.location) {
                        item.lineLocation = getLocationAddress(item.location, transaction);
                    } else if (transaction.hdrLocation || !transaction.ismultishipto) {
                        item.lineLocation = transaction.hdrLocation;
                    }
                    //in search there is no way to get the item amount excluding tax in one field, so get the net amount and  deduct the taxamount
                    item.amount = (item.amount - item.taxamount).toFixed(2);
                    //exclude line items with no amount 
                    if (item.amount > 0)
                        lineItems.items.push(item);
                    // log.debug('amount' + item.amount);
                    // log.debug('lineItems',JSON.stringify(lineItems));              
                }
            }
            return lineItems;
        }

        function getAllAccounts() {
            var accountFilter = [];
            var accountSearchColumns = [];
            accountSearchColumns[0] = search.createColumn("internalid");
            accountSearchColumns[1] = search.createColumn("name");
            //HHTODO
            // accountSearchColumns[2] = search.createColumn("number");
            return getSearchResults(record.Type.ACCOUNT, accountFilter, accountSearchColumns);
        }

        function findAccountInfoBy(transaction, filter, filterValue, info) {
            var accountInfo = '';
            if (!filter || !filterValue) {
                return accountInfo;
            }
            for (var i = 0; transaction.accounts && i < transaction.accounts.length; i++) {
                var accountSearchFilter = transaction.accounts[i].getValue(filter);
                if (accountSearchFilter == filterValue) {
                    accountInfo = transaction.accounts[i].getValue(info);
                    break;
                }
            }
            return accountInfo;
        }
        /**
         * Function to search Expense Categories and get the Purchase class.
         *
         * @return array
         */
        function getAllExpenseCategories() {
            var productClassFieldId = 'custrecord_purchase_class_vt';
            var expenseCategoryResults = search.create({
                type: search.Type.EXPENSE_CATEGORY,
                columns: [productClassFieldId]
            }).run().getRange({
                start: 0,
                end: 1000
            });
            var expenseCategoryValues = [];
            for (var i = 0; expenseCategoryResults && i < expenseCategoryResults.length; i++) {
                var expenseCategoryId = expenseCategoryResults[i].id;
                var productClass = expenseCategoryResults[i].getValue(productClassFieldId);
                expenseCategoryValues.push({
                    expenseCategoryId: expenseCategoryId,
                    productClass: productClass
                });
            }
            //log.debug('expenseCategoryValues', JSON.stringify(expenseCategoryValues));
            return expenseCategoryValues;
        }
        /**get the purchase class for a given Expense Category
         * @param filter
         * @param filterValue
         * @param info
         * @returns
         */
        function getPurchaseClass(expenseCategoryValues, currentCatId) {
            //log.debug('currentCatId',currentCatId);
            if (!expenseCategoryValues || !currentCatId)
                return '';
            for (var idx = 0; expenseCategoryValues != null
                && idx < expenseCategoryValues.length; idx++) {
                var categoryId = expenseCategoryValues[idx].expenseCategoryId;
                //log.debug('idx || categoryId',idx + '||'+categoryId);
                if (categoryId == currentCatId) {
                    //log.debug('found productClass', expenseCategoryValues[idx].productClass);
                    return expenseCategoryValues[idx].productClass;
                }
            }
            return '';
        }
        function getAllProductClasses() {
            var filter = [];
            var productClassSearchColumns = [];
            productClassSearchColumns[0] = search.createColumn('internalid');
            productClassSearchColumns[1] = search.createColumn('name');
            return getSearchResults('customlist_taxproductclass_vt', filter, productClassSearchColumns);
        }

        function findProductClassInfoBy(transaction, filter, filterValue, info) {
            var productClassInfo = '';
            if (!filter || !filterValue) {
                return productClassInfo;
            }
            for (var i = 0; transaction.productClasses
                && i < transaction.productClasses.length; i++) {
                var productClassSearchFilter = transaction.productClasses[i].getValue(filter);
                if (productClassSearchFilter == filterValue) {
                    productClassInfo = transaction.productClasses[i].getValue(info);
                    break;
                }
            }
            return productClassInfo;
        }

        function getAllUNSPCcodes() {
            var filter = [];
            var UNSPSCcodeSearchColumns = [];
            UNSPSCcodeSearchColumns[0] = search.createColumn('internalid');
            UNSPSCcodeSearchColumns[1] = search.createColumn('name');
            return getSearchResults('customlist_unspsc_code_vt', filter, UNSPSCcodeSearchColumns);
        }

        function findUNSPCcodeInfoBy(transaction, filter, filterValue, info) {
            var UNSPCcodeInfo = '';
            if (!filter || !filterValue) {
                return UNSPCcodeInfo;
            }
            for (var i = 0; transaction.UNSPCcodes && i < transaction.UNSPCcodes.length; i++) {
                var UNSPCcodeSearchFilter = transaction.UNSPCcodes[i].getValue(filter);
                if (UNSPCcodeSearchFilter == filterValue) {
                    UNSPCcodeInfo = transaction.UNSPCcodes[i].getValue(info);
                    break;
                }
            }
            return UNSPCcodeInfo;
        }

        /**
         * creates journal parameters from paymentRecord
         * 
         * @param paymentRecord
         */
        function createJournalParams(paymentRecord, taxVariance) {
            var journalParams = {};
            var scriptObj = runtime.getCurrentScript();
            journalParams.debitAccount = scriptObj.getParameter('custscript_payables_account_vt');
            journalParams.creditAccount = scriptObj.getParameter('custscript_vt_cut_accrual_account');

            if (!journalParams.debitAccount || journalParams.debitAccount == null) {
                return null;
            }
            // journalParams.amount = taxVariance;
            journalParams.trandate = paymentRecord.getValue({ fieldId: 'trandate' });
            journalParams.subsidiary = paymentRecord.getValue({ fieldId: 'subsidiary' });
            journalParams.currency = paymentRecord.getValue({ fieldId: 'currency' });
            journalParams.exchangerate = paymentRecord.getValue({ fieldId: 'exchangerate' });
            journalParams.associatedPayment = paymentRecord.id;
            journalParams.memo = 'TaxAjustAccrual-Payment internalid ' + paymentRecord.id;
            log.debug('VertexAfterSubmit2.0', 'createJournal:' + JSON.stringify(journalParams));
            return journalParams;
        }

        /**
         * Create journal based on the parameters
         * 
         * @param journalParams
         */
        function createJournalEntry(journalParams) {
            var journal = record.create({ type: record.Type.JOURNAL_ENTRY });
            journal.setValue({ fieldId: 'subsidiary', value: journalParams.subsidiary });
            journal.setValue({ fieldId: 'trandate', value: journalParams.trandate });
            journal.setValue({ fieldId: 'currency', value: journalParams.currency });
            journal.setValue({ fieldId: 'exchangerate', value: journalParams.exchangerate });
            journal.setValue({ fieldId: 'memo', value: journalParams.memo });
            journal.setValue({ fieldId: 'custbody_associated_tran_vt', value: journalParams.associatedPayment });

            journal.insertLine({ sublistId: 'line', line: 0 });
            journal.setSublistValue({ sublistId: 'line', fieldId: 'account', line: 0, value: journalParams.creditAccount });
            journal.setSublistValue({ sublistId: 'line', fieldId: 'credit', line: 0, value: journalParams.amount });
            journal.setSublistValue({ sublistId: 'line', fieldId: 'memo', line: 0, value: journalParams.memo });
            journal.insertLine({ sublistId: 'line', line: 1 });
            journal.setSublistValue({ sublistId: 'line', fieldId: 'account', line: 1, value: journalParams.debitAccount });
            journal.setSublistValue({ sublistId: 'line', fieldId: 'debit', line: 1, value: journalParams.amount });
            journal.setSublistValue({ sublistId: 'line', fieldId: 'memo', line: 1, value: journalParams.memo });
            return journal.save();
        }
        /**
         * RQ-86899 On afterSubmit add/remove adjustment item on relevant scenario 
         * Tax Adjustment item should only be there when it is Pay & Accrue
         * For one customer, this item is added for other cases also, remove the item in that scenario
         * @param recordType    
         * @param recordId
         * @returns 
         */
        function CUTimplementation(recordType, recordId) {
            //log.debug('CUTimplementationAS', 'Remove adjustment - start');
            var tranRec = record.load({ type: recordType, id: recordId });
            var CUTaction = tranRec.getText({ fieldId: 'custbody_cut_tax_action_vt' });
            if (!CUTaction)
                return;
            log.debug('###AfterSubCUTaction', 'CUTaction: ' + CUTaction);
            var scriptObj = runtime.getCurrentScript();
            var taxAdjustmentItem = scriptObj.getParameter('custscript_tax_adjustment_item_vt');
            var taxAdjustmentItemIdx = tranRec.findSublistLineWithValue({
                sublistId: 'item',
                fieldId: 'item',
                value: taxAdjustmentItem
            });
            log.debug("addAdjustmentItem2.0", "taxAdjustmentItemIdx: " + taxAdjustmentItemIdx);
            if ((CUTaction == 'Pay & Accrue' || CUTaction == 'Pay no Vendor Tax and Accrue') && taxAdjustmentItemIdx < 0) {
                //add Adjustment item for $0 to hold the tax difference in the tax details
                //log.debug('###AfterSubCUTaction', 'CUTaction: '+CUTaction + 'No Adjustment'); 
                taxAdjustmentItemIdx = tranRec.getLineCount({ sublistId: 'item' });
                //log.debug("addAdjustmentItem2.0", "itemCount: " + tranRec.getLineCount({sublistId: 'item'}));
                tranRec.insertLine('item', taxAdjustmentItemIdx);
                tranRec.setSublistValue({ sublistId: 'item', fieldId: 'item', line: taxAdjustmentItemIdx, value: taxAdjustmentItem });
                tranRec.setSublistValue({ sublistId: 'item', fieldId: 'quantity', line: taxAdjustmentItemIdx, value: '1' });
                tranRec.setSublistValue({ sublistId: 'item', fieldId: 'rate', line: taxAdjustmentItemIdx, value: '0' });
                tranRec.setSublistValue({ sublistId: 'item', fieldId: 'amount', line: taxAdjustmentItemIdx, value: '0' });
                log.debug('VertexAfterSubmit2.0', CUTaction + ' - added adjustment');
            }
            if ((CUTaction == 'Pay Vendor Tax' || CUTaction == 'Overpay'
                || CUTaction == 'Within Threshold' || CUTaction == 'Shortpay')
                && taxAdjustmentItemIdx >= 0) {
                //log.debug('removeBlankAdjustment', 'taxAdjustmentItemIdx:'+taxAdjustmentItemIdx);
                tranRec.removeLine({
                    sublistId: 'item',
                    line: taxAdjustmentItemIdx,
                    ignoreRecalc: true
                });
                log.debug('VertexAfterSubmit2.0', CUTaction + ' - removed adjustment');
            }
            var recordId = tranRec.save({
                enableSourcing: true,
                ignoreMandatoryFields: true
            });
        }
        /**
         * @param vertexTax
         * @returns boolean
         */
        function getThreshold(vertexTax) {
            var scriptObj = runtime.getCurrentScript();
            var thresholdPercent = scriptObj.getParameter('custscript_cut_threshold_percent_vt');
            var thresholdAmount = scriptObj.getParameter('custscript_cut_threshold_amount_vt');
            var thresholdPercentAmount = 0;
            if (thresholdPercent)
                thresholdPercentAmount = (vertexTax * getFloat(thresholdPercent) / 100);
            if (thresholdPercent && thresholdAmount) {
                thresholdAmount = getFloat(thresholdAmount);
                if (thresholdAmount < thresholdPercentAmount)
                    return thresholdAmount;
                else
                    return thresholdPercentAmount;
            }
            if (thresholdPercent)
                return thresholdPercentAmount;
            else
                return thresholdAmount;
        }
        /**
         * Check if the tax difference is with in the threshold
         * @param taxDiff
         * @param CUTthreshold
         * @returns boolean
         */
        function checkWithinThreshold(taxDiff, CUTthreshold) {
            if (taxDiff < 0)
                taxDiff = (taxDiff * -1);
            if (taxDiff <= CUTthreshold)
                return true;
            else
                return false;
        }
        /**
         * link the Call details with the transaction
         * @param transaction
         * @param curRecord
         * @param recordType
         * @param recordId
         * @param context
         * @param preferencesObj
         * @returns 
         */
        function updateVertexCallDetails(transaction, curRecord, recordType, recordId, context, preferencesObj) {
            log.debug('VertexAfterSubmit2.0', 'recordType:' + recordType
                + '; internalid: ' + recordId);
            // getTransactionDetails(transaction, preferencesObj, recordId, recordType, false);
            var filters = [];
            filters[0] = search.createFilter({
                name: 'custrecord_transaction_internalid_vt',
                operator: search.Operator.EQUALTO,
                values: recordId
            });
            filters[1] = search.createFilter({
                name: 'custrecord_trans_vt',
                operator: search.Operator.ANYOF,
                values: '@NONE@'
            })
            var columns = [];
            columns[0] = search.createColumn('internalid');
            columns[1] = search.createColumn('custrecord_transaction_internalid_vt');
            columns[2] = search.createColumn('custrecord_tax_result_vt');
            columns[3] = search.createColumn('custrecord_total_tax_vt');
            columns[4] = search.createColumn('custrecord_process_date_vt');
            columns[5] = search.createColumn('custrecord_request_vt');
            columns[6] = search.createColumn('custrecord_request_type_vt');
            columns[7] = search.createColumn('custrecord_tranid_missing_vt');
            columns[8] = search.createColumn('custrecord_cut_tax_action_vt');
            columns[9] = search.createColumn('custrecord_cut_tax_variance_vt');
            // CORST-1123 story changes by SYED
            columns[10] = search.createColumn('custrecord_dpp_applied_vt');
            columns[11] = search.createColumn('custrecord_response_vt');
            var searchResults = getSearchResults('customrecord_call_details_vt', filters, columns);
            for (var idx = 0; searchResults != null && idx < searchResults.length; idx++) {
                var detailsVt = {};

                detailsVt.vertexCallRecId = searchResults[idx].getValue({ name: 'internalId' });
                detailsVt.transactionId = searchResults[idx]
                    .getValue({ name: 'custrecord_transaction_internalid_vt' });
                detailsVt.taxResult = searchResults[idx]
                    .getValue({ name: 'custrecord_tax_result_vt' });
                detailsVt.vertexTax = searchResults[idx]
                    .getValue({ name: 'custrecord_total_tax_vt' });
                detailsVt.vertexProcessDate = searchResults[idx]
                    .getValue({ name: 'custrecord_process_date_vt' });
                detailsVt.requestTypeVt = searchResults[idx]
                    .getValue({ name: 'custrecord_request_type_vt' });
                detailsVt.requestVt = searchResults[idx]
                    .getValue({ name: 'custrecord_request_vt' });
                detailsVt.response = searchResults[idx]
                    .getValue({ name: 'custrecord_response_vt' });
                // var requestVt = searchResults[idx]
                // .getValue({name: 'custrecord_request_vt_hdn'});
                // Handle To Be Generated/blank tranid on posting transactions; post
                // InvoiceRequest with tranid on aftersubmit on relevant documents
                detailsVt.tranidMissing = searchResults[idx]
                    .getValue({ name: 'custrecord_tranid_missing_vt' });
                detailsVt.CUTtaxAction = searchResults[idx]
                    .getValue({ name: 'custrecord_cut_tax_action_vt' });
                detailsVt.CUTVariance = searchResults[idx]
                    .getValue({ name: 'custrecord_cut_tax_variance_vt' });
                // CORST-1123 story changes by SYED
                detailsVt.dppapplied = searchResults[idx].getValue({ name: 'custrecord_dpp_applied_vt' })
                //detailsVt.tokenHdr = searchResults[idx].getValue({fieldId: 'custrecord_token_header_cd_vt'});
                var postOnAfterSubmit = false;
                if (context.type == context.UserEventType.CREATE
                    && detailsVt.tranidMissing
                    && (recordType == record.Type.INVOICE || recordType == record.Type.CASH_SALE
                        || recordType == record.Type.CASH_REFUND || recordType == record.Type.CREDIT_MEMO)) {
                    var newRecord = record.load({ type: recordType, id: recordId });
                    var tranid = newRecord.getValue({ fieldId: 'tranid' });

                    var invRequestWithTranid;
                    var invResponseWithTranid;
                    log.debug('updateVertexCallDetails', 'preferencesObj: ' + JSON.stringify(preferencesObj));
                    if (preferencesObj.useRest) {
                        log.debug('updateVertexCallDetails', 'generating REST request with TRAN ID');
                        invRequestWithTranid = generateRestRequestWithTranid(detailsVt.requestVt, tranid, recordId, preferencesObj);
                    } else {
                        log.debug('updateVertexCallDetails', 'generating SOAP request with TRAN ID');
                        invRequestWithTranid = generateRequestWithTranid(detailsVt.requestVt, tranid, recordId, preferencesObj);
                    }

                    if (preferencesObj.useRest && !preferencesObj.isSoapFormat) {
                        invResponseWithTranid = postRestWithTranid(transaction, curRecord, invRequestWithTranid, preferencesObj);
                        invResponseWithTranid = JSON.parse(invResponseWithTranid); // Parse the JSON string into an object
                        detailsVt.vertexTax = Math.abs(parseFloat(invResponseWithTranid.totalTax));
                        invRequestWithTranid = JSON.stringify(invRequestWithTranid);
                        invResponseWithTranid = JSON.stringify(invResponseWithTranid);
                    } else {
                        invResponseWithTranid = postWithTranid(transaction, curRecord, invRequestWithTranid, preferencesObj);
                        var soapXML = xml.Parser.fromString({
                            text: invResponseWithTranid
                        });

                        var subNode = xml.XPath.select({
                            node: soapXML,
                            xpath: "//*[name()='TotalTax']"
                        });

                        if (subNode) {
                            detailsVt.vertexTax = Math.abs(parseFloat(subNode[0].textContent));
                        }
                    }
                    postOnAfterSubmit = true;
                    detailsVt.requestTypeVt = 'InvoiceRequest';
                    detailsVt.vertexProcessDate = new Date();
                    detailsVt.requestVt = invRequestWithTranid;
                }
                if (postOnAfterSubmit && invResponseWithTranid) {
                    if (invResponseWithTranid.length >= 1000000)
                        invResponseWithTranid = invResponseWithTranid.substring(0, 999999);
                    lib.submitField('customrecord_call_details_vt',
                        detailsVt.vertexCallRecId, ['custrecord_trans_vt',
                        'custrecord_request_vt', 'custrecord_response_vt',
                        'custrecord_request_type_vt', 'custrecord_total_tax_vt'], [
                        detailsVt.transactionId, invRequestWithTranid,
                        invResponseWithTranid, 'InvoiceRequest', detailsVt.vertexTax]);
                }
                else {
                    lib.submitField('customrecord_call_details_vt',
                        detailsVt.vertexCallRecId, ['custrecord_trans_vt', 'custrecord_total_tax_vt'],
                        [detailsVt.transactionId, detailsVt.vertexTax]);
                }
                log.debug('VertexAfterSubmit2.0',
                    'Link Vertex Call Details custom record internalid; '
                    + detailsVt.vertexCallRecId
                    + ' with transaction internalid: '
                    + detailsVt.transactionId)
                // log.debug('updateVertexCallDetails', 'detailsVt: ' + JSON.stringify(detailsVt));
                if (detailsVt.vertexProcessDate
                    && detailsVt.requestTypeVt == 'InvoiceRequest')
                    lib.submitField(recordType, recordId, ['custbody_tax_result_vt',
                        'custbody_vertex_tax_vt', 'custbody_process_date_vt_2',
                        'custbody_request_vt', 'custbody_vertex_api_taxtotal'], [detailsVt.taxResult,
                        detailsVt.vertexTax, detailsVt.vertexProcessDate,
                        detailsVt.requestVt, detailsVt.vertexTax]);
                    else if((transaction.subRecord.getValue('custrecord_canada_procurement_vt') || transaction.subRecord.getValue('custrecord_canada_procurement_vt') == true) && preferencesObj.useRest)
                    {
                        var recId= curRecord.id;
                        var uniqueIDValue=curRecord.getValue("custbody_transaction_unique_id_vt");
                        var postToCanada=curRecord.getValue("custbody_canada_post_to_journal_vt");
                        var paymentholdFlag=curRecord.getValue("paymenthold");
                        
                        var oldRequest=curRecord.getValue("custbody_request_vt");
                        var response = JSON.parse(detailsVt.response);
                        log.debug('responseresponse',response.data.taxEvaluationResult)
                        log.debug('responseresponse1',response.data.taxEvaluationActionResult)
                        log.debug('responseresponse2',response.data.taxEvaluationHoldFlag)
                        log.debug('responseresponse3',response.data.taxEvaluationHoldReason)
                        var taxEveResults =response.data.taxEvaluationResult;
                        var taxEveAction  =response.data.taxEvaluationActionResult;
                        var taxEveHold	   =response.data.taxEvaluationHoldFlag;
                        var taxEveHoldReson = response.data.taxEvaluationHoldReason;
                        var postToJournalCanada = response.data.postToJournal;
                        var uniqueIdData='';
						
						if(response)
						{
							uniqueIdData = response.data.transactionId;
							log.debug("oldRequest id",uniqueIdData)
						}
						if(taxEveResults == "MATCHED")
						postToJournalCanada = true;
					
						var currentTime = new Date().getTime();
					
						if(!curRecord.getValue("custbody_transaction_unique_id_vt"))
						{
							if(taxEveHold || taxEveHold == true){
							lib.submitField(recordType, recordId, ['custbody_tax_result_vt',
								'custbody_vertex_tax_vt', 'custbody_process_date_vt_2',
								'custbody_request_vt', 'custbody_vertex_api_taxtotal','custbody_tax_evaluation_result_vt','custbody_tax_evaluation_action_result','custbody_tax_evaluation_hold_reason_vt','paymenthold','custbody_canada_post_to_journal_vt','custbody_transaction_unique_id_vt'], [detailsVt.taxResult,
								detailsVt.vertexTax, detailsVt.vertexProcessDate,
								detailsVt.requestVt, detailsVt.vertexTax,taxEveResults,taxEveAction,taxEveHoldReson,taxEveHold,postToJournalCanada,uniqueIdData]);
							}
							else{
								if(paymentholdFlag || paymentholdFlag == true){
								lib.submitField(recordType, recordId, ['custbody_tax_result_vt',
								'custbody_vertex_tax_vt', 'custbody_process_date_vt_2',
								'custbody_request_vt', 'custbody_vertex_api_taxtotal','custbody_tax_evaluation_result_vt','custbody_tax_evaluation_action_result','custbody_tax_evaluation_hold_reason_vt','custbody_canada_post_to_journal_vt','custbody_transaction_unique_id_vt','paymenthold'], [detailsVt.taxResult,
								detailsVt.vertexTax, detailsVt.vertexProcessDate,
								detailsVt.requestVt, detailsVt.vertexTax,taxEveResults,taxEveAction,taxEveHoldReson,postToJournalCanada,uniqueIdData,taxEveHold]);
								}
								else{
									lib.submitField(recordType, recordId, ['custbody_tax_result_vt',
								'custbody_vertex_tax_vt', 'custbody_process_date_vt_2',
								'custbody_request_vt', 'custbody_vertex_api_taxtotal','custbody_tax_evaluation_result_vt','custbody_tax_evaluation_action_result','custbody_tax_evaluation_hold_reason_vt','custbody_canada_post_to_journal_vt','custbody_transaction_unique_id_vt'], [detailsVt.taxResult,
								detailsVt.vertexTax, detailsVt.vertexProcessDate,
								detailsVt.requestVt, detailsVt.vertexTax,taxEveResults,taxEveAction,taxEveHoldReson,postToJournalCanada,uniqueIdData]);
							
								}
							}
						}
						else{
							if(taxEveHold || taxEveHold == true){
							lib.submitField(recordType, recordId, ['custbody_tax_result_vt',
								'custbody_vertex_tax_vt', 'custbody_process_date_vt_2',
								'custbody_request_vt', 'custbody_vertex_api_taxtotal','custbody_tax_evaluation_result_vt','custbody_tax_evaluation_action_result','custbody_tax_evaluation_hold_reason_vt','paymenthold','custbody_canada_post_to_journal_vt','custbody_transaction_unique_id_vt'], [detailsVt.taxResult,
								detailsVt.vertexTax, detailsVt.vertexProcessDate,
								detailsVt.requestVt, detailsVt.vertexTax,taxEveResults,taxEveAction,taxEveHoldReson,taxEveHold,postToJournalCanada,uniqueIdData]);
							}
							else{
								if(paymentholdFlag || paymentholdFlag == true){
								lib.submitField(recordType, recordId, ['custbody_tax_result_vt',
								'custbody_vertex_tax_vt', 'custbody_process_date_vt_2',
								'custbody_request_vt', 'custbody_vertex_api_taxtotal','custbody_tax_evaluation_result_vt','custbody_tax_evaluation_action_result','custbody_tax_evaluation_hold_reason_vt','custbody_canada_post_to_journal_vt','paymenthold','custbody_transaction_unique_id_vt'], [detailsVt.taxResult,
								detailsVt.vertexTax, detailsVt.vertexProcessDate,
								detailsVt.requestVt, detailsVt.vertexTax,taxEveResults,taxEveAction,taxEveHoldReson,postToJournalCanada,taxEveHold,uniqueIdData]);		
								}
								else{
									lib.submitField(recordType, recordId, ['custbody_tax_result_vt',
								'custbody_vertex_tax_vt', 'custbody_process_date_vt_2',
								'custbody_request_vt', 'custbody_vertex_api_taxtotal','custbody_tax_evaluation_result_vt','custbody_tax_evaluation_action_result','custbody_tax_evaluation_hold_reason_vt','custbody_canada_post_to_journal_vt','custbody_transaction_unique_id_vt',], [detailsVt.taxResult,
								detailsVt.vertexTax, detailsVt.vertexProcessDate,
								detailsVt.requestVt, detailsVt.vertexTax,taxEveResults,taxEveAction,taxEveHoldReson,postToJournalCanada,uniqueIdData]);		
								}
								
							}
						}
				    }
                    else if(detailsVt.vertexTax)					
                        lib.submitField(recordType, recordId, ['custbody_tax_result_vt',
                            'custbody_vertex_tax_vt', 'custbody_cut_tax_action_vt', 'custbody_tax_variance_vt', 'custbody_dpp_applied_vt', 'custbody_vertex_api_taxtotal'],
                            [detailsVt.taxResult, detailsVt.vertexTax, detailsVt.CUTtaxAction, detailsVt.CUTVariance, detailsVt.dppapplied, detailsVt.vertexTax]);
                    else
                        lib.submitField(recordType, recordId, ['custbody_tax_result_vt',
                            'custbody_vertex_tax_vt', 'custbody_cut_tax_action_vt', 'custbody_tax_variance_vt', 'custbody_dpp_applied_vt'],
                            [detailsVt.taxResult, detailsVt.vertexTax, detailsVt.CUTtaxAction, detailsVt.CUTVariance, detailsVt.dppapplied]);
                    log.debug('VertexAfterSubmit2.0',
                    'Update Vertex Call Details internalid; '
                    + detailsVt.transactionId + ' with Vertex Tax Result.');
            }
        }

        /**
         * get URL from preferences/subsidiary record on after submit
         * 
         * @returns serviceURL
         */
        function getURL(curRecord) {
            var scriptObj = runtime.getCurrentScript();
            var useRest = scriptObj.getParameter('custscript_use_rest_vt');
            var serviceURL;
            if (useRest) {
                serviceURL = scriptObj.getParameter('custscript_rest_base_url_vt');
            } else {
                serviceURL = scriptObj.getParameter('custscript_taxserviceurl_vt');
            }
            try {
                var oneWorld = scriptObj.getParameter(
                    'custscript_oneworldflag_vt');
                if (oneWorld) {
                    var subsidiary = curRecord.getValue({ fieldId: 'subsidiary' });
                    var subRecord = record.load({ type: record.Type.SUBSIDIARY, id: subsidiary });
                    if (!useRest) {
                        serviceURL = subRecord.getValue({ fieldId: 'custrecord_taxserviceurl_vt' });
                    }
                }
            } catch (e) {
                log.error('Subsidiary Error', e.name + '\n'
                    + e.message);
            }
            return serviceURL;
        }

        function postRestWithTranid(transaction, curRecord, requestVt, preferencesObj) {
            try {
                var serviceURL = lib.getServiceUrl(transaction, preferencesObj);
                if (transaction.sellerOrBuyer == 'Buyer') {
                    serviceURL = serviceURL + '/v2/procurement';
                } else {
                    serviceURL = serviceURL + '/v2/supplies';
                }
                log.debug('postRestWithTranid', 'serviceURL: ' + serviceURL);
                log.debug('postRestWithTranid', 'requestVt: ' + JSON.stringify(requestVt));

                //Token based auth additional logic

                if (transaction.useToken) {
                    //Get token params if saved in custom record otherwise post token request and save params in custom record.
                    var useTokenStatus = lib.tokenLogic(transaction, preferencesObj);
                    if (!useTokenStatus)
                        return '';
                    log.debug('postRestWithTranid', 'transaction.tokenParams: ' + JSON.stringify(transaction.tokenParams));
                    log.debug('postRestWithTranid', 'transaction.tokenHeader: ' + JSON.stringify(transaction.tokenHeader));
                }

                var headers = {};
                headers['Content-Type'] = 'application/json';
                headers['Authorization'] = transaction.tokenHeader.authorization;
                headers['Accept'] = 'application/json';
                log.debug('postRestWithTranid', 'headers: ' + JSON.stringify(headers));

                var vertexResponse = https.post({ url: serviceURL, body: JSON.stringify(requestVt), headers: headers });
                var requestType = 'InvoiceRequest';
                if (transaction.useToken && vertexResponse) {
                    var responseCode = vertexResponse.code;
                    if (responseCode == 401 || responseCode == 403 || (responseCode == 500 && vertexResponse.body && vertexResponse.body.message && vertexResponse.body.message.contains('expired'))) {
                        log.debug('VertexAfterSubmit2.0', ' Token expired', 'Retry with new token ');
                        var postToken = lib.postTokenRequest(transaction);
                        if (!postToken) {
                            log.debug('VertexAfterSubmit2.0', 'Token', 'Unsuccessful token call');
                            return vertexResponse;
                        }
                        lib.saveTokenInCustomRecord(transaction);
                        transaction.tokenHeader = lib.getTokenFromCustomRecord();
                        headers['Authorization'] = transaction.tokenHeader.authorization;
                        log.debug('postRestWithTranid', 'headers: ' + JSON.stringify(headers));
                        vertexResponse = https.post({ url: serviceURL, body: JSON.stringify(requestVt), headers: headers });
                    }
                }
                if (vertexResponse.code != 200) {
                    var faultString = '';
                    if (vertexResponse.errors && vertexResponse.errors != undefined && vertexResponse.errors[0]) {
                        faultString = vertexResponse.errors[0].message;
                    }
                    log.error('VertexAfterSubmit2.0', 'PostWithTranIdResponseCode: ' +
                        vertexResponse.code + ' fault string = ' + faultString);
                } else {
                    var responseBody = JSON.parse(vertexResponse.body);
                    log.debug('VertexAfterSubmit2.0', 'PostWithTranIdResponse: ' + JSON.stringify(responseBody.data));
                    return JSON.stringify(responseBody.data);
                }
            } catch (e) {
                log.error('VertexAfterSubmit2.0', 'PostWithTranIdResponseCode:' + e.name
                    + '\n' + e.message);
            }
            return '';
        }

        /**
         * @param Post
         *            InvoiceRequest with tranid on after submit when the tranid does
         *            not exist in the before submit.
         */
        function postWithTranid(transaction, curRecord, requestVt, preferencesObj) {
            try {
                var serviceURL = lib.getServiceUrl(transaction, preferencesObj);
                log.debug('postWithTranid', 'serviceURL: ' + serviceURL);
                log.debug('postWithTranid', 'requestVt: ' + requestVt);

                // log.debug('Vertex2.0', ' PostWithTranId URL:'+serviceURL);
                var soapHead = {};
                soapHead['Content-Type'] = 'text/xml';
                // log.debug("postWithTranid2.0", "serviceURL: " + serviceURL);
                // log.debug("postWithTranid2.0", "useToken: " + useToken);
                if (transaction.useToken) {
                    //Get token params if saved in custom record otherwise post token request and save params in custom record.
                    var useTokenStatus = lib.tokenLogic(transaction);
                    log.debug('VertexAfterSubmit2.0', "postWithTranid2.0 useTokenStatus: " + useTokenStatus);
                    if (!useTokenStatus)
                        return '';
                    soapHead = transaction.tokenHeader;
                    // log.debug('postWithTranid2.0', 'tokenHeader: '+transaction.tokenHeader );
                }
                // log.debug('postWithTranid2.0', 'request body: ' + requestVt);
                var vertexResponse = https.post({ url: serviceURL, body: requestVt, headers: soapHead });
                var requestType = 'InvoiceRequest';
                //if the token or credentials expired, retry with new token 
                if (transaction.useToken && vertexResponse) {
                    var responseCode = vertexResponse.code;
                    if (responseCode == 403 || (responseCode == 500 && vertexResponse.body.indexOf('expired') >= 0)) {
                        log.debug('VertexAfterSubmit2.0', ' Token expired', 'Retry with new token ');
                        var postToken = lib.postTokenRequest(transaction);
                        if (!postToken) {
                            log.debug('VertexAfterSubmit2.0', 'Token', 'Unsuccessful token call');
                            return vertexResponse;
                        }
                        lib.saveTokenInCustomRecord(transaction);
                        vertexResponse = https.post({ url: serviceURL, body: soap, headers: transaction.tokenHeader });
                    }
                }
                if (vertexResponse.code != 200) {
                    var soapText = '';
                    soapText = vertexResponse.body;
                    if (soapText && soapText.length < 1500) {
                        faultString = soapText;
                    } else {
                        errorXML = xml.Parser.fromString({
                            text: soapText
                        });
                        if (soapText.indexOf('faultstring') >= 0) {
                            var faultNode = xml.XPath.select({
                                node: errorXML,
                                xpath: "//*[name()='faultstring']"
                            });
                            faultString = faultNode[0].textContent;
                        }
                    }
                    log.error('VertexAfterSubmit2.0', 'PostWithTranIdResponseCode: ' +
                        vertexResponse.code + ' fault string = ' + faultString);
                } else {
                    log.debug('VertexAfterSubmit2.0', 'PostWithTranIdResponse: ' + vertexResponse.body);
                    return vertexResponse.body;
                }
            } catch (e) {
                log.error('VertexAfterSubmit2.0', 'PostWithTranIdResponseCode:' + e.name
                    + '\n' + e.message);
            }
            return '';
        }

        function generateRestRequestWithTranid(prevRequest, tranid, internalid, preferencesObj) {
            log.debug('generateRestRequestWithTranid', 'prevRequest: ' + prevRequest);
            var invRequestWithTranid;
            try {
                invRequestWithTranid = JSON.parse(prevRequest);

                if (tranid && tranid != undefined && tranid != '') {
                    invRequestWithTranid.documentNumber = tranid;
                }
                if (internalid && internalid != undefined && internalid != '') {
                    invRequestWithTranid.transactionId = internalid;
                }
                invRequestWithTranid.saleMessageType = "INVOICE";
                preferencesObj.isSoapFormat = false;
            } catch (error) {
                log.error('generateRestRequestWithTranid', 'Request not in REST format, using SOAP');
                invRequestWithTranid = generateRequestWithTranid(prevRequest, tranid, internalid, preferencesObj);
            }
            return invRequestWithTranid;
        }

        /**
         * 
         * @param soap
         * @returns soap
         */
        function generateRequestWithTranid(prevRequest, tranid, internalid, preferencesObj) {
            // if(isDistributeTax == 'T')
            // prevRequest = prevRequest.replace(/postToJournal= "false"/g,
            // 'postToJournal= "true"');
            // else
            prevRequest = prevRequest.replace(/QuotationRequest/g, "InvoiceRequest");
            if (tranid == '' || tranid == 'undefined' || tranid == 'null'
                || tranid == 'To Be Generated')
                tranid = ' ';
            if (!internalid || internalid == '' || internalid == 'undefined'
                || internalid == 'null' || internalid == 'To Be Generated')
                internalid = ' ';
            // nlapiLogExecution('DEBUG', 'tranid:'+tranid +' internalid:'+internalid);
            var requestPart1 = prevRequest.substring(0, prevRequest
                .indexOf('documentNumber='));
            var requestPart2 = prevRequest.substring(prevRequest
                .indexOf('postingDate='), prevRequest.length);
            var invRequestWithTranid = requestPart1;
            invRequestWithTranid += ' documentNumber= "' + tranid + '"';
            invRequestWithTranid += ' transactionId= "' + internalid + '"';
            invRequestWithTranid += ' ' + requestPart2;
            preferencesObj.isSoapFormat = true;
            return invRequestWithTranid;
        }

        function sendVertexAccrual(transaction, preferencesObj, recordId, recordType, vendorTax, appliedBills, paymentRecord, dppApplied, chargedTax) {
            getTransactionDetails(transaction, preferencesObj, recordId, recordType, false);
            var request;
            if (preferencesObj.useRest) {
                request = generateRestRequestAccrual(transaction, preferencesObj, vendorTax, appliedBills, paymentRecord, dppApplied, chargedTax);
            } else {
                request = generateSOAPrequestAccrual(transaction, preferencesObj, vendorTax, appliedBills, paymentRecord, dppApplied, chargedTax);
            }
            lib.logLongText(JSON.stringify(request), 'Request2.0');

            var vertexAccrualCallStatus;
            if (preferencesObj.useRest && !preferencesObj.isSoapFormat) {
                vertexAccrualCallStatus = triggerRestVertexWebService(transaction, recordId, request, false, false, preferencesObj);
            } else {
                vertexAccrualCallStatus = triggerVertexWebService(transaction, recordId, request, false, false, preferencesObj);
            }
            log.debug('VertexAfterSubmit2.0', ' Vertex Accrual: ' + JSON.stringify(vertexAccrualCallStatus));
            return vertexAccrualCallStatus;
        }

        /*
        * Get transaction details
        * 
        * @param {String TaxCalculationInput} @returns boolean
        */
        function getTransactionDetails(transaction, preferencesObj, recordId, recordType, distributeTax) {
            //log.debug('Vertex2.0', 'getTransactionDetails');
            // POPULATR TRANSACTION HEADER FIELDS
            transaction.recType = recordType;
            if (transaction.recType)
                transaction.recType = transaction.recType.toLowerCase();
            transaction.internalid = recordId;
            transaction.tranRecord = record.load({ type: recordType, id: recordId });
            populateTranHeaderFields(transaction, transaction.tranRecord);
            // LOAD ENTITY RECORD
            var loadEntity = false;
            if (!transaction.isCUT)
                loadEntity = loadCustomerRecord(transaction);
            else
                loadEntity = getVendorRecord(transaction);
            if (!loadEntity)
                return "001 Invalid Entity";
            transaction.shippingCost = transaction.tranRecord.getValue('shippingcost');
            transaction.handlingCost = transaction.tranRecord.getValue('handlingcost');
            transaction.shippingtaxamount = transaction.tranRecord.getValue('shippingtaxamount');
            transaction.handlingtaxamount = transaction.tranRecord.getValue('handlingtaxamount');

            populateEntityFields(transaction, preferencesObj);
            // GET COMPANY/ONE WORLD PREFERENCES
            // Log error and return if any issues getting info from subsidiary
            var scriptObject = runtime.getCurrentScript();
            transaction.useToken = scriptObject.getParameter({ name: 'custscript_use_token_vt' });

            var getPreferenceStatus = getPreferences(transaction, preferencesObj);
            if (getPreferenceStatus != true)
                return getPreferenceStatus;// return false;
            // GET COMPANY DETAILS BY LOADING CONFIG
            // Log error and return if any issues on nlapiLoadConfiguration
            if (!getCompanyDetails(transaction, preferencesObj))
                return "003 Invalid Company Details";// return false;
            // POPULATE HEADER LOCATION AND ADDRESS
            //RQ-98099/CORST-1990 SSS_USAGE_LIMIT_EXCEEDED - remove load location and use search
            //GET LOCATIONS
            var featureInEffectLoc = runtime.isFeatureInEffect({
                feature: 'LOCATIONS'
            });
            if (featureInEffectLoc == true) {
                transaction.locationResults = getLocationResults();
            }
            if (transaction.location) {
                var hdrLocation = getLocationAddress(transaction.location, transaction);
                if (hdrLocation) {
                    transaction.hdrLocationDetails = hdrLocation;
                    log.debug('Vertex2.0',
                        'transaction.hdrLocationDetails:'
                        + JSON.stringify(transaction.hdrLocationDetails));
                }
            }
            transaction.countries = lib.getCountriesViaSuiteQL();
			transaction.flexFields = lib.populateFlexFields(transaction, transaction.tranRecord, 'ue');
			//log.debug('transaction.flexFields',transaction.flexFields);
            getAdministrativeOrigin(transaction);
            transaction.accounts = getAllAccounts();
            transaction.UNSPCcodes = getAllUNSPCcodes();
            transaction.productClasses = getAllProductClasses();
            return true;
        }

        /**
         * ADD TRANSACTION FIELDS TO transaction OBJECT
         * 
         * @param {transaction}
         * @returns boolean On error return null
         */
        function populateTranHeaderFields(transaction, tranRecord) {
            log.debug('Vertex2.0', 'populateTranHeaderFields');
            transaction.shiptoLat = tranRecord.getValue('custbody_shipto_latitude_vt');
            transaction.shiptoLong = tranRecord.getValue('custbody_shipto_longitude_vt');
            transaction.billtoLat = tranRecord.getValue('custbody_billto_latitude_vt');
            transaction.billtoLong = tranRecord.getValue('custbody_billto_longitude_vt');

            transaction.itemShipTo = new Array();
            transaction.itemShipFrom = new Array();
            transaction.subsidiary = tranRecord.getValue('subsidiary');
            transaction.custId = tranRecord.getValue('entity');
            transaction.handlingCost = '' + 0;
            transaction.discountTotal = 0;
            transaction.subtotal = tranRecord.getValue('subtotal');
            transaction.total = tranRecord.getValue('total');
            transaction.location = tranRecord.getValue('location');
            transaction.hdrLocation = tranRecord.getValue('location');
            transaction.tranDate = tranRecord.getValue('trandate');
            var curDate = format.parse({ value: transaction.tranDate, type: format.Type.DATE });
            var stringDate = curDate.getFullYear() + '-' + ("0" + (curDate.getMonth() + 1)).slice(-2)
                + '-' + ("0" + curDate.getDate()).slice(-2);
            transaction.tranDate = stringDate;
            transaction.docElementName = 'AccrualRequest';
            transaction.tranId = tranRecord.getValue('tranid');
            transaction.custShipCountry = '';// todo
            transaction.transactionType = 'PURCHASE';
            transaction.sellerOrBuyer = 'Buyer';
            transaction.originOrDestnation = 'Destination';
            transaction.productOrPurchase = 'Purchase';
            transaction.returnAssistedParametersIndicator = 'true';
            transaction.entitytaxregnum = tranRecord.getValue('entitytaxregnum');
            transaction.currency = tranRecord.getValue('currency');
            log.debug('Vertex2.0', 'recType: '
                + transaction.recType + ' ;subsidiary: ' + transaction.subsidiary
                + ' ;hdrLocation: ' + transaction.hdrLocation
                + ' ;custInternalId: ' + transaction.custId + ' ;tranDate: '
                + transaction.tranDate + ' ;handlingCost: '
                + transaction.handlingCost + ' ;discountTotal: '
                + transaction.discountTotal + ' ;subtotal: ' + transaction.subtotal);
        }


        function generateRestRequestAccrual(transaction, preferencesObj, vendorTax, appliedBills, paymentRecord, dppApplied, chargedTax) {
            var request = {};
            log.debug('Vertex2.0', 'generateRestRequestAccrual');
            var lineItems = getAssociatedBillsItemsExpenses(transaction, preferencesObj, appliedBills);
            transaction.scriptType = 'UE';
            request = lib.addRestDocumentInfo(request, transaction, preferencesObj);
            // CORST-1123 story changes by SYED      
            if (vendorTax && !dppApplied) {
                request.chargedTax = chargedTax;
            } else {
                request.chargedTax = 0;
            }

            log.debug('Vertex2.0', ' generateRestRequestAccrual lineItems: '
                + JSON.stringify(lineItems));

            request.lineItems = [];
            var lineItemNumber = 1;
            for (var i = 0; lineItems.items && i < lineItems.items.length; i++) {
                var lineItem = createRestItem(transaction, lineItems.items[i], lineItems.items[i].sublistType, lineItemNumber++, i + 1, preferencesObj, paymentRecord);
                request.lineItems.push(lineItem);
            }
            for (var i = 0; lineItems.expenses && i < lineItems.expenses.length; i++) {
                var lineExpense = createRestItem(transaction, lineItems.expenses[i], lineItems.items[i].sublistType, lineItemNumber++, i + 1, preferencesObj, paymentRecord);
                request.lineItems.push(lineExpense);
            }
            preferencesObj.isSoapFormat = false;
            return request;
        }

        /**
         * @param taxVariance
         * @returns
         */
        function generateSOAPrequestAccrual(transaction, preferencesObj, vendorTax, appliedBills, paymentRecord, dppApplied, chargedTax) {
            log.debug('Vertex2.0', 'generateSOAPrequest');
            var lineItems = getAssociatedBillsItemsExpenses(transaction, preferencesObj, appliedBills);
            var soapRequest = lib.addRequestHeaderElements(preferencesObj);
            transaction.scriptType = 'UE';
            soapRequest = lib.addDateTags(soapRequest, transaction, preferencesObj);
            // CORST-1123 story changes by SYED       
            if (vendorTax && !dppApplied) {
                soapRequest += '\t\t\t<ChargedTax>' + chargedTax + '</ChargedTax>';
            } else {
                soapRequest += '\t\t\t<ChargedTax>0</ChargedTax>';
            }

            log.debug('Vertex2.0', ' generateSOAPrequest lineItems: '
                + JSON.stringify(lineItems));

            var lineItemNumber = 1;
            for (var i = 0; lineItems.items && i < lineItems.items.length; i++) {
                soapRequest += addItemElement(transaction, lineItems.items[i], lineItems.items[i].sublistType,
                    lineItemNumber++, i + 1, preferencesObj, paymentRecord);
            }
            for (var i = 0; lineItems.expenses && i < lineItems.expenses.length; i++) {
                soapRequest += addItemElement(transaction, lineItems.expenses[i], lineItems.items[i].sublistType,
                    lineItemNumber++, i + 1, preferencesObj, paymentRecord);
            }
            soapRequest = lib.addClosingTags(soapRequest, transaction);
            preferencesObj.isSoapFormat = true;
            return soapRequest;
        }

        /**
         * Add Entity fields to transaction Object Add Customer Class and Customer
         * Category. Both of these can drive tax in O Series.
         * 
         * @param
         * @returns
         */
        function populateEntityFields(transaction, preferencesObj) {
            log.debug('Vertex2.0', 'populateEntityFields');
            if (transaction.custRecord) {
                transaction.custBillAddr1 = transaction.custRecord
                    .getValue('billaddr1');
                transaction.custBillAddr2 = transaction.custRecord
                    .getValue('billaddr2');
                transaction.custBillAddr3 = transaction.custRecord
                    .getValue('billaddr3');
                transaction.custBillCity = transaction.custRecord
                    .getValue('billcity');
                transaction.custBillPostal = transaction.custRecord
                    .getValue('billzip');
                transaction.custBillState = transaction.custRecord
                    .getValue('billstate');
                transaction.custBillCountry = transaction.custRecord
                    .getValue('billcountry');
                transaction.custShipAddr1 = transaction.custRecord
                    .getValue('shipaddr1');
                transaction.custShipAddr2 = transaction.custRecord
                    .getValue('shipaddr2');
                transaction.custShipAddr3 = transaction.custRecord
                    .getValue('shipaddr3');
                transaction.custShipCity = transaction.custRecord
                    .getValue('shipcity');
                transaction.custShipPostal = transaction.custRecord
                    .getValue('shipzip');
                transaction.custShipState = transaction.custRecord
                    .getValue('shipstate');
                transaction.custShipCountry = transaction.custRecord
                    .getValue('shipcountry');
                transaction.custExternalId = transaction.custRecord
                    .getValue('custentity_externalid_vt') ? transaction.custRecord
                        .getValue('custentity_externalid_vt')
                    : '';
                transaction.custExternalId = transaction.custExternalId
                    .substring(0, 40);
                transaction.custCategory = transaction.custRecord
                    .getText('custentity_customercode_vt');
                if (transaction.custCategory) {
                    transaction.custCategory = transaction.custCategory.toUpperCase();
                } else {
                    transaction.custCategory = '';
                }
                if (!transaction.currency)
                    transaction.currency = transaction.custRecord.getValue('currency');
                if (transaction.currency) {
                    preferencesObj.currency = getCurrencyCode(transaction.currency);
                }
                //      preferencesObj.currency = transaction.custRecord
                //              .getValue('currency');
                //      if (preferencesObj.currency) {
                //          preferencesObj.currency = getCurrencyCode(preferencesObj.currency);
                //      }
                // ADMINISTRATIVE DESTINATION IS CUSTOMER BILLADDRESS
                var administrativeDestination = {};
                //CORST-3093
                if(!transaction.tranRecord.getValue({ fieldId: "payeeaddress" }))
               {   
				var billAddress = transaction.tranRecord.getSubrecord({ fieldId: "billingaddress" });
				var shipaddress = transaction.tranRecord.getSubrecord({ fieldId: "shippingaddress" });
				if (billAddress && billAddress != null && billAddress != '' && billAddress != undefined) 
				{
					//var billToAddress=addrSearch(transaction.tranRecord.getValue('billingaddress'));
					administrativeDestination.addr1 = billAddress.getValue("addr1");
					administrativeDestination.city =billAddress.getValue("city");
					administrativeDestination.state =billAddress.getValue("state");
					administrativeDestination.zip = billAddress.getValue("zip");
					administrativeDestination.country = billAddress.getValue("country");//lib.convertCountry(lib.escapeXMLapi(billToAddress.country)) ;
					transaction.administrativeDestination = administrativeDestination;
                    transaction.isoCountryCode = administrativeDestination.country;
				}
				else{
                administrativeDestination.addr1 = transaction.custBillAddr1;
                administrativeDestination.city = transaction.custBillCity;
                administrativeDestination.state = transaction.custBillState;
                administrativeDestination.zip = transaction.custBillPostal;
                administrativeDestination.country = transaction.custBillCountry;
                transaction.administrativeDestination = administrativeDestination;
                transaction.isoCountryCode = administrativeDestination.country;
                }
            }
            else{
            administrativeDestination.addr1 = transaction.custBillAddr1;
            administrativeDestination.city = transaction.custBillCity;
            administrativeDestination.state = transaction.custBillState;
            administrativeDestination.zip = transaction.custBillPostal;
            administrativeDestination.country = transaction.custBillCountry;
            transaction.administrativeDestination = administrativeDestination;
            transaction.isoCountryCode = administrativeDestination.country;
            }
            } else {
                transaction.custExternalId = '';
                transaction.custCategory = '';
            }
        }

        /**
         * LOAD ENTITY RECORD TO GET ADDRESS Add the entity record to the transaction
         * object
         * 
         * @param null
         * @returns boolean
         */
        function getVendorRecord(transaction) {
            log.debug('Vertex2.0', 'getVendorRecord');
            try {
                transaction.custRecord = record.load({ type: record.Type.VENDOR, id: transaction.custId });
                return true;
            } catch (e) {
                log.debug("getVendorRecord", "Error: " + e);
                return false
            }
        }

        /**
         * loadCustomerRecord
         * @param 
         * @returns 
         */
        function loadCustomerRecord(transaction) {
            if (transaction.custId != null && transaction.custId > 0) {
                var customerLoaded = false;
                var custRecord;
                while (!customerLoaded) {
                    try {
                        custRecord = record.load({ type: record.Type.CUSTOMER, id: transaction.custId });
                        customerLoaded = true;
                        transaction.custRecord = custRecord;
                        transaction.custType = 'customer';
                        return true;
                    } catch (e) {
                        log.error('VertexloadCustomerRecord', e
                            .name
                            + ' ' + e.message);
                        try { // Parent field is not a searchcolumn, so
                            // need to load the JOB record to get the parent
                            custRecord = record.load({ type: record.Type.JOB, id: transaction.custId });
                            var errmsg = 'Job parent id = ' + transaction.custId;
                            log.debug('Vertex2.0', 'VertexProcessTaxTransaction ' +
                                errmsg);
                            customerLoaded = true;
                            transaction.custRecord = custRecord;
                            transaction.custType = 'job';
                            return true;
                        } catch (e) {
                            var errmsg = 'Could not load the job record from project lookup'
                                + transaction.custName;
                            log.error('VertexloadCustomerRecord',
                                errmsg);
                            return false;
                        }
                    }
                }
            }
        }

        /**
         * Get Company Preferences
         * 
         * @param {transaction}
         * @returns boolean On error return false
         */
        function getPreferences(transaction, preferencesObj) {
            log.debug('Vertex2.0', 'getPreferences');
            var preference = true;
            var environment = runtime.envType;
            var scriptObject = runtime.getCurrentScript();
            preferencesObj.useRest = scriptObject.getParameter('custscript_use_rest_vt');
            if (preferencesObj.useRest) {
                preferencesObj.serviceURL = scriptObject.getParameter('custscript_rest_base_url_vt');
            } else {
                preferencesObj.serviceURL = scriptObject.getParameter(
                    'custscript_taxserviceurl_vt');
            }
            preferencesObj.vtOneWorldFlag = scriptObject.getParameter(
                'custscript_oneworldflag_vt');
            preferencesObj.trustedId = scriptObject.getParameter(
                'custscript_trustedid_vt');
            preferencesObj.defaultNontaxable = scriptObject.getParameter(
                'custscript_defaultnontax_vt');
            preferencesObj.companyCode = scriptObject.getParameter(
                'custscript_companycode_vt');
            //CORST - 439 Including test company code by Srihitha
            preferencesObj.companyCodeTest = scriptObject.getParameter(
                'custscript_test_companycode_vt');
            //log.debug('preferencesObj.companyCodeTest',preferencesObj.companyCodeTest);
            preferencesObj.canadaLicensing = scriptObject.getParameter(
                'custscript_canlicense_vt');
            preferencesObj.payablesAccount = scriptObject.getParameter(
                'custscript_payables_account_vt');
            preferencesObj.receivablesAccount = scriptObject.getParameter(
                'custscript_receivables_account_vt');
            preferencesObj.taxAdjustmentItem = scriptObject.getParameter(
                'custscript_tax_adjustment_item_vt');
            preferencesObj.deliveryTerm = scriptObject.getParameter(
                'custscript_delivery_term_vt');

            if (preferencesObj.vtOneWorldFlag) {
                preference = getOneWorldPreference(transaction, preferencesObj);
                if (preference != true)
                    return preference;
            }
            if ((preferencesObj.trustedId == '' || preferencesObj.trustedId == null) && (preferencesObj.useRest==false || !preferencesObj.useRest)) {
                return "008 Missing Preference Trusted Id.";
            }
            if ((preferencesObj.companyCode == '' || preferencesObj.companyCode == null) && (environment == 'PRODUCTION')) {
                return "009 Missing Preference Company code.";
            }
            //CORST-439 Changes by Srihitha
            if ((environment == 'BETA' || environment == 'SANDBOX') && (preferencesObj.companyCodeTest == '' || preferencesObj.companyCodeTest == null)) {
                return "009 Missing Preference Company code Test.";
            }
            if (preferencesObj.payablesAccount == ''
                || preferencesObj.payablesAccount == null) {
                return "010 Missing Preference Payables Account.";
            }
            if (preferencesObj.receivablesAccount == ''
                || preferencesObj.receivablesAccount == null) {
                return "011 Missing Preference Receivables Account.";
            }
            if (preferencesObj.serviceURL == '' || preferencesObj.serviceURL == null) {
                return "012 Missing Preference Service URL.";
            }
            //lib.logLongText(JSON.stringify(preferencesObj), 'Preferences');
            return preference;
        }

        /**
         * Load Subsidiary to get Trusted Id
         * 
         * @param {transaction}
         * @returns boolean On error return false
         */
        function getOneWorldPreference(transaction, preferencesObj) {
            //nlapiLogExecution('DEBUG', 'Vertex', 'getOneWorldPreference');
            try {
                var environment = runtime.envType;
                //log.debug('environment',environment);
                var subRecord = record.load({ type: record.Type.SUBSIDIARY, id: transaction.subsidiary });
                transaction.subRecord = subRecord;
                var subsidiaryAddress = {}
                subsidiaryAddress.addr1 = subRecord.getValue({ fieldId: 'shipaddress1' });
                subsidiaryAddress.city = subRecord.getValue({ fieldId: 'shipcity' });
                subsidiaryAddress.state = subRecord.getValue({ fieldId: 'shipstate' });
                subsidiaryAddress.zip = subRecord.getValue({ fieldId: 'shipzip' });
                subsidiaryAddress.country = subRecord.getValue({ fieldId: 'shipcountry' });

                var filters = [];
                filters[0] = search.createFilter({
                    name: 'internalid',
                    operator: search.Operator.IS,
                    values: transaction.subsidiary
                });
                var columns = [];
                columns[0] = search.createColumn('internalid');
                columns[1] = search.createColumn('address1');
                columns[2] = search.createColumn('city');
                columns[3] = search.createColumn('state');
                columns[4] = search.createColumn('zip');
                columns[5] = search.createColumn('country');
                var searchResults = getSearchResults(search.Type.SUBSIDIARY, filters, columns);

                subsidiaryAddress.addr1 = searchResults[0]
                    .getValue({ name: 'address1' });
                subsidiaryAddress.city = searchResults[0]
                    .getValue({ name: 'city' });
                subsidiaryAddress.state = searchResults[0]
                    .getValue({ name: 'state' });
                subsidiaryAddress.zip = searchResults[0]
                    .getValue({ name: 'zip' });
                subsidiaryAddress.country = searchResults[0]
                    .getValue({ name: 'country' });

                transaction.subsidiaryAddress = subsidiaryAddress;
                var subTrustedId = subRecord.getValue({ fieldId: 'custrecord_trustedid_vt' });
                preferencesObj.useRest = subRecord.getValue('custrecord_use_rest_vt');
                // RETURN ERROR IF TRUSTED ID IS MISSING
                if ((subTrustedId == '' || subTrustedId == null) && (preferencesObj.useRest==false || !preferencesObj.useRest)) {
                    log.error('Vertex Error',
                        'Missing Trusted ID for Subsidiary '
                        + transaction.subsidiary);
                    return "004 Missing One World Preference Trusted Id.";
                }
                preferencesObj.trustedId = subTrustedId;
                preferencesObj.companyCode = subRecord
                    .getValue('custrecord_companycode_vt');
                preferencesObj.companyCodeTest = subRecord
                    .getValue('custrecord_test_companycode_vt');
                //log.debug('preferencesObj.companyCodeTest',preferencesObj.companyCodeTest);
                if ((preferencesObj.companyCode == ''
                    || preferencesObj.companyCode == null) && (environment == 'PRODUCTION')) {
                    return "005 Missing One World Preference Company Code.";
                }
                //CORST-439 Changes by Srihitha         
                if ((environment == 'BETA' || environment == 'SANDBOX') && (preferencesObj.companyCodeTest == '' || preferencesObj.companyCodeTest == null)) {
                    return "005 Missing One World Preference Company Code Test.";
                }
                var subURL = subRecord.getValue('custrecord_taxserviceurl_vt');
                if (subURL == '' || subURL == null) {
                    return "006 Missing One World Preference URL.";
                }
                if (!preferencesObj.useRest) {
                    preferencesObj.serviceURL = subURL;
                } else {
                    preferencesObj.serviceURL = subRecord.getValue('custrecord_rest_base_url_vt');
                }
                transaction.useToken = subRecord.getValue('custrecord_use_token_vt');

                preferencesObj.deliveryTerm = subRecord
                    .getValue('custrecord_delivery_term_vt');
                return true;
            } catch (err) {
                log.error('Vertex Error Loading Subsidiary '
                    + transaction.subsidiary, lib.logExecutionMsg(err,
                        'Error Loading Subsidiary'));
                return "007 Invalid Subsidiary.";
            }
        }

        /*
        * Remove getCurrencyCode for a given currency
        * 
        * @param String @returns String
        */
        function getCurrencyCode(currencyInternalId) {
            if (!currencyInternalId)
                return '';
            var currencyCode = '';
            var currencyResults = null;

            var filters = [];
            filters[0] = search.createFilter({
                name: 'internalid',
                operator: search.Operator.IS,
                values: currencyInternalId
            });
            var columns = [];
            columns[0] = search.createColumn('currency');
            var searchResults = getSearchResults(search.Type.SUBSIDIARY, filters, columns);

            if (searchResults && searchResults[0]) {
                currencyCode = searchResults[0].getValue({ name: 'currency' });
            }
            return currencyCode;
        }

        /*
        * Remove trusted id from the request
        * 
        * @param String txt @returns String txt
        */
        function removeTrustedId(txt) {
            try {
                // REMOVE TRUSTED ID FROM THE REQUEST
                var startIdx = txt.indexOf("<urn:TrustedId>");
                var endIdx = txt.indexOf("</urn:TrustedId>");
                if (startIdx >= 0 && endIdx >= 0) {
                    var replacedStr = txt.substring(0, startIdx);
                    replacedStr += "<urn:TrustedId>";
                    replacedStr += txt.substring(endIdx);
                    txt = replacedStr;
                }
            } catch (err) {
                // printStackTrace(e);
                log.error('VertexUE Error', lib.logExecutionMsg(err,
                    'Error removing Trusted id '));
            }
            return txt;
        }

        /**
         * @returns
         */
        function getCompanyDetails(transaction, preferencesObj) {
            log.debug('Vertex2.0', 'getCompanyDetails');
            try {
                var configData = config.load(config.Type.COMPANY_INFORMATION);
                var environment = runtime.envType;
                //log.debug('environment',environment);
                var company = new Object();

                //CORST-439 Changes by Srihitha
                if (environment == 'BETA' || environment == 'SANDBOX') {
                    company.code = preferencesObj.companyCodeTest;
                }
                else
                    company.code = preferencesObj.companyCode;
                company.canadaLicensing = preferencesObj.canadaLicensing;// TODO
                if (configData.getValue('shippingaddress1') != null
                    && configData.getValue('shippingaddress1') != '') {
                    company.addrText = configData.getValue({ fieldId: 'shippingaddresstext' });
                    company.addr1 = configData.getValue({ fieldId: 'shippingaddress1' });
                    company.addr2 = configData.getValue({ fieldId: 'shippingaddress2' });
                    company.city = configData.getValue({ fieldId: 'shippingcity' });
                    company.state = configData.getValue({ fieldId: 'shippingstate' });
                    company.zip = configData.getValue({ fieldId: 'shippingzip' });
                    company.country = configData.getValue({ fieldId: 'shippingcountry' });
                } else {
                    company.addrText = configData.getValue({ fieldId: 'addresstext' });
                    company.addr1 = configData.getValue({ fieldId: 'address1' });
                    company.addr2 = configData.getValue({ fieldId: 'address2' });
                    company.city = configData.getValue({ fieldId: 'city' });
                    company.state = configData.getValue({ fieldId: 'state' });
                    company.zip = configData.getValue({ fieldId: 'zip' });
                    company.country = configData.getValue({ fieldId: 'country' });
                }
                // Administrative Origin = Company address for single company
                company.mainaddrText = configData.getValue({ fieldId: 'addresstext' });
                company.mainaddr1 = configData.getValue({ fieldId: 'address1' });
                company.mainaddr2 = configData.getValue({ fieldId: 'address2' });
                company.maincity = configData.getValue({ fieldId: 'city' });
                company.mainstate = configData.getValue({ fieldId: 'state' });
                company.mainzip = configData.getValue({ fieldId: 'zip' });
                company.maincountry = configData.getValue({ fieldId: 'country' });

                transaction.company = company;
                log.debug('Vertex2.0', 'company:'
                    + JSON.stringify(company));
            } catch (err) {
                log.error('Vertex', lib.logExecutionMsg(err,
                    'Error on LoadConfiguration'));
                return false;
            }
            return true;
        }
        /**
         * getLocationResults
         * Search and get locations
         * @returns locationResults
         */
        function getLocationResults() {
            try {
                var columns = [];
                columns[0] = search.createColumn({
                    name: 'internalid'
                });
                columns[1] = search.createColumn({
                    name: 'name'
                });
                columns[2] = search.createColumn({
                    name: 'address1'
                });
                columns[3] = search.createColumn({
                    name: 'address2'
                });
                columns[4] = search.createColumn({
                    name: 'city'
                });
                columns[5] = search.createColumn({
                    name: 'state'
                });
                columns[6] = search.createColumn({
                    name: 'zip'
                });
                columns[7] = search.createColumn({
                    name: 'country'
                });
                var filters = [];
                filters[0] = search.createFilter({
                    name: 'isinactive',
                    operator: search.Operator.IS,
                    values: false
                });
                var locationResults = longSearchRecord('location', null, filters, columns);
                return locationResults;
            } catch (err) {
                log.error('VertexPlugin Error', lib.logExecutionMsg(err,
                    'Error searching locations'));
                return null;
            }
        }
        /**
         * 
         * get Search Results
         * 
         * @param recordType
         * @param searchId
         * @param filters
         * @param columns
         * @returns object Get complete results
         */
        function longSearchRecord(recordType, savedSearchId, searchFilters,
            searchColumns) {
            var searchObject = null;
            if (searchFilters == '' || searchFilters == null
                || typeof (searchFilters) == 'undefined') {
                searchFilters = [];
            }
            if (searchColumns == '' || searchColumns == null
                || typeof (searchColumns) == 'undefined') {
                searchColumns = [];
            }

            if (savedSearchId != null && savedSearchId != ''
                && typeof (savedSearchId) != 'undefined') {
                //searchObject = nlapiLoadSearch(recordType, savedSearchId);
                searchObject = search.load({
                    type: recordType,
                    id: savedSearchId
                });

                // Only supports array of search filters to add to existing search
                for (var i = 0; i < searchFilters.length; i++) {
                    searchObject.addFilter(searchFilters[i]);
                }
            } else {
                //todo check
                //          searchObject = nlapiCreateSearch(recordType, searchFilters,
                //                  searchColumns);
                searchObject = search.create(
                    {
                        type: recordType,
                        filters: searchFilters,
                        columns: searchColumns
                    });
            }
            var searchResults = [];
            var resultsSet = searchObject.run();
            var resultsCounter = 0;
            var resultsPart = null;

            do {
                resultsPart = resultsSet.getRange(resultsCounter,
                    resultsCounter + 1000);

                for (var i = 0; i < resultsPart.length; i++) {
                    searchResults.push(resultsPart[i]);
                    resultsCounter++;
                }
            } while (resultsPart.length >= 1000);

            return searchResults;
        }
        /**
         * Get location address for a given location internalid
         * 
         * @param string locationInternalid
         * @returns object
         */
        function getLocationAddress(locationInternalid, transaction) {
            var locationFound = false;
            try {
                var locationAddress = {};
                for (var i in transaction.locationResults) {
                    var result = transaction.locationResults[i];
                    if (result.id == locationInternalid) {
                        locationAddress.locationInternalid = locationInternalid;
                        // vertex can only handle 20 character location codes
                        locationAddress.locationName = result.getValue('name')
                            .substring(0, 20);
                        locationAddress.addr1 = result.getValue('address1');
                        locationAddress.addr2 = result.getValue('address2');
                        locationAddress.city = result.getValue('city');
                        locationAddress.state = result.getValue('state');
                        locationAddress.zip = result.getValue('zip');
                        locationAddress.country = lib.convertCountry(result.getValue('country'));
                        locationAddress.addrText = locationAddress.addr1 + ' '
                            + locationAddress.city + ' ' + locationAddress.state + ' '
                            + locationAddress.zip + ' ' + locationAddress.country;
                        locationFound = true;
                        break;
                    }
                }
                //log.debug('VertexPlugin2.0','locationFound: '+locationFound + ' locationInternalid: '+locationInternalid +' locationAddress.addrText:'+locationAddress.addrText);
                return locationAddress;
            } catch (err) {
                //printStackTrace(err);
                log.error('VertexPlugin Error', lib.logExecutionMsg(err,
                    'Error getting Location Address; locationInternalid:'
                    + locationInternalid));
                return null;
            }
        }
        // function getLocationAddressOld(locationInternalid) {
        //     if (locationInternalid == null || locationInternalid == ''
        //         || locationInternalid == '')
        //         return null;
        //     var locationDetails = new Object();
        //     try {
        //         var locationRec = record.load({ type: record.Type.LOCATION, id: locationInternalid });
        //         if (locationRec) {
        //             locationDetails.locationInternalid = locationInternalid;
        //             // vertex can only handle 20 character location codes
        //             locationDetails.locationName = locationRec.getValue({ fieldId: 'name' })
        //                 .substring(0, 20);
        //             locationDetails.addr1 = locationRec.getValue({ fieldId: 'addr1' });
        //             locationDetails.addr2 = locationRec.getValue({ fieldId: 'addr2' });
        //             locationDetails.city = locationRec.getValue({ fieldId: 'city' });
        //             locationDetails.state = locationRec.getValue({ fieldId: 'state' });
        //             locationDetails.zip = locationRec.getValue({ fieldId: 'zip' });
        //             locationDetails.country = locationRec.getValue({ fieldId: 'country' });
        //             locationDetails.addrText = locationDetails.addr1 + ' '
        //                 + locationDetails.city + ' ' + locationDetails.state + ' '
        //                 + locationDetails.zip + ' ' + locationDetails.country;

        //             if (locationDetails.addr1 == undefined) {
        //                 var filters = [];
        //                 filters[0] = search.createFilter({
        //                     name: 'internalid',
        //                     operator: search.Operator.IS,
        //                     values: locationInternalid
        //                 });
        //                 var columns = [];
        //                 columns[0] = search.createColumn('internalid');
        //                 columns[1] = search.createColumn({ name: 'address1', join: 'address' });
        //                 columns[2] = search.createColumn({ name: 'address2', join: 'address' });
        //                 columns[3] = search.createColumn('city');
        //                 columns[4] = search.createColumn('state');
        //                 columns[5] = search.createColumn('zip');
        //                 columns[6] = search.createColumn('country');
        //                 var searchResults = getSearchResults(search.Type.LOCATION, filters, columns);

        //                 if (searchResults && searchResults != undefined && searchResults.length >= 1) {
        //                     locationDetails.addr1 = searchResults[0].getValue(columns[1]);
        //                     locationDetails.addr2 = searchResults[0].getValue(columns[2]);
        //                     locationDetails.city = searchResults[0].getValue(columns[3]);
        //                     locationDetails.state = searchResults[0].getValue(columns[4]);
        //                     locationDetails.zip = searchResults[0].getValue(columns[5]);
        //                     locationDetails.country = searchResults[0].getValue(columns[6]);
        //                     locationDetails.addrText = locationDetails.addr1 + ' '
        //                         + locationDetails.city + ' ' + locationDetails.state + ' '
        //                         + locationDetails.zip + ' ' + locationDetails.country;
        //                 }
        //             }
        //             log.debug('Vertex2.0', 'locationDetails:'
        //                 + JSON.stringify(locationDetails));
        //             return locationDetails;
        //         }
        //     } catch (err) {
        //       //  printStackTrace(err);
        //         log.error('Vertex Error', lib.logExecutionMsg(err,
        //             'Error getting Location Address; locationInternalid:'
        //             + locationInternalid));
        //         return null;
        //     }
        // }

        /**
         * If multi-shipping is enabled, physical origin comes from the ship from
         * specified at the line item. There is no shipfrom field, so shipFrom is
         * location/company/subsidiary address regardless of multiship Single Company If
         * location & location address use location address, else Company address.
         * OneWorld: If location & location address use location address, else
         * Subsidiary address.
         * 
         * @param
         * @returns soap THIS LOGIC IS NEEDED SINCE getShipFrom & getShipTo functions
         *          does not work
         */
        function getShipFrom(transaction, preferencesObj) {
            log.debug('Vertex2.0', 'getShipFrom-hdrLocation:' + transaction.hdrLocation);
            var oneWorld = false;
            if (preferencesObj.vtOneWorldFlag)
                oneWorld = true;
            if (oneWorld) {// ONE WORLD
                if (transaction.hdrLocation && transaction.hdrLocationDetails) {
                    log.debug('Vertex2.0',
                        'One World ShipFrom is Location Address');
                    return transaction.hdrLocationDetails;
                } else {
                    log.debug('Vertex2.0',
                        'One World ShipFrom is Subsidiary Address');
                    return transaction.subsidiaryAddress;
                }
            } else { // SINGLE COMPANY
                if (transaction.hdrLocation && transaction.hdrLocationDetails) {
                    log.debug('Vertex2.0',
                        'Single Company ShipFrom is Location Address');
                    return transaction.hdrLocationDetails;
                } else {
                    log.debug('Vertex2.0',
                        'Single Company ShipFrom is Company Address');
                    return transaction.company;
                }
            }
        }

        function createSellerOrBuyerRestObject(transaction, preferencesObj, item) {
            var environment = runtime.envType;
            //log.debug('environment',environment);
            var physicalOriginAddress = getShipFrom(transaction, preferencesObj);
            if (physicalOriginAddress.country)
                transaction.physicalOriginCountry = physicalOriginAddress.country;
            log.debug('Vertex2.0', 'addSellerOrBuyerElement; sellerOrBuyer: ' + JSON.stringify(transaction.sellerOrBuyer));

            var sellerOrBuyer = {};
            if (environment == 'SANDBOX' || environment == 'BETA') {
                sellerOrBuyer.company = preferencesObj.companyCodeTest;
            }
            else {
                sellerOrBuyer.company = preferencesObj.companyCode;
            }
            if (transaction.sellerOrBuyer == 'Buyer' && item.lineLocation) {
                sellerOrBuyer.destination = lib.createRestAddressObject(item.lineLocation);
            } else if (physicalOriginAddress.addr1 != ''
                || physicalOriginAddress.city != ''
                || physicalOriginAddress.state != ''
                || physicalOriginAddress.zip != ''
                || physicalOriginAddress.country != '') {
                if (transaction.originOrDestnation == 'Destination') {
                    sellerOrBuyer.destination = lib.createRestAddressObject(physicalOriginAddress);
                } else {
                    sellerOrBuyer.physicalOrigin = lib.createRestAddressObject(physicalOriginAddress);
                }
            }
            if (transaction.originOrDestnation == 'PhysicalOrigin') {
                transaction.administrativeOrigin = lib.formatAddressFields(transaction.administrativeOrigin);
                sellerOrBuyer.administrativeOrigin = lib.createRestAddressObject(transaction.administrativeOrigin);
            } else {
                var adminDest = {};
                if (transaction.subsidiaryAddress) {
                    adminDest.addr1 = transaction.subsidiaryAddress.addr1;
                    adminDest.city = transaction.subsidiaryAddress.city;
                    adminDest.state = transaction.subsidiaryAddress.state;
                    adminDest.zip = transaction.subsidiaryAddress.zip;
                    adminDest.country = transaction.subsidiaryAddress.country;
                } else if (transaction.company.mainaddrText) {
                    adminDest.addr1 = transaction.company.mainaddr1;
                    adminDest.city = transaction.company.maincity;
                    adminDest.state = transaction.company.mainstate;
                    adminDest.zip = transaction.company.mainzip;
                    adminDest.country = transaction.company.maincountry;
                }
                adminDest = lib.formatAddressFields(adminDest);
                sellerOrBuyer.administrativeDestination = lib.createRestAddressObject(adminDest);
            }
            return sellerOrBuyer;
        }

        /**
         * @param object
         * @returns soap
         */
        function addSellerOrBuyerElement(transaction, preferencesObj, item) {
            var environment = runtime.envType;
            //log.debug('environment',environment);
            var physicalOriginAddress = getShipFrom(transaction, preferencesObj);
            if (physicalOriginAddress.country)
                transaction.physicalOriginCountry = physicalOriginAddress.country;
            log.debug('Vertex2.0', ' addSellerOrBuyerElement; sellerOrBuyer: ' + JSON.stringify(transaction.sellerOrBuyer));

            var sellerElement = '\t\t\t<' + transaction.sellerOrBuyer + '>';

            //CORST-439 Changes by Srihitha
            if (environment == 'SANDBOX' || environment == 'BETA') {
                sellerElement += '\t\t\t<Company>' + preferencesObj.companyCodeTest
                    + '</Company>';
            }
            else
                sellerElement += '\t\t\t<Company>' + preferencesObj.companyCode
                    + '</Company>';
            // ADD PHYSCAL ORIGIN IF ADDRESS NOT BLANK
            if (transaction.sellerOrBuyer == 'Buyer' && item.lineLocation) {
                sellerElement += '\t\t\t    <' + transaction.originOrDestnation + '>';
                sellerElement = lib.addAddressElement(sellerElement, item.lineLocation);
                sellerElement += '\t\t\t    </' + transaction.originOrDestnation + '>';
            } else if (physicalOriginAddress.addr1 != ''
                || physicalOriginAddress.city != ''
                || physicalOriginAddress.state != ''
                || physicalOriginAddress.zip != ''
                || physicalOriginAddress.country != '') {
                sellerElement += '\t\t\t    <' + transaction.originOrDestnation + '>';
                sellerElement = lib.addAddressElement(sellerElement, physicalOriginAddress);
                sellerElement += '\t\t\t    </' + transaction.originOrDestnation + '>';
            }
            // ADD ADMINISTRATIVEORIGIN/ADMINISTRATIVEDESTINATION
            if (transaction.originOrDestnation == 'PhysicalOrigin')
                sellerElement = lib.addAdministrativeOriginElement(sellerElement, transaction);
            else {
                var adminDest = {};
                if (transaction.subsidiaryAddress) {
                    adminDest.addr1 = transaction.subsidiaryAddress.addr1;
                    adminDest.city = transaction.subsidiaryAddress.city;
                    adminDest.state = transaction.subsidiaryAddress.state;
                    adminDest.zip = transaction.subsidiaryAddress.zip;
                    adminDest.country = transaction.subsidiaryAddress.country;
                } else if (transaction.company.mainaddrText) {
                    adminDest.addr1 = transaction.company.mainaddr1;
                    adminDest.city = transaction.company.maincity;
                    adminDest.state = transaction.company.mainstate;
                    adminDest.zip = transaction.company.mainzip;
                    adminDest.country = transaction.company.maincountry;
                }
                adminDest = lib.formatAddressFields(adminDest);
                sellerElement += '\t\t\t  <AdministrativeDestination>';
                sellerElement = lib.addAddressElement(sellerElement, adminDest);
                sellerElement += '\t\t\t  </AdministrativeDestination>';
            }
            // sellerElement = addAdministrativeDestinationElement(sellerElement);
            sellerElement += '\t\t\t  </' + transaction.sellerOrBuyer + '>';
            return sellerElement;
        }

        function createRestVendor(transaction, paymentRecord) {
            log.debug('Vertex2.0', 'createRestVendorObject');
            var vendor = {};
            if (transaction.custExternalId && transaction.custExternalId != undefined) {
                vendor.vendorCode = {};
                if (transaction.custCategory == null || transaction.custCategory == '')
                    vendor.vendorCode.value = lib.escapeXMLapi(transaction.custExternalId);
                else {
                    vendor.vendorCode.classCode = lib.escapeJSONapi(transaction.custCategory);
                    vendor.vendorCode.value = lib.escapeXMLapi(transaction.custExternalId);
                }
            }
            else if(transaction.custCategory && transaction.custCategory != undefined)
            {
                vendor.vendorCode = {};
                vendor.vendorCode.classCode = lib.escapeJSONapi(transaction.custCategory);
            }
            transaction.billtoLat = paymentRecord.getValue('custbody_billto_latitude_vt');
            transaction.billtoLong = paymentRecord.getValue('custbody_billto_longitude_vt');
            log.debug('Vertex2.0', 'addVendorElement: billtoLat: ' + transaction.billtoLat + ', billtoLong: ' + transaction.billtoLong);

            vendor.physicalOrigin = {};
            if (transaction.billtoLat && transaction.billtoLat != undefined) {
                vendor.physicalOrigin.latitude = transaction.billtoLat;
            }
            if (transaction.billtoLong && transaction.billtoLong != undefined) {
                vendor.physicalOrigin.longitude = transaction.billtoLong;
            }
            vendor.physicalOrigin.streetAddress1 = lib.escapeXMLapi(transaction.custShipAddr1);
            vendor.physicalOrigin.city = lib.escapeXMLapi(transaction.custShipCity);
            vendor.physicalOrigin.mainDivision = lib.escapeXMLapi(transaction.custShipState);
            vendor.physicalOrigin.postalCode = lib.escapeXMLapi(transaction.custShipPostal);
            vendor.physicalOrigin.country = lib.escapeXMLapi(transaction.custShipCountry);

            vendor.administrativeOrigin = {};
            vendor.administrativeOrigin.streetAddress1 = lib.escapeXMLapi(transaction.custBillAddr1);
            vendor.administrativeOrigin.city = lib.escapeXMLapi(transaction.custBillCity);
            vendor.administrativeOrigin.mainDivision = lib.escapeXMLapi(transaction.custBillState);
            vendor.administrativeOrigin.postalCode = lib.escapeXMLapi(transaction.custBillPostal);
            vendor.administrativeOrigin.country = lib.escapeXMLapi(transaction.custBillCountry);
            return vendor;
        }

        /**
         * @param
         * @returns soap
         * 
         */
        function addVendorElement(transaction, paymentRecord) {
            log.debug('Vertex2.0', 'addvendorElement');
            var vendorElement = '\t\t\t  <Vendor>';
            // class code attribute can't be blank, but blank external ID is OK
            if (transaction.custExternalId && transaction.custExternalId != undefined) {
                if (transaction.custCategory == null || transaction.custCategory == '')
                    vendorElement += '\t\t\t    <VendorCode>'
                        + lib.escapeXMLapi(transaction.custExternalId) + '</VendorCode>';
                else {
                    vendorElement += '\t\t\t    <VendorCode classCode="'
                        + lib.escapeXMLapi(transaction.custCategory) + '">'
                        + lib.escapeXMLapi(transaction.custExternalId) + '</VendorCode>';
                }
            }
            else if(transaction.custCategory && transaction.custCategory != undefined)
            {
                vendorElement += '\t\t\t    <VendorCode classCode="'
                        + lib.escapeXMLapi(transaction.custCategory) + '"></VendorCode>';
            }

            //Support latLong
            transaction.billtoLat = paymentRecord.getValue('custbody_billto_latitude_vt');
            transaction.billtoLong = paymentRecord.getValue('custbody_billto_longitude_vt');
            log.debug('Vertex2.0', 'addVendorElement: billtoLat: ' + transaction.billtoLat + ', billtoLong: ' + transaction.billtoLong);
            vendorElement = lib.addPhysicalOrgLatLongElement(vendorElement, transaction);
            //vendorElement += '\t\t\t  <PhysicalOrigin>';

            vendorElement += '\t\t\t    <StreetAddress1>' + lib.escapeXML(transaction.custShipAddr1)
                + '</StreetAddress1>';
            vendorElement += '\t\t\t    <City>' + transaction.custShipCity + '</City>';
            vendorElement += '\t\t\t    <MainDivision>' + transaction.custShipState
                + '</MainDivision>';
            vendorElement += '\t\t\t    <PostalCode>' + transaction.custShipPostal
                + '</PostalCode>';
            vendorElement += '\t\t\t    <Country>' + transaction.custShipCountry
                + '</Country>';
            vendorElement += '\t\t\t  </PhysicalOrigin>';
            // ADD ADMINISTRATIVE ORIGIN
            vendorElement += '\t\t\t  <AdministrativeOrigin>';
            vendorElement += '\t\t\t    <StreetAddress1>' + lib.escapeXML(transaction.custBillAddr1)
                + '</StreetAddress1>';
            vendorElement += '\t\t\t    <City>' + transaction.custBillCity + '</City>';
            vendorElement += '\t\t\t    <MainDivision>' + transaction.custBillState
                + '</MainDivision>';
            vendorElement += '\t\t\t    <PostalCode>' + transaction.custBillPostal
                + '</PostalCode>';
            vendorElement += '\t\t\t    <Country>' + transaction.custBillCountry
                + '</Country>';
            vendorElement += '\t\t\t  </AdministrativeOrigin>';
            vendorElement += '\t\t\t  </Vendor>';
            // nlapiLogExecution("DEBUG", 'Vertex', 'vendorElement;'+ JSON
            // .stringify(vendorElement));
            return vendorElement;
        }

        function createRestItem(transaction, item, type, lineNumber, typeNumber, preferencesObj, paymentRecord) {
            var lineItem = {};
            var itemName = '';
            lineItem.lineItemNumber = lineNumber;
            lineItem.lineItemId = type + '|' + typeNumber;

            if (item.account) {
                lineItem.generalLedgerAccount = lib.escapeXMLapi(item.account);
            }
            if (item.lineLocation && item.lineLocation.locationName) {
                lineItem.locationCode = lib.escapeXMLapi(item.lineLocation.locationName);
            } else if (transaction.hdrLocationDetails && transaction.hdrLocationDetails.locationName) {
                lineItem.locationCode = lib.escapeXMLapi(transaction.hdrLocationDetails.locationName);
            }

            if (transaction.sellerOrBuyer == 'Buyer') {
                lineItem.buyer = createSellerOrBuyerRestObject(transaction, preferencesObj, item);
            } else {
                lineItem.seller = createSellerOrBuyerRestObject(transaction, preferencesObj, item);
            }
            lineItem.vendor = createRestVendor(transaction, paymentRecord);

            if (item.itemName) {
                itemName = item.itemName.substring(0, 40);
            } else {
                itemName = type;
            }
            if (item.productClass) {
                lineItem.purchase = {};
                lineItem.purchase.purchaseClass = lib.escapeXMLapi(item.productClass);
                lineItem.purchase.value = lib.escapeXMLapi(itemName);
            } else {
                lineItem.purchase = {};
                lineItem.purchase.value = lib.escapeXMLapi(itemName);
            }
            if (item.UNSPSCcode) {
                var commodityCodeType = "UNSPSC";
                lineItem.commodityCode = {};
                lineItem.commodityCode.commodityCodeType = commodityCodeType;
                lineItem.commodityCode.value = item.UNSPSCcode;
            }
            lineItem.quantity = {};
            lineItem.quantity.value = item.quantity;
            lineItem.extendedPrice = item.amount;
            return lineItem;
        }

        /**
         * @param item
         * @param type
         * @param lineNumber
         * @param typeNumber
         * @returns
         */
        function addItemElement(transaction, item, type, lineNumber, typeNumber, preferencesObj, paymentRecord) {
            var itemName = '';
            var productClassAttributeName = 'purchaseClass';
            var itemElement = '\t\t\t <LineItem lineItemNumber="' + lineNumber
                + '" lineItemId="' + type + '|' + typeNumber + '"';

            if (item.account) {
                itemElement += ' generalLedgerAccount=' + '"' + lib.escapeXMLapi(item.account) + '"';
            }
            if (item.lineLocation && item.lineLocation.locationName) {
                itemElement += ' locationCode="'
                    + lib.escapeXMLapi(item.lineLocation.locationName) + '"';
            } else if (transaction.hdrLocationDetails
                && transaction.hdrLocationDetails.locationName) {
                itemElement += ' locationCode="'
                    + lib.escapeXMLapi(transaction.hdrLocationDetails.locationName)
                    + '"';
            }
            itemElement += '>'
            itemElement += addSellerOrBuyerElement(transaction, preferencesObj, item);
            itemElement += addVendorElement(transaction, paymentRecord);
            if (item.itemName) {
                itemName = item.itemName.substring(0, 40);
            } else {
                itemName = type;
            }
            if (item.productClass) {
                itemElement += '\t\t\t  <' + transaction.productOrPurchase + ' '
                    + productClassAttributeName + '="'
                    + lib.escapeXMLapi(item.productClass) + '">'
                    + lib.escapeXMLapi(itemName) + '</'
                    + transaction.productOrPurchase + '>';
            } else {
                itemElement += '\t\t\t  <' + transaction.productOrPurchase + '>'
                    + lib.escapeXMLapi(itemName) + '</'
                    + transaction.productOrPurchase + '>';
            }
            if (item.UNSPSCcode) {
                var commodityCodeType = "UNSPSC";
                itemElement += '\t\t\t      <CommodityCode commodityCodeType="'
                    + commodityCodeType + '">' + item.UNSPSCcode
                    + '</CommodityCode>';
            }
            itemElement += '\t\t\t      <Quantity>' + item.quantity
                + '</Quantity>';
            itemElement += '\t\t\t      <ExtendedPrice>' + item.amount
                + '</ExtendedPrice>';
            // itemElement += '\t\t\t <ChargedTax>' + vendorTax + '</ChargedTax>';
            itemElement += '\t\t\t </LineItem>';
            return itemElement;
        }

        function triggerRestVertexWebService(transaction, recordId, request, distributeTax, reverse, preferencesObj) {
            var details = {};
            try {
                // var serviceURL = preferencesObj.serviceURL;
                var serviceURL = lib.getServiceUrl(transaction, preferencesObj);
                if (transaction.sellerOrBuyer == 'Buyer') {
                    serviceURL = serviceURL + '/v2/procurement';
                } else {
                    serviceURL = serviceURL + '/v2/supplies';
                }
                if (transaction.useToken) {
                    log.debug('triggerRestVertexWebService', 'Using token');
                    //Get token params if saved in custom record otherwise post token request and save params in custom record.
                    var useTokenStatus = lib.tokenLogic(transaction, preferencesObj);
                    if (!useTokenStatus)
                        return '';
                    log.debug('triggerRestVertexWebService', 'tokenParams: ' + JSON.stringify(transaction.tokenParams));
                    //log.debug('triggerRestVertexWebService', 'transaction.tokenHeader: ' + JSON.stringify(transaction.tokenHeader));
                }

                var headers = {};
                headers['Content-Type'] = 'application/json';
                headers['Authorization'] = transaction.tokenHeader.authorization;
                headers['Accept'] = 'application/json';
                log.debug('triggerRestVertexWebService', 'headers: ' + JSON.stringify(headers));

                var vertexResponse = https.post({ url: serviceURL, body: JSON.stringify(request), headers: headers });
                lib.logLongText(vertexResponse.body, 'Response');

                //if the token or credentials expired, retry with new token 
                if (transaction.useToken && vertexResponse) {
                    var responseCode = vertexResponse.code;
                    if (responseCode == 401 || responseCode == 403 || (responseCode == 500 && vertexResponse.body && vertexResponse.body.message && vertexResponse.body.message.contains('expired'))) {
                        log.debug('Vertex2.0', ' Token expired retry with new token ');
                        // var postToken = lib.postTokenRequest(transaction);   
                        var postToken = lib.postTokenRequest(transaction);
                        if (!postToken) {
                            log.debug('Vertex2.0', 'Unsuccessful token call');
                            return vertexResponse;
                        }
                        lib.saveTokenInCustomRecord(transaction);
                        transaction.tokenHeader = lib.getTokenFromCustomRecord();
                        headers['Authorization'] = transaction.tokenHeader.authorization;
                        log.debug('triggerRestVertexWebService', 'headers: ' + JSON.stringify(headers));
                        vertexResponse = https.post({ url: serviceURL, body: JSON.stringify(request), headers: headers });
                    }
                }
                if (vertexResponse.code == 200) {
                    log.debug('Vertex2.0 ', 'triggerRestVertexWebService - adding successful Vertex Call Record');
                    var responseBody = JSON.parse(vertexResponse.body);
                   
                    if (responseBody.data)
                    {
                        if(responseBody.data.totalTax < 0)
                            details.TotalTax = ((responseBody.data.totalTax) * (-1));
                        else
                        details.TotalTax = responseBody.data.totalTax;
                    }
                    else
                        details.TotalTax = '';
                    //lib.logLongText(JSON.stringify(responseBody), 'Stringified Response: body');
                    //lib.logLongText(JSON.stringify(responseBody.data), 'Stringified Response body: data');

                    addVtCallRecord(transaction, JSON.stringify(request), vertexResponse.body, 'Success',
                        recordId, reverse, details.TotalTax, preferencesObj);
                    if (distributeTax) {
                        details.status = 'Success';
                        return details;
                    }
                    details.status = 'Success';
                    log.debug('Vertex2.0 AccrualRequest',
                        'details.TotalTax:' + details.TotalTax);
                    return details;
                } else {
                    var faultString = '';
                    var errorDetails = 'Request failed to post to Vertex.'
                        + faultString;
                    log.error('Vertex error',
                        errorDetails);
                    log.debug('Vertex2.0 ', 'triggerRestVertexWebService - adding Vertex Call Record');
                    addVtCallRecord(transaction, request, errorDetails, errorDetails, recordId, reverse, '', preferencesObj);
                    details.status = errorDetails;
                    return details;
                }
            } catch (e) {
                var errmsg = 'Vertex Error ' + e.name + ' '
                    + e.message;
                log.error('Vertex error', errmsg);
                log.debug('Vertex2.0', ' triggerRestVertexWebService - adding Vertex Call Record');
                addVtCallRecord(transaction, request, errmsg, errmsg, recordId, reverse, '', preferencesObj);
                details.status = errmsg;
                return details;
            }
        }

        /**
         * @param recordId
         * @param soap
         * @param distributeTax 
         * @returns
         */
        function triggerVertexWebService(transaction, recordId, soap, distributeTax, reverse, preferencesObj) {
            var details = {};
            try {
                var soapHead = {};
                var serviceURL = lib.getServiceUrl(transaction, preferencesObj);
                soapHead['Content-Type'] = 'text/xml';
                //Token based auth additional logic

                if (transaction.useToken) {
                    //Get token params if saved in custom record otherwise post token request and save params in custom record.
                    var useTokenStatus = lib.tokenLogic(transaction, preferencesObj);
                    if (!useTokenStatus)
                        return '';
                    soapHead = transaction.tokenHeader;
                    log.debug('Vertex2.0', ' Use token');
                }
                vertexResponse = https.post({ url: serviceURL, body: soap, headers: soapHead });
                //if the token or credentials expired, retry with new token 
                if (transaction.useToken && vertexResponse) {
                    var responseCode = vertexResponse.code;
                    if (responseCode == 401 || responseCode == 403 || (responseCode == 500 && vertexResponse.body.indexOf('expired') >= 0)) {
                        log.debug('Vertex2.0', ' Token expired retry with new token ');
                        var postToken = lib.postTokenRequest(transaction);
                        if (!postToken) {
                            log.debug('Vertex2.0', 'Unsuccessful token call');
                            return vertexResponse;
                        }
                        lib.saveTokenInCustomRecord(transaction);
                        vertexResponse = https.post({ url: serviceURL, body: soap, headers: transaction.tokenHeader });
                    }
                }
                lib.logLongText(vertexResponse.body, 'Response');
                if (vertexResponse.code == 200) {
                    details.status = 'Success';
                    var safeRequest = removeTrustedId(soap);
                    var soapXML = xml.Parser.fromString({
                        text: vertexResponse.body
                    });
                    var subNode = xml.XPath.select({
                        node: soapXML,
                        xpath: "//*[name()='SubTotal']"
                    });
                    if (subNode && subNode != undefined && subNode.length >= 1) {
                        var taxNode = xml.XPath.select({ node: subNode[0], xpath: "//*[name()='TotalTax']" });
                        if(taxNode[0].textContent < 0)
						{
							details.TotalTax = (taxNode[0].textContent * -1);
						}
                        else 
							details.TotalTax = taxNode[0].textContent;
                    }
                    // log.debug('Vertex2.0 AccrualRequest',
                    //     'details.TotalTax:' + details.TotalTax);
                    log.debug('Vertex2.0 ', 'triggerVertexWebService - adding Vertex Call Record');
                    addVtCallRecord(transaction, safeRequest, vertexResponse.body, 'Success',
                        recordId, reverse, details.TotalTax, preferencesObj);
                    return details;
                } else {
                    var faultString = '';//nlapiSelectValue(errorXML,"//*[name()='faultstring']");
                    var errorDetails = 'Request failed to post to Vertex.'
                        + faultString;
                    log.error('Vertex error',
                        errorDetails);
                    var safeRequest = removeTrustedId(soap);
                    log.debug('Vertex2.0 ', 'triggerVertexWebService - adding Vertex Call Record');
                    addVtCallRecord(transaction, safeRequest, errorDetails, errorDetails, recordId, reverse, '', preferencesObj);
                    details.status = errorDetails;
                    return details;
                }
            } catch (e) {
                var errmsg = 'Vertex Error ' + e.name + ' '
                    + e.message;
                log.error('Vertex error', errmsg);
                var safeRequest = removeTrustedId(soap);
                log.debug('Vertex2.0', ' triggerVertexWebService - adding Vertex Call Record');
                addVtCallRecord(transaction, safeRequest, errmsg, errmsg, recordId, reverse, '', preferencesObj);
                details.status = errmsg;
                return details;
            }
        }

        /**
         * Create a custom record with the request and response details and link to the
         * transaction
         * 
         * @param requestVt
         * @param responseVt
         * @param result
         * @param transactionInternalId
         * @returns
         */
        function addVtCallRecord(transaction, requestVt, responseVt, result, transactionInternalId, reverse, vtTax, preferencesObj) {
            //log.debug('Vertex2.0', 'addVtCallRecord starting');
            try {
                if (typeof requestVt == 'object') {
                    requestVt = JSON.stringify(requestVt);
                }
                if (typeof responseVt == 'object') {
                    responseVt = JSON.stringify(responseVt);
                }
                if (responseVt && responseVt.length >= 1000000)
                    responseVt = responseVt.substring(0, 999999);
                var vtCallRecord = record.create({ type: 'customrecord_call_details_vt' });
                //add url, and trusted to call details
                if (preferencesObj && preferencesObj.serviceURL)
                    vtCallRecord.setValue({ fieldId: 'custrecord_url_vt', value: preferencesObj.serviceURL });
                if (preferencesObj && preferencesObj.trustedId) {
                    const trustedId = 'ver' + preferencesObj.trustedId + 'tex';
                    vtCallRecord.setValue({ fieldId: 'custrecord_trusted_id_vt', value: trustedId });
                }
                vtCallRecord.setValue({ fieldId: 'custrecord_request_vt', value: requestVt });
                vtCallRecord.setValue({ fieldId: 'custrecord_response_vt', value: responseVt });
                vtCallRecord.setValue({ fieldId: 'custrecord_tax_result_vt', value: result });
                vtCallRecord.setValue({
                    fieldId: 'custrecord_transaction_internalid_vt',
                    value: transactionInternalId
                });
                vtCallRecord
                    .setValue({ fieldId: 'custrecord_trans_vt', value: transactionInternalId });
                vtCallRecord.setValue({ fieldId: 'custrecord_script_type_vt', value: '2.0' });
                if (transaction.docElementName) {
                    if (reverse)
                        vtCallRecord.setValue({ fieldId: 'custrecord_request_type_vt', value: 'Reverse Request' });
                    else
                        vtCallRecord.setValue({ fieldId: 'custrecord_request_type_vt', value: transaction.docElementName });
                }
                // CORST-1123 story changes by SYED
                if (transaction.dppapplied) {
                    vtCallRecord.setValue({ fieldId: 'custrecord_dpp_applied_vt', value: true });
                }
                if (lib.isPostingTransaction(transaction.recordType)
                    && transaction.docElementName == 'InvoiceRequest' ||
                    transaction.docElementName == 'DistributeTaxRequest')
                    vtCallRecord.setValue({ fieldId: 'custrecord_process_date_vt', value: new Date() });
                if (vtTax)
                    vtCallRecord.setValue({ fieldId: 'custrecord_total_tax_vt', value: vtTax });
                vtCallRecord.save();
                log.debug('Vertex2.0',
                    'Added Call Details for transaction '
                    + transactionInternalId);
                return true;
            } catch (err) {
                var errorDetailMsg = lib.logExecutionMsg(err,
                    "Error adding Vertex Call Details Record. ");
                log.error('VertexPlugin Error', errorDetailMsg);
                return false;
            }
        }

        /*
        * Administrative Origin = Company address for single company and subsidiary
        * address for one world
        * 
        * @param {String TaxCalculationInput} @returns
        */
        function getAdministrativeOrigin(transaction) {
            var administrativeOrigin = {};
            if (transaction.subsidiaryAddress) {
                administrativeOrigin.addr1 = transaction.subsidiaryAddress.addr1;
                administrativeOrigin.city = transaction.subsidiaryAddress.city;
                administrativeOrigin.state = transaction.subsidiaryAddress.state;
                administrativeOrigin.zip = transaction.subsidiaryAddress.zip;
                administrativeOrigin.country = transaction.subsidiaryAddress.country;
                transaction.administrativeOrigin = administrativeOrigin;
            } else if (transaction.company.mainaddrText) {
                // Administrative Origin = Company address for single company
                administrativeOrigin.addr1 = transaction.company.mainaddr1;
                administrativeOrigin.city = transaction.company.maincity;
                administrativeOrigin.state = transaction.company.mainstate;
                administrativeOrigin.zip = transaction.company.mainzip;
                administrativeOrigin.country = transaction.company.maincountry;
                transaction.administrativeOrigin = administrativeOrigin;
            }
        }

        /**
         * @param aValue
         * @returns
         */
        function getFloat(aValue) {
            if (aValue == null || isNaN(aValue) || aValue == '')
                return 0;
            return parseFloat(aValue);
        }

        /**
         * Check if distribute tax eligible
         * @param recordType
         * @param type
         * @returns boolean
         */
        function distributeTaxEligible(curRecord, recordType, type) {
            var distributeTax = curRecord.getValue({ fieldId: 'custbody_distributetax_vt' });
            var taxOverride = curRecord.getValue({ fieldId: 'taxdetailsoverride' });
            if ((recordType == record.Type.SALES_ORDER
                || recordType == record.Type.INVOICE
                || recordType == record.Type.CASH_SALE
                || recordType == record.Type.CREDIT_MEMO
                || recordType == record.Type.CASH_REFUND
                || recordType == record.Type.ESTIMATE)
                && (distributeTax)
                && (taxOverride)
                && (type == 'edit' || type == 'create')) {
                return true;
            }
            else {
                return false;
            }
        }

        /**
         * Distribute Tax functionality
         * @param recordType
         * @returns 
         */
        function distributeTax(transaction, preferencesObj, curRecord, recordType, recordId, type) {
            //log.debug("distributeTax2.0", "Starting");
            var taxtotal = getFloat(curRecord.getValue({ fieldId: 'taxtotal' }));
            var distributedTax = getFloat(curRecord.getValue({ fieldId: 'custbody_distributed_tax_vt' }));
            if (type == 'create' && taxtotal == 0) {
                if (recordType == record.Type.CREDIT_MEMO && !isTaxOnlyAdjustment(transaction, curRecord)) {
                    log.debug('VertexAfterSubmit2.0', 'No tax to distribute');
                    return;
                }
            }
            var vertexTaxResult = curRecord.getValue({ fieldId: 'custbody_tax_result_vt' });
            if (type == 'edit' && taxtotal == distributedTax && vertexTaxResult == 'Success') {
                log.debug('VertexAfterSubmit2.0', 'Tax not changed');
                return;
            }
            else if(type == 'edit' && taxtotal == distributedTax && !isTaxOnlyAdjustment(transaction, curRecord))
			{
				return;
			}
            getTransactionDetails(transaction, preferencesObj, recordId, recordType, true);
            distributeTaxCall(transaction, curRecord, recordType, recordId, type, preferencesObj);
            return;
        }

        /**
         * Distribute Tax Vertex call
         * if posting transaction and if tax already distributed, send negative request 
         *  send positive request
         * @param
         * @returns 
         */
        function distributeTaxCall(transaction, curRecord, recordType, recordId, type, preferencesObj) {
            // log.debug("distributeTaxCall2.0", "Starting");
            var distributedTax = getFloat(curRecord.getValue({ fieldId: 'custbody_distributed_tax_vt' }));
            var request = lib.convertNullToBlank(curRecord.getValue({ fieldId: 'custbody_request_vt' }));
            var fieldValues = {};
            if (type == 'edit' && lib.isPostingTransaction(recordType) && distributedTax != 0 && request) {
                transaction.docElementName = 'DistributeTaxRequest';
                var reverseRequest;
                if (preferencesObj.useRest) {
                    reverseRequest = generateRestReverseRequest(curRecord, request, preferencesObj, transaction);
                } else {
                    reverseRequest = generateReverseRequest(curRecord, request, preferencesObj);
                }

                var reverseCallDetails;
                if (preferencesObj.useRest && !preferencesObj.isSoapFormat) {
                    reverseCallDetails = triggerRestVertexWebService(transaction, recordId, reverseRequest, true, true, preferencesObj);
                } else {
                    reverseCallDetails = triggerVertexWebService(transaction, recordId, reverseRequest, true, true, preferencesObj);
                }
                if (reverseCallDetails.status != 'Success') {
                    const taxResult = {};
                    taxResult['custbody_tax_result_vt'] = reverseCallDetails.status;
                    record.submitFields({ type: recordType, id: recordId, values: taxResult });
                    log.error('Reversal', 'Something went wrong when posting reverse distribute tax request');
                    return;
                }
                lib.logLongText(reverseRequest, 'ReverseRequest');
            }

            var request;
            if (preferencesObj.useRest) {
                request = generateRestDistributeRequest(transaction, curRecord, recordType, recordId, preferencesObj);
            } else {
                request = generateDistributeRequest(transaction, curRecord, recordType, recordId, preferencesObj);
            }
            lib.logLongText(JSON.stringify(request), 'Request2.0');

            var distributeCallDetails;
            if (preferencesObj.useRest) {
                distributeCallDetails = triggerRestVertexWebService(transaction, recordId, request, true, false, preferencesObj);
            } else {
                distributeCallDetails = triggerVertexWebService(transaction, recordId, request, true, false, preferencesObj);
            }
            log.debug('Vertex2.0', JSON.stringify(distributeCallDetails));
            if (distributeCallDetails.status == 'Success') {
                var taxtotal = transaction.tranRecord.getValue({ fieldId: 'taxtotal' });
                if (transaction.isTaxOnlyAdjustment)
                    taxtotal = transaction.tranRecord.getValue({ fieldId: 'total' });
                var today = new Date();

                if (preferencesObj.useRest) {

                    request = JSON.stringify(request);

                }

                if (lib.isPostingTransaction(recordType)) {
                    fieldValues = { 'custbody_tax_result_vt': distributeCallDetails.status, 'custbody_request_vt': request, 'custbody_distributed_tax_vt': taxtotal, 'custbody_process_date_vt_2': today };
                    record.submitFields({ type: recordType, id: recordId, values: fieldValues });
                }
                else {
                    fieldValues = { 'custbody_tax_result_vt': distributeCallDetails.status, 'custbody_request_vt': request, 'custbody_distributed_tax_vt': taxtotal };
                    record.submitFields({ type: recordType, id: recordId, values: fieldValues });
                }
            } else {
                fieldValues = { 'custbody_tax_result_vt': distributeCallDetails.status };
                record.submitFields({ type: recordType, id: recordId, values: fieldValues });
            }
        }

        function generateRestReverseRequest(curRecord, prevRequest, preferencesObj, transaction) {
            var reverseRequest;
            try {
                reverseRequest = prevRequest;
                reverseRequest = JSON.parse(reverseRequest);

                if (reverseRequest.saleMessageType) {
                    transaction.sellerOrBuyer = "Seller";
                } else {
                    transaction.sellerOrBuyer = "Buyer";
                }

                if (reverseRequest && typeof reverseRequest.lineItems == 'object') {
                    for (var i = 0; i < reverseRequest.lineItems.length; i++) {

                        if (reverseRequest.lineItems[i].extendedPrice) {
                            reverseRequest.lineItems[i].extendedPrice = (getFloat(reverseRequest.lineItems[i].extendedPrice) * -1).toFixed(5);
                        }
                        if (reverseRequest.lineItems[i].inputTotalTax) {
                            reverseRequest.lineItems[i].inputTotalTax = (getFloat(reverseRequest.lineItems[i].inputTotalTax) * -1).toFixed(5);
                        }
                    }
                }
                //update documentDate 
                var tranDate = curRecord.getValue({ fieldId: 'trandate' });
                tranDate = format.parse({ value: tranDate, type: format.Type.DATE });
                tranDate = tranDate.getFullYear() + '-' + ("0" + (tranDate.getMonth() + 1)).slice(-2) + '-' + ("0" + tranDate.getDate()).slice(-2);
                var postingDate = tranDate;
                //If there is a saleseffectivedate, documentDate=saleseffectivedate; postingDate is always trandate from the document
                if (curRecord.getValue({ fieldId: 'saleseffectivedate' })) {
                    tranDate = curRecord.getValue({ fieldId: 'saleseffectivedate' });
                    tranDate = format.parse({ value: tranDate, type: format.Type.DATE });
                    tranDate = tranDate.getFullYear() + '-' + ("0" + (tranDate.getMonth() + 1)).slice(-2) + '-' + ("0" + tranDate.getDate()).slice(-2);
                }
                reverseRequest.documentDate = tranDate;
                if (reverseRequest.postingDate) reverseRequest.postingDate = postingDate;
                preferencesObj.isSoapFormat = false;
            } catch (error) {
                log.error('generateRestReverseRequest', 'Request is not in REST format, attempting to use SOAP');
                reverseRequest = generateReverseRequest(curRecord, prevRequest, preferencesObj);
            }
            return reverseRequest;
        }

        /**
         * Get request from the request field and generate request amounts changed to negative amount
         * @param prevRequest
         * @returns string
         */
        function generateReverseRequest(curRecord, prevRequest, preferencesObj) {
            //nlapiLogExecution('DEBUG', 'prevRequest', prevRequest);
            var reverseRequest = prevRequest;
            var idx = 0;
            //QuotationRequest/InvoiceRequest - change ExtendedPrice to negative
            while (idx >= 0) {
                var openTagIdx = reverseRequest.indexOf('<ExtendedPrice>', idx);
                if (openTagIdx == -1) {
                    break;
                }
                var closeTagIdx = reverseRequest.indexOf('</ExtendedPrice>',
                    openTagIdx);
                var amount = getFloat(reverseRequest.substring(openTagIdx + 15, closeTagIdx));
                var negativeAmount = (amount * -1);
                reverseRequest = reverseRequest.substring(0, openTagIdx)
                    + '<ExtendedPrice>' + negativeAmount
                    + reverseRequest.substring(closeTagIdx);
                idx = closeTagIdx;
            }
            //DistributeTax - change InputTotalTax to negative
            var idx = 0;
            while (idx >= 0) {
                var openTagIdx = reverseRequest.indexOf('<InputTotalTax>', idx);
                if (openTagIdx == -1) {
                    break;
                }
                var closeTagIdx = reverseRequest.indexOf('</InputTotalTax>',
                    openTagIdx);
                var amount = getFloat(reverseRequest.substring(openTagIdx + 15, closeTagIdx));
                var negativeAmount = (amount * -1).toFixed(5);
                //nlapiLogExecution('DEBUG', 'Reversing amount', 'amount:'+amount+ ' reverseAmount: '+negativeAmount);
                reverseRequest = reverseRequest.substring(0, openTagIdx)
                    + '<InputTotalTax>' + negativeAmount
                    + reverseRequest.substring(closeTagIdx);
                idx = closeTagIdx;
            }
            //update documentDate 
            var tranDate = curRecord.getValue({ fieldId: 'trandate' });
            tranDate = format.parse({ value: tranDate, type: format.Type.DATE });
            tranDate = tranDate.getFullYear() + '-' + (tranDate.getMonth() + 1) + '-' + tranDate.getDate();
            var postingDate = tranDate;
            //If there is a saleseffectivedate, documentDate=saleseffectivedate; postingDate is always trandate from the document
            if (curRecord.getValue({ fieldId: 'saleseffectivedate' })) {
                tranDate = curRecord.getValue({ fieldId: 'saleseffectivedate' });
                tranDate = format.parse({ value: tranDate, type: format.Type.DATE });
                tranDate = tranDate.getFullYear() + '-' + (tranDate.getMonth() + 1) + '-' + tranDate.getDate();
            }
            var requestPart1 = reverseRequest.substring(0, reverseRequest.indexOf('documentDate='));
            var requestPart2 = reverseRequest.substring(reverseRequest.indexOf('documentNumber='), reverseRequest.length);
            reverseRequest = requestPart1 + ' documentDate= "' + tranDate + '" ' + requestPart2;
            //nlapiLogExecution("DEBUG", 'docDate',  reverseRequest);   
            if (reverseRequest.indexOf('postingDate=') >= 0) {
                var requestPart1 = reverseRequest.substring(0, reverseRequest.indexOf('postingDate='));
                var requestPart2 = reverseRequest.substring(reverseRequest.indexOf('transactionType='), reverseRequest.length);
                reverseRequest = requestPart1 + ' postingDate= "' + postingDate + '" ' + requestPart2;
            }

            reverseRequest = lib.replaceSoapTrustedId(reverseRequest, preferencesObj.trustedId);

            preferencesObj.isSoapFormat = true;
            return reverseRequest;
        }

        function generateRestDistributeRequest(transaction, curRecord, recordType, recordId, preferencesObj) {
            log.debug('Vertex2.0 Distribute', 'generateRestDistributeRequest');
            var request = {};
            var lineItems = getItems(transaction, curRecord);
            transaction.custShipAddr1 = curRecord.getValue({ fieldId: 'shipaddr1' });
            transaction.custShipAddr2 = curRecord.getValue({ fieldId: 'shipaddr2' });
            transaction.custShipAddr3 = curRecord.getValue({ fieldId: 'shipaddr3' });
            transaction.custShipCity = curRecord.getValue({ fieldId: 'shipcity' });
            transaction.custShipPostal = curRecord.getValue({ fieldId: 'shipzip' });
            transaction.custShipState = curRecord.getValue({ fieldId: 'shipstate' });
            transaction.custShipCountry = curRecord.getValue({ fieldId: 'shipcountry' });
            transaction.docElementName = 'DistributeTaxRequest';
            transaction.transactionType = 'SALE';
            transaction.sellerOrBuyer = 'Seller';
            transaction.originOrDestnation = 'PhysicalOrigin';
            transaction.internalid = recordId;
            transaction.tranid = curRecord.getValue({ fieldId: 'tranid' });
            // log.debug("generateDistributeRequest2.0", "transaction: " + JSON.stringify(transaction));
            if (lib.isPostingTransaction(recordType))
                transaction.postToJournal = true;
            else
                transaction.postToJournal = false;
            //log.debug(postToJournal', transaction.postToJournal);
            transaction.scriptType = 'UE';

            request = lib.addRestDocumentInfo(request, transaction, preferencesObj);
            processLineDiscounts(lineItems);

            request.lineItems = [];
            for (var i = 0; lineItems && i < lineItems.length; i++) {
                if (lineItems[i].itemType && lineItems[i].itemType.toLowerCase() == 'discount') continue;
                //HHTODO
                var lineItem = createRestItemDistribute(transaction, lineItems[i], 'item', i + 1, preferencesObj, curRecord);
                request.lineItems.push(lineItem);
                //nlapiLogExecution('DEBUG', 'itemElement '+i, soapRequest);
            }
            if (!transaction.isTaxOnlyAdjustment) {
                log.debug('Vertex2.0', 'shippingCost:' + transaction.shippingCost
                    + ' handlingCost:' + transaction.handlingCost
                    + ' shippingtaxamount:' + transaction.shippingtaxamount
                    + ' handlingtaxamount:' + transaction.handlingtaxamount);
                //HHTODO
                if (getFloat(transaction.shippingCost) > 0 && transaction.shippingtaxamount) {
                    var lineItem = createRestItemDistribute(transaction, lineItems[0], 'FREIGHT', 1, preferencesObj, curRecord);
                    request.lineItems.push(lineItem);
                }
                if (getFloat(transaction.handlingCost) > 0 && transaction.handlingtaxamount) {
                    var lineItem = createRestItemDistribute(transaction, lineItems[0], 'HANDLING', 1, preferencesObj, curRecord);
                    request.lineItems.push(lineItem);
                }
            }
            return request;
        }

        /**
         * @param recordType
         * @param recordId
         * @returns
         */
        function generateDistributeRequest(transaction, curRecord, recordType, recordId, preferencesObj) {
            log.debug('Vertex2.0 Distribute', 'generateSOAPrequest');
            var lineItems = getItems(transaction, curRecord);
            var soapRequest = lib.addRequestHeaderElements(preferencesObj);
            transaction.custShipAddr1 = curRecord.getValue({ fieldId: 'shipaddr1' });
            transaction.custShipAddr2 = curRecord.getValue({ fieldId: 'shipaddr2' });
            transaction.custShipAddr3 = curRecord.getValue({ fieldId: 'shipaddr3' });
            transaction.custShipCity = curRecord.getValue({ fieldId: 'shipcity' });
            transaction.custShipPostal = curRecord.getValue({ fieldId: 'shipzip' });
            transaction.custShipState = curRecord.getValue({ fieldId: 'shipstate' });
            transaction.custShipCountry = curRecord.getValue({ fieldId: 'shipcountry' });
            transaction.docElementName = 'DistributeTaxRequest';
            transaction.transactionType = 'SALE';
            transaction.sellerOrBuyer = 'Seller';
            transaction.originOrDestnation = 'PhysicalOrigin';
            transaction.internalid = recordId;
            transaction.tranid = curRecord.getValue({ fieldId: 'tranid' });
            // log.debug("generateDistributeRequest2.0", "transaction: " + JSON.stringify(transaction));
            if (lib.isPostingTransaction(recordType))
                transaction.postToJournal = true;
            else
                transaction.postToJournal = false;
            //log.debug(postToJournal', transaction.postToJournal);
            transaction.scriptType = 'UE';
            soapRequest = lib.addDateTags(soapRequest, transaction, preferencesObj);
            processLineDiscounts(lineItems);
            for (var i = 0; lineItems && i < lineItems.length; i++) {
                if (lineItems[i].itemType && lineItems[i].itemType.toLowerCase() == 'discount') continue;
                //HHTODO
                soapRequest += addItemTagsDistribute(transaction, lineItems[i], 'item', i + 1, preferencesObj, curRecord);
                //nlapiLogExecution('DEBUG', 'itemElement '+i, soapRequest);
            }
            if (!transaction.isTaxOnlyAdjustment) {
                log.debug('Vertex2.0', 'shippingCost:' + transaction.shippingCost
                    + ' handlingCost:' + transaction.handlingCost
                    + ' shippingtaxamount:' + transaction.shippingtaxamount
                    + ' handlingtaxamount:' + transaction.handlingtaxamount);
                //HHTODO
                if (getFloat(transaction.shippingCost) > 0 && transaction.shippingtaxamount)
                    soapRequest += addItemTagsDistribute(transaction, lineItems[0], 'FREIGHT', 1, preferencesObj, curRecord);
                if (getFloat(transaction.handlingCost) > 0 && transaction.handlingtaxamount)
                    soapRequest += addItemTagsDistribute(transaction, lineItems[0], 'HANDLING', 1, preferencesObj, curRecord);
            }
            soapRequest = lib.addClosingTags(soapRequest, transaction);
            return soapRequest;
        }

        function processLineDiscounts(lineItems) {
            for (var i = 0; lineItems && i < lineItems.length; i++) {
                if (lineItems[i].itemType && lineItems[i].itemType.toLowerCase() == 'discount' && i > 0) {
                    var itemCount = lineItems.length;
                    var itemAmount = parseFloat(lineItems[i - 1].amount);
                    var discountAmount = parseFloat(lineItems[i].amount);
                    var currentDiscountIdx = i + 1;
                    var additionalDiscount = 0;

                    while (currentDiscountIdx < itemCount
                        && lineItems[currentDiscountIdx].itemType && lineItems[currentDiscountIdx].itemType.toLowerCase() == 'discount') {
                        discountAmount += parseFloat(lineItems[currentDiscountIdx].amount);
                        currentDiscountIdx++;
                        additionalDiscount++;
                    }
                    itemAmount += discountAmount;
                    lineItems[i - 1].amountNetDiscount = itemAmount;
                    i = i + additionalDiscount;
                }
            }
        }

        function createRestItemDistribute(transaction, item, type, typeNumber, preferencesObj, curRecord) {
            var lineItem = {};
            lineItem.lineItemNumber = 1;
            if (type == 'FREIGHT')
                lineItem.lineItemId = 'FREIGHT' + '|' + '1';
            else if (type == 'HANDLING')
                lineItem.lineItemId = 'HANDLING' + '|' + '1';
            else {
                lineItem.lineItemNumber = typeNumber;
                lineItem.lineItemId = type + '|' + typeNumber;
            }
            if (item.lineLocation && item.lineLocation.locationName) {
                lineItem.locationCode = lib.escapeXMLapi(item.lineLocation.locationName);
            } else if (transaction.hdrLocationDetails && transaction.hdrLocationDetails.locationName) {
                lineItem.locationCode = lib.escapeXMLapi(transaction.hdrLocationDetails.locationName);
            }

            if (transaction.sellerOrBuyer == 'Buyer') {
                lineItem.buyer = createSellerOrBuyerRestObject(transaction, preferencesObj, item);
            } else {
                lineItem.seller = createSellerOrBuyerRestObject(transaction, preferencesObj, item);
            }
            lineItem.customer = createRestCustomerDistribute(transaction,preferencesObj);

            if (item.itemName)
                item.itemName = item.itemName.substring(0, 40);
            if (type == 'FREIGHT') {
                lineItem.product = {};
                lineItem.product.productClass = 'Freight';
                lineItem.product.value = 'Shipping';
                lineItem.inputTotalTax = transaction.shippingtaxamount;
                lineItem.extendedPrice = transaction.shippingCost;
            } else if (type == 'HANDLING') {
                lineItem.product = {};
                lineItem.product.productClass = 'Handling';
                lineItem.product.value = 'Handling';
                lineItem.inputTotalTax = transaction.handlingtaxamount;
                lineItem.extendedPrice = transaction.handlingCost;
            } else {
                if (item.productClass) {
                    lineItem.product = {};
                    lineItem.product.productClass = lib.escapeXMLapi(item.productClass);
                    lineItem.product.value = lib.escapeXMLapi(item.itemName);
                } else {
                    lineItem.product = {};
                    lineItem.product.value = lib.escapeXMLapi(item.itemName);
                }
                if (lib.isRefundTransaction(transaction.recType))
					lineItem.inputTotalTax = (item.inputTotalTax * -1);
				else
					lineItem.inputTotalTax = item.inputTotalTax;
                if (item.amountNetDiscount) {
                    lineItem.extendedPrice = item.amountNetDiscount;
                }
                else 
				{
					if (lib.isRefundTransaction(transaction.recType))
						lineItem.extendedPrice = (item.amount * -1);
					else 
						lineItem.extendedPrice = item.amount;
                }
                if (item.amountNetDiscount) {
                    lineItem.discount = {};
                    lineItem.discountType = 'DiscountAmount';
                    lineItem.discountValue = lineItemAmount - discountedAmount;
                }
            }
            if (item.UNSPSCcode) {
                var commodityCodeType = "UNSPSC";
                lineItem.commodityCode = {};
                lineItem.commodityCode.commodityCodeType = commodityCodeType;
                lineItem.value = item.UNSPSCcode;
            }
            lineItem.quantity = {};
            lineItem.quantity.value = item.quantity;
			var flexFields = lib.createRestFlexfields(typeNumber - 1, transaction, curRecord, 'ue');
            //log.debug('flexFields',flexFields);
			if (flexFields) {
				lineItem.flexibleFields = flexFields;
			}
            return lineItem;
        }

        function addItemTagsDistribute(transaction, item, type, typeNumber, preferencesObj, curRecord) {
            //nlapiLogExecution("DEBUG",'addItemElement', JSON.stringify(item));
            var productClassAttributeName = 'productClass';
            var itemElement = '';
            if (type == 'FREIGHT')
                itemElement = '\t\t\t <LineItem lineItemNumber="1" lineItemId="FREIGHT|1"';
            else if (type == 'HANDLING')
                itemElement = '\t\t\t <LineItem lineItemNumber="1" lineItemId="HANDLING|1"';
            else
                itemElement = '\t\t\t <LineItem lineItemNumber="' + typeNumber
                    + '" lineItemId="' + type + '|' + typeNumber + '"';
            if (item.lineLocation && item.lineLocation.locationName) {
                itemElement += ' locationCode="'
                    + lib.escapeXMLapi(item.lineLocation.locationName) + '"';
            } else if (transaction.hdrLocationDetails
                && transaction.hdrLocationDetails.locationName) {
                itemElement += ' locationCode="'
                    + lib.escapeXMLapi(transaction.hdrLocationDetails.locationName)
                    + '"';
            }
            itemElement += '>'
            itemElement += addSellerOrBuyerElement(transaction, preferencesObj, item);
            itemElement += addCustomerElementDistribute(transaction);
            if (item.itemName)
                item.itemName = item.itemName.substring(0, 40);
            if (type == 'FREIGHT') {
                itemElement += '\t\t\t  <Product productClass="Freight">Shipping</Product>';
                itemElement += '\t\t\t <InputTotalTax>' + transaction.shippingtaxamount + '</InputTotalTax>';
                itemElement += '\t\t\t  <ExtendedPrice>' + transaction.shippingCost + '</ExtendedPrice>';
            } else if (type == 'HANDLING') {
                itemElement += '\t\t\t  <Product productClass="Handling">Handling</Product>';
                itemElement += '\t\t\t <InputTotalTax>' + transaction.handlingtaxamount + '</InputTotalTax>';
                itemElement += '\t\t\t  <ExtendedPrice>' + transaction.handlingCost + '</ExtendedPrice>';
            } else {
                if (item.productClass) {
                    itemElement += '\t\t\t  <Product productClass="'
                        + lib.escapeXMLapi(item.productClass) + '">'
                        + lib.escapeXMLapi(item.itemName) + '</Product>';
                } else {
                    itemElement += '\t\t\t  <Product>' + lib.escapeXMLapi(item.itemName) + '</Product>';
                }
                if (lib.isRefundTransaction(transaction.recType))
				{
                itemElement += '\t\t\t <InputTotalTax>' + (item.inputTotalTax * -1) + '</InputTotalTax>';
                }
				else
                itemElement += '\t\t\t <InputTotalTax>' + item.inputTotalTax + '</InputTotalTax>';
                if (item.amountNetDiscount) itemElement += '\t\t\t <ExtendedPrice>' + item.amountNetDiscount + '</ExtendedPrice>';
                
					if (lib.isRefundTransaction(transaction.recType))
					{
					    itemElement += '\t\t\t <ExtendedPrice>' + (item.amount * -1) + '</ExtendedPrice>';
					}
					else
						itemElement += '\t\t\t <ExtendedPrice>' + item.amount + '</ExtendedPrice>';
				
                if (item.amountNetDiscount) itemElement += addDiscountElement(item.amount, item.amountNetDiscount);
            }
            if (item.UNSPSCcode) {
                var commodityCodeType = "UNSPSC";
                itemElement += '\t\t\t      <CommodityCode commodityCodeType="'
                    + commodityCodeType + '">' +item.UNSPSCcode
                    + '</CommodityCode>';
            }
            itemElement += '\t\t\t      <Quantity>' + item.quantity
                + '</Quantity>';
			var flexFields = lib.addFlexfieldElement(typeNumber - 1, transaction, curRecord, 'ue');
			if (flexFields)
				itemElement += flexFields;	
            itemElement += '\t\t\t </LineItem>';
            //nlapiLogExecution("DEBUG",'addItemElement', 'added');
            return itemElement;
        }

        /**
         * @param lineItemAmount line item quantity * price
         * @param discountedAmount the line item amount after discount
         * @returns the discount amount
         */
        function addDiscountElement(lineItemAmount, discountedAmount) {
            return '\t\t\t  <Discount><DiscountAmount>' + (lineItemAmount - discountedAmount) + '</DiscountAmount> </Discount>'
        }

        function getInputTotalTax(curRecord, itemTaxRef) {
            var inputTotalTax = 0;
            //get tax details
            var taxDetailsCount = curRecord.getLineCount('taxdetails');
            if (taxDetailsCount == 0)
                return 0;
            for (var idx = 0; idx < taxDetailsCount; idx++) {
                var taxDetailRef = curRecord.getSublistValue({ sublistId: 'taxdetails', fieldId: 'taxdetailsreference', line: idx });
                if (taxDetailRef == itemTaxRef)
                    inputTotalTax += getFloat(curRecord.getSublistValue({ sublistId: 'taxdetails', fieldId: 'taxamount', line: idx }));
            }
            //nlapiLogExecution("DEBUG",'itemTaxRef: '+itemTaxRef, 'inputTotalTax:'+inputTotalTax);
            return inputTotalTax;
        }

        function createRestCustomerDistribute(transaction,preferencesObj) {
            var customer = {};
            customer.customerCode = {};

            if (transaction.custExternalId && transaction.custExternalId != undefined) {
                if (transaction.custCategory == null || transaction.custCategory == '')
                    customer.customerCode.value = lib.escapeXMLapi(transaction.custExternalId);
                else {
                    customer.customerCode.classCode = lib.escapeJSONapi(transaction.custCategory);
                    customer.customerCode.value = lib.escapeXMLapi(transaction.custExternalId);
                }
            }

            customer.destination = {};
            if (transaction.billtoLat && transaction.billtoLat != undefined) {
                customer.destination.latitude = transaction.billtoLat;
            }
            if (transaction.billtoLong && transaction.billtoLong != undefined) {
                customer.destination.longitude = transaction.billtoLong;
            }

            transaction.administrativeDestination = lib.formatAddressFields(transaction.administrativeDestination);

            customer.destination.streetAddress1 = lib.escapeXMLapi(transaction.custShipAddr1);
            customer.destination.city = lib.escapeXMLapi(transaction.custShipCity);
            customer.destination.mainDivision = lib.escapeXMLapi(transaction.custShipState);
            customer.destination.postalCode = lib.escapeXMLapi(transaction.custShipPostal);
            customer.destination.country = lib.convertCountry(lib.escapeXMLapi(transaction.custShipCountry));

            if (!customer.destination.streetAddress1 || customer.destination.streetAddress1 == undefined || customer.destination.streetAddress1 == '') {
                customer.destination = lib.createRestAddressObject(transaction.administrativeDestination);
            }

            customer.administrativeDestination = lib.createRestAddressObject(transaction.administrativeDestination);
            var taxRegistration = lib.createRestTaxRegistration(true, transaction, transaction.isoCountryCode,preferencesObj);
            if (taxRegistration && taxRegistration != undefined) {
                customer.taxRegistrations = [];
                customer.taxRegistrations.push(taxRegistration);
            }
            return customer;
        }

        function addCustomerElementDistribute(transaction) {
            var customerElement = '\t\t\t  <Customer>';
            // class code attribute can't be blank, but blank external ID is OK

            if (transaction.custExternalId && transaction.custExternalId != undefined) {
                if (transaction.custCategory == null || transaction.custCategory == '')
                    customerElement += '\t\t\t    <CustomerCode>'
                        + lib.escapeXMLapi(transaction.custExternalId)
                        + '</CustomerCode>';
                else {
                    customerElement += '\t\t\t    <CustomerCode classCode="'
                        + lib.escapeXMLapi(transaction.custCategory) + '">'
                        + lib.escapeXMLapi(transaction.custExternalId)
                        + '</CustomerCode>';
                }
            }

            //customerElement += '\t\t\t  <Destination>';
            //Support lat long
            customerElement = lib.addDestinationLatLongElement(customerElement, transaction);
            customerElement += '\t\t\t    <StreetAddress1>' + lib.escapeXML(transaction.custShipAddr1)
                + '</StreetAddress1>';
            customerElement += '\t\t\t    <City>' + lib.escapeXML(transaction.custShipCity) + '</City>';
            customerElement += '\t\t\t    <MainDivision>' + lib.escapeXML(transaction.custShipState) + '</MainDivision>';
            customerElement += '\t\t\t    <PostalCode>' + lib.escapeXML(transaction.custShipPostal) + '</PostalCode>';
            customerElement += '\t\t\t    <Country>' + lib.convertCountry(lib.escapeXML(transaction.custShipCountry)) + '</Country>';
            customerElement += '\t\t\t  </Destination>';
            // ADD ADMINISTRATIVE DESTINATION
            customerElement = lib.addAdministrativeDestinationElement(customerElement, transaction);
            customerElement = lib.addTaxRegistrationElement(customerElement, true, transaction, transaction.isoCountryCode);
            customerElement += '\t\t\t  </Customer>';
            // nlapiLogExecution("DEBUG", 'VertexPlugin customerElement', JSON
            // .stringify(customerElement));
            return customerElement;
        }

        /**
         * get item details for Distribute tax
         * @param
         * @returns 
         */
        function getItems(transaction, curRecord) {
            //nlapiLogExecution('DEBUG', 'getItems');
            var lineItems = [];
            var itemCount = curRecord.getLineCount('item');
            for (var i = 0; i < itemCount; i++) {
                var item = {};
                item.itemId = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
                const itemInternalId = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
                item.itemName = lib.getSearchValueByInternalId(search.Type.ITEM, itemInternalId, "name");
                item.quantity = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i });
                item.itemTaxRef = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'taxdetailsreference', line: i });
                item.amount = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: i });
                item.inputTotalTax = 0;
                if (transaction.isTaxOnlyAdjustment == true)
                    item.inputTotalTax = item.amount;
                else if (item.itemTaxRef)
                    item.inputTotalTax = getInputTotalTax(curRecord, item.itemTaxRef);
                const productClassInternalId = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_taxproductclass_vt', line: i });
                if(productClassInternalId)
					item.productClass = lib.getSearchValueByInternalId("customlist_taxproductclass_vt", productClassInternalId, "name");
                item.location = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'location', line: i });
                item.lineLocation = '';
                if (item.location)
                    item.lineLocation = getLocationAddress(item.location, transaction);
                const unspcInternalId = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_unspsc_code_vt', line: i });
				if(unspcInternalId)
					item.unspc = lib.getSearchValueByInternalId("customlist_taxproductclass_vt", unspcInternalId, "name");
                item.itemType = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i });
                lineItems.push(item);
                // log.debug("getItems2.0", "item #" + i + ": " + JSON.stringify(item));
                //nlapiLogExecution("DEBUG", 'item '+i, JSON.stringify(item));
            }
            //  nlapiLogExecution("DEBUG", 'Vertex', 'lineItems:'+ JSON.stringify(lineItems));
            return lineItems;
        }

        /**
         * Tax only Adjustment
         * @param
         * @returns 
         */
        function taxOnlyAdjustValidation(curRecord, oldRecord, type) {
            var itemCount = curRecord.getLineCount('item');
            var hasTaxOnlyAdjustment = false;
            var itemIds = [];
            for (var i = 0; i < itemCount; i++) {
                var curItem = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
                itemIds.push(curItem);
            }

            var itemList = lib.getSearchValuesByInternalIds(search.Type.ITEM, itemIds, "name");

            if (itemList && itemList.length) {
                for (var j = 0; j < itemList.length; j++) {
                    if (itemList[j].value && itemList[j].value.indexOf('Tax Only Adjustment') == 0) {
                        hasTaxOnlyAdjustment = true;
                    }
                }
            }
            if (hasTaxOnlyAdjustment && type == 'edit') {
                var oldTotal = oldRecord.getValue('total');
                var newTotal = curRecord.getValue('total');
                if (oldTotal != newTotal) {
                    throw error.create({
                        name: 'TAX ONLY ADJUSTMENT ERROR',
                        message: 'You are not allowed to change the amount since tax already adjusted for this Credit Memo.'
                        , notifyOff: true
                    });
                }
            }
            if (hasTaxOnlyAdjustment) {
                if (itemCount > 1) {
                    throw error.create({
                        name: 'TAX ONLY ADJUSTMENT ERROR',
                        message: 'You are not allowed to use Tax Only Adjustment item with any other item.'
                        , notifyOff: true
                    });
                }
                var taxtotal = getFloat(curRecord.getValue({ fieldId: 'taxtotal' }));
                if (taxtotal > 0) {
                    throw error.create({
                        name: 'TAX ONLY ADJUSTMENT ERROR',
                        message: 'You are not supposed to enter tax on Tax Only Adjustment Credit Memo.'
                        , notifyOff: true
                    });
                }
                curRecord.setValue({ fieldId: 'taxdetailsoverride', value: true });
                curRecord.setValue({ fieldId: 'custbody_distributetax_vt', value: true });
            }
        }

        /**
         * Check for Tax only Adjustment
         * @param
         * @returns 
         */
        function isTaxOnlyAdjustment(transaction, curRecord) {
            transaction.isTaxOnlyAdjustment = false;
            var itemCount = curRecord.getLineCount('item');
            for (var i = 0; i < itemCount; i++) {
                //CNSL-361 Tax only adjustment for Canada and other countries
                var curItem = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
                var curItemName = lib.getSearchValueByInternalId(search.Type.ITEM, curItem, "name");
                // log.debug("isTaxOnlyAdjustment2.0", "curItem: " + curItem);
                // log.debug("isTaxOnlyAdjustment2.0", "curItemName: " + curItemName);
                if (curItemName.indexOf('Tax Only Adjustment') == 0) {
                    transaction.isTaxOnlyAdjustment = true;
                    // log.debug('VertexAftersubmit2.0', 'Tax Only Adjustment');
                    return true;
                }
            }
            return false;
        }

        function getSearchResults(searchRecord, filters, columns) {
            var searchResults = null;
            try {
                // 10 POINTS
                searchResults = search.create({
                    type: searchRecord,
                    filters: filters,
                    columns: columns
                }).run().getRange({
                    start: 0,
                    end: 1000
                });

            } catch (err) {
                var errorDetailMsg = lib.logExecutionMsg(err, "Error retrieving "
                    + searchRecord + " search for filters: " + JSON.stringify(filters) + " and columns: " + JSON.stringify(columns));
                log.error({ title: 'Vertex Search Error', details: errorDetailMsg });
            }
            return searchResults;
        }
        //moved to lib
        // function addFlexfieldElementUE(itemIdx, transaction, recobject) {
		// 	// SEARCH FOR FLEX FIELD CUSTOM RECORDS
		// 	try {
		// 		var flexFieldResults = transaction.flexFields;
		// 		// log.debug('Vertex flexFields', 'Number of flex
		// 		// fields:'+ flexFieldResults.length);
		// 		var flexfieldElement = '\t\t\t  <FlexibleFields>';
		// 		var codeFieldCount = 0;// max 25
		// 		var numericFieldCount = 0;// max 10
		// 		var dateFieldCount = 0;// max 5
		// 		if (flexFieldResults) {
		// 			for (var idx = 0; flexFieldResults && idx < flexFieldResults.length; idx++) {
		// 				//fieldType, flexFieldType, netsuiteListField, flexFieldNumber, netsuiteFieldInternalid
		// 				var fieldType = flexFieldResults[idx].fieldType;
		// 				var flexFieldType = flexFieldResults[idx].flexFieldType;
		// 				var netsuiteListField = flexFieldResults[idx].netsuiteListField;
		// 				var flexFieldNumber = flexFieldResults[idx].flexFieldNumber;
		// 				var netsuiteFieldInternalid = flexFieldResults[idx].netsuiteFieldInternalid;
		// 				var flexFieldValue = '';
		// 				if (fieldType == "body") {
		// 					flexFieldValue = recobject.getValue({ fieldId: netsuiteFieldInternalid });
		// 					if (netsuiteListField == true){
		// 						if(netsuiteFieldInternalid == 'shipmethod')
		// 							flexFieldValue = transaction.shipMethod;
		// 						else if(netsuiteFieldInternalid == 'entity')
		// 							flexFieldValue = lib.getListRecordName(flexFieldResults[idx].listOrRecordResults, flexFieldValue, false, 'companyname');
		// 						else
		// 							flexFieldValue = lib.getListRecordName(flexFieldResults[idx].listOrRecordResults, flexFieldValue, false, '');
		// 					}
		// 				} else if (fieldType == "column") {
		// 					flexFieldValue = recobject.getSublistValue({
		// 						sublistId: 'item',
		// 						fieldId: netsuiteFieldInternalid, line: itemIdx
		// 					});
		// 					if (netsuiteListField == true){
		// 						if(netsuiteFieldInternalid == 'shipmethod')
		// 							flexFieldValue = transaction.shipMethod;
		// 						else
		// 							flexFieldValue = lib.getListRecordName(flexFieldResults[idx].listOrRecordResults, flexFieldValue, false, '');
		// 					}
		// 				}
		// 				if (flexFieldValue != true && flexFieldValue != false && flexFieldValue != 'T' && flexFieldValue != 'F') {
							
		// 					if (flexFieldValue == null || !flexFieldValue
		// 						|| flexFieldValue == '')
		// 						continue;
		// 				}
		// 				// limit: 25 code fields, 10 numenric fields, 5 date fields
		// 				var flexFieldTag = 'FlexibleCodeField';
		// 				if (flexFieldType == 'Code') {
		// 					if(!flexFieldValue || flexFieldValue == null || flexFieldValue == "" || flexFieldValue == undefined)
		// 						continue;
		// 					if (codeFieldCount >= 25)
		// 						continue;
		// 					// Vertex has 40 chars limit trim 
		// 					//				if (flexFieldValue.length > 40)
		// 					//					flexFieldValue = flexFieldValue.substring(0, 40);
		// 					if (flexFieldValue != true && flexFieldValue != false && flexFieldValue != 'T' && flexFieldValue != 'F') {
		// 						flexFieldValue = lib.trimAndHandleSpecialChars(flexFieldValue);
		// 					}
		// 					codeFieldCount++;
		// 					flexFieldTag = 'FlexibleCodeField';
		// 				} else if (flexFieldType == 'Numeric') {
		// 					if(!flexFieldValue || flexFieldValue == null || flexFieldValue == "" || flexFieldValue == undefined)
		// 						continue;
		// 					if (numericFieldCount >= 10)
		// 						continue;
		// 					numericFieldCount++;
		// 					flexFieldTag = 'FlexibleNumericField';
		// 				} else if (flexFieldType == 'Date') {
		// 					if(!flexFieldValue || flexFieldValue == null || flexFieldValue == "" || flexFieldValue == undefined)
		// 						continue;
		// 					if (dateFieldCount >= 5)
		// 						continue;
		// 					dateFieldCount++
		// 					flexFieldTag = 'FlexibleDateField';
							
		// 					// format YYYY-MM-DD
		// 					var flexdate = new Date(flexFieldValue);
		// 					//flexFieldValue = format.parse({ value: flexFieldValue, type: format.Type.DATE });
		// 					flexFieldValue = flexdate.getFullYear() + "-"
		// 						+ (flexdate.getMonth() + 1) + "-"
		// 						+ flexdate.getDate();
		// 				}
		// 				flexFieldValue = flexFieldValue + '';
		// 				flexfieldElement += '\t\t\t<' + flexFieldTag + ' fieldId="'
		// 					+ flexFieldNumber + '">' + xml.escape({ xmlText: flexFieldValue })
		// 					+ '</' + flexFieldTag + '>';
		// 			}
		// 		}
		// 		flexfieldElement += '\t\t\t  </FlexibleFields>';
		// 		return flexfieldElement;
		// 	} catch (err) {
		// 		log.debug(" addFlexfieldElement Error", logExecutionMsg(err, ''));
		// 		return null;
		// 	}
		// }
        
		// function createRestFlexfields(itemIdx, transaction, curRecord) {
		// 	//log.debug('createRestFlexfields');
		// 	var flexFieldsArr = transaction.flexFields;
		// 	//log.debug('flexFieldsArr',flexFieldsArr);
		// 	//var currRec = context.newRecord;
		// 	var item = curRecord.getSublistValue('item','item',itemIdx);
		// 	//log.debug('item',item);
		// 	//var item = input.lines[itemIdx];
		// 	if (!flexFieldsArr)
		// 		return null;
		// 	// FLEX FIELDS
		// 	var flexFieldsObject = {};
		// 	var codeFieldCount = 0;// max 25
		// 	var numericFieldCount = 0;// max 10
		// 	var dateFieldCount = 0;// max 5
		// 	for (var flexFieldIdx = 0; flexFieldsArr
		// 		&& flexFieldIdx < flexFieldsArr.length; flexFieldIdx++) {
		// 		var flexFields = flexFieldsArr[flexFieldIdx];
		// 		log.debug('flexFields',flexFields);
		// 		if (flexFields && flexFields.flexFieldId) {
		// 			var docTypes = flexFields.docTypes;
		// 			// log.debug('Vertex flexFields ',
		// 			// 'docTypes:'+docTypes);
		// 			// NETSUITE DEFECT - MULTI SELECT FILTER WONT WORK
		// 			if (docTypes.indexOf(transaction.recType) == -1)
		// 				continue;
		// 			var flexFieldValue = '';
		// 			var nsFieldType = flexFields.nsFieldType;
		// 			if (nsFieldType == "body") {
		// 				flexFieldValue = curRecord.getValue({fieldId: flexFields.flexFieldId});
		// 				//flexFieldValue = input.getAdditionalFieldValue(flexFields.flexFieldId);
        //                 log.debug('###REST flexFieldValue:',flexFieldValue);
		// 				if (flexFields.netsuiteListField == true
		// 					&& flexFields.listOrRecordId && flexFieldValue) {
		// 					// Search list/record since getText is not supported in
		// 					// plugin
        //                     log.debug('###REST flexFieldId:',flexFields.flexFieldId);
        //                     if(flexFields.flexFieldId == 'entity'){
        //                         //flexFields.listOrRecordResults = lib.getListRecordResults(flexFields.listOrRecordId, 'companyname');
        //                         flexFieldValue = lib.getListRecordName(flexFields.listOrRecordResults, flexFieldValue, false, 'companyname');
        //                     }else if(flexFields.flexFieldId == 'shipmethod')
        //                         flexFieldValue = transaction.shipMethod;
        //                     else {
        //                         //flexFields.listOrRecordResults = lib.getListRecordResults(flexFields.listOrRecordId);
        //                         flexFieldValue = lib.getListRecordName(flexFields.listOrRecordResults, flexFieldValue, false);
        //                     }
		// 					// try {
		// 					// 	var listRecordColumn = ['name'];
		// 					// 	var listRecordResults = longSearchRecord(
		// 					// 		flexFields.listOrRecordId, null, null,
		// 					// 		listRecordColumn);
		// 					// 	for (var j = 0; listRecordResults != null
		// 					// 		&& j < listRecordResults.length; j++) {
		// 					// 		var srchResult = listRecordResults[j];
		// 					// 		if (srchResult.id == flexFieldValue) {
		// 					// 			flexFieldValue = srchResult.getValue('name');
		// 					// 			break;
		// 					// 		}
		// 					// 	}
		// 					// } catch (err) {
		// 					// 	log.error('VertexPlugin flexfield Error',
		// 					// 		lib.logExecutionMsg(err,
		// 					// 			'Error fetching name from list/record'));
		// 					// }
		// 				}
		// 			} else if (nsFieldType == "column") {
		// 				if (flexFields.netsuiteListField == true) {
		// 					flexFieldValue = curRecord.getSublistValue({sublistId: 'item', fieldId:flexFields.flexFieldId, line: itemIdx});
        //                     if (flexFieldValue) {
		// 						var custResults = null;
		// 						var custColumn = [];
		// 						custColumn[0] = search.createColumn({
		// 							name: 'name'
		// 						});
		// 						var custFilter = [];
		// 						custFilter[0] = search.createFilter({
		// 							name: 'internalid',
		// 							operator: search.Operator.IS,
		// 							values: flexFieldValue
		// 						});
		// 						custResults = lib.getSearchResults(flexFields.listOrRecordId, null, custFilter, custColumn);
		// 						if (custResults && custResults[0]) {
		// 							flexFieldValue = custResults[0].getValue(custColumn[0]);
		// 						}
		// 					}
		// 				} else
		// 					flexFieldValue = curRecord.getSublistValue('item',flexFields.flexFieldId,flexFieldIdx);
		// 					//flexFieldValue = item.getAdditionalFieldValue(flexFields.flexFieldId);
		// 			}
		// 			if (flexFieldValue == null || !flexFieldValue)
		// 				continue;
		// 			var flexFieldTag = 'flexibleCodeFields';
		// 			if (codeFieldCount == 0) flexFieldsObject.flexibleCodeFields = [];
		// 			if (numericFieldCount == 0) flexFieldsObject.flexibleNumericFields = [];
		// 			if (dateFieldCount == 0) flexFieldsObject.flexibleDateFields = [];
		// 			if (flexFields.flexFieldType == 'Code') {
		// 				if (codeFieldCount >= 25)
		// 					continue;
		// 				// Code fields can accept only 40 characters
		// 				if (flexFieldValue.length > 40)
		// 					flexFieldValue = flexFieldValue.substring(0, 40);
		// 				codeFieldCount++;
		// 				flexFieldTag = 'flexibleCodeFields';
		// 			} else if (flexFields.flexFieldType == 'Numeric') {
		// 				if (numericFieldCount >= 10)
		// 					continue;
		// 				numericFieldCount++;
		// 				flexFieldTag = 'flexibleNumericFields';
		// 			} else if (flexFields.flexFieldType == 'Date') {
		// 				if (dateFieldCount >= 5)
		// 					continue;
		// 				dateFieldCount++
		// 				flexFieldTag = 'flexibleDateFields';
		// 				// format YYYY-MM-DD
		// 				flexFieldValue = format.parse({ value: flexFieldValue, type: format.Type.DATE })
		// 				//flexFieldValue = nlapiStringToDate(flexFieldValue);
		// 				flexFieldValue = flexFieldValue.getFullYear() + '-' + ("0" + (flexFieldValue.getMonth() + 1)).slice(-2) + '-' + ("0" + flexFieldValue.getDate()).slice(-2);
		// 			}
		// 			var flexFieldObject = {};
		// 			flexFieldObject.fieldId = flexFields.flexFieldNumber;
		// 			flexFieldObject.value = lib.escapeXMLapi(flexFieldValue);
		// 			if (flexFieldTag == 'flexibleCodeFields') flexFieldsObject.flexibleCodeFields.push(flexFieldObject);
		// 			else if (flexFieldTag == 'flexibleNumericFields') flexFieldsObject.flexibleNumericFields.push(flexFieldObject);
		// 			else if (flexFieldTag == 'flexibleDateFields') flexFieldsObject.flexibleDateFields.push(flexFieldObject);
		// 		}
		// 	}
		// 	return flexFieldsObject;
		// }
    
        return {
            beforeLoad: vertexBeforeLoad,
            beforeSubmit: vertexBeforeSubmit,
            afterSubmit: vertexAfterSubmit,
            generateRestReverseRequest: generateRestReverseRequest,
            getAfterSubmitPreferences: getAfterSubmitPreferences,
            purchaseClassMissing: purchaseClassMissing,
            SourceProductClass: SourceProductClass,
            getLineLocation: getLineLocation,
            updateNexus: updateNexus,
            nexusSubsidiaryRelated: nexusSubsidiaryRelated,
            getSubsidiaryShipState: getSubsidiaryShipState,
            accrualProcess: accrualProcess,
            getAssociatedBillsData: getAssociatedBillsData,
            getAllAccounts: getAllAccounts,
            findAccountInfoBy: findAccountInfoBy,
            getAllExpenseCategories: getAllExpenseCategories,
            getPurchaseClass: getPurchaseClass,
            getAllProductClasses: getAllProductClasses,
            findProductClassInfoBy: findProductClassInfoBy,
            getAllUNSPCcodes: getAllUNSPCcodes,
            findUNSPCcodeInfoBy: findUNSPCcodeInfoBy,
            createJournalParams: createJournalParams,
            createJournalEntry: createJournalEntry,
            getShipFrom: getShipFrom,
            CUTimplementation: CUTimplementation,
            getThreshold: getThreshold,
            checkWithinThreshold: checkWithinThreshold,
            updateVertexCallDetails: updateVertexCallDetails,
            getURL: getURL,
            postRestWithTranid: postRestWithTranid,
            postWithTranid: postWithTranid,
            generateRestRequestWithTranid: generateRestRequestWithTranid,
            generateRequestWithTranid: generateRequestWithTranid,
            sendVertexAccrual: sendVertexAccrual,
            getFloat: getFloat,
            getLocationAddress: getLocationAddress,
            removeAdjustmentItemOnCreate: removeAdjustmentItemOnCreate,
            getVendorRecord: getVendorRecord,
            loadCustomerRecord: loadCustomerRecord,
            getPreferences: getPreferences,
            getOneWorldPreference: getOneWorldPreference,
            populateTranHeaderFields: populateTranHeaderFields,
            getTransactionDetails: getTransactionDetails,
            isTaxOnlyAdjustment: isTaxOnlyAdjustment,
            taxOnlyAdjustValidation: taxOnlyAdjustValidation,
            vertexBeforeLoad: vertexBeforeLoad,
            generateRestDistributeRequest: generateRestDistributeRequest,
            generateReverseRequest: generateReverseRequest,
            generateDistributeRequest: generateDistributeRequest,
            processLineDiscounts: processLineDiscounts,
            createRestItemDistribute: createRestItemDistribute,
            createSellerOrBuyerRestObject: createSellerOrBuyerRestObject,
            addItemTagsDistribute: addItemTagsDistribute,
            addDiscountElement: addDiscountElement,
            getInputTotalTax: getInputTotalTax,
            getItems: getItems,
            addCustomerElementDistribute: addCustomerElementDistribute,
            createRestCustomerDistribute: createRestCustomerDistribute,
            createRestVendor: createRestVendor,
            addVendorElement: addVendorElement,
            distributeTaxEligible: distributeTaxEligible,
            addVendorElement: addVendorElement,
            distributeTaxEligible: distributeTaxEligible,
            populateEntityFields: populateEntityFields,
            getAdministrativeOrigin: getAdministrativeOrigin,
            removeTrustedId: removeTrustedId,
            vertexAfterSubmit: vertexAfterSubmit,
            getAssociatedBillsItemsExpenses: getAssociatedBillsItemsExpenses,
            getSearchResults: getSearchResults,
            distributeTaxCall: distributeTaxCall,
            distributeTax: distributeTax,
            addVtCallRecord: addVtCallRecord,
            generateSOAPrequestAccrual: generateSOAPrequestAccrual,
            getCurrencyCode: getCurrencyCode,
            getCompanyDetails: getCompanyDetails,
            generateRestRequestAccrual: generateRestRequestAccrual,
            longSearchRecord:longSearchRecord,
            updateCountryNexus: updateCountryNexus,
            vertexPluginCheck: vertexPluginCheck
        }
    });
    