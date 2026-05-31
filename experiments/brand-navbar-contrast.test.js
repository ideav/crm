// Brand-agnostic contrast guard for the branded top menu (navbar).
//
// Why this test exists
// --------------------
// Issue #3008 / PR #3009: when a brand repaints the Интеграм navbar with a dark
// brand colour and makes the navbar text/icons light, interactive controls that
// carry their OWN surface from the shared light theme (the AI-chat button, the
// account button and their hover/open states) stayed light. The result was white
// icons and "Admin / Admin" text on a light surface — unreadable. The fix added
// branded surfaces, but nothing stopped the same class of defect from coming back
// for the next control or the next brand.
//
// This test is the "reliable mechanism" requested in issue #3013: it encodes the
// invariant once and applies it automatically to EVERY brand. A brand that recolours
// the navbar (a "dark-header brand") must, for every surface-bearing navbar control,
// set BOTH a branded background and a contrasting text/icon colour — for the resting
// AND the hover state. Never recolour text without recolouring its surface.
//
// The control inventory below mirrors the inventory documented in
// docs/integram-app-workflow.md §4.1.2. Keep the two in sync: whenever the shared
// shell adds a new surface-bearing navbar control, add it here and in the doc.
//
// Run with:
//   node experiments/brand-navbar-contrast.test.js

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function exists(rel) {
    return fs.existsSync(path.join(root, rel));
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function stripComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseRules(css) {
    const rules = [];
    const re = /([^{}]+)\{([^{}]+)\}/g;
    let match;

    while ((match = re.exec(stripComments(css))) !== null) {
        const selectorText = match[1].trim();
        if (!selectorText || selectorText.startsWith('@')) continue;

        rules.push({
            selectors: selectorText.split(',').map((selector) => selector.trim()),
            body: match[2],
        });
    }

    return rules;
}

function declarationsFor(rules, selector) {
    return rules
        .filter((rule) => rule.selectors.includes(selector))
        .map((rule) => rule.body);
}

function hasProperty(rules, selector, property) {
    const propertyPattern = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(^|;|\\s)' + propertyPattern + '\\s*:\\s*[^;]+', 'i');
    return declarationsFor(rules, selector).some((body) => re.test(body));
}

// Navbar controls that paint their own surface in the shared shell
// (css/main-app.css, css/ai-chat.css). Each one, on a dark brand navbar, must be
// re-surfaced by the brand or the shared light surface bleeds through.
//   - .ai-chat-toggle: resting background-color var(--bg-secondary), hover var(--card-bg)
//   - .account-info  : hover background-color var(--border-color)
const SURFACE_BEARING_CONTROLS = [
    '.navbar .ai-chat-toggle',
    '.navbar .account-info',
];

// Discover every brand that ships a navbar override stylesheet.
function discoverBrands() {
    const downloadDir = path.join(root, 'download');
    if (!fs.existsSync(downloadDir)) return [];

    return fs
        .readdirSync(downloadDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => exists(path.join('download', name, 'css', 'brand.css')))
        .map((name) => ({ name, brandCss: path.join('download', name, 'css', 'brand.css') }));
}

// A brand "recolours the navbar" (dark-header brand) when its brand.css sets a
// .navbar background. Only those brands need the contrast guard; brands that leave
// the navbar untouched keep the shared, already-balanced surfaces.
function recoloursNavbar(rules) {
    return hasProperty(rules, '.navbar', 'background-color') ||
        hasProperty(rules, '.navbar', 'background');
}

const brands = discoverBrands();
assert(brands.length > 0, 'expected at least one brand under download/<brand>/css/brand.css');

let checkedBrands = 0;

for (const brand of brands) {
    const rules = parseRules(read(brand.brandCss));

    if (!recoloursNavbar(rules)) {
        console.log('brand "' + brand.name + '" leaves the navbar untouched — contrast guard not required');
        continue;
    }

    checkedBrands += 1;

    for (const control of SURFACE_BEARING_CONTROLS) {
        // Resting state: branded surface + contrasting text/icon colour together.
        assert(
            hasProperty(rules, control, 'background-color') || hasProperty(rules, control, 'background'),
            'brand "' + brand.name + '": ' + control +
                ' must set a branded background so the shared light surface does not bleed through the dark navbar'
        );
        assert(
            hasProperty(rules, control, 'color'),
            'brand "' + brand.name + '": ' + control +
                ' must set a contrasting text/icon colour to match its branded background'
        );

        // Hover state: the surface must not snap back to the shared light token.
        const hover = control + ':hover';
        assert(
            hasProperty(rules, hover, 'background-color') || hasProperty(rules, hover, 'background'),
            'brand "' + brand.name + '": ' + hover +
                ' must keep a branded background on hover (shared hover uses a light theme token)'
        );
        assert(
            hasProperty(rules, hover, 'color'),
            'brand "' + brand.name + '": ' + hover +
                ' must keep a contrasting text/icon colour on hover'
        );
    }

    console.log('brand "' + brand.name + '" passes the navbar contrast guard');
}

assert(checkedBrands > 0, 'no dark-header brand was checked — expected at least one brand recolouring the navbar');

console.log('brand navbar contrast checks passed (' + checkedBrands + ' dark-header brand(s))');
