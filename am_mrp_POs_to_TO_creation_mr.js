/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
 */
define(['N/search', 'N/record', 'N/log', 'N/runtime'], function (search, record, log, runtime) {

    /**
     * 1. Use search to find all individual Planned Orders matching the supply plan parameter,
     * group them by supplyPlan-fromLoc-toLoc, and return the list of groups.
     */
    function getInputData() {
        var supplyPlanParam = runtime.getCurrentScript().getParameter({
            name: 'custscript_supply_plan_definition'
        });

        log.debug('getInputData', 'supplyPlanParam: ' + supplyPlanParam);

        if (!supplyPlanParam) {
            log.error('getInputData', 'Script parameter custscript_supply_plan_definition is missing. Processing aborted.');
            return [];
        }

        var ptoSearch = search.create({
            type: 'plannedorder',
            filters: [
                ['trantype', 'anyof', 'TrnfrOrd'],
                'AND',
                ['supplyplandefinition', 'anyof', supplyPlanParam]
            ],
            columns: [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'item' }),
                search.createColumn({ name: 'quantity' }),
                search.createColumn({ name: 'sourcelocation' }),
                search.createColumn({ name: 'location' }),
                search.createColumn({ name: 'supplyplandefinition' })
            ]
        });

        var allResults = [];
        var pagedData = ptoSearch.runPaged({ pageSize: 1000 });
        pagedData.pageRanges.forEach(function (pageRange) {
            var myPage = pagedData.fetch({ index: pageRange.index });
            myPage.data.forEach(function (r) {
                var ptoId = r.getValue({ name: 'internalid' });
                var itemId = r.getValue({ name: 'item' });
                var qty = parseFloat(r.getValue({ name: 'quantity' })) || 0;
                var fromLoc = r.getValue({ name: 'sourcelocation' });
                var toLoc = r.getValue({ name: 'location' });
                var supplyPlan = r.getValue({ name: 'supplyplandefinition' });
                var supplyPlanName = r.getText({ name: 'supplyplandefinition' }) || '';

                if (qty > 0 && fromLoc && toLoc) {
                    allResults.push({
                        ptoId: ptoId,
                        itemId: itemId,
                        quantity: qty,
                        fromLoc: fromLoc,
                        toLoc: toLoc,
                        supplyPlan: supplyPlan,
                        supplyPlanName: supplyPlanName
                    });
                }
            });
        });

        log.debug('getInputData', 'Total Planned Order lines found: ' + allResults.length);

        var groupedObj = groupByCombinedKey(allResults);
        var groupedList = [];
        for (var k in groupedObj) {
            if (groupedObj.hasOwnProperty(k)) {
                var lines = groupedObj[k];
                groupedList.push({
                    key: k,
                    supplyPlan: lines[0].supplyPlan,
                    supplyPlanName: lines[0].supplyPlanName,
                    fromLoc: lines[0].fromLoc,
                    toLoc: lines[0].toLoc,
                    lines: lines
                });
            }
        }

        log.debug('getInputData', 'Total grouped Transfer Orders to create: ' + groupedList.length);
        return groupedList;
    }

    /**
     * Helper to group a list of items by a custom combined key.
     */
    function groupByCombinedKey(list) {
        return list.reduce(function (rv, x) {
            var key = x.supplyPlan + '-' + x.fromLoc + '-' + x.toLoc;
            (rv[key] = rv[key] || []).push(x);
            return rv;
        }, {});
    }

    /**
     * 2. Map stage - Creates the Transfer Order for a single group,
     * and passes each related Planned Order ID to the reduce stage.
     */
    function map(context) {
        try {
            var group = JSON.parse(context.value);
            log.debug('map processing group', group.key);

            var supplyPlan = group.supplyPlan;
            var supplyPlanName = group.supplyPlanName;
            var fromLoc = group.fromLoc;
            var toLoc = group.toLoc;
            var lines = group.lines;

            // Aggregate items
            var itemMap = {};
            var ptoIds = [];
            lines.forEach(function (line) {
                itemMap[line.itemId] = (itemMap[line.itemId] || 0) + line.quantity;
                if (line.ptoId && ptoIds.indexOf(line.ptoId) === -1) {
                    ptoIds.push(line.ptoId);
                }
            });

            // Create Transfer Order
            var toRec = record.create({
                type: record.Type.TRANSFER_ORDER,
                isDynamic: true
            });

            // Header
            toRec.setValue({ fieldId: 'subsidiary', value: 4 });
            toRec.setValue({ fieldId: 'location', value: parseInt(fromLoc, 10) });
            toRec.setValue({ fieldId: 'transferlocation', value: parseInt(toLoc, 10) });
            toRec.setValue({ fieldId: 'custbody_am_transfer_reason', value: 1 }); // Internal ID 5 = 'Stock Replenishment'

            // Add custom comment in memo
            var memoText = 'Created from MRP automation';
            if (supplyPlanName) {
                memoText += ' with schedule plan: ' + supplyPlanName;
            } else if (supplyPlan) {
                memoText += ' with schedule plan ID: ' + supplyPlan;
            }
            toRec.setValue({
                fieldId: 'memo',
                value: memoText.slice(0, 999)
            });

            // Set new field custbody_pto_ids in a try-catch block
            if (ptoIds.length) {
                try {
                    toRec.setValue({
                        fieldId: 'custbody_pto_ids',
                        value: ptoIds.join(', ')
                    });
                } catch (fieldErr) {
                    log.error('Failed to set custbody_pto_ids for deleted Planned Orders', {
                        error: fieldErr,
                        ptoIds: ptoIds
                    });
                }
            }

            // Lines
            for (var itemId in itemMap) {
                if (!itemMap.hasOwnProperty(itemId)) continue;
                toRec.selectNewLine({ sublistId: 'item' });
                toRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: parseInt(itemId, 10) });
                toRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: itemMap[itemId] });
                toRec.commitLine({ sublistId: 'item' });
            }

            var toId = toRec.save();
            log.audit('Transfer Order Created', 'ID: ' + toId + ' | From: ' + fromLoc + ' | To: ' + toLoc + ' | SupplyPlan: ' + supplyPlan);

            // Pass Planned Order IDs to reduce stage
            ptoIds.forEach(function (id) {
                context.write({
                    key: id,
                    value: toId
                });
            });

        } catch (e) {
            log.error('Error creating Transfer Order in map stage for group: ' + (group ? group.key : 'unknown'), e);
        }
    }

    /**
     * 3. Reduce stage - Deletes each Planned Order individually.
     * Since reduce runs once per key, each deletion has its own governance limit.
     */
    function reduce(context) {
        try {
            var ptoId = context.key;
            var toId = context.values[0];

            log.audit('Deleting Planned Order in reduce', { ptoId: ptoId, associatedTO: toId });

            record.delete({
                type: 'plannedorder',
                id: ptoId
            });

            log.audit('Deleted Planned Order successfully', ptoId);
        } catch (e) {
            log.error('Failed to delete Planned Order in reduce stage', { ptoId: context.key, error: e });
        }
    }

    /**
     * 4. Summarize stage - logs errors if any occurred.
     */
    function summarize(summary) {
        log.audit('Summarize', 'Completed processing.');

        summary.mapSummary.errors.iterator().each(function (key, error) {
            log.error('Map Error for Key: ' + key, error);
            return true;
        });

        summary.reduceSummary.errors.iterator().each(function (key, error) {
            log.error('Reduce Error for Key: ' + key, error);
            return true;
        });
    }

    return {
        getInputData: getInputData,
        map: map,
        reduce: reduce,
        summarize: summarize
    };
});
