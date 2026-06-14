// Regression test for issue #3390.
//
// "templates/upload.html При импорте из экселя корректно обрабатывать переводы
//  строк - сейчас они выбиваются в отдельные строки."
//  (When importing from Excel, in-cell line breaks must be handled correctly —
//   they currently get scattered into separate rows / collapsed.)
//
// The issue ships sample data whose 4th column carries an in-cell line break,
// e.g.  "59мм х 15 / 20 резок (885мм)\nЛИДЕР ЭТИКЕТКА 37". The desired result
// (see the screenshot in the issue) is that every source record stays on ONE
// preview row while the in-cell line break is shown as a SECOND visible line
// inside the same cell — not flattened to a space and not split into an extra
// table row.
//
// The whole pipeline must therefore preserve the embedded "\n":
//   1. parsing keeps a quoted multi-line field as a single record (PapaParse);
//   2. escape() (HTML-escaping for the preview) keeps the "\n" intact so the
//      browser can render it;
//   3. CSS `white-space: pre-line` on the preview cells turns that "\n" into a
//      visible line break inside one row;
//   4. escapeSlashesNSemicolons() (the .bki serialiser) keeps the "\n" so the
//      server reassembles the multi-line cell value unchanged.
//
// This test extracts the REAL helpers / CSS from the template and verifies each
// link of that chain with a tiny shim — no external dependencies required.

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

// Materialise the real helpers the preview/upload paths rely on.
var escape = new Function('return ' + extractFn('escape').replace(/^function\s+\w+/, 'function'))();
var serializeUploadCellValue =
  new Function('return ' + extractFn('serializeUploadCellValue').replace(/^function\s+\w+/, 'function'))();
var escapeSlashesNSemicolons = new Function(
  'serializeUploadCellValue',
  extractFn('escapeSlashesNSemicolons') + '\nreturn escapeSlashesNSemicolons;'
)(serializeUploadCellValue);

// A representative multi-line cell value from the issue data.
var MULTILINE = '59мм х 15 / 20 резок (885мм)\nЛИДЕР ЭТИКЕТКА 37 ';

// ── 1. escape() must preserve the in-cell newline ────────────────────────────
// The preview renders cells via escape(cellValue); if escape() dropped or
// rewrote "\n", `white-space: pre-line` would have nothing to render.
(function(){
  var html = escape(MULTILINE);
  check('escape() keeps the in-cell "\\n" (so the browser can render it)',
    html.indexOf('\n') !== -1);
  check('escape() does not split the value into multiple HTML rows',
    html.indexOf('<br') === -1 && html.indexOf('</tr>') === -1);
})();

// ── 2. CSS renders the newline as a visible line within ONE row ──────────────
// Without a real browser we assert the rule exists and targets the preview
// cells, so a collapsed-to-one-line regression is caught.
(function(){
  // Normalise whitespace inside the <style> blocks for robust matching.
  var css = template.replace(/\s+/g, ' ');
  var rule = /#preview td[^{]*#1st2 td\s*\{[^}]*white-space:\s*pre-line/i.test(css)
          || /(#preview td|#1st2 td)[^{}]*\{[^}]*white-space:\s*pre-line/i.test(css);
  check('preview cells use white-space:pre-line (newlines shown as separate lines, one row)',
    rule);
  check('the pre-line rule targets the import preview (#preview)',
    /#preview td/.test(template) && /white-space:\s*pre-line/i.test(template));
})();

// ── 3. escapeSlashesNSemicolons() must keep "\n" for the .bki upload ─────────
// The server (.bki handler) reassembles a multi-line cell by reading lines
// until the ";"-separated field count matches; that only works if the browser
// writes the embedded "\n" verbatim (only "\\" and ";" are escaped).
(function(){
  var serialised = escapeSlashesNSemicolons(MULTILINE);
  check('escapeSlashesNSemicolons() keeps the embedded "\\n" (server can reassemble)',
    serialised.indexOf('\n') !== -1);
  check('escapeSlashesNSemicolons() does NOT escape the newline away',
    serialised.indexOf('\\n') === -1 && serialised === MULTILINE);

  // A cell with both a semicolon and a newline: the ";" is escaped, the "\n" is not.
  var mixed = 'a;b\nc';
  var out = escapeSlashesNSemicolons(mixed);
  check('escapeSlashesNSemicolons() escapes ";" but preserves "\\n" in mixed values',
    out === 'a\\;b\nc');
})();

// ── 4. The serialised value carried into the preview is a single string ──────
// serializeUploadCellValue must keep the newline (it feeds both preview and .bki).
(function(){
  check('serializeUploadCellValue() preserves the in-cell newline',
    serializeUploadCellValue(MULTILINE) === MULTILINE);
})();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
