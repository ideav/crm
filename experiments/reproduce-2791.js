// Reproduce bug from issue #2791
// JavaScript .replace() interprets $ patterns in REPLACEMENT strings:
//   $$ → $
//   $& → matched substring
//   $` → portion BEFORE the match
//   $' → portion AFTER the match
//   $n → captured group

// Simulated template (innerHTML of div#template101)
var template = '\n        <label class="control-label" for="t101_42">\n            <i class="pi pi-pencil"></i>\n        </label>\n        <!--Expression-->\n\t\t<input type="text" name="t101" id="t101_42" class="form-control form-control-sm save-input" value="">\n\t';

// User input from issue 2791 (simplified to last lines)
var userValue = "REGEXP_REPLACE(x,'^,|,$', '')";

console.log("=== INPUT ===");
console.log(JSON.stringify(userValue));

// This is the buggy line from templates/sql.html:843
var result = template.replace('value=""', 'value="' + userValue + '" title="' + userValue + '"');
console.log("\n=== OUTPUT (with bug) ===");
console.log(result);

// Extract just the value attribute back to see corruption
var m = result.match(/value="([^"]*)"/);
console.log("\n=== Recovered value (from value attribute) ===");
console.log(JSON.stringify(m && m[1]));

// Compare original vs recovered
console.log("\n=== Match? ===", m && m[1] === userValue);

// Now demonstrate the fix using function-as-replacement (no $ substitution)
var fixed = template.replace('value=""', function () {
    return 'value="' + userValue + '" title="' + userValue + '"';
});
var m2 = fixed.match(/value="([^"]*)"/);
console.log("\n=== FIXED Recovered value ===");
console.log(JSON.stringify(m2 && m2[1]));
console.log("=== FIXED Match? ===", m2 && m2[1] === userValue);
