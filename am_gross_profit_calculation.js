/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * AM_UE_GrossProfitCalculation.js
 * --------------------------------------------------------------------------
 * Ace Mart - Gross Profit Waterfall (Sales Order / Invoice)
 *
 * On every Create / Edit / Inline-Edit of a Sales Order or Invoice, this
 * script recalculates the following line fields for every item line:
 *
 *   custcol_am_line_cost      [AM] Line Cost      (extended: unit cost x qty)
 *   custcol_gross_profit      [AM] Gross Profit   (Revenue - Line Cost)
 *   custcol_gross_profit_perc [AM] Gross Profit % (Gross Profit / Revenue)
 *
 * COST WATERFALL (first tier that returns a value wins):
 *   Tier 1  Special Order PO Rate   - rate on the PO line tied to this
 *                                     specific SO/Invoice line.
 *                                     On Sales Orders this is read directly
 *                                     off the line (purchaseorder + porate).
 *                                     On Invoices, NetSuite does NOT carry
 *                                     the PO linkage onto the invoice line
 *                                     even when billed from a special-order
 *                                     SO - so for invoices this tier is
 *                                     resolved by looking back at the
 *                                     originating SO line via
 *                                     custcol_so_line_ref, a custom field
 *                                     maintained on both the SO line and
 *                                     the Invoice line as a shared external
 *                                     key.
 *                                     If that SO line has no PO, Tier 1
 *                                     fails and Tier 2 is tried, same as SO.
 *   Tier 2  Location Average Cost   - item's average cost at the line's
 *                                     own Location (no header fallback -
 *                                     if the line has no location, this
 *                                     tier is skipped and Tier 3 is tried)
 *   Tier 3  Preferred Vendor Price  - item's purchase price from its
 *                                     preferred vendor, where the vendor's
 *                                     subsidiary matches the transaction
 *                                     subsidiary
 *   Tier 4  No source found         - Line Cost = 0 (GP = Revenue)
 *
 * OPEN ITEMS - pending Ace Mart confirmation (see SDD section 2d / 4):
 *   - Tier 4 defaulting Line Cost to 0
 *   - Gross Profit % forced to 0 when Revenue = 0 (avoids divide-by-zero)
 *
 * SEARCH STRATEGY (max 4 searches total regardless of line count):
 *   Pass 1a Run the main line-level search (your first search) ONCE for
 *           the whole transaction. On a Sales Order this resolves Tier 1
 *           inline (purchaseorder + porate already on the line). On an
 *           Invoice, it instead gathers custcol_so_line_ref (your shared
 *           external key) for every line so Pass 1b can look Tier 1 back
 *           up on the SO.
 *   Pass 1b (Invoice only) ONE batched search on the Sales Order, filtered
 *           directly on custcol_so_line_ref anyof [...] - covers Tier 1
 *           for every distinct SO line referenced by this invoice in one
 *           call, with no need to also resolve which SO each line
 *           belongs to.
 *   Pass 1c Apply the Pass 1b results (or Pass 1a results for SOs) and
 *           queue anything still unresolved for Tier 2.
 *   Pass 2  ONE search covers Tier 2 for every item/location pairing still
 *           needed (`internalid anyof [...]` + `inventorylocation anyof
 *           [...]`), instead of a search per line or per item.
 *   Pass 3  ONE search covers Tier 3 for every item still unresolved after
 *           Tier 2, against the transaction's single subsidiary.
 *   Pass 4  Apply Tier 4 default where nothing resolved, compute GP / GP%,
 *           and write back to the loaded record.
 *
 * RECURSION NOTE:
 *   This script calls record.save() on the same record it is triggered
 *   from, which re-fires afterSubmit. Recursion is broken because the
 *   second pass recomputes identical values and the "changed" flag stays
 *   false, so no second save occurs. Do not remove the change-detection
 *   guard below.
 *
 * FIELD ID NOTE:
 *   The Tier 1 rate is read from the standard "porate" search field. The
 *   discovery searches you provided also referenced custcol_rm_po_rate and
 *   custbody_fam_specdeprjrn_rate on the same transaction - if this
 *   account's special-order rate actually lives in one of those custom
 *   fields instead of/in addition to porate, change SPECIAL_ORDER_RATE_FIELD
 *   below (and add a second lookup column if you need a fallback between
 *   them).
 * --------------------------------------------------------------------------
 */
define(['N/search', 'N/record', 'N/log'], function (search, record, log) {

    var LINE_COST_FIELD = 'custcol_am_line_cost';
    var GROSS_PROFIT_FIELD = 'custcol_gross_profit';
    var GROSS_PROFIT_PCT_FIELD = 'custcol_gross_profit_perc';

    // See "FIELD ID NOTE" above - swap this if the correct PO rate field
    // differs in this account.
    var SPECIAL_ORDER_RATE_FIELD = 'porate';

    // custcol_so_line_ref is a custom field you maintain on BOTH the Sales
    // Order line and the Invoice line, holding a shared external key value
    // that links a given Invoice line back to its originating SO line.
    // Invoice-only for our purposes: we read it off the invoice line, then
    // filter the SO search on that same field to find the matching SO line.
    var SO_LINE_REF_FIELD = 'custcol_so_line_ref';

    // Rounding tolerance used to decide whether a recalculated value is
    // actually "different" from what's stored - keeps us from re-saving
    // (and re-triggering afterSubmit) over floating point noise.
    var EPSILON = 0.005;

    function afterSubmit(context) {
        var validTypes = [
            context.UserEventType.CREATE,
            context.UserEventType.EDIT,
            context.UserEventType.XEDIT
        ];
        if (validTypes.indexOf(context.type) === -1) {
            return;
        }

        var recType = context.newRecord.type; // 'salesorder' or 'invoice'
        // if (recType !== record.Type.SALES_ORDER && recType !== record.Type.INVOICE) {
        //     return;
        // }

        var recId = context.newRecord.id;

        log.debug('AM GP - START', 'type=' + recType + ' id=' + recId + ' eventType=' + context.type);

        try {
            var rec = record.load({
                type: recType,
                id: recId,
                isDynamic: false
            });

            var subsidiaryId = rec.getValue({ fieldId: 'subsidiary' }) || null;
            var changed = false;

            log.debug('AM GP - Header', 'subsidiaryId=' + subsidiaryId);

            // ---- PASS 1a: run the main line-level search ONE time for the
            // whole transaction. For Sales Orders, its columns already carry
            // everything Tier 1 needs (purchaseorder + porate) directly on
            // the line. For Invoices, NetSuite does NOT carry the PO linkage
            // onto the invoice line even when billed from a special-order
            // SO - so for invoices we only gather custcol_so_line_ref here
            // and resolve Tier 1 in Pass 1c after a batched SO lookup.

            var transactionSearchTypes = {};

transactionSearchTypes[record.Type.SALES_ORDER] = search.Type.SALES_ORDER;
transactionSearchTypes[record.Type.INVOICE] = search.Type.INVOICE;
transactionSearchTypes[record.Type.CASH_SALE] = search.Type.CASH_SALE;
transactionSearchTypes[record.Type.CREDIT_MEMO] = search.Type.CREDIT_MEMO;
transactionSearchTypes[record.Type.CASH_REFUND] = search.Type.CASH_REFUND;

var txnType = transactionSearchTypes[recType];

var isSalesOrder = (recType === record.Type.SALES_ORDER);

var usesSoLineRef = (
    recType === record.Type.INVOICE ||
    recType === record.Type.CASH_SALE ||
    recType === record.Type.CREDIT_MEMO ||
    recType === record.Type.CASH_REFUND
);

var isReturnTransaction = (
    recType === record.Type.CREDIT_MEMO ||
    recType === record.Type.CASH_REFUND
);


            var lineSearchColumns = [
                search.createColumn({ name: 'line' }),
                search.createColumn({ name: 'item' }),
                search.createColumn({ name: 'quantity' }),
                search.createColumn({ name: 'amount' }),
                search.createColumn({ name: 'location' })
            ];
            if (usesSoLineRef) {
                lineSearchColumns.push(search.createColumn({ name: SO_LINE_REF_FIELD }));
            } else {
                lineSearchColumns.push(search.createColumn({ name: 'purchaseorder' }));
                lineSearchColumns.push(search.createColumn({ name: SPECIAL_ORDER_RATE_FIELD }));
            }

            var lineSearch = search.create({
                type: txnType,
                filters: [
                    ['internalidnumber', 'equalto', recId],
                    'AND',
                    ['mainline', 'is', 'F'],
                    'AND',
                    ['taxline', 'is', 'F']
                ],
                columns: lineSearchColumns
            });

            var lines = [];              // every item line on the transaction
            var soLookupKeys = {};       // invoice-only: unique 'soId_lineRef' keys needing a Tier 1 lookback

            lineSearch.run().each(function (result) {
                var itemId = result.getValue({ name: 'item' });
                if (!itemId) {
                    return true;
                }

                var lineLocationId = result.getValue({ name: 'location' }); // line-level only, no header fallback

                var row = {
                    lineUniqueKey: result.getValue({ name: 'line' }),
                    itemId: itemId,
                    quantity: parseFloat(result.getValue({ name: 'quantity' })) || 0,
                    amount: parseFloat(result.getValue({ name: 'amount' })) || 0, // Revenue
                    locationId: lineLocationId,
                    lineUnitCost: null,
                    tier: null // for logging: which tier ultimately resolved this line
                };

                if (usesSoLineRef) {
                    var soLineRef = result.getValue({ name: SO_LINE_REF_FIELD });
                    row.soLineRef = soLineRef;
                    if (soLineRef !== '' && soLineRef !== null) {
                        soLookupKeys[soLineRef] = true;
                    }
                    log.debug('AM GP - Pass1a line (invoice)', JSON.stringify({
                        line: row.lineUniqueKey,
                        item: row.itemId,
                        qty: row.quantity,
                        amount: row.amount,
                        location: row.locationId,
                        soLineRef: soLineRef
                    }));
                } else {
                    var purchaseOrderId = result.getValue({ name: 'purchaseorder' });
                    var poRate = result.getValue({ name: SPECIAL_ORDER_RATE_FIELD });
                    if (purchaseOrderId && poRate !== '' && poRate !== null) {
                        row.lineUnitCost = parseFloat(poRate);
                        row.tier = 1;
                    }
                    log.debug('AM GP - Pass1a line (SO)', JSON.stringify({
                        line: row.lineUniqueKey,
                        item: row.itemId,
                        qty: row.quantity,
                        amount: row.amount,
                        location: row.locationId,
                        purchaseOrderId: purchaseOrderId,
                        poRate: poRate,
                        tier1Resolved: row.tier === 1 ? row.lineUnitCost : null
                    }));
                }

                lines.push(row);
                return true;
            });

            log.debug('AM GP - Pass1a summary', 'totalLines=' + lines.length + ' usesSoLineRef=' + usesSoLineRef +
                (usesSoLineRef ? (' soLookupKeys=' + Object.keys(soLookupKeys).length) : ''));

            // ---- PASS 1b (Invoice only): ONE batched search back on the
            // Sales Order, filtered directly on lineuniquekey - covers Tier 1
            // for every distinct SO line referenced by this invoice, with no
            // need to also know which SO each line belongs to. ----
            var soTier1Map = {}; // key: SO line's lineuniquekey -> PO rate
            if (usesSoLineRef) {
                var soLookupKeyList = Object.keys(soLookupKeys);
                if (soLookupKeyList.length > 0) {
                    log.debug('AM GP - Pass1b search filters', JSON.stringify({
                        soLineUniqueKeys: soLookupKeyList
                    }));

                    var soLineRefFilterExpr = buildOrFilterExpression(SO_LINE_REF_FIELD, soLookupKeyList);

                    var soSearch = search.create({
                        type: search.Type.SALES_ORDER,
                        filters: [
                            soLineRefFilterExpr,
                            'AND',
                            ['mainline', 'is', 'F'],
                            'AND',
                            ['taxline', 'is', 'F'],
                            'AND',
                            ['purchaseorder', 'noneof', '@NONE@']
                        ],
                        columns: [
                            search.createColumn({ name: SO_LINE_REF_FIELD }),
                            search.createColumn({ name: 'purchaseorder' }),
                            search.createColumn({ name: SPECIAL_ORDER_RATE_FIELD })
                        ]
                    });

                    soSearch.run().each(function (result) {
                        var soLineKey = result.getValue({ name: SO_LINE_REF_FIELD });
                        var purchaseOrderId = result.getValue({ name: 'purchaseorder' });
                        var poRate = result.getValue({ name: SPECIAL_ORDER_RATE_FIELD });
                        if (purchaseOrderId && poRate !== '' && poRate !== null) {
                            soTier1Map[soLineKey] = parseFloat(poRate);
                        }
                        log.debug('AM GP - Pass1b result row', JSON.stringify({
                            soLineKey: soLineKey, purchaseOrderId: purchaseOrderId, poRate: poRate
                        }));
                        return true;
                    });
                } else {
                    log.debug('AM GP - Pass1b', 'skipped - no invoice lines referenced an SO line');
                }
                log.debug('AM GP - Pass1b SO tier1 map', JSON.stringify(soTier1Map));
            }

            // ---- PASS 1c: resolve Tier 1 for invoice lines using the SO
            // lookback map (SO lines are already resolved from Pass 1a).
            // Anything still unresolved gets queued for the Tier 2 lookup.
            var tier2ItemIds = {};       // unique item ids still needing a location avg cost
            var tier2LocationIds = {};   // unique locations involved in those lookups

            lines.forEach(function (row) {
                if (usesSoLineRef && row.lineUnitCost === null && row.soLineRef && soTier1Map.hasOwnProperty(row.soLineRef)) {
                    row.lineUnitCost = soTier1Map[row.soLineRef];
                    row.tier = 1;
                }

                if (row.lineUnitCost === null && row.locationId) {
                    tier2ItemIds[row.itemId] = true;
                    tier2LocationIds[row.locationId] = true;
                }
            });

            log.debug('AM GP - Pass1c summary', 'tier2CandidateItems=' + Object.keys(tier2ItemIds).length +
                ' tier2CandidateLocations=' + Object.keys(tier2LocationIds).length);

            // ---- PASS 2: ONE batched search covers Tier 2 for every
            // item/location pairing still needed, instead of one search per
            // line or per item. ----
            var tier2CostMap = {}; // key: itemId + '_' + locationId -> avg cost
            var tier2ItemIdList = Object.keys(tier2ItemIds);
            var tier2LocationIdList = Object.keys(tier2LocationIds);

            if (tier2ItemIdList.length > 0) {
                log.debug('AM GP - Pass2 search filters', JSON.stringify({
                    items: tier2ItemIdList,
                    locations: tier2LocationIdList
                }));

                var locSearch = search.create({
                    type: search.Type.ITEM,
                    filters: [
                        ['internalid', 'anyof', tier2ItemIdList],
                        'AND',
                        ['inventorylocation', 'anyof', tier2LocationIdList]
                    ],
                    columns: [
                        search.createColumn({ name: 'internalid' }),
                        search.createColumn({ name: 'inventorylocation' }),
                        search.createColumn({ name: 'locationaveragecost' })
                    ]
                });

                locSearch.run().each(function (result) {
                    var itemId = result.getValue({ name: 'internalid' });
                    var locId = result.getValue({ name: 'inventorylocation' });
                    var avgCost = result.getValue({ name: 'locationaveragecost' });
                    if (avgCost !== '' && avgCost !== null) {
                        tier2CostMap[itemId + '_' + locId] = parseFloat(avgCost);
                    }
                    log.debug('AM GP - Pass2 result row', JSON.stringify({ itemId: itemId, locId: locId, avgCost: avgCost }));
                    return true;
                });
            } else {
                log.debug('AM GP - Pass2', 'skipped - no lines needed Tier 2');
            }

            log.debug('AM GP - Pass2 cost map', JSON.stringify(tier2CostMap));

            // Apply Tier 2 results and figure out what's still left for Tier 3.
            var tier3ItemIds = {};
            lines.forEach(function (row) {
                if (row.lineUnitCost === null && row.locationId) {
                    var key = row.itemId + '_' + row.locationId;
                    if (tier2CostMap.hasOwnProperty(key)) {
                        row.lineUnitCost = tier2CostMap[key];
                        row.tier = 2;
                    }
                }
                if (row.lineUnitCost === null && subsidiaryId) {
                    tier3ItemIds[row.itemId] = true;
                }
            });

            log.debug('AM GP - Pass2 applied', 'tier3CandidateItems=' + Object.keys(tier3ItemIds).length);

            // ---- PASS 3: ONE batched search covers Tier 3 for every
            // remaining item at once (subsidiary is a single header-level
            // value for the whole transaction, so this is a single anyof
            // on item id against a single subsidiary). ----
            var tier3CostMap = {}; // key: itemId -> preferred vendor price
            var tier3ItemIdList = Object.keys(tier3ItemIds);

            if (tier3ItemIdList.length > 0 && subsidiaryId) {
                log.debug('AM GP - Pass3 search filters', JSON.stringify({
                    items: tier3ItemIdList,
                    subsidiaryId: subsidiaryId
                }));

                var vendorSearch = search.create({
                    type: search.Type.ITEM,
                    filters: [
                        ['internalid', 'anyof', tier3ItemIdList],
                        'AND',
                        ['vendor.subsidiary', 'anyof', subsidiaryId]
                    ],
                    columns: [
                        search.createColumn({ name: 'internalid' }),
                        search.createColumn({ name: 'vendorcost' })
                    ]
                });

                vendorSearch.run().each(function (result) {
                    var itemId = result.getValue({ name: 'internalid' });
                    var vendorCost = result.getValue({ name: 'vendorcost' });
                    if (vendorCost !== '' && vendorCost !== null) {
                        tier3CostMap[itemId] = parseFloat(vendorCost);
                    }
                    log.debug('AM GP - Pass3 result row', JSON.stringify({ itemId: itemId, vendorCost: vendorCost }));
                    return true;
                });
            } else {
                log.debug('AM GP - Pass3', 'skipped - no items needed Tier 3, or subsidiary missing');
            }

            log.debug('AM GP - Pass3 cost map', JSON.stringify(tier3CostMap));

            // ---- PASS 4: apply Tier 3, fall back to Tier 4, compute GP,
            // and write results back to the loaded record. ----
            lines.forEach(function (row) {
                if (row.lineUnitCost === null && tier3CostMap.hasOwnProperty(row.itemId)) {
                    row.lineUnitCost = tier3CostMap[row.itemId];
                    row.tier = 3;
                }
                if (row.lineUnitCost === null) {
                    row.lineUnitCost = 0; // OPEN ITEM - proposed default per SDD 2d
                    row.tier = 4;
                }

                log.debug('AM GP - Tier Result',
                    'Line ' + row.lineUniqueKey + ' (item ' + row.itemId + ') passed Tier ' + row.tier +
                    ' - unitCost=' + row.lineUnitCost);

var revenue = row.amount;
var extendedLineCost = row.lineUnitCost * Math.abs(row.quantity);

if (isReturnTransaction) {
    revenue = -Math.abs(revenue);
    extendedLineCost = -Math.abs(extendedLineCost);
}

var grossProfit = revenue - extendedLineCost;
var grossProfitPct = (revenue !== 0)
    ? (grossProfit / revenue) * 100
    : 0;

                var lineIdx = rec.findSublistLineWithValue({
                    sublistId: 'item',
                    fieldId: 'line',
                    value: row.lineUniqueKey
                });
                if (lineIdx === -1) {
                    log.debug('AM GP - Pass4 line SKIPPED (no sublist match)', 'line=' + row.lineUniqueKey);
                    return; // couldn't map - skip this row
                }

                var existingLineCost = parseFloat(rec.getSublistValue({ sublistId: 'item', fieldId: LINE_COST_FIELD, line: lineIdx })) || 0;
                var existingGP = parseFloat(rec.getSublistValue({ sublistId: 'item', fieldId: GROSS_PROFIT_FIELD, line: lineIdx })) || 0;
                var existingGPPct = parseFloat(rec.getSublistValue({ sublistId: 'item', fieldId: GROSS_PROFIT_PCT_FIELD, line: lineIdx })) || 0;

                var willUpdate = (Math.abs(existingLineCost - extendedLineCost) > EPSILON ||
                    Math.abs(existingGP - grossProfit) > EPSILON ||
                    Math.abs(existingGPPct - grossProfitPct) > EPSILON);

                log.debug('AM GP - Pass4 line', JSON.stringify({
                    line: row.lineUniqueKey,
                    item: row.itemId,
                    tierUsed: row.tier,
                    unitCost: row.lineUnitCost,
                    qty: row.quantity,
                    extendedLineCost: round2(extendedLineCost),
                    revenue: revenue,
                    grossProfit: round2(grossProfit),
                    grossProfitPct: round2(grossProfitPct),
                    existingLineCost: existingLineCost,
                    existingGP: existingGP,
                    existingGPPct: existingGPPct,
                    willUpdate: willUpdate
                }));

                if (willUpdate) {
                    rec.setSublistValue({ sublistId: 'item', fieldId: LINE_COST_FIELD, line: lineIdx, value: round2(extendedLineCost) });
                    rec.setSublistValue({ sublistId: 'item', fieldId: GROSS_PROFIT_FIELD, line: lineIdx, value: round2(grossProfit) });
                    rec.setSublistValue({ sublistId: 'item', fieldId: GROSS_PROFIT_PCT_FIELD, line: lineIdx, value: round2(grossProfitPct) });
                    changed = true;
                }
            });

            log.debug('AM GP - Save decision', 'changed=' + changed);

            // Only save if something actually changed. This both avoids
            // needless resaves and is what breaks the afterSubmit->save->
            // afterSubmit recursion (the re-triggered run recomputes the
            // same values and takes the "no change" path).
            if (changed) {
                rec.save({ enableSourcing: false, ignoreMandatoryFields: true });
                log.debug('AM GP - SAVED', 'type=' + recType + ' id=' + recId);
            } else {
                log.debug('AM GP - NOT SAVED (no changes / recursion stop)', 'type=' + recType + ' id=' + recId);
            }

        } catch (e) {
            log.error('AM Gross Profit Calculation - Error on ' + recType + ' ' + recId, e);
        }
    }

    /**
     * Builds a NetSuite nested filter expression matching ANY of the given
     * values on a field using the 'is' operator - safe for text/number
     * custom fields where 'anyof' isn't a valid operator (anyof only works
     * on List/Record select fields). For a single value this just returns
     * a plain filter; for multiple values it returns an OR-chained group,
     * e.g. [[field,'is',v1],'OR',[field,'is',v2],'OR',[field,'is',v3]].
     * Uses 'is', which is valid for Free-Form Text fields. If
     * custcol_so_line_ref turns out to be a Number/Integer field instead,
     * swap 'is' below to 'equalto'.
     */
    function buildOrFilterExpression(fieldId, values) {
        var expr = [];
        values.forEach(function (value, idx) {
            if (idx > 0) {
                expr.push('OR');
            }
            expr.push([fieldId, 'is', value]);
        });
        return expr;
    }

    function round2(n) {
        return Math.round((n + (n >= 0 ? 0.00001 : -0.00001)) * 100) / 100;
    }

    return {
        afterSubmit: afterSubmit
    };

});