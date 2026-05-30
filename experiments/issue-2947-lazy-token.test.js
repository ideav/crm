// Structural regression test for issue #2947:
// hasValidAuthToken must be called lazily, only inside _ensureCaptchaBypass,
// never eagerly in App.init().
//
// Tests verified against js/app.js source text:
// 1. hasValidAuthToken() is called exactly once (excluding its own definition),
//    and that call is inside _ensureCaptchaBypass.
// 2. _ensureCaptchaBypass is async and memoizes via _captchaBypassChecked.
// 3. _initCaptchaWidgets is async and awaits _ensureCaptchaBypass.
// 4. The login submit handler awaits _ensureCaptchaBypass before the captcha gate.
// 5. The register submit handler awaits _ensureCaptchaBypass before the captcha gate.
// 6. init() does NOT call hasValidAuthToken directly.
//
// Run with: node experiments/issue-2947-lazy-token.test.js

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const lines = src.split('\n');

let failures = 0;
function assert(cond, name, detail) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (!cond) { failures++; if (detail) console.log('  ', detail); }
}

// Helper: find all 1-based line numbers where pattern matches.
function findLines(pattern) {
    return lines.reduce((acc, line, i) => {
        if (pattern.test(line)) acc.push(i + 1);
        return acc;
    }, []);
}

// Helper: extract the source slice from the line where `defPattern` first
// matches to the end of that block (tracking brace depth).
function extractBlock(defPattern) {
    const start = lines.findIndex(l => defPattern.test(l));
    if (start === -1) return null;
    let depth = 0;
    const body = [];
    for (let i = start; i < lines.length; i++) {
        depth += (lines[i].match(/\{/g) || []).length;
        depth -= (lines[i].match(/\}/g) || []).length;
        body.push(lines[i]);
        if (depth === 0 && i > start) break;
    }
    return body.join('\n');
}

// 1. hasValidAuthToken calls (not counting the function definition line itself):
//    must appear exactly once, inside _ensureCaptchaBypass.
{
    // Lines that call hasValidAuthToken (exclude the "async function hasValidAuthToken" definition line).
    const callLines = findLines(/hasValidAuthToken\s*\(/)
        .filter(ln => !/^\s*(async\s+)?function\s+hasValidAuthToken\s*\(/.test(lines[ln - 1]));

    assert(callLines.length === 1,
        'hasValidAuthToken() called exactly once (excluding its own definition)',
        'found at lines: ' + callLines.join(', '));

    const ensureBody = extractBlock(/async\s+_ensureCaptchaBypass\s*\(/);
    const inEnsure = ensureBody && /hasValidAuthToken\s*\(/.test(ensureBody);
    assert(!!inEnsure,
        'hasValidAuthToken() is called inside _ensureCaptchaBypass');
}

// 2. _ensureCaptchaBypass: async, memoizes via _captchaBypassChecked.
{
    const defLines = findLines(/async\s+_ensureCaptchaBypass\s*\(/);
    assert(defLines.length === 1,
        '_ensureCaptchaBypass is defined as async',
        'found at lines: ' + defLines.join(', '));

    const body = extractBlock(/async\s+_ensureCaptchaBypass\s*\(/);
    assert(body && /this\._captchaBypassChecked/.test(body),
        '_ensureCaptchaBypass reads/writes _captchaBypassChecked for memoization');
}

// 3. _initCaptchaWidgets: async, awaits _ensureCaptchaBypass.
{
    const defLines = findLines(/async\s+_initCaptchaWidgets\s*\(/);
    assert(defLines.length === 1,
        '_initCaptchaWidgets is defined as async',
        'found at lines: ' + defLines.join(', '));

    const body = extractBlock(/async\s+_initCaptchaWidgets\s*\(/);
    assert(body && /await\s+this\._ensureCaptchaBypass\s*\(/.test(body),
        '_initCaptchaWidgets awaits _ensureCaptchaBypass');
}

// 4. Login submit handler awaits _ensureCaptchaBypass before the captcha gate.
//    Locate getCaptchaToken('login-captcha-container') then check the next few lines.
{
    const captchaGetIdx = lines.findIndex(l => /getCaptchaToken\('login-captcha-container'\)/.test(l));
    assert(captchaGetIdx !== -1, 'login submit: getCaptchaToken call found');

    if (captchaGetIdx !== -1) {
        const snippet = lines.slice(captchaGetIdx, captchaGetIdx + 5).join('\n');
        assert(/await\s+this\._ensureCaptchaBypass\s*\(/.test(snippet),
            'login submit: await _ensureCaptchaBypass appears right after getCaptchaToken');
    }
}

// 5. Register submit handler awaits _ensureCaptchaBypass before the captcha gate.
{
    const captchaGetIdx = lines.findIndex(l => /getCaptchaToken\('register-captcha-container'\)/.test(l));
    assert(captchaGetIdx !== -1, 'register submit: getCaptchaToken call found');

    if (captchaGetIdx !== -1) {
        const snippet = lines.slice(captchaGetIdx, captchaGetIdx + 5).join('\n');
        assert(/await\s+this\._ensureCaptchaBypass\s*\(/.test(snippet),
            'register submit: await _ensureCaptchaBypass appears right after getCaptchaToken');
    }
}

// 6. init() does NOT call hasValidAuthToken directly.
{
    const initBody = extractBlock(/^\s*async\s+init\s*\(/);
    assert(initBody && !/hasValidAuthToken\s*\(/.test(initBody),
        'init() does not call hasValidAuthToken directly');
}

console.log('\n' + (failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
