// issue #4618: ЖУРНАЛ РАССЛЕДОВАНИЯ — свидетель «работа исчезла».
//
// Потерянные проходы (#4552, #4598, #4616) выглядят в базе одинаково: голова урезана,
// продолжения нет, «Тайминг» помнит прежнее число. Кто снял продолжение — по остаткам не
// восстановить. Журнал пишет это в момент действия, а решает вопрос «сошлось/не сошлось»
// одна чистая функция — `journalChainBalance(cuts, ops)`: Σ проходов ЦЕПОЧКИ до и после
// набора операций. Её и проверяем: она обязана ловить ровно тот класс, ради которого
// заведена, и не кричать на законных раскладках.
//
//   A — целое задание разрезали по дням: голова урезана + родилось продолжение → баланс 0;
//   B — КОРЕНЬ #4598: голову урезали, продолжение НЕ родилось → delta < 0 (потеря видна);
//   C — сегмент сняли, а его проходы вернули в голову (схлопывание цепочки) → баланс 0;
//   D — сегмент сняли и никому не вернули → delta < 0;
//   E — цепочка собирается по «ID первой части», а не по id: звенья считаются вместе;
//   F — задания, которых операции не касались, в отчёт не попадают (иначе тонет главное).
//
// Run with: node experiments/atex-pp-4618-journal-balance.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh', xsrf: 'x' };
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}
// задание: id, проходов, голова цепочки (пусто = само себе голова)
function C(id, runs, head) { return { id: String(id), plannedRuns: runs, firstPartId: head || '' }; }
function byChain(rows, chainId) {
    for (var i = 0; i < rows.length; i++) if (String(rows[i].chainId) === String(chainId)) return rows[i];
    return null;
}

// ── A. Разрез по дням: 20 = 8 (голова) + 12 (продолжение). Работа на месте.
(function () {
    var cuts = [C(100, 20)];
    var ops = { updates: [{ cutId: '100', plannedRuns: 8 }], creates: [{ parentCutId: '100', plannedRuns: 12 }], deletes: [] };
    var r = byChain(P.journalChainBalance(cuts, ops), '100');
    assert(r && r.before === 20 && r.after === 20 && r.delta === 0,
        'A: разрез по дням сохраняет работу (20 → 8+12)', r ? JSON.stringify(r) : 'нет строки');
})();

// ── B. КОРЕНЬ #4598: голову урезали, продолжение не родилось — 12 проходов исчезли.
(function () {
    var cuts = [C(100, 20)];
    var ops = { updates: [{ cutId: '100', plannedRuns: 8 }], creates: [], deletes: [] };
    var r = byChain(P.journalChainBalance(cuts, ops), '100');
    assert(r && r.before === 20 && r.after === 8 && r.delta === -12,
        'B: урезали голову без продолжения — потеря видна (delta -12)', r ? JSON.stringify(r) : 'нет строки');
})();

// ── C. Схлопывание цепочки: сегмент сняли, его 5 проходов вернулись в голову.
(function () {
    var cuts = [C(100, 10), C(101, 5, '100')];
    var ops = { updates: [{ cutId: '100', plannedRuns: 15 }], creates: [], deletes: ['101'] };
    var r = byChain(P.journalChainBalance(cuts, ops), '100');
    assert(r && r.before === 15 && r.after === 15 && r.delta === 0,
        'C: схлопывание с возвратом проходов в голову — баланс сошёлся', r ? JSON.stringify(r) : 'нет строки');
})();

// ── D. Сегмент сняли, проходы никому не вернули.
(function () {
    var cuts = [C(100, 10), C(101, 5, '100')];
    var ops = { updates: [], creates: [], deletes: ['101'] };
    var r = byChain(P.journalChainBalance(cuts, ops), '100');
    assert(r && r.before === 15 && r.after === 10 && r.delta === -5,
        'D: сняли сегмент без возврата — потеря видна (delta -5)', r ? JSON.stringify(r) : 'нет строки');
})();

// ── E. Цепочка — по «ID первой части»: три звена считаются одной цепочкой.
(function () {
    var cuts = [C(100, 4), C(101, 6, '100'), C(102, 10, '100')];
    var ops = { updates: [{ cutId: '102', plannedRuns: 3 }], creates: [], deletes: [] };
    var rows = P.journalChainBalance(cuts, ops);
    var r = byChain(rows, '100');
    assert(rows.length === 1 && r && r.before === 20 && r.after === 13 && r.delta === -7,
        'E: звенья одной цепочки сложены вместе (20 → 13)', JSON.stringify(rows));
})();

// ── F. Нетронутые задания в отчёт не попадают — иначе одна сломанная цепочка утонет.
(function () {
    var cuts = [C(100, 20), C(200, 30), C(300, 40)];
    var ops = { updates: [{ cutId: '100', plannedRuns: 20 }], creates: [], deletes: [] };
    var rows = P.journalChainBalance(cuts, ops);
    assert(rows.length === 1 && String(rows[0].chainId) === '100' && rows[0].delta === 0,
        'F: в отчёте только затронутые цепочки', JSON.stringify(rows));
})();

console.log('\n' + passed + '/' + total + ' пройдено');
