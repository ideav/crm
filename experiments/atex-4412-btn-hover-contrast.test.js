// Tests for ideav/crm#4412 — «Дефект кнопки Отклонения on hover».
// Под курсором красная кнопка «Отклонения N/M» становилась почти белой, а текст у неё белый
// (.atex-pp-btn-danger color:#fff) → подпись исчезала, кнопка выглядела отключённой.
// Причина: базовое `.atex-pp-btn:hover { background: var(--pp-surface) }` имеет ту же силу
// (класс + псевдокласс), что и `.atex-pp-btn-danger`, и бьёт его фон; собственный
// `.atex-pp-btn-danger:hover` переопределял только `filter`, но не `background`.
// Покрываем:
//   1) ИНВАРИАНТ: каждый цветной модификатор `.atex-pp-btn-*` (свой background) обязан
//      переопределить background и в своём `:hover` — иначе базовый серый фон подменит его;
//   2) `.atex-pp-btn-danger:hover` красный (var(--pp-warn)) и текст белый — подпись читается;
//   3) кнопка «Отклонения» в JS действительно несёт класс .atex-pp-btn-danger (связь JS↔CSS);
//   4) подсказка кнопки — КОРОТКИЕ строки (#4412: одной длинной строкой она уезжала за край окна).
//
// Run with: node experiments/atex-4412-btn-hover-contrast.test.js

process.env.TZ = 'UTC';

var fs = require('fs');
var path = require('path');

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

var cssPath = path.join(__dirname, '..', 'download', 'atex', 'css', 'production-planning.css');
var css = fs.readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
var ctrlPath = path.join(__dirname, '..', 'download', 'atex', 'js', 'production-planning', '20-controller.js');
var ctrl = fs.readFileSync(ctrlPath, 'utf8');

// селектор → объединённые объявления (правил на селектор может быть несколько)
var rules = {};
css.replace(/([^{}]+)\{([^}]*)\}/g, function(m, sel, body) {
    sel.split(',').map(function(s) { return s.trim(); }).forEach(function(s) {
        rules[s] = (rules[s] || '') + ';' + body;
    });
    return m;
});
function decl(sel, prop) {
    var body = rules[sel];
    if (!body) return null;
    var re = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'g');
    var last = null, m;
    while ((m = re.exec(body))) last = m[1].trim();
    return last;
}

// ── 1) Инвариант: цветной модификатор обязан держать свой фон и под курсором ──
(function () {
    assert(!!decl('.atex-pp-btn:hover', 'background'),
        'базовая кнопка перекрашивается под курсором (иначе тест бессмысленен)');

    var modifiers = Object.keys(rules).filter(function(sel) {
        return /^\.atex-pp-btn-[a-z-]+$/.test(sel) && decl(sel, 'background');
    });
    assert(modifiers.length >= 3, 'цветных модификаторов кнопки несколько: ' + modifiers.join(', '));

    var broken = modifiers.filter(function(sel) { return !decl(sel + ':hover', 'background'); });
    assertEqual(broken, [],
        'у КАЖДОГО модификатора свой фон в :hover (иначе базовый серый подменит его — #4412)');
})();

// ── 2) «Отклонения»: под курсором красная и с белым текстом ──────────────────
(function () {
    assert(/--pp-warn/.test(decl('.atex-pp-btn-danger', 'background') || ''),
        'в покое кнопка «Отклонения» красная (var(--pp-warn))');
    assert(/--pp-warn/.test(decl('.atex-pp-btn-danger:hover', 'background') || ''),
        'под курсором она ОСТАЁТСЯ красной, а не становится светло-серой');
    var hoverColor = (decl('.atex-pp-btn-danger:hover', 'color') || decl('.atex-pp-btn-danger', 'color') || '').toLowerCase();
    assert(hoverColor === '#fff' || hoverColor === '#ffffff' || hoverColor === 'white',
        'текст под курсором белый — на красном он читается');
    assert(/brightness/.test(decl('.atex-pp-btn-danger:hover', 'filter') || ''),
        'наведение по-прежнему заметно (кнопка чуть темнее)');
})();

// ── 3) Связь JS ↔ CSS: кнопка действительно несёт класс модификатора ────────
(function () {
    assert(/atex-pp-btn atex-pp-btn-danger atex-pp-dev-btn/.test(ctrl),
        'кнопка «Отклонения» создаётся с классом .atex-pp-btn-danger');
})();

// ── 4) Подсказка не уезжает за край окна: короткие строки ───────────────────
(function () {
    var m = /this\.devBtn\.title\s*=\s*([\s\S]*?);\n/.exec(ctrl);
    assert(!!m, 'подсказка кнопки «Отклонения» задаётся в updateDeviationsButton');
    var literal = (m ? m[1] : '');
    // Текст подсказки собираем из САМИХ строковых литералов выражения: числа и условные куски
    // («+ (st.k ? … : '')», с #4596 таких два) на длину фраз не влияют, а разбор кода —
    // на структуру подсказки. Иначе тест мерил бы длину строк ИСХОДНИКА, а не подсказки.
    var text = (literal.match(/'(?:[^'\\]|\\.)*'/g) || []).map(function(s) {
        return s.slice(1, -1);
    }).join('').replace(/\\n/g, '\n');
    var lines = text.split('\n');
    assert(lines.length >= 3, 'подсказка разбита на строки (перевод строки в title браузер уважает)');
    var longLines = lines.filter(function(s) { return s.length > 70; });
    assertEqual(longLines, [],
        'ни одной строки длиннее 70 символов — подсказка у правого края окна не обрезается (#4412)');
    assert(/Просрочено/.test(text) && /досрочно/.test(text) && /урегулировать/.test(text),
        'смысл подсказки сохранён: просрочено, выполнено досрочно, что делать');
})();

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' passed');
});
