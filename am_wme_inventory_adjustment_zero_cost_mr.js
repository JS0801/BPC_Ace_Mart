/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/search', 'N/record', 'N/runtime', 'N/query', 'N/email', 'N/format'], (
  search,
  record,
  runtime,
  query,
  email,
  format
) => {
  const PARAM_SEARCH_ID = 'custscript_am_wme_zero_cost_search';
  const PARAM_ITEM_COST_QUERY = 'custscript_am_wme_item_cost_query';
  const PARAM_LOOKBACK_DAYS = 'custscript_am_wme_lookback_days';
  const PARAM_EMAIL_AUTHOR = 'custscript_am_wme_email_author';
  const PARAM_EMAIL_RECIPIENTS = 'custscript_am_wme_email_recipients';

  const SUBLIST_INVENTORY = 'inventory';
  const FIELD_RATE = 'rate';
  const FIELD_LINE_UNIQUE_KEY = 'lineuniquekey';
  const FIELD_PROCESSED = 'custbody_am_wme_cost_update_processed';
  const FIELD_PROCESSED_DATE = 'custbody_am_wme_cost_update_date';
  const FIELD_COST_SOURCE = 'custcol_am_wme_cost_source';

  const SOURCE_VENDOR_PRICE = '1';
  const SOURCE_AVERAGE_COST = '2';
  const SOURCE_NOT_FOUND = '3';

  const getInputData = () => {
    const script = runtime.getCurrentScript();
    const searchId = script.getParameter({ name: PARAM_SEARCH_ID });
    const itemCostQuery = script.getParameter({ name: PARAM_ITEM_COST_QUERY });
    const lookbackDays = Number(script.getParameter({ name: PARAM_LOOKBACK_DAYS }) || 2);

    if (!searchId) throw new Error(`Missing script parameter ${PARAM_SEARCH_ID}`);
    if (!itemCostQuery) throw new Error(`Missing script parameter ${PARAM_ITEM_COST_QUERY}`);

    const itemCostMap = buildItemCostMap(itemCostQuery);
    const zeroCostSearch = search.load({ id: searchId });

    if (lookbackDays > 0) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);
      zeroCostSearch.filters.push(search.createFilter({
        name: 'datecreated',
        operator: search.Operator.ONORAFTER,
        values: format.format({ value: cutoffDate, type: format.Type.DATE })
      }));
    }

    const lineInstructions = [];
    const pagedData = zeroCostSearch.runPaged({ pageSize: 1000 });

    pagedData.pageRanges.forEach((pageRange) => {
      const page = pagedData.fetch({ index: pageRange.index });

      page.data.forEach((result) => {
        const itemId = String(result.getValue({ name: 'item' }) || '');
        const subsidiaryId = String(result.getValue({ name: 'subsidiarynohierarchy' }) || '');
        const locationId = String(result.getValue({ name: 'locationnohierarchy' }) || '');
        const resolvedCost = resolveCost(itemCostMap, itemId, subsidiaryId, locationId);

        lineInstructions.push({
          recordId: String(result.getValue({ name: 'internalid' }) || ''),
          tranId: String(result.getValue({ name: 'tranid' }) || ''),
          itemId,
          itemText: String(result.getText({ name: 'item' }) || itemId),
          line: String(result.getValue({ name: 'line' }) || ''),
          lineUniqueKey: String(result.getValue({ name: 'lineuniquekey' }) || ''),
          quantity: String(result.getValue({ name: 'quantity' }) || ''),
          locationId,
          locationText: String(result.getText({ name: 'locationnohierarchy' }) || locationId),
          subsidiaryId,
          subsidiaryText: String(result.getText({ name: 'subsidiarynohierarchy' }) || subsidiaryId),
          cost: resolvedCost.cost,
          source: resolvedCost.source,
          reason: resolvedCost.reason
        });
      });
    });

    log.audit('Input prepared', {
      searchId,
      lookbackDays,
      itemCount: Object.keys(itemCostMap).length,
      lineCount: lineInstructions.length
    });

    return lineInstructions;
  };

  const map = (context) => {
    const line = JSON.parse(context.value);
    context.write({
      key: line.recordId,
      value: JSON.stringify(line)
    });
  };

  const reduce = (context) => {
    const recordId = context.key;
    const lines = context.values.map((value) => JSON.parse(value));
    const stats = {
      type: 'RECORD_SUMMARY',
      recordId,
      tranId: lines[0] && lines[0].tranId,
      attemptedLines: lines.length,
      vendorPriceLines: 0,
      averageCostLines: 0,
      notFoundLines: 0,
      skippedNonZeroLines: 0,
      lineErrorCount: 0,
      vendorPriceExamples: [],
      averageCostExamples: [],
      notFoundExamples: []
    };
    const exceptions = [];

    try {
      const adjustment = record.load({
        type: record.Type.INVENTORY_ADJUSTMENT,
        id: recordId,
        isDynamic: false
      });
      const lineIndexByKey = {};
      const lineCount = adjustment.getLineCount({ sublistId: SUBLIST_INVENTORY });

      for (let i = 0; i < lineCount; i += 1) {
        const key = adjustment.getSublistValue({
          sublistId: SUBLIST_INVENTORY,
          fieldId: FIELD_LINE_UNIQUE_KEY,
          line: i
        });
        if (key) lineIndexByKey[String(key)] = i;
      }

      lines.forEach((line) => {
        const recordLine = lineIndexByKey[line.lineUniqueKey];

        if (recordLine === undefined) {
          stats.lineErrorCount += 1;
          exceptions.push({
            type: 'LINE_NOT_FOUND',
            recordId,
            tranId: line.tranId,
            itemText: line.itemText,
            itemId: line.itemId,
            locationText: line.locationText,
            locationId: line.locationId,
            subsidiaryText: line.subsidiaryText,
            line: line.line,
            lineUniqueKey: line.lineUniqueKey,
            quantity: line.quantity,
            reason: 'Line unique key was not found on the Inventory Adjustment.'
          });
          return;
        }

        const currentRate = toNumber(adjustment.getSublistValue({
          sublistId: SUBLIST_INVENTORY,
          fieldId: FIELD_RATE,
          line: recordLine
        }));

        if (currentRate > 0) {
          stats.skippedNonZeroLines += 1;
          return;
        }

        adjustment.setSublistValue({
          sublistId: SUBLIST_INVENTORY,
          fieldId: FIELD_COST_SOURCE,
          line: recordLine,
          value: line.source
        });

        if (line.source === SOURCE_NOT_FOUND) {
          stats.notFoundLines += 1;
          if (stats.notFoundExamples.length < 5) {
            stats.notFoundExamples.push({
              tranId: line.tranId,
              line: line.line,
              item: line.itemText,
              location: line.locationText,
              quantity: line.quantity,
              reason: line.reason
            });
          }
          exceptions.push({
            type: 'NOT_FOUND',
            recordId,
            tranId: line.tranId,
            itemText: line.itemText,
            itemId: line.itemId,
            locationText: line.locationText,
            locationId: line.locationId,
            subsidiaryText: line.subsidiaryText,
            line: line.line,
            lineUniqueKey: line.lineUniqueKey,
            quantity: line.quantity,
            reason: line.reason
          });
          return;
        }

        adjustment.setSublistValue({
          sublistId: SUBLIST_INVENTORY,
          fieldId: FIELD_RATE,
          line: recordLine,
          value: line.cost
        });

        if (line.source === SOURCE_VENDOR_PRICE) {
          stats.vendorPriceLines += 1;
          if (stats.vendorPriceExamples.length < 5) {
            stats.vendorPriceExamples.push({
              tranId: line.tranId,
              line: line.line,
              item: line.itemText,
              location: line.locationText,
              quantity: line.quantity,
              cost: line.cost
            });
          }
        }
        if (line.source === SOURCE_AVERAGE_COST) {
          stats.averageCostLines += 1;
          if (stats.averageCostExamples.length < 5) {
            stats.averageCostExamples.push({
              tranId: line.tranId,
              line: line.line,
              item: line.itemText,
              location: line.locationText,
              quantity: line.quantity,
              cost: line.cost
            });
          }
        }
      });

      adjustment.setValue({ fieldId: FIELD_PROCESSED, value: true });
      adjustment.setValue({ fieldId: FIELD_PROCESSED_DATE, value: new Date() });

      const savedId = adjustment.save({
        enableSourcing: true,
        ignoreMandatoryFields: true
      });

      context.write({ key: `summary_${recordId}`, value: JSON.stringify(stats) });
      exceptions.forEach((exception, index) => {
        context.write({
          key: `exception_${recordId}_${index}`,
          value: JSON.stringify(exception)
        });
      });

      log.audit('Inventory Adjustment processed', {
        recordId: savedId,
        tranId: stats.tranId,
        vendorPriceLines: stats.vendorPriceLines,
        averageCostLines: stats.averageCostLines,
        notFoundLines: stats.notFoundLines,
        vendorPriceExamples: stats.vendorPriceExamples,
        averageCostExamples: stats.averageCostExamples,
        notFoundExamples: stats.notFoundExamples
      });
    } catch (error) {
      context.write({
        key: `save_failed_${recordId}`,
        value: JSON.stringify({
          type: 'SAVE_FAILED',
          recordId,
          tranId: stats.tranId,
          attemptedLines: stats.attemptedLines,
          reason: error.message || String(error)
        })
      });

      log.error('Inventory Adjustment save failed', {
        recordId,
        tranId: stats.tranId,
        error: error.message || String(error)
      });
    }
  };

  const summarize = (summary) => {
    const recordSummaries = [];
    const lineExceptions = [];
    const saveFailures = [];
    const scriptErrors = [];

    if (summary.inputSummary.error) {
      scriptErrors.push({
        stage: 'getInputData',
        key: '',
        message: summary.inputSummary.error
      });
    }

    summary.mapSummary.errors.iterator().each((key, error) => {
      scriptErrors.push({ stage: 'map', key, message: error });
      return true;
    });

    summary.reduceSummary.errors.iterator().each((key, error) => {
      scriptErrors.push({ stage: 'reduce', key, message: error });
      return true;
    });

    summary.output.iterator().each((key, value) => {
      const row = JSON.parse(value);

      if (row.type === 'RECORD_SUMMARY') recordSummaries.push(row);
      if (row.type === 'NOT_FOUND' || row.type === 'LINE_NOT_FOUND') lineExceptions.push(row);
      if (row.type === 'SAVE_FAILED') saveFailures.push(row);

      return true;
    });

    const totals = recordSummaries.reduce((total, row) => {
      total.records += 1;
      total.attemptedLines += row.attemptedLines || 0;
      total.vendorPriceLines += row.vendorPriceLines || 0;
      total.averageCostLines += row.averageCostLines || 0;
      total.notFoundLines += row.notFoundLines || 0;
      total.skippedNonZeroLines += row.skippedNonZeroLines || 0;
      total.lineErrorCount += row.lineErrorCount || 0;
      return total;
    }, {
      records: 0,
      attemptedLines: 0,
      vendorPriceLines: 0,
      averageCostLines: 0,
      notFoundLines: 0,
      skippedNonZeroLines: 0,
      lineErrorCount: 0
    });

    totals.saveFailures = saveFailures.length;
    totals.scriptErrors = scriptErrors.length;

    log.audit('Run complete', totals);

    if (!lineExceptions.length && !saveFailures.length && !scriptErrors.length) return;

    const script = runtime.getCurrentScript();
    const author = script.getParameter({ name: PARAM_EMAIL_AUTHOR });
    const recipients = parseRecipients(script.getParameter({ name: PARAM_EMAIL_RECIPIENTS }));

    if (!author || !recipients.length) {
      log.error('Exception email not sent', {
        author,
        recipients,
        lineExceptions: lineExceptions.length,
        saveFailures: saveFailures.length,
        scriptErrors: scriptErrors.length
      });
      return;
    }

    email.send({
      author,
      recipients,
      subject: `[AM] WME Inventory Adjustment Cost Exceptions - ${new Date().toISOString().slice(0, 10)}`,
      body: buildEmailBody(totals, lineExceptions, saveFailures, scriptErrors)
    });

    log.audit('Exception email sent', {
      recipients,
      lineExceptions: lineExceptions.length,
      saveFailures: saveFailures.length,
      scriptErrors: scriptErrors.length
    });
  };

  const buildItemCostMap = (itemCostQuery) => {
    const itemCostMap = {};
    const pagedData = query.runSuiteQLPaged({
      query: itemCostQuery,
      pageSize: 1000
    });

    pagedData.pageRanges.forEach((pageRange) => {
      const page = pagedData.fetch({ index: pageRange.index });
      page.data.asMappedResults().forEach((row) => {
        const itemId = String(row.item_id || row.ITEM_ID || '');
        const subsidiaryId = String(row.subsidiary_id || row.SUBSIDIARY_ID || '');
        const locationId = String(row.location_id || row.LOCATION_ID || '');
        const vendorPrice = toNumber(row.preferred_vendor_price || row.PREFERRED_VENDOR_PRICE);
        const averageCost = toNumber(row.location_average_cost || row.LOCATION_AVERAGE_COST);

        if (!itemId) return;
        if (!itemCostMap[itemId]) {
          itemCostMap[itemId] = {
            preferredVendorPriceBySubsidiary: {},
            averageCostByLocation: {}
          };
        }
        if (subsidiaryId && vendorPrice > 0) {
          itemCostMap[itemId].preferredVendorPriceBySubsidiary[subsidiaryId] = vendorPrice;
        }
        if (locationId && averageCost > 0) {
          itemCostMap[itemId].averageCostByLocation[locationId] = averageCost;
        }
      });
    });

    return itemCostMap;
  };

  const resolveCost = (itemCostMap, itemId, subsidiaryId, locationId) => {
    const itemCost = itemCostMap[itemId];
    const vendorPrice = itemCost && itemCost.preferredVendorPriceBySubsidiary[subsidiaryId];
    const averageCost = itemCost && itemCost.averageCostByLocation[locationId];

    if (vendorPrice > 0) {
      return { cost: vendorPrice, source: SOURCE_VENDOR_PRICE, reason: '' };
    }
    if (averageCost > 0) {
      return { cost: averageCost, source: SOURCE_AVERAGE_COST, reason: '' };
    }
    return {
      cost: null,
      source: SOURCE_NOT_FOUND,
      reason: 'No preferred vendor price and no location average cost were found.'
    };
  };

  const buildEmailBody = (totals, lineExceptions, saveFailures, scriptErrors) => {
    const lineRows = lineExceptions.map((row) => `
      <tr>
        <td>${escapeHtml(row.tranId)}</td>
        <td>${escapeHtml(row.recordId)}</td>
        <td>${escapeHtml(row.subsidiaryText)}</td>
        <td>${escapeHtml(row.itemText)}</td>
        <td>${escapeHtml(row.locationText)}</td>
        <td>${escapeHtml(row.line || row.lineUniqueKey)}</td>
        <td>${escapeHtml(row.quantity)}</td>
        <td>${escapeHtml(row.reason)}</td>
      </tr>
    `).join('');

    const saveRows = saveFailures.map((row) => `
      <tr>
        <td>${escapeHtml(row.tranId)}</td>
        <td>${escapeHtml(row.recordId)}</td>
        <td>${escapeHtml(row.attemptedLines)}</td>
        <td>${escapeHtml(row.reason)}</td>
      </tr>
    `).join('');

    const errorRows = scriptErrors.map((row) => `
      <tr>
        <td>${escapeHtml(row.stage)}</td>
        <td>${escapeHtml(row.key)}</td>
        <td>${escapeHtml(row.message)}</td>
      </tr>
    `).join('');

    return `
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1f2933;">
        <h2 style="margin:0 0 12px;color:#0f4c81;">[AM] WME Inventory Adjustment Cost Exceptions</h2>
        <p style="margin:0 0 16px;">One or more Inventory Adjustment cost lines need review.</p>

        <table style="border-collapse:collapse;margin-bottom:18px;">
          <tr><td style="padding:4px 12px 4px 0;"><b>Records saved</b></td><td>${totals.records}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;"><b>Lines attempted</b></td><td>${totals.attemptedLines}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;"><b>Vendor price updates</b></td><td>${totals.vendorPriceLines}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;"><b>Average cost updates</b></td><td>${totals.averageCostLines}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;"><b>Not found lines</b></td><td>${totals.notFoundLines}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;"><b>Line match errors</b></td><td>${totals.lineErrorCount}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;"><b>Save failures</b></td><td>${saveFailures.length}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;"><b>Script errors</b></td><td>${scriptErrors.length}</td></tr>
        </table>

        ${lineRows ? `
          <h3 style="margin:16px 0 8px;color:#0f4c81;">Lines Not Costed</h3>
          <table style="border-collapse:collapse;width:100%;">
            <thead>
              <tr style="background:#e8f1f8;">
                <th style="border:1px solid #c9d6e2;padding:6px;text-align:left;">Document</th>
                <th style="border:1px solid #c9d6e2;padding:6px;text-align:left;">Record ID</th>
                <th style="border:1px solid #c9d6e2;padding:6px;text-align:left;">Subsidiary</th>
                <th style="border:1px solid #c9d6e2;padding:6px;text-align:left;">Item</th>
                <th style="border:1px solid #c9d6e2;padding:6px;text-align:left;">Location</th>
                <th style="border:1px solid #c9d6e2;padding:6px;text-align:left;">Line</th>
                <th style="border:1px solid #c9d6e2;padding:6px;text-align:left;">Qty</th>
                <th style="border:1px solid #c9d6e2;padding:6px;text-align:left;">Reason</th>
              </tr>
            </thead>
            <tbody>${lineRows}</tbody>
          </table>
        ` : ''}

        ${saveRows ? `
          <h3 style="margin:16px 0 8px;color:#0f4c81;">Save Failures</h3>
          <table style="border-collapse:collapse;width:100%;">
            <thead>
              <tr style="background:#f8ece8;">
                <th style="border:1px solid #e2cec9;padding:6px;text-align:left;">Document</th>
                <th style="border:1px solid #e2cec9;padding:6px;text-align:left;">Record ID</th>
                <th style="border:1px solid #e2cec9;padding:6px;text-align:left;">Lines Attempted</th>
                <th style="border:1px solid #e2cec9;padding:6px;text-align:left;">Error</th>
              </tr>
            </thead>
            <tbody>${saveRows}</tbody>
          </table>
        ` : ''}

        ${errorRows ? `
          <h3 style="margin:16px 0 8px;color:#0f4c81;">Script Errors</h3>
          <table style="border-collapse:collapse;width:100%;">
            <thead>
              <tr style="background:#f8ece8;">
                <th style="border:1px solid #e2cec9;padding:6px;text-align:left;">Stage</th>
                <th style="border:1px solid #e2cec9;padding:6px;text-align:left;">Key</th>
                <th style="border:1px solid #e2cec9;padding:6px;text-align:left;">Error</th>
              </tr>
            </thead>
            <tbody>${errorRows}</tbody>
          </table>
        ` : ''}
      </div>
    `;
  };

  const toNumber = (value) => {
    const number = Number(String(value || '').replace(/,/g, ''));
    return Number.isFinite(number) ? number : 0;
  };

  const parseRecipients = (value) => String(value || '')
    .split(';')
    .map((recipient) => recipient.trim())
    .filter(Boolean);

  const escapeHtml = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  return {
    getInputData,
    map,
    reduce,
    summarize
  };
});
