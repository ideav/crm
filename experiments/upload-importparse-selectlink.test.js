// Regression test for issue #3306 / #3304.
//
// `#selectLink` is commented out in templates/upload.html (it has been since the
// file was created). When importParse() runs with an empty #input and no file
// selected — exactly the state reached while restoring a saved upload set via
// setAutoParent() — it falls through to `$('#selectLink').val().length`.
// jQuery's .val() on an empty set returns `undefined`, so reading `.length`
// throws "Cannot read properties of undefined (reading 'length')". That crash
// aborts the `case 'type'` handler before the #createParent checkbox is
// restored (issue #3304) and surfaces as the console error in issue #3306.
//
// This test extracts the real importParse() source from the template and runs
// it under a tiny jQuery shim that reproduces the relevant semantics.

var fs = require('fs');
var path = require('path');

var passed = 0, failed = 0;
function check(name, ok){
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
  if (ok) passed++; else { failed++; process.exitCode = 1; }
}

// ── Extract the real importParse() source from the template ──────────────────
var template = fs.readFileSync(path.join(__dirname, '..', 'templates', 'upload.html'), 'utf8');
var start = template.indexOf('function importParse(){');
if (start < 0) throw new Error('importParse() not found in template');
// Walk braces to find the matching close of the function body.
var depth = 0, end = -1;
for (var i = template.indexOf('{', start); i < template.length; i++) {
  if (template[i] === '{') depth++;
  else if (template[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
var importParseSrc = template.slice(start, end);

// ── Confirm the precondition: #selectLink is NOT a live element ───────────────
check('#selectLink is commented out in the template (no live input)',
  /<!--[\s\S]*id="selectLink"[\s\S]*-->/.test(template) &&
  !/<input[^>]*id="selectLink"[^>]*>(?![\s\S]*-->)/.test(template.replace(/<!--[\s\S]*?-->/g, '')));

// ── Minimal jQuery shim reproducing the semantics importParse() relies on ─────
// Known element ids resolve to a node; unknown ids resolve to an empty set
// whose .val() returns undefined (this is real jQuery behaviour).
function makeShim(present){
  return function $(sel){
    var id = sel.charAt(0) === '#' ? sel.slice(1) : null;
    var exists = id && Object.prototype.hasOwnProperty.call(present, id);
    return {
      val: function(){ return exists ? present[id] : undefined; },
      hide: function(){ return this; },
      prop: function(){ return this; }
    };
  };
}

function runImportParse(present){
  var $ = makeShim(present);
  var documentStub = {
    getElementById: function(id){
      // #selectFiles exists as a real <input type=file>, with an empty FileList.
      if (id === 'selectFiles') return { files: present.__files || [] };
      return null;
    }
  };
  function parseUploadText(){ /* stubbed: only called when #input has text */ }
  function importDoParse(){}
  function FileReader(){ this.readAsText = function(){}; }
  var factory = new Function(
    '$', 'document', 'parseUploadText', 'importDoParse', 'FileReader',
    importParseSrc + '\nreturn importParse;'
  );
  var importParse = factory($, documentStub, parseUploadText, importDoParse, FileReader);
  return importParse();
}

// ── The bug reproduction / fix verification ──────────────────────────────────
// State while restoring a saved set: #input empty, no file chosen, #selectLink absent.
var threw = null, result;
try {
  result = runImportParse({ input: '', delim: ',', caret: '\n', encoding: 'utf-8', __files: [] });
} catch (e) {
  threw = e;
}

check('importParse() does not throw when #input is empty and #selectLink is absent',
  threw === null);
if (threw) console.log('  threw:', threw && threw.message);
check('importParse() returns false (nothing to parse) instead of crashing',
  threw === null && result === false);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
