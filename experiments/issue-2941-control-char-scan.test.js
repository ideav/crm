// Regression guard for issue #2941.
//
// A stray ESC byte (0x1B) had crept into index.php line 9921, turning the array
// key `$row["t"]` into `$row["t\x1b"]`. Because the SQL there selects `t, val`,
// the corrupted key resolved to NULL, so the "Link to any table" branch lost the
// referenced object's real type and fed NULL into Check_Val_granted() — a silent
// logic/permission bug invisible in most editors.
//
// This test sweeps the tracked source files for any non-printable control
// character (everything in C0 except tab/newline/carriage-return, plus DEL) so a
// similar invisible corruption can never slip in unnoticed again — answering the
// issue's "is there such a thing in other places?" on every run.
//
// Run with: node experiments/issue-2941-control-char-scan.test.js

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');

// Text source extensions worth scanning. Binary assets (png, fonts, docx) are
// excluded — they legitimately contain control bytes.
const SCAN_EXTENSIONS = ['.php', '.js', '.css', '.html', '.htm', '.sql'];

// Allowed C0 whitespace: tab (0x09), line feed (0x0A), carriage return (0x0D).
const ALLOWED = new Set([0x09, 0x0a, 0x0d]);
function isForbidden(byte) {
    if (ALLOWED.has(byte)) return false;
    return byte < 0x20 || byte === 0x7f; // C0 controls and DEL
}

function trackedFiles() {
    const out = execSync('git ls-files', { cwd: repoRoot, encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
}

function findControlChars(absPath) {
    const buf = fs.readFileSync(absPath);
    const hits = [];
    let line = 1;
    let col = 0;
    for (let i = 0; i < buf.length; i++) {
        const b = buf[i];
        if (b === 0x0a) { line++; col = 0; continue; }
        col++;
        if (isForbidden(b)) {
            hits.push({ line, col, byte: b });
        }
    }
    return hits;
}

let failures = 0;
let scanned = 0;

for (const rel of trackedFiles()) {
    const ext = path.extname(rel).toLowerCase();
    if (!SCAN_EXTENSIONS.includes(ext)) continue;
    scanned++;
    const hits = findControlChars(path.join(repoRoot, rel));
    if (hits.length) {
        failures += hits.length;
        for (const h of hits) {
            console.error(
                `FAIL ${rel}:${h.line}: stray control byte 0x${h.byte.toString(16).padStart(2, '0')} at column ${h.col}`
            );
        }
    }
}

// Targeted assertion: the exact line from the issue must be clean.
const indexPhp = fs.readFileSync(path.join(repoRoot, 'index.php'), 'utf8');
if (indexPhp.includes('$row["t\x1b"]')) {
    console.error('FAIL index.php still contains the corrupted key $row["t\\x1b"]');
    failures++;
}
if (!/\$GLOBALS\["REF_typs"\]\[\$t\] = \$row\["t"\];/.test(indexPhp)) {
    console.error('FAIL expected clean assignment $GLOBALS["REF_typs"][$t] = $row["t"]; not found');
    failures++;
}

if (failures) {
    console.error(`\n${failures} problem(s) found across ${scanned} scanned source file(s).`);
    process.exit(1);
}
console.log(`OK: ${scanned} source file(s) scanned, no stray control characters.`);
