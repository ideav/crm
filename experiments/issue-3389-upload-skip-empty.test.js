// Regression test for issue #3389.
//
// templates/upload.html — importDoParse() decides whether to drop a data row as
// "empty". The original check looked at the FIRST INPUT column (`j==='0'`): if it
// was empty, the whole row was skipped. But with a saved import set the user may
// not use the first input column at all (e.g. a CSV with a leading comma:
// `,3580,Образец…`). Those rows were silently dropped even though the field the
// user actually imports (the chosen type's value, which lands first in the OUTPUT
// after the importMap layout) is present.
//
// The fix: skip a row only when the MAIN value — the chosen type's field — is
// empty, not the first input column. This test extracts the real importDoParse()
// source from the template and runs it under tiny shims.

var fs = require('fs');
var path = require('path');

var passed = 0, failed = 0;
function check(name, ok){
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
  if (ok) passed++; else { failed++; process.exitCode = 1; }
}

// ── Extract the real importDoParse() source from the template ────────────────
var template = fs.readFileSync(path.join(__dirname, '..', 'templates', 'upload.html'), 'utf8');
var start = template.indexOf('function importDoParse(input){');
if (start < 0) throw new Error('importDoParse() not found in template');
var depth = 0, end = -1;
for (var i = template.indexOf('{', start); i < template.length; i++) {
  if (template[i] === '{') depth++;
  else if (template[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
var importDoParseSrc = template.slice(start, end);

// The fix must no longer key the skip on the first input column.
check('importDoParse no longer skips rows by the first input column (j===\'0\')',
  !/j===['"]0['"]&&val===['"]['"]/.test(importDoParseSrc) &&
  /sourceMap\[k\]\.id===chosenType/.test(importDoParseSrc));

// ── Faithful, tiny reimplementation of serializeUploadCellValue ──────────────
function serializeUploadCellValue(v){
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') { try { return JSON.stringify(v); } catch(e) { return String(v); } }
  return v.toString();
}

// ── jQuery shim: captures .html() into a store, answers .prop('checked') ──────
function makeShim(opts, store){
  return function(sel){
    var id = sel.charAt(0) === '#' ? sel.slice(1) : sel;
    return {
      html: function(v){ if (arguments.length) { store[id] = v; return this; } return store[id] || ''; },
      hide: function(){ return this; },
      show: function(){ return this; },
      prop: function(){ if (id === 'trim') return !!opts.trim; if (id === 'header') return !!opts.header; return false; }
    };
  };
}

function runImportDoParse(scenario){
  var store = {};
  var $ = makeShim(scenario, store);
  var noop = function(){};
  var factory = new Function(
    '$', 'escape', 'serializeUploadCellValue', 'parseType', 'procStats', 'drawPage',
    'previewCopyActionHtml', 'setPreviewCopyStatus',
    'chosenType', 'sourceMap', 'importMap', 'origMap', 'formulas', 'autoParent', 'chunkSize',
    'var toImport, statArr, evalExpr={}, evalErrs={};\n' +
    importDoParseSrc +
    '\nreturn { run: importDoParse, toImport: function(){ return toImport; } };'
  );
  var api = factory(
    $, function(s){ return s; }, serializeUploadCellValue, noop, noop, noop,
    function(){ return ''; }, noop,
    scenario.chosenType, scenario.sourceMap, scenario.importMap, scenario.origMap,
    scenario.formulas || {}, scenario.autoParent, 1000
  );
  api.run({ data: scenario.data });
  var rows = api.toImport().filter(function(r){ return r !== undefined; });
  // "всего строк: <b>N</b>" from the #resume summary.
  var m = /всего строк[\s\S]*?<b>(\d+)<\/b>/.exec(store.resume || '');
  return { rows: rows, total: m ? parseInt(m[1], 10) : null };
}

// ── Scenario from the issue: type 1076, first input column unused & empty ─────
// Saved set importMap maps 66405→col0 (empty leading comma), 1076 (chosen type,
// "Заказанное количество")→col7, autoParent=2 → parent read from col1.
var issueScenario = {
  chosenType: '1076',
  autoParent: 2,
  trim: 1,
  header: 0,
  sourceMap: [
    { id: '66405', base: '1',  name: 'Неиспользуемая колонка', skip: 0 },
    { id: '1138',  base: '1',  name: 'Артикул',                skip: 0 },
    { id: '1076',  base: '13', name: 'Заказанное количество',  skip: 0 }
  ],
  importMap: { '66405': 0, '1138': 2, '1076': 7 },
  origMap:   { '1076': 0, '1138': 3, '66405': 4 },
  data: [
    ['', '3580', 'Образец MW208 (110*200) OUT с прозрачным лидером', '75мм х 5', '16.06.2026', '', '', '3'],
    ['', '3580', 'Образец MW208 (75*200) OUT с прозрачным лидером',  '75мм х 5', '16.06.2026', '', '', '5'],
    ['', '3580', 'Образец MW208 (30*200) OUT с прозрачным лидером',  '75мм х 5', '16.06.2026', '', '', '6']
  ]
};

var res = runImportDoParse(issueScenario);
check('all 3 rows are imported even though the first input column is empty',
  res.total === 3 && res.rows.length === 3);

// ── Row whose MAIN value (chosen type, col7) is empty must still be skipped ───
var emptyMainScenario = JSON.parse(JSON.stringify(issueScenario));
emptyMainScenario.data = [
  ['', '3580', 'Образец A', '75мм', '16.06.2026', '', '', '3'],
  ['', '3580', 'Образец B', '75мм', '16.06.2026', '', '', ''],   // main qty empty → skip
  ['', '3580', 'Образец C', '75мм', '16.06.2026', '', '', '6']
];
var res2 = runImportDoParse(emptyMainScenario);
check('a row with an empty MAIN value (chosen type) is skipped',
  res2.total === 2 && res2.rows.length === 2);

// ── chosenType===undefined keeps the original "first column" semantics ────────
var newTypeScenario = {
  chosenType: undefined,
  autoParent: undefined,
  trim: 1,
  header: 0,
  sourceMap: [
    { id: 0, base: '1', name: 'Колонка A', skip: 0 },
    { id: 1, base: '1', name: 'Колонка B', skip: 0 }
  ],
  importMap: {},
  origMap: {},
  data: [
    ['x', 'a'],
    ['',  'b'],   // first column empty → skipped when creating a new type
    ['y', 'c']
  ]
};
var res3 = runImportDoParse(newTypeScenario);
check('creating a new type still skips rows with an empty first column',
  res3.total === 2 && res3.rows.length === 2);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
