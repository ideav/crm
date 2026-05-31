const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(repo, rel), 'utf8');
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

const templates = [
    'templates/main.html',
    'templates/atex/main.html',
    'templates/sportzania/main.html',
];

for (const rel of templates) {
    const html = read(rel);
    const brandBgRuleMatch = html.match(/body\.brand-bg-on\s*\{([\s\S]*?)\}/);

    assert(brandBgRuleMatch, rel + ' has a body.brand-bg-on rule');
    assert(
        !/--text-(primary|secondary)\s*:/.test(brandBgRuleMatch[1]),
        rel + ' must not override global light/dark theme text tokens in brand-bg styles'
    );
    assert(
        /--brand-bg-text-primary\s*:/.test(brandBgRuleMatch[1]) &&
        /--brand-bg-text-secondary\s*:/.test(brandBgRuleMatch[1]),
        rel + ' defines separate brand background text tokens'
    );
    assert(
        /body\.brand-bg-on \.navbar[\s\S]*body\.brand-bg-on \.app-sidebar[\s\S]*color:\s*var\(--brand-bg-text-primary\)/.test(html),
        rel + ' scopes brand background text color to navbar/sidebar chrome'
    );
}

const brandCssFiles = [
    'download/atex/css/brand.css',
    'download/atex/css/atex-brand.css',
];

for (const rel of brandCssFiles) {
    const css = read(rel);

    assert(
        !/--(?:bg|text|card|input|border|nav|button)-/.test(css),
        rel + ' must keep brand variables separate from app theme variables'
    );
    assert(
        !/\[data-theme=/.test(css),
        rel + ' must not define light/dark theme overrides'
    );
}

console.log('issue 2996 brand/theme isolation checks passed');
