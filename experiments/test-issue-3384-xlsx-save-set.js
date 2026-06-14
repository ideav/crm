// Regression test for issue #3384.
//
// "https://github.com/ideav/crm/pull/3383 Сохранять настройку импорта из Excel
//  кнопкой #save-set-btn - Лист, Старт, справа до, снизу до"
//
// The "Сохранить настройку" button (#save-set-btn) persists the upload set
// (sheet field mapping, header/trim flags, delimiters, formulas, parent…) as a
// JSON blob. Before the fix, the Excel-specific choices made in the #xlsx-area
// panel — the selected sheet, the start cell and the right/bottom range limits —
// were NOT part of that blob, so re-applying a saved set and re-loading the same
// .xlsx always fell back to auto-detection and lost the user's manual range.
//
// The fix:
//   1. check-set (build of saveSet) adds a `xlsx` block {sheet,r0,c0,r1,c1} when
//      a workbook is loaded, and carries forward a previously-saved block on
//      re-save without a workbook.
//   2. applying a saved set (type case) stashes that block into xlsxSavedSel.
//   3. handleExcelFile() consumes xlsxSavedSel on the next .xlsx load, selecting
//      the saved sheet and restoring the saved range (renderXlsxSheet(name,saved)).
//   4. renderXlsxSheet(name,saved) restores the saved selection, clamped to the
//      current sheet bounds (xlsxClampSel); otherwise auto-detects as before.
//
// This test extracts the REAL renderXlsxSheet()/xlsxClampSel() source from the
// template, drives them with a tiny XLSX/DOM shim, and asserts the round-trip:
// a saved selection comes back unchanged when it fits, and is clamped when it
// no longer does. It also runs defensive checks on the save/restore wiring.

var fs = require('fs');
var path = require('path');

var passed = 0, failed = 0;
function check(name, ok){
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
  if (ok) passed++; else { failed++; process.exitCode = 1; }
}

// ── Extract a top-level function body from the template ──────────────────────
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

var renderSrc = extractFn('renderXlsxSheet');
var clampSrc  = extractFn('xlsxClampSel');
var autoSrc   = extractFn('xlsxAutoDetectStart');

// ── Defensive checks: the save/restore wiring is present and intended ────────
var checkSetSrc = template.slice(template.indexOf("case 'check-set':"), template.indexOf("case 'upload':"));
check('check-set persists the Excel block (sheet/start/limits) into saveSet',
  /saveSet\['xlsx'\]\s*=\s*\{sheet:\$\('#xlsx-sheet'\)\.val\(\),r0:xlsxSel\.r0,c0:xlsxSel\.c0,r1:xlsxSel\.r1,c1:xlsxSel\.c1\}/.test(checkSetSrc));
check('check-set carries a previously-saved Excel block forward on re-save',
  /else if\(uploadSets\[chosenSet\]&&uploadSets\[chosenSet\]\.xlsx\)\s*\n?\s*saveSet\['xlsx'\]=uploadSets\[chosenSet\]\.xlsx/.test(checkSetSrc));

var typeSrc = template.slice(template.indexOf("case 'type':"), template.indexOf("case 'base':"));
check('applying a saved set stashes its Excel block into xlsxSavedSel (else null)',
  /xlsxSavedSel=\(uploadSets\[chosenSet\]&&uploadSets\[chosenSet\]\.xlsx\)\?uploadSets\[chosenSet\]\.xlsx:null/.test(typeSrc));

var handleSrc = extractFn('handleExcelFile');
check('handleExcelFile restores the saved sheet when present in the workbook',
  /xlsxWorkbook\.SheetNames\.indexOf\(saved\.sheet\)!==-1/.test(handleSrc) &&
  /renderXlsxSheet\(saved\.sheet,saved\)/.test(handleSrc));
check('handleExcelFile consumes xlsxSavedSel once (resets to null)',
  /var saved=xlsxSavedSel;\s*xlsxSavedSel=null;/.test(handleSrc));

// ── Behavioural harness for renderXlsxSheet()/xlsxClampSel() ─────────────────
function runRender(rows, name, saved){
  // window.XLSX.utils.sheet_to_json just hands back our rows (deep-ish copy).
  var sheetRows = rows.map(function(r){ return r.slice(); });
  var win = { XLSX: { utils: { sheet_to_json: function(){ return sheetRows; } } } };
  var xlsxWorkbook = { Sheets: {} };
  xlsxWorkbook.Sheets[name] = {};
  var captured = { xlsxRows: null };

  var xlsxAutoDetectStart = new Function('return ' + autoSrc.replace(/^function\s+\w+/, 'function'))();

  // Build xlsxClampSel and renderXlsxSheet in a shared scope so renderXlsxSheet
  // can call xlsxClampSel, and so we can read back the resulting xlsxSel.
  var factory = new Function(
    'window', 'xlsxWorkbook', 'xlsxAutoDetectStart', 'drawXlsxGrid', 'captured',
    'var xlsxRows=[], xlsxSel={};\n' +
    clampSrc + '\n' + renderSrc + '\n' +
    'return function(name,saved){ renderXlsxSheet(name,saved); captured.xlsxRows=xlsxRows; return xlsxSel; };'
  );
  var run = factory(win, xlsxWorkbook, xlsxAutoDetectStart, function(){}, captured);
  return run(name, saved);
}

// A 5-row × 4-col sheet (indices 0..4 / 0..3).
var grid = [
  ['junk','',  '',  ''  ],
  ['',    'A', 'B', 'C' ],
  ['',    'a1','b1','c1'],
  ['',    'a2','b2','c2'],
  ['',    'a3','b3','c3']
];

// ── Case 1: saved selection that fits is restored verbatim ───────────────────
(function(){
  var saved = { sheet:'Лист1', r0:1, c0:1, r1:3, c1:2 };
  var sel = runRender(grid, 'Лист1', saved);
  check('case1: saved start cell restored (r0/c0)', sel.r0 === 1 && sel.c0 === 1);
  check('case1: saved right/bottom limits restored (r1/c1)', sel.r1 === 3 && sel.c1 === 2);
})();

// ── Case 2: open limits (null = "to edge") survive restore ───────────────────
(function(){
  var saved = { sheet:'Лист1', r0:1, c0:1, r1:null, c1:null };
  var sel = runRender(grid, 'Лист1', saved);
  check('case2: null limits stay null (to edge)', sel.r1 === null && sel.c1 === null);
  check('case2: start cell still restored', sel.r0 === 1 && sel.c0 === 1);
})();

// ── Case 3: out-of-range saved selection is clamped to sheet bounds ──────────
(function(){
  // saved file had more rows/cols; current sheet is only 5×4 → clamp to 4/3.
  var saved = { sheet:'Лист1', r0:99, c0:99, r1:200, c1:200 };
  var sel = runRender(grid, 'Лист1', saved);
  check('case3: start clamped to last row/col (4/3)', sel.r0 === 4 && sel.c0 === 3);
  check('case3: limits clamped to last row/col (4/3)', sel.r1 === 4 && sel.c1 === 3);
  check('case3: clamped limits never precede start (r1>=r0,c1>=c0)',
    sel.r1 >= sel.r0 && sel.c1 >= sel.c0);
})();

// ── Case 4: no saved selection → auto-detect (start at B2 of this layout) ─────
(function(){
  var sel = runRender(grid, 'Лист1', undefined);
  // xlsxAutoDetectStart: first row whose non-empty count repeats next row → row 1
  // (cols B,C,D = 3 non-empty), first non-empty col there is index 1.
  check('case4: auto-detect kicks in without a saved block (start B2)',
    sel.r0 === 1 && sel.c0 === 1 && sel.r1 === null && sel.c1 === null);
})();

// ── Case 5: a tiny 1×1 sheet clamps a big saved selection without going < 0 ──
(function(){
  var sel = runRender([['x']], 'Лист1', { sheet:'Лист1', r0:5, c0:5, r1:9, c1:9 });
  check('case5: 1x1 sheet clamps everything to (0,0)',
    sel.r0 === 0 && sel.c0 === 0 && sel.r1 === 0 && sel.c1 === 0);
})();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
