// issue #5411: ЖУРНАЛ СТРАЖА НАЗЫВАЕТ ПРАВИЛО.
//
// Зачем. Журнал планирования — единственный замер того, как часто движок пытается нарушить
// жёсткое правило (страж снял операции: OP_DROPPED / RATCHET_REFUSED / WORK_REFUSED). На боевой
// ateh за 01.08–19.10 таких записей 1151, и ни в одной нет id правила: запись называет цепочку,
// но не то, что она нарушала. Поэтому по журналу нельзя сказать, какое из правил реестра
// срабатывает и какое не сработало ни разу.
//
// Плюс дефект: построчные OP_DROPPED (#4618) не писались НИКОГДА. Их считали разницей «операции до
// стража − после», но страж мутирует набор на месте, и «до» к моменту записи уже было «после»:
// разница всегда пустая (в боевом журнале 592 OP_DROPPED, все — сводка #4536).
//
// Контракт: строки журнала по отчёту стража строит чистая `journalGuardRows(guard)`, и КАЖДАЯ
// строка начинается с `правило=<ID>[,<ID>…]: `, где ID — id правила реестра (или GATE_WORK_KEPT —
// сохранность работы, свойство самого шлюза #4645, а не правила реестра).
//
//   A — правило `drop` сняло операцию: сводка по правилу (сколько снято) + строка на снятый CREATE;
//   B — цепочка снята целиком (#4536) из-за отброшенной операции — названо отбросившее правило;
//   C — храповик (#4751) снял цепочку — названо ухудшенное правило;
//   D — набор отнимал работу (#4645) — GATE_WORK_KEPT;
//   E — формат: каждая строка с префиксом правила;
//   F — боевой реестр: FROZEN_DAY называет себя.
//
// Run with: node experiments/atex-pp-5411-guard-rule-id.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh', xsrf: 'x' };
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}
function find(rows, event, cut, rule) {
    return (rows || []).filter(function(r) {
        return r.event === event && (cut == null || String(r.cut) === String(cut))
            && String(r.details || '').indexOf('правило=') === 0
            && String(r.details).split(':')[0].replace('правило=', '').split(',').indexOf(rule) >= 0;
    });
}

var RUNS = { '1': 20, '5': 10, '7': 10 };
var ctx = {
    plannedRunsOfCut: function(id) { return RUNS[String(id)]; },
    chainIdOfCut: function(id) { return String(id); }
};
// Правило-отбрасыватель: снимает продолжение задания 1.
var TEST_DROP = {
    id: 'TEST_DROP', actor: 'auto', mode: 'drop',
    check: function() { return []; },
    drop: function(op, c, kind) { return kind === 'create' && String(op.parentCutId) === '1'; }
};
// Правило храповика: ухудшается, если набор трогает задание 5.
var TEST_RATCHET = {
    id: 'TEST_RATCHET', actor: 'auto', mode: 'audit', gate: 'ratchet',
    check: function(ops) {
        return ((ops && ops.updates) || []).some(function(u) { return String(u.cutId) === '5'; })
            ? [{ rule: 'TEST_RATCHET', cutId: '5', msg: 'тест' }] : [];
    }
};
var ops = {
    updates: [{ cutId: '1', plannedRuns: 8 }, { cutId: '5', plannedRuns: 10 }, { cutId: '7', plannedRuns: 4 }],
    creates: [{ parentCutId: '1', plannedRuns: 12 }],
    deletes: []
};
var guard = P.guardPlanOpsWith([TEST_DROP, TEST_RATCHET], ops, ctx, 'auto');
var rows = typeof P.journalGuardRows === 'function' ? P.journalGuardRows(guard) : [];
var dump = JSON.stringify(rows);

// ── A. Правило `drop`: сводка + строка на снятый CREATE.
var sumA = find(rows, 'OP_DROPPED', null, 'TEST_DROP').filter(function(r) { return r.cut == null; });
assert(sumA.length === 1 && Number(sumA[0].before) === 1,
    'A1: сводка OP_DROPPED по правилу TEST_DROP — снята 1 операция', dump);
var crA = find(rows, 'OP_DROPPED', '1', 'TEST_DROP').filter(function(r) { return /CREATE/.test(r.details); });
assert(crA.length === 1 && Number(crA[0].after) === 12,
    'A2: снятый CREATE продолжения задания 1 записан строкой с правилом', dump);

// ── B. Цепочка 1 снята целиком: update 1→8 без продолжения терял бы 12 проходов.
var rB = find(rows, 'OP_DROPPED', '1', 'TEST_DROP').filter(function(r) { return /#4536/.test(r.details); });
assert(rB.length === 1, 'B: снятие цепочки 1 целиком (#4536) называет TEST_DROP', dump);

// ── C. Храповик снял цепочку 5.
assert(find(rows, 'RATCHET_REFUSED', '5', 'TEST_RATCHET').length === 1,
    'C: RATCHET_REFUSED по цепочке 5 называет TEST_RATCHET', dump);

// ── D. Набор отнимал работу у цепочки 7 (10 → 4 без продолжения).
assert(find(rows, 'WORK_REFUSED', '7', 'GATE_WORK_KEPT').length === 1,
    'D: WORK_REFUSED по цепочке 7 называет GATE_WORK_KEPT', dump);

// ── E. Формат: каждая строка — с префиксом правила.
var bad = rows.filter(function(r) { return !/^правило=[A-Z0-9_]+(,[A-Z0-9_]+)*: /.test(String(r.details || '')); });
assert(rows.length > 0 && bad.length === 0, 'E: у каждой строки журнала стража есть «правило=ID: »',
    JSON.stringify(bad));

// ── F. Боевой реестр: перенос задания замороженного дня снимает FROZEN_DAY.
var opsF = { updates: [{ cutId: '9', planStartTs: '1790000000' }], creates: [], deletes: [] };
var guardF = P.guardPlanOps(opsF, {
    isFrozenCut: function(id) { return String(id) === '9'; },
    isFrozenTs: function() { return false; }
}, 'auto');
var rowsF = typeof P.journalGuardRows === 'function' ? P.journalGuardRows(guardF) : [];
var sumF = find(rowsF, 'OP_DROPPED', null, 'FROZEN_DAY').filter(function(r) { return r.cut == null; });
assert(guardF.skipped === 1 && sumF.length === 1 && Number(sumF[0].before) === 1,
    'F: FROZEN_DAY снял перенос из замороженного дня и назван в журнале',
    'skipped=' + guardF.skipped + ' ' + JSON.stringify(rowsF));

console.log('\n' + passed + '/' + total + ' passed');
