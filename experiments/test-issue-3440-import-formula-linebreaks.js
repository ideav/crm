// Regression test for issue #3440.
//
// "https://github.com/ideav/crm/pull/3394/changes Ломается импорт если есть
//  переводы строк."
//
// PR #3394 (issue #3390) only fixed how an in-cell line break is *displayed* in
// the preview (CSS white-space: pre-line). Parsing is fine — PapaParse keeps a
// quoted multi-line field as ONE record. The break that remained is in the
// FORMULA path: templates/upload.html lets a user attach a JS formula to an
// output column, with `[ColumnName]` placeholders. The placeholder is replaced
// by the raw cell value and the whole expression is run through eval().
//
// When a referenced cell carries an in-cell line break (e.g.
//   "52мм х 17 / 21 резок (884мм)\nФМ лоджистик")
// and the formula wraps the placeholder in quotes (the usual way to use a text
// column, e.g. '[Примечание]'), the raw "\n" lands inside a JS string literal
// and turns it into an UNTERMINATED multi-line literal → eval() throws
// SyntaxError → the preview cell is painted yellow (cell-error) and the row is
// counted as an error (the "ошибок: 74" in the issue screenshot).
//
// The fix: escapeFormulaValue() escapes the substituted value so it is safe
// inside a JS string literal (', " or `), while leaving plain numeric/unquoted
// values untouched and PRESERVING the embedded newline in the resulting string.
//
// This test extracts the REAL escapeFormulaValue() from the template and
// replays the exact substitute→eval pipeline from importDoParse().

var fs = require('fs');
var path = require('path');

var passed = 0, failed = 0;
function check(name, ok){
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
  if (ok) passed++; else { failed++; process.exitCode = 1; }
}

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

// Materialise the real helper from the template.
var escapeFormulaValue =
  new Function('return ' + extractFn('escapeFormulaValue').replace(/^function\s+\w+/, 'function'))();

// The exact substitution+eval that importDoParse() runs for a formula column.
// `row` is the parsed source record; `colIndex` maps a [Name] placeholder to a
// column. Returns {value} on success or {error} on a thrown eval (mirrors the
// evalErrs branch that paints the cell yellow).
function runFormula(formula, row, colIndex, useFix){
  var expr = formula.replace(/\[(.+?)\]/mug, function($1, $2){
    if (colIndex[$2] !== undefined)
      return useFix ? escapeFormulaValue(row[colIndex[$2]]) : row[colIndex[$2]];
    return '[' + $2 + ']';
  });
  try { return { value: eval(expr) }; }       // eslint-disable-line no-eval
  catch (e){ return { error: e }; }
}

// Issue data: 4th column carries an in-cell line break.
var MULTILINE = '52мм х 17 / 21 резок (884мм)\nФМ лоджистик';
var row = ['2910', '', 'MR192 52 х 450 OUT (П)', MULTILINE, '07.05.2026', '', '', '357'];
var colIndex = { 'Примечание': 3, 'Кол-во': 7, 'Название': 2 };

// ── 0. Confirm the original break still happens WITHOUT the fix ──────────────
(function(){
  var r = runFormula("'[Примечание]'", row, colIndex, /*useFix=*/false);
  check('without the fix, a quoted multi-line cell makes eval() throw (the bug)',
    !!r.error && r.error instanceof SyntaxError);
})();

// ── 1. With the fix, the same formula evaluates and keeps the newline ────────
(function(){
  var r = runFormula("'[Примечание]'", row, colIndex, /*useFix=*/true);
  check('with the fix, quoted multi-line cell evaluates without error',
    !r.error);
  check('with the fix, the evaluated value equals the original cell (newline kept)',
    r.value === MULTILINE && r.value.indexOf('\n') !== -1);
})();

// ── 2. Works regardless of which quote style the author used ─────────────────
(function(){
  var single = runFormula("'[Примечание]'", row, colIndex, true);
  var dbl    = runFormula('"[Примечание]"', row, colIndex, true);
  var tick   = runFormula('`[Примечание]`', row, colIndex, true);
  check('fix works for single/double/backtick-quoted placeholders',
    !single.error && !dbl.error && !tick.error &&
    single.value === MULTILINE && dbl.value === MULTILINE && tick.value === MULTILINE);
})();

// ── 3. Quotes/backslashes inside the value no longer break eval ──────────────
(function(){
  var tricky = ["o'b\\rien", '', 'x', 'a"b`c\\d', '', '', '', '1'];
  var r = runFormula("'[Примечание]'", tricky, colIndex, true);
  check('values with quotes/backslashes evaluate verbatim under the fix',
    !r.error && r.value === 'a"b`c\\d');
})();

// ── 4. Numeric / unquoted formulas are unchanged (backward compatible) ───────
(function(){
  var r = runFormula('[Кол-во]*2', row, colIndex, true);
  check('numeric unquoted formula [Кол-во]*2 still evaluates (357*2 = 714)',
    !r.error && r.value === 714);

  var concat = runFormula("'[Название]'+' / '+[Кол-во]", row, colIndex, true);
  check('mixed text+number formula still works',
    !concat.error && concat.value === 'MR192 52 х 450 OUT (П) / 357');
})();

// ── 5. The escape helper itself: no special chars left to break a literal ────
(function(){
  var out = escapeFormulaValue(MULTILINE);
  check('escapeFormulaValue() removes raw newline (turns it into the \\n escape)',
    out.indexOf('\n') === -1 && out.indexOf('\\n') !== -1);
})();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
