'use strict';

const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/dash.js', 'utf8');
const css = fs.readFileSync('css/dash.css', 'utf8');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function extractFunction(name) {
    const marker = 'function ' + name + '(';
    const start = source.indexOf(marker);
    if (start === -1) throw new Error('Missing function ' + name);

    const braceStart = source.indexOf('{', start);
    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') depth--;
        if (depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('Unclosed function ' + name);
}

assert(source.includes('json[i].panelNotes'), 'dashboard model parser must read panelNotes from model rows');
assert(source.includes('f-panel-notes'), 'dashboard panels must include a notes container');
assert(css.includes('.f-panel-notes'), 'dashboard notes must have dedicated styling');
assert(/\.f-panel-notes\s*\{[^}]*margin-bottom:\s*1rem;/.test(css), 'dashboard notes must leave a 1rem margin below');

const code = `
${extractFunction('dashEscapeHtml')}
${extractFunction('dashMarkdownInline')}
${extractFunction('dashMarkdownToHtml')}
${extractFunction('dashSetPanelNotes')}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

var notesEl = { innerHTML: '', style: { display: 'none' } };
var panelEl = {
    querySelector(selector) {
        return selector === '.f-panel-notes' ? notesEl : null;
    }
};

dashSetPanelNotes(panelEl, '* мультипликатор по **последней** сделке');
assert(notesEl.style.display === '', 'non-empty panel notes must be visible');
assert(
    notesEl.innerHTML === '<ul><li>мультипликатор по <strong>последней</strong> сделке</li></ul>',
    'panelNotes markdown list must be converted to HTML'
);

dashSetPanelNotes(panelEl, '\\\\* мультипликатор по последней сделке');
assert(
    notesEl.innerHTML === '<p>* мультипликатор по последней сделке</p>',
    'escaped leading markdown marker must render as literal text without a backslash'
);

dashSetPanelNotes(panelEl, 'Перед <script>alert(1)</script>\\n\\n* [ссылка](https://example.com/?a=1&b=2)');
assert(!notesEl.innerHTML.includes('<script>'), 'panel notes must escape raw HTML');
assert(notesEl.innerHTML.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'escaped HTML must remain readable');
assert(
    notesEl.innerHTML.includes('<a href="https://example.com/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">ссылка</a>'),
    'markdown links must render as safe links'
);

dashSetPanelNotes(panelEl, '   ');
assert(notesEl.style.display === 'none', 'blank panel notes must be hidden');
assert(notesEl.innerHTML === '', 'blank panel notes must clear previous content');
`;

vm.runInNewContext(code, { console });
console.log('issue-2328 dashboard panel notes: ok');
