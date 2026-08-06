// #4617 — «потерянные резки»: карточка куска разорванного задания называет арифметику цепочки.
//
// Боевая ateh, Станок 2, 06.08.2026: у заказов 4580/4567/4564/4561 в дне остался ОДИН проход
// (20 + 21 + 5 + 52 = 98 минут), а остальные 4–5 стояли ОТДЕЛЬНОЙ записью на 07.08. Проходы целы —
// это проверено по базе, — но очередь показывала «300 x 1» и читалась как потерянная резка: значок
// «→» в углу карточки не называет ни числа проходов, ни дня, куда уехал остаток.
//
// Поведение упаковщика заказчик решил не менять (06.08.2026): огрызок в один проход остаётся,
// потому что вытеснять 🔒 из своего дня нельзя (#4512). Поэтому чиним то, из-за чего заказ читается
// как потерянный, — подпись на карточке.
//
// Run with: node experiments/atex-pp-4617-chain-note.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh', xsrf: 'x' };

var fs = require('fs');
var path = require('path');
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}
function label(planDate) { return P.formatPlanDayLabel(P.planDateIso(planDate)); }
function note(parts, id) { return P.daySplitChainNote(parts, id, label); }

// Боевой случай: голова 1 проход на 06.08 + продолжение 4 прохода на 07.08.
var D0608 = String(Math.round(new Date(2026, 7, 6, 8, 0, 0).getTime() / 1000));
var D0708 = String(Math.round(new Date(2026, 7, 7, 8, 0, 0).getTime() / 1000));
var D0808 = String(Math.round(new Date(2026, 7, 8, 8, 0, 0).getTime() / 1000));
var HEAD = { id: '662448', plannedRuns: 1, planDate: D0608 };
var TAIL = { id: '665739', plannedRuns: 4, planDate: D0708 };

// ── 1. Голова: сколько здесь, сколько всего, куда уехал остаток ──────────────────────────
(function () {
    var n = note([HEAD, TAIL], '662448');
    assert(!!n, 'у разорванного задания подпись есть');
    assert(n && n.text === 'проходов 1 из 5 · остальные 4 → 07.08.2026',
        'голова называет и свои проходы, и общее число, и день остатка', '(' + (n && n.text) + ')');
    assert(n && /не потеряны/.test(n.title), 'в подсказке сказано, что проходы не потеряны', '(' + (n && n.title) + ')');
})();

// ── 2. Продолжение смотрит в обратную сторону ────────────────────────────────────────────
(function () {
    var n = note([HEAD, TAIL], '665739');
    assert(n && n.text === 'проходов 4 из 5 · остальные 1 → 06.08.2026',
        'продолжение называет день головы', '(' + (n && n.text) + ')');
})();

// ── 3. Разрыв на три дня — перечислены все чужие дни ─────────────────────────────────────
(function () {
    var third = { id: '999', plannedRuns: 2, planDate: D0808 };
    var n = note([HEAD, TAIL, third], '662448');
    assert(n && n.text === 'проходов 1 из 7 · остальные 6 → 07.08.2026, 08.08.2026',
        'дни остатка перечислены по возрастанию, без повторов', '(' + (n && n.text) + ')');
})();

// ── 4. Молчим там, где сказать нечего ────────────────────────────────────────────────────
(function () {
    assert(note([HEAD], '662448') === null, 'целое задание (одна запись) — подписи нет');
    assert(note([], '662448') === null, 'пустая цепочка — подписи нет');
    assert(note([HEAD, TAIL], 'нет-такого') === null, 'записи нет в цепочке — подписи нет');
    var setupOnly = [{ id: 'S1', plannedRuns: 0, planDate: D0608 }, { id: 'S2', plannedRuns: 0, planDate: D0708 }];
    assert(note(setupOnly, 'S1') === null, 'наладочный хвост без проходов (#3635 п.5) — считать нечего');
})();

// ── 5. Даты может не быть — подпись всё равно осмысленна ─────────────────────────────────
(function () {
    var n = P.daySplitChainNote([HEAD, { id: 'X', plannedRuns: 4, planDate: '' }], '662448', label);
    assert(n && n.text === 'проходов 1 из 5 · остальные 4',
        'без даты остатка — только арифметика, без стрелки в пустоту', '(' + (n && n.text) + ')');
})();

// ── 6. Очередь эту подпись рисует, и у неё есть стиль ────────────────────────────────────
(function () {
    var ctrl = fs.readFileSync(path.join(__dirname, '..', 'download', 'atex', 'js',
        'production-planning', '20-controller.js'), 'utf8');
    assert(/daySplitChainNote\(splitChainPartsOf\(self\.cuts \|\| \[\], c\.id\), c\.id/.test(ctrl),
        'renderQueue считает подпись по записям цепочки задания');
    assert(/atex-pp-cut-chain-note/.test(ctrl), 'и вешает её на карточку');
    var css = fs.readFileSync(path.join(__dirname, '..', 'download', 'atex', 'css',
        'production-planning.css'), 'utf8');
    assert(/\.atex-pp-cut-chain-note\s*\{/.test(css), 'класс подписи описан в стилях');
    var built = fs.readFileSync(path.join(__dirname, '..', 'download', 'atex', 'js',
        'production-planning.js'), 'utf8');
    assert(/daySplitChainNote/.test(built), 'сборный production-planning.js пересобран из модулей');
})();

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' passed');
});
