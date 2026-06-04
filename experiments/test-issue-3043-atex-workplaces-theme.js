/*
 * Regression test for issue #3043.
 *
 * Atex workplaces render inside templates/atex/main.html, so generated
 * workplace CSS must not pin light surfaces or neutral text colors as final
 * values. Use the shared theme tokens from css/styles.css, or local variables
 * with explicit dark-theme overrides for semantic statuses.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const cssDir = path.join(root, 'download', 'atex', 'css');

const cssFiles = fs.readdirSync(cssDir)
    .filter((name) => name.endsWith('.css'))
    .filter((name) => !['atex-brand.css', 'brand.css'].includes(name))
    .sort();

const surfaceHexes = new Set([
    '#ffffff', '#f8fafc', '#f1f5f9', '#fbfcfe', '#fafbfc', '#f6fdf8',
    '#f2fbf4', '#f5f9fc', '#eef2f7', '#eef1f5', '#e6eaf0', '#e2e8f0',
    '#d9dee5', '#cbd5e1', '#dee2e6', '#ced4da',
    '#e0ecff', '#eff6ff', '#ecfdf5', '#fef2f2', '#fef9c3', '#ede9fe',
    '#e0f2fe', '#dcfce7', '#dbeafe', '#d1fae5', '#bbf7d0', '#bfdbfe',
    '#fecaca', '#86efac'
]);

const neutralTextHexes = new Set([
    '#1f2933', '#111827', '#374151', '#475569', '#64748b', '#6b7280',
    '#94a3b8', '#334155', '#1e40af', '#047857', '#b91c1c', '#854d0e',
    '#5b21b6', '#0369a1', '#3730a3', '#166534'
]);

function normalizeHex(value) {
    const lower = value.toLowerCase();
    if (lower.length === 4) {
        return '#' + lower[1] + lower[1] + lower[2] + lower[2] + lower[3] + lower[3];
    }
    return lower;
}

function sensitiveHexes(value, includeSurfaces, includeText) {
    const matches = value.match(/#[0-9a-fA-F]{3,6}\b/g) || [];
    return matches
        .map(normalizeHex)
        .filter((hex) => (includeSurfaces && surfaceHexes.has(hex)) || (includeText && neutralTextHexes.has(hex)));
}

function parseDeclarations(source) {
    const cleanSource = source.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [];
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let match;
    while ((match = ruleRe.exec(cleanSource))) {
        const selectors = match[1].split(',').map((item) => item.trim()).filter(Boolean);
        const declarations = {};
        match[2].split(';').forEach((chunk) => {
            const idx = chunk.indexOf(':');
            if (idx === -1) return;
            const prop = chunk.slice(0, idx).trim();
            const value = chunk.slice(idx + 1).trim();
            if (prop && value) declarations[prop] = value;
        });
        const line = cleanSource.slice(0, match.index).split('\n').length;
        rules.push({ selectors, declarations, line });
    }
    return rules;
}

function hasThemeVariable(value) {
    return /var\(\s*--/.test(value);
}

function declarationsFor(rules, selector) {
    return rules
        .filter((rule) => rule.selectors.includes(selector))
        .map((rule) => rule.declarations)
        .reduce((acc, declarations) => Object.assign(acc, declarations), {});
}

function hasDarkOverride(rules, selector, prop) {
    return Boolean(declarationsFor(rules, '[data-theme="dark"] ' + selector)[prop]);
}

function shouldCheckProperty(prop) {
    return prop === 'background' ||
        prop === 'background-color' ||
        prop === 'color' ||
        prop.indexOf('border') !== -1 ||
        prop.startsWith('--');
}

const failures = [];

cssFiles.forEach((file) => {
    const cssPath = path.join(cssDir, file);
    const source = fs.readFileSync(cssPath, 'utf8');
    const rules = parseDeclarations(source);

    rules.forEach((rule) => {
        rule.selectors.forEach((selector) => {
            Object.entries(rule.declarations).forEach(([prop, value]) => {
                if (!shouldCheckProperty(prop) || hasThemeVariable(value)) return;
                if (selector.startsWith('[data-theme="dark"] ')) return;

                const checkSurface = prop !== 'color';
                const checkText = prop === 'color' || prop.startsWith('--');
                const hexes = sensitiveHexes(value, checkSurface, checkText);
                if (hexes.length === 0) return;

                if (prop.startsWith('--') && hasDarkOverride(rules, selector, prop)) return;

                failures.push(file + ':' + rule.line + ' ' + selector + ' ' + prop + ': ' + value);
            });
        });
    });
});

assert.strictEqual(
    failures.length,
    0,
    'Atex workplace CSS must use theme tokens or dark overrides for theme-sensitive colors:\n' +
        failures.slice(0, 120).join('\n')
);

console.log('issue-3043 atex workplace theme checks: ok');
