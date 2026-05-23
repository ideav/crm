// End-to-end verification: simulate the actual code path from templates/sql.html
// after the fix, with the exact user input from issue #2791.

// Simulated getReq() from templates/sql.html:643-648 (escapes " to &quot;)
function getReq(id, r, mockValue) {
    if (mockValue === undefined) return '';
    return mockValue.replace(/"/gm, '&quot;');
}

// Simulated innerHTML of div#template101 (used for t101 Expression filter)
var template101innerHTML = '\n        <label class="control-label" for="t101_:id:">\n            <i class="pi pi-pencil"></i>\n        </label>\n        <!--Expression-->\n\t\t<input type="text" name="t101" id="t101_:id:" class="form-control form-control-sm save-input" value="">\n\t';

// Exact value from issue #2791
var userValue = `CONCAT('[',
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                REGEXP_REPLACE(
                  Наименование,
                  '[™№#"\\'«»]', ''),
                '(^| )(для|за|под|без|не|в|к|от|с|на|и)( |$)', ' '),
              '([0-9])([A-Za-zА-Яа-я])', '$1,$2'),
            '([A-Za-zА-Яа-я])([0-9])', '$1,$2'),
          '[^a-zA-Z0-9а-яА-Я]+', ','),
        ',,+', ','),
      '^,|,$', ''),
    ']')`;

var id = 42;
var ctlk = 101;

// === Reproduce the original buggy code ===
var control = template101innerHTML.replace(/:t:/g, ctlk).replace(/:id:/g, id);
var buggy = control.replace('value=""',
    'value="' + getReq(id, ctlk, userValue).replace(/"/g, '\"') + '" title="' +
    getReq(id, ctlk, userValue).replace(/"/g, '\"') + '"');
var buggyValueMatch = buggy.match(/value="([^"]*)"/);
var buggyValue = buggyValueMatch ? buggyValueMatch[1].replace(/&quot;/g, '"') : null;

// === Reproduce the FIXED code ===
var control2 = template101innerHTML.replace(/:t:/g, ctlk).replace(/:id:/g, id);
var v = getReq(id, ctlk, userValue);
var fixed = control2.replace('value=""', function () {
    return 'value="' + v + '" title="' + v + '"';
});
var fixedValueMatch = fixed.match(/value="([^"]*)"/);
var fixedValue = fixedValueMatch ? fixedValueMatch[1].replace(/&quot;/g, '"') : null;

console.log('Original user value contains $1, $2, and ^,|,$\' patterns.');
console.log('');
console.log('--- BUGGY behaviour ---');
console.log('Matches original?', buggyValue === userValue);
if (buggyValue !== userValue) {
    // Show the diverging tail (the part that got corrupted)
    var idx = 0;
    while (idx < userValue.length && idx < buggyValue.length && userValue[idx] === buggyValue[idx]) idx++;
    console.log('Diverges at char', idx);
    console.log('Expected tail:', JSON.stringify(userValue.slice(idx, idx + 30)));
    console.log('Got tail:     ', JSON.stringify(buggyValue.slice(idx, idx + 30)));
}

console.log('');
console.log('--- FIXED behaviour ---');
console.log('Matches original?', fixedValue === userValue);
if (fixedValue !== userValue) {
    var idx = 0;
    while (idx < userValue.length && idx < fixedValue.length && userValue[idx] === fixedValue[idx]) idx++;
    console.log('Diverges at char', idx);
    console.log('Expected tail:', JSON.stringify(userValue.slice(idx, idx + 30)));
    console.log('Got tail:     ', JSON.stringify(fixedValue.slice(idx, idx + 30)));
}
