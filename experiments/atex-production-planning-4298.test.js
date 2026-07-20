// #4298 — «После ручного переноса задания и пересчёта задания отображаются некорректно».
// Симптом: с активным поиском по ширине («110») сразу после переноса+пересчёта станок казался
// ПУСТЫМ (0 совпадений), хотя карточки показывают «110мм»; после F5 — всё верно. Причина: поиск
// матчил ширину ТОЛЬКО через подписи связанных позиций (обеспечения → this.positions), которые
// после переноса+пересчёта временно устаревали (this.positions в сессии не перечитывается) → поиск
// «110» не находил резки, хотя их СОБСТВЕННАЯ ширина полос (knifeWidths) = 110 (карточка её и рисует).
//
// Фикс #4298: cutSearchHaystack включает ширины полос (knifeWidths) резки → поиск по ширине находит
// резку по её геометрии, независимо от свежести связей позиций.
//
// Run with: node experiments/atex-production-planning-4298.test.js

var planning = require('../download/atex/js/production-planning.js').planning;
var haystack = planning.cutSearchHaystack;
var matches = planning.cutMatchesQuery;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var cut110 = { materialName: 'MW308', materialId: '1253', winding: 'OUT', status: '', number: '', knifeWidths: [110, 110, 110] };
var cut59  = { materialName: 'MW411', materialId: '999', winding: 'IN', status: '', number: '', knifeWidths: [59] };

// ── Поиск по ширине находит резку по knifeWidths ДАЖЕ БЕЗ связанных позиций (устаревшая связь) ───────
assert(matches(cut110, '110', []) === true,
    '#4298: резка 110мм БЕЗ связанной позиции — поиск «110» находит её по своей ширине (knifeWidths)');
assert(matches(cut110, '110', null) === true,
    '#4298: linkedLabels=null — поиск «110» всё равно находит по knifeWidths');
assert(matches(cut59, '110', []) === false,
    '#4298: резка 59мм — поиск «110» НЕ находит (чужая ширина)');
assert(matches(cut59, '59', []) === true,
    '#4298: резка 59мм — поиск «59» находит по своей ширине');

// ── Прежние совпадения (сырьё/намотка/позиция) не сломаны ────────────────────────────────────────
assert(matches(cut110, 'mw308', []) === true, '#4298: поиск по названию сырья по-прежнему работает');
assert(matches(cut110, 'out', []) === true, '#4298: поиск по намотке по-прежнему работает');
assert(haystack(cut110, ['заказ42 · 110x450']).indexOf('110') !== -1,
    '#4298: подписи связанных позиций по-прежнему в haystack');
assert(haystack(cut110, []).indexOf('110') !== -1, '#4298: ширина 110 попала в haystack и без позиций');

// ── Дубли ширин схлопываются; пустой запрос матчит всё; резка без ножей не падает ──────────────────
var hay = haystack({ materialName: 'X', knifeWidths: [110, 110, 110, 110] }, []);
assert((hay.match(/110/g) || []).length === 1, '#4298: дубли ширин схлопнуты (одно «110» в haystack)');
assert(matches(cut110, '', []) === true, '#4298: пустой запрос матчит всё');
assert(matches({ materialName: 'X', knifeWidths: [] }, 'x', []) === true, '#4298: резка без ножей — не падает, матч по сырью');

console.log('\n' + passed + '/' + total + ' passed');
