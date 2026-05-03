const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');

function readTemplate(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function getInputById(html, id) {
    const re = new RegExp(`<input\\b[^>]*\\bid="${id}"[^>]*>`, 'i');
    const match = html.match(re);
    assert(match, `expected input #${id}`);
    return match[0];
}

function assertHasAttr(input, attr, expectedValue) {
    const attrRe = new RegExp(`\\b${attr}(?:="([^"]*)")?`, 'i');
    const match = input.match(attrRe);
    assert(match, `expected ${input} to include ${attr}`);
    if (expectedValue !== undefined)
        assert.strictEqual(match[1], expectedValue, `expected ${attr}="${expectedValue}" in ${input}`);
}

function assertChangePasswordInputsAreInert(relativePath) {
    const html = readTemplate(relativePath);
    const oldPwd = getInputById(html, 'old-pwd');
    const newPwd = getInputById(html, 'new-pwd');
    const newAgain = getInputById(html, 'new-again');

    [oldPwd, newPwd, newAgain].forEach(function(input) {
        assertHasAttr(input, 'disabled');
    });
    assertHasAttr(oldPwd, 'autocomplete', 'current-password');
    assertHasAttr(newPwd, 'autocomplete', 'new-password');
    assertHasAttr(newAgain, 'autocomplete', 'new-password');
    assert(
        html.includes('function openChangePasswordForm()'),
        `expected ${relativePath} to expose openChangePasswordForm()`
    );
    assert(
        html.includes('function closeChangePasswordForm()'),
        `expected ${relativePath} to expose closeChangePasswordForm()`
    );
    assert(
        /onclick="openChangePasswordForm\(\);?"/.test(html),
        `expected ${relativePath} change-password button to enable the inert fields`
    );
    assert(
        /onclick="closeChangePasswordForm\(\);?"/.test(html),
        `expected ${relativePath} close controls to disable the password fields again`
    );
}

function assertFakeCredentialsCannotBeAutofilled(relativePath) {
    const html = readTemplate(relativePath);
    const fakePasswordMatch = html.match(/<input type="password" name="fake_password"[^>]*>/);
    assert(fakePasswordMatch, `expected fake password decoy in ${relativePath}`);
    const fakePassword = fakePasswordMatch[0];

    assertHasAttr(fakePassword, 'readonly');
    assertHasAttr(fakePassword, 'autocomplete', 'off');
    assertHasAttr(fakePassword, 'tabindex', '-1');
}

[
    'templates/main.html',
    'templates/ru/main.html',
    'templates/sportzania/main.html',
    'templates/my/main.html'
].forEach(assertChangePasswordInputsAreInert);

[
    'templates/main.html',
    'templates/sportzania/main.html'
].forEach(assertFakeCredentialsCannotBeAutofilled);

console.log('issue #2342 password-manager trap checks passed');
