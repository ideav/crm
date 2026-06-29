// Regression test for issue #3810.
//
// templates/upload.html — when the user picks a SAVED import setting, applySet()
// re-fetches the table schema and the `case 'type'` branch of intApi() rebuilds
// the draggable field list. The reconciliation loop only walked the *saved*
// importMap, so a requisite ADDED to the table AFTER the setting was saved (it is
// present in json.req_order but absent from the saved importMap) silently
// disappeared and could not be mapped.
//
// The fix appends any current requisite (and the main value, defensively) that is
// missing from the saved importMap to the end of the field list, reusing the same
// addSortable(...) calls as the fresh-setting branch.
//
// This test extracts the real `case 'type'` block from the template and runs it
// under tiny shims, replaying the exact scenario from the issue: the «Заказанное
// количество» table (type 1076) gained column «Ед.изм.» (req 129370) after a
// setting was saved without it.

var fs = require('fs');
var path = require('path');

var passed = 0, failed = 0;
function check(name, ok){
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
  if (ok) passed++; else { failed++; process.exitCode = 1; }
}

// ── Extract the real `case 'type'` block source from the template ────────────
var template = fs.readFileSync(path.join(__dirname, '..', 'templates', 'upload.html'), 'utf8');
var start = template.indexOf("case 'type':");
if (start < 0) throw new Error("case 'type' not found in template");
// The block is terminated by its own `break;` (16-space indent). No inner
// switch/loop uses break inside it, so the first such marker closes the case.
var brk = template.indexOf('\n                break;', start);
if (brk < 0) throw new Error("closing break of case 'type' not found");
// Body = everything after `case 'type':` up to (but not including) the break.
var caseBody = template.slice(start + "case 'type':".length, brk);

// The fix must be present and must guard with === undefined (index 0 is falsy).
check('source appends current req_order entries missing from saved importMap',
  /for\(i in json\.req_order\)/.test(caseBody) &&
  /uploadSets\[chosenSet\]\.importMap\[json\.req_order\[i\]\]===undefined/.test(caseBody));
check('source also appends the main value when missing from importMap',
  /uploadSets\[chosenSet\]\.importMap\[json\.type\.id\]===undefined/.test(caseBody));

// ── addSortable shim: emits a marker carrying the field id so we can assert ──
function addSortable(id, val, base, baseId){
  return '[FIELD id=' + id + ' name="' + val + '" base=' + base + ']';
}
// `---` placeholders come through as base=--- / --; real fields carry a numeric id.

// ── jQuery shim: captures $('#sortable').html(h); answers the rest harmlessly ─
function makeShim(store){
  return function(sel){
    var id = (typeof sel === 'string' && sel.charAt(0) === '#') ? sel.slice(1) : sel;
    var api = {
      html: function(v){ if (arguments.length){ store[id] = v; return api; } return store[id] || ''; },
      val: function(){ return api; },
      prop: function(){ return api; },
      attr: function(){ return api; },
      append: function(){ return api; },
      addClass: function(){ return api; },
      removeClass: function(){ return api; },
      show: function(){ return api; },
      hide: function(){ return api; },
      remove: function(){ return api; }
    };
    return api;
  };
}

function runCaseType(scenario){
  var store = {};
  var $ = makeShim(store);
  var noop = function(){};
  var factory = new Function(
    '$', 'addSortable', 'getParent', 'getUpType', 'gatherSet', 'setAutoParent',
    'selectItem', 'json', 'chosenSet', 'uploadSets', 'formulas',
    'var h="", i, j, chosenType, chosenTypeName, upType, origMap={}, xlsxSavedSel;\n' +
    caseBody +
    '\nreturn { html: $("#sortable").html(), origMap: origMap };'
  );
  return factory(
    $, addSortable,
    function(){ return ''; },   // getParent → '' (no parent block)
    function(){ return ''; },   // getUpType
    noop, noop, noop,           // gatherSet / setAutoParent / selectItem
    scenario.json, scenario.chosenSet, scenario.uploadSets, scenario.formulas || {}
  );
}

// ── Scenario from the issue ──────────────────────────────────────────────────
// «Заказанное количество» type 1076. The saved setting knew columns up to req
// 66418; the table later gained req 129370 «Ед.изм.» (and we also drop a column,
// req 9999, that no longer exists in the table to confirm the removal placeholder
// still works).
var REQ = {
  '1138': 'Вид сырья', '1141': 'Ширина, мм', '1143': 'Длина, м', '16325': 'Статус позиции',
  '1147': 'Обеспечение', '8194': 'Диаметр втулки', '8463': 'Тип намотки',
  '8571': 'Дата согласования', '8627': 'Срок изготовления', '13671': 'Задача на втулки',
  '66405': 'Примечание', '66409': 'Лидер', '66418': 'Доп. втулка',
  '129370': 'Ед.изм.'   // ← added to the table AFTER the setting was saved
};
var req_order = Object.keys(REQ);                 // current table schema
var req_type = {}, req_base = {}, req_base_id = {};
req_order.forEach(function(id){ req_type[id] = REQ[id]; req_base[id] = 'SHORT'; req_base_id[id] = ''; });

// Saved importMap (from the issue body) — note it has NO 129370, and it has 1076
// (the main value). We add a stale 9999 to exercise the removed-column path.
var savedImportMap = {
  '1076': 7, '1077': 8, '1080': 12, '1138': 2, '1141': 3, '1143': 5, '8194': 9,
  '8463': 10, '8571': 11, '8627': 4, '16325': 6, '66405': 0, '66409': 13, '66418': 14,
  '9999': 15   // column removed from the table after the setting was saved
};

var json = {
  type: { id: '1076', val: 'Заказанное количество', base: 'LONG' },
  base: { id: '' },
  req_order: req_order, req_type: req_type, req_base: req_base, req_base_id: req_base_id
};
var html = runCaseType({
  json: json, chosenSet: 'Заказанное количество',
  uploadSets: { 'Заказанное количество': { type: '1076', importMap: savedImportMap, formulas: {} } }
}).html;

// ── Assertions ───────────────────────────────────────────────────────────────
check('added column «Ед.изм.» (req 129370) now appears in the field list',
  /\[FIELD id=129370 name="Ед\.изм\." /.test(html));
check('main value (type 1076) still present exactly once',
  (html.match(/\[FIELD id=1076 /g) || []).length === 1);
check('added column «Ед.изм.» appears exactly once (no duplicate)',
  (html.match(/\[FIELD id=129370 /g) || []).length === 1);
check('a pre-existing mapped column (req 1138) is still present',
  /\[FIELD id=1138 /.test(html));
check('removed column (req 9999, gone from table) is NOT rendered as a real field',
  !/\[FIELD id=9999 /.test(html) && /base=---/.test(html));

// ── Middle-insertion scenario ────────────────────────────────────────────────
// The new column is added in the MIDDLE of the table schema, not at the end.
// Output-column placement is driven by origMap, which `case 'type'` rebuilds from
// the live req_order on every load (upload.html:925-927). So inserting a requisite
// in the middle must shift every later column +1 in the OUTPUT — for existing
// fields and the new one alike — while the field-list append keeps it visible.
function buildJson(order){
  var rt={}, rb={}, rbid={};
  order.forEach(function(id){ rt[id]=REQ[id]||('req'+id); rb[id]='SHORT'; rbid[id]=''; });
  return { type:{id:'1076',val:'Заказанное количество',base:'LONG'}, base:{id:''},
           req_order:order, req_type:rt, req_base:rb, req_base_id:rbid };
}
// importMap saved BEFORE the new column existed (so it has no 129370 entry).
var imBefore = { '1076':5, '1138':0, '1141':1, '1143':2, '16325':3, '1147':4 };
function runMid(order){
  return runCaseType({ json: buildJson(order), chosenSet:'S',
    uploadSets:{ 'S':{ type:'1076', importMap: imBefore, formulas:{} } } });
}
var orderNoNew   = ['1138','1141','1143','16325','1147'];               // before adding
var orderWithNew = ['1138','1141','129370','1143','16325','1147'];      // 129370 inserted at idx 2
var omBefore = runMid(orderNoNew).origMap;
var midRes   = runMid(orderWithNew);
var omAfter  = midRes.origMap;

// origMap[id] = (1-based index in req_order); main value (type id) = 0.
check('middle-inserted column gets its correct OUTPUT position (origMap=3)',
  omAfter['129370'] === 3);
check('columns AFTER the insertion point shift +1 in the output',
  omAfter['1143'] === omBefore['1143'] + 1 &&
  omAfter['16325'] === omBefore['16325'] + 1 &&
  omAfter['1147'] === omBefore['1147'] + 1);
check('columns BEFORE the insertion point keep their output position',
  omAfter['1138'] === omBefore['1138'] && omAfter['1141'] === omBefore['1141']);
check('middle-inserted column is rendered in the field list (visible & mappable)',
  /\[FIELD id=129370 /.test(midRes.html));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
