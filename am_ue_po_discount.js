/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 * Applies header defaults and computes the PO discount in the same save.
 */
define(['N/runtime', 'N/log', 'N/search'], (runtime, log, search) => {
    const HEADER = 'custbody_am_po_discount';
    const LINE = 'custcol_am_po_applied_discount';
    const empty = v => v === '' || v === null || v === undefined;
    const percent = v => {
        if (empty(v)) return 0;
        const n = Number(String(v).replace(/%$/, '').trim());
        if (!Number.isFinite(n) || Math.abs(n) > 100) throw new Error('PO discount must be a percentage between -100 and 100.');
        return Math.abs(n);
    };
    const beforeSubmit = context => {
        if (!['create', 'edit', 'copy'].includes(context.type)) return;
        const rec = context.newRecord, old = context.oldRecord;
        const item = runtime.getCurrentScript().getParameter({name: 'custscript_po_discount_item'});
        if (!item) throw new Error('PO discount item is not configured. Contact your administrator before saving.');
        try {
            applyVendorDefaults(rec, old, context.type);
            appendStockInstructions(rec);
            const header = percent(rec.getValue({fieldId: HEADER}));
            const oldHeader = old ? percent(old.getValue({fieldId: HEADER})) : header;
            const oldLines = {};
            if (old) for (let i = 0; i < old.getLineCount({sublistId:'item'}); i++) {
                const key = old.getSublistValue({sublistId:'item',fieldId:'lineuniquekey',line:i});
                if (!empty(key)) oldLines[String(key)] = old.getSublistValue({sublistId:'item',fieldId:LINE,line:i});
            }
            const discounts = [];
            let total = 0;
            const count = rec.getLineCount({sublistId:'item'});
            for (let i = 0; i < count; i++) {
                const get = fieldId => rec.getSublistValue({sublistId:'item',fieldId,line:i});
                if (String(get('item')) === String(item)) { discounts.push(i); continue; }
                if (['Subtotal','Description','Discount','Markup','EndGroup','Group'].includes(String(get('itemtype')))) continue;
                const value = get(LINE), key = String(get('lineuniquekey'));
                let applied = percent(value);
                // Propagate a changed header only to inherited lines. Preserve existing
                // overrides, including explicit zero, and edits made in this same save.
                const hasOld = Object.prototype.hasOwnProperty.call(oldLines, key);
                const inherited = hasOld && (empty(oldLines[key]) || percent(oldLines[key]) === oldHeader);
                const unchanged = hasOld && percent(value) === percent(oldLines[key]);
                if (empty(value) || (header !== oldHeader && inherited && unchanged)) applied = header;
                if (empty(value) || percent(value) !== applied) rec.setSublistValue({sublistId:'item',fieldId:LINE,line:i,value:applied});
                const amount = Number(get('amount') || 0);
                if (!Number.isFinite(amount)) throw new Error('Invalid PO amount on line ' + (i+1));
                if (amount > 0) total += amount * applied / 100;
            }
            const amount = -Math.round((total + Number.EPSILON) * 100) / 100;
            // Rebuild only the configured discount item, once, at the end.
            for (let i = discounts.length - 1; i >= 0; i--) rec.removeLine({sublistId:'item',line:discounts[i]});
            if (amount < 0) {
                const line = rec.getLineCount({sublistId:'item'});
                rec.insertLine({sublistId:'item',line});
                rec.setSublistValue({sublistId:'item',fieldId:'item',line,value:item});
                rec.setSublistValue({sublistId:'item',fieldId:'rate',line,value:amount});
                rec.setSublistValue({sublistId:'item',fieldId:'amount',line,value:amount});
            }
        } catch (e) {
            log.error({title:'PO discount save failed',details:e});
            throw e; // Never silently save an incorrect PO total.
        }
    };
    function applyVendorDefaults(rec, old, type) {
        const vendor = rec.getValue({fieldId:'entity'});
        if (!vendor) return;
        const changedVendor = old && String(old.getValue({fieldId:'entity'})) !== String(vendor);
        if (type !== 'create' && type !== 'copy' && !changedVendor) return;
        const defaults = search.lookupFields({type:'vendor',id:vendor,columns:['custentity_bpc_vendor_pref_ship_method','custentity_bpc_vendor_am_discount']});
        const shipping = String(defaults.custentity_bpc_vendor_pref_ship_method || '').trim();
        if (shipping && empty(rec.getValue({fieldId:'shipmethod'}))) {
            try { rec.setText({fieldId:'shipmethod',text:shipping}); }
            catch(e) { throw new Error('Vendor preferred shipping method "' + shipping + '" does not match an available Shipping Method. Select a method on this PO or correct the vendor default.'); }
        }
        const discount = String(defaults.custentity_bpc_vendor_am_discount || '').trim();
        // Free-form vendor descriptions are not assumed to be a numeric discount.
        if (empty(rec.getValue({fieldId:HEADER})) && /^\d+(?:\.\d+)?\s*%?$/.test(discount)) rec.setValue({fieldId:HEADER,value:percent(discount)});
    }
    function appendStockInstructions(rec) {
        const stock = rec.getValue({fieldId:'custbody_ace_join_stockpo'});
        if (stock !== true && stock !== 'T') return;
        const note = 'COMBINE WITH STOCK PO FOR PROCESSING AND PREPAID SHIPMENT AS INVENTORY ALLOWS';
        const existing = String(rec.getValue({fieldId:'custbody_ace_po_instruction'}) || '');
        if (existing.replace(/\s+/g,' ').toUpperCase().includes(note)) return;
        rec.setValue({fieldId:'custbody_ace_po_instruction',value:existing + (existing ? '\n' : '') + note});
    }
    return {beforeSubmit};
});
