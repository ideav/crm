// Regression test for issue #3374.
//
// "По кнопке «Применить диапазон» копировать распознанные данные в окно #input
//  для возможности редактирования строк."
//
// Before the fix, applyXlsxRange() fed the recognised Excel slice straight into
// importDoParse({data: out}) — the rows never appeared in the editable #input
// textarea, so the user could not tweak them before uploading (unlike the plain
// text/CSV path, which always round-trips through #input).
//
// The fix serialises the slice to CSV (via Papa.unparse), writes it to #input
// and then calls importParse() — the same path text import uses. This test
// extracts the REAL applyXlsxRange() source from the template, runs it with a
// tiny jQuery shim and the REAL PapaParse, and asserts:
//   1. #input is populated with the recognised rows as text;
//   2. that text re-parses (the way importParse() does) back to the slice;
//   3. importParse() is invoked (editable path) and importDoParse() is NOT
//      called directly by applyXlsxRange().

var fs = require('fs');
var path = require('path');
var Papa = require('/tmp/papatest/node_modules/papaparse/papaparse.js');

var passed = 0, failed = 0;
function check(name, ok){
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
  if (ok) passed++; else { failed++; process.exitCode = 1; }
}

// ── Extract the real applyXlsxRange() source from the template ───────────────
var template = fs.readFileSync(path.join(__dirname, '..', 'templates', 'upload.html'), 'utf8');
function extractFn(name){
  var start = template.indexOf('function ' + name + '(');
  if (start < 0) throw new Error(name + '() not found in template');
  var depth = 0, end = -1;
  for (var i = template.indexOf('{', start); i < template.length; i++) {
    if (template[i] === '{') depth++;
    else if (template[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return template.slice(start, end);
}
var applyXlsxRangeSrc = extractFn('applyXlsxRange');
var serializeSrc      = extractFn('serializeUploadCellValue');

// ── Confirm the fix is wired the intended way (defensive, not behavioural) ───
check('applyXlsxRange writes the slice into #input', /\$\('#input'\)\.val\(/.test(applyXlsxRangeSrc));
check('applyXlsxRange goes through the editable text path (importParse)',
  /\bimportParse\(\)/.test(applyXlsxRangeSrc));
check('applyXlsxRange no longer feeds importDoParse directly',
  !/importDoParse\(/.test(applyXlsxRangeSrc));

// ── Minimal jQuery shim with a real, mutable #input value store ──────────────
function makeShim(store){
  return function $(sel){
    var id = sel.charAt(0) === '#' ? sel.slice(1) : null;
    return {
      val: function(v){ if (v === undefined) return store[id] || ''; store[id] = v; return this; },
      hide: function(){ return this; },
      show: function(){ return this; },
      html: function(){ return this; }
    };
  };
}

function runApply(rows, sel, delim){
  var store = { delim: delim || '' };
  var $ = makeShim(store);
  var calls = { importParse: 0, importDoParse: 0, errors: [] };

  // Globals applyXlsxRange() closes over in the template.
  var serializeUploadCellValue = new Function('return ' + serializeSrc.replace(/^function\s+\w+/, 'function') )();
  var xlsxRows = rows;
  var xlsxSel  = sel;
  function xlsxEndR(){ return xlsxSel.r1 == null ? xlsxRows.length - 1 : xlsxSel.r1; }
  function xlsxEndC(){ return xlsxSel.c1 == null ? ((xlsxRows[0] ? xlsxRows[0].length : 1) - 1) : xlsxSel.c1; }
  function xlsxShowError(m){ calls.errors.push(m); }
  function importParse(){ calls.importParse++; }
  function importDoParse(){ calls.importDoParse++; }

  var factory = new Function(
    '$', 'Papa', 'serializeUploadCellValue', 'xlsxRows', 'xlsxSel',
    'xlsxEndR', 'xlsxEndC', 'xlsxShowError', 'importParse', 'importDoParse',
    applyXlsxRangeSrc + '\nreturn applyXlsxRange;'
  );
  var applyXlsxRange = factory($, Papa, serializeUploadCellValue, xlsxRows, xlsxSel,
    xlsxEndR, xlsxEndC, xlsxShowError, importParse, importDoParse);
  applyXlsxRange();
  return { store: store, calls: calls };
}

// Re-parse #input the way importParse() does (Papa.parse, skip empty lines).
function reparse(text, delim){
  return Papa.parse(text, { delimiter: delim || '', skipEmptyLines: true }).data;
}

// ── Case 1: simple slice from top-left, no limits ────────────────────────────
(function(){
  var rows = [
    ['Имя', 'Цена', 'Кол-во'],
    ['Болт', '12.5', '100'],
    ['Гайка', '3', '250']
  ];
  var r = runApply(rows, { r0:0, c0:0, r1:null, c1:null });
  check('case1: importParse() called, importDoParse() not', r.calls.importParse === 1 && r.calls.importDoParse === 0);
  check('case1: #input is non-empty text', typeof r.store.input === 'string' && r.store.input.length > 0);
  var back = reparse(r.store.input);
  check('case1: re-parsed text matches the slice', JSON.stringify(back) === JSON.stringify(rows));
})();

// ── Case 2: offset start + right/bottom limits ───────────────────────────────
(function(){
  var rows = [
    ['junk', '',     '',     ''],
    ['',     'A',    'B',    'C'],
    ['',     'a1',   'b1',   'c1'],
    ['',     'a2',   'b2',   'c2'],
    ['',     'a3',   'b3',   'c3']
  ];
  // start at B2 (r1,c1), limit right to C (c=2... index 2 is 'B' col? cols: 0..3),
  // bottom limit to row index 3.
  var r = runApply(rows, { r0:1, c0:1, r1:3, c1:2 });
  var expected = [['A','B'],['a1','b1'],['a2','b2']];
  var back = reparse(r.store.input);
  check('case2: slice with right/bottom limits round-trips', JSON.stringify(back) === JSON.stringify(expected));
})();

// ── Case 3: values containing the delimiter survive (CSV quoting) ────────────
(function(){
  var rows = [
    ['Товар', 'Описание'],
    ['Кабель', 'красный, 2.5 мм'],
    ['Лента', 'синяя; широкая']
  ];
  var r = runApply(rows, { r0:0, c0:0, r1:null, c1:null });
  var back = reparse(r.store.input);
  check('case3: comma-containing cell stays one field after round-trip',
    JSON.stringify(back) === JSON.stringify(rows));
})();

// ── Case 4: custom TAB delimiter is honoured on both ends ────────────────────
(function(){
  var rows = [['a','b'],['1','2']];
  var r = runApply(rows, { r0:0, c0:0, r1:null, c1:null }, '\t');
  check('case4: #input uses the configured TAB delimiter', r.store.input.indexOf('\t') >= 0);
  var back = reparse(r.store.input, '\t');
  check('case4: TAB-delimited text round-trips', JSON.stringify(back) === JSON.stringify(rows));
})();

// ── Case 5: empty sheet still errors, nothing parsed ─────────────────────────
(function(){
  var r = runApply([], { r0:0, c0:0, r1:null, c1:null });
  check('case5: empty sheet reports an error and parses nothing',
    r.calls.errors.length === 1 && r.calls.importParse === 0 && !r.store.input);
})();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
