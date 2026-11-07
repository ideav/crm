// Мерка к issue #5447: панель модерации шаблонов баз (js/db-templates.js, #5364) в новом ЛК
// базы my (#5420) рисуется без оформления. Панель строится настоящим initCabinet на мини-DOM
// внутри <main class="cabinet-content mc-content"> (как в templates/my/main.html), затем для
// каждого элемента панели ищется правило css/my-cabinet.css, селектор которого его выбирает.
// Бутстрапа (table, btn) в ЛК нет — элемент без своего правила остаётся голым.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let failures = 0;
function check(name, fn) {
    return Promise.resolve().then(fn)
        .then(() => console.log('PASS: ' + name))
        .catch(e => { failures++; console.log('FAIL: ' + name + ' — ' + e.message); });
}

// --- мини-DOM: ровно то, чем пользуется db-templates.js ---
function Node(tag) {
    this.tagName = tag.toLowerCase();
    this.attrs = {};
    this.children = [];
    this.parent = null;
    this.style = {};
    this._text = '';
}
Node.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
Node.prototype.appendChild = function (c) { c.parent = this; this.children.push(c); return c; };
Node.prototype.addEventListener = function () {};
Object.defineProperty(Node.prototype, 'textContent', {
    get() { return this._text; },
    set(v) { this.children = []; this._text = String(v); },
});
Node.prototype.classes = function () { return (this.attrs.class || '').split(/\s+/).filter(Boolean); };
function walk(n, out) { out.push(n); n.children.forEach(c => walk(c, out)); return out; }

global.document = { createElement: t => new Node(t) };
const T = require('../js/db-templates.js');

// --- селекторы: тег, классы, потомок/ребёнок; псевдоклассы не сужают выбор ---
function compound(s) {
    s = s.replace(/::?[\w-]+(\([^)]*\))?/g, '');
    const m = s.match(/^([a-z0-9*]*)((?:\.[\w-]+)*)$/i);
    if (!m || (!m[1] && !m[2])) return null; // :root, атрибутные и прочие селекторы здесь не в счёт
    return { tag: m[1] && m[1] !== '*' ? m[1].toLowerCase() : '', cls: m[2].split('.').filter(Boolean) };
}
function matchesCompound(n, c) {
    if (!n || !n.tagName) return false;
    if (c.tag && c.tag !== n.tagName) return false;
    const have = n.classes();
    return c.cls.every(x => have.includes(x));
}
function matches(n, sel) {
    const toks = sel.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
    const parts = []; // [{c, comb}] справа налево
    for (let i = toks.length - 1; i >= 0; i--) {
        if (toks[i] === '>') continue;
        const c = compound(toks[i]);
        if (!c) return false;
        parts.push({ c, child: toks[i - 1] === '>' });
    }
    if (!matchesCompound(n, parts[0].c)) return false;
    let cur = n;
    for (let i = 1; i < parts.length; i++) {
        const viaChild = parts[i - 1].child;
        let p = cur.parent;
        if (viaChild) { if (!matchesCompound(p, parts[i].c)) return false; cur = p; continue; }
        while (p && !matchesCompound(p, parts[i].c)) p = p.parent;
        if (!p) return false;
        cur = p;
    }
    return true;
}
const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'my-cabinet.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const selectors = [];
// правило только для состояния (:hover, :focus…) базового вида элементу не даёт
css.replace(/([^{}]+)\{[^{}]*\}/g, (_, sel) => {
    sel.split(',').map(s => s.trim()).filter(s => s && !/:(hover|focus|active|disabled)\b/.test(s)).forEach(s => selectors.push(s));
});

function styledBy(n) { return selectors.filter(s => matches(n, s)); }

(async () => {
    const list = [
        { id: 'cm', title: 'Сопоставление каталогов', ver: 1, source: 'cm', author: '',
          versions: [{ ver: 1, status: 'approved', created: '2026-11-02 11:34:37', note: 'перевод cm на реестр (#5364)' },
                     { ver: 2, status: 'pending', created: '2026-11-06 10:00:00', note: '' }] },
    ];
    global.fetch = () => Promise.resolve({ json: () => ({ templates: list, moderator: 1 }) });

    const mainEl = new Node('main'); mainEl.setAttribute('class', 'cabinet-content mc-content');
    const section = mainEl.appendChild(new Node('section')); section.setAttribute('class', 'cabinet-section');
    const panel = section.appendChild(new Node('div')); panel.setAttribute('class', 'tpl-moderation mc-card');
    await T.initCabinet({ base: 'https://ideav.ru/my', xsrf: 'x', panel });

    const els = walk(panel, []).slice(1);
    const kinds = ['h3', 'input', 'table', 'th', 'td', 'button'];

    await check('панель модерации построена: заголовок, поле, таблица, кнопки', () => {
        for (const k of kinds) assert.ok(els.some(e => e.tagName === k), 'нет <' + k + '>');
    });

    await check('каждый элемент панели оформлен правилом my-cabinet.css (#5447)', () => {
        const bare = els.filter(e => kinds.includes(e.tagName) && !styledBy(e).length)
            .map(e => '<' + e.tagName + (e.classes().length ? ' .' + e.classes().join('.') : '') + '>');
        assert.deepStrictEqual([...new Set(bare)], []);
    });

    await check('правила панели не задевают таблицы остального ЛК', () => {
        const other = mainEl.appendChild(new Node('table')); other.setAttribute('class', 'data-table');
        assert.ok(!styledBy(other).some(s => /tpl-moderation/.test(s)));
    });

    if (failures) { console.log('\n' + failures + ' FAIL'); process.exit(1); }
    console.log('\nall PASS');
})();
