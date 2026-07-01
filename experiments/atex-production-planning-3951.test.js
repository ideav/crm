// Tests for ideav/crm#3951 — «почему 490 минут? А потом 14.07 (437 мин)?»
//
// Диагностика (лог PP_TRACE ateh_log6): планировщик splitMachineQueue раскладывал дни В БЮДЖЕТЕ
// (ИТОГ: 452, 445, 452, 454, 455, 448, 75 — все ≤ 460). Но у станка длинный «Отпуск» (относит. дни
// 3..11 заблокированы), и applyDowntime/shiftPlacementsPastDowntime сдвигал работу отпускных дней
// за отпуск. При этом ВСТЫК-курсор (#3764, «догоняющая упаковка») паковал ПРОДОЛЖЕНИЕ разбитой по
// дням резки в ХВОСТ дня её первой части: день-сплит (part1 отн. день 3, part2 отн. день 4) после
// сдвига схлопывался в ОДИН абсолютный день → бейдж 490 (>460) на 13.07, а 14.07 недобирал (437).
//   сдвиг 264644: 13:04(+3д) → 12:24(+12д)   (part1)
//   сдвиг 264644: 08:00(+4д) → 15:34(+12д)   (part2 — сюда же, на день 12!)  ← БАГ
//
// Фикс #3951: shiftPlacementsPastDowntime сохраняет ГРАНИЦЫ ДНЕЙ — сегмент, исходно стоявший на
// более позднем дне, чем предыдущий, и после сдвига оказывается на более позднем дне (не пакуется
// встык в хвост предыдущего). Сегменты одного исходного дня по-прежнему пакуются встык.
//
// Run with: node experiments/atex-production-planning-3951.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;
var shift = planning.shiftPlacementsPastDowntime;

var passed = 0;
function assert(cond, name) { console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (cond) passed++; else process.exitCode = 1; }
var DS = 480, DE = 970, FIT = 975;   // окно 08:00..16:10 (cutEnd), потолок нахлёста 16:15
var ACC = { windowStart: function (s) { return s.ws; }, length: function (s) { return s.len; }, shift: function (s, d) { s.ws += d; } };
function day(m) { return Math.floor(m / 1440); }
function mk(id, d, hhmm, len) { return { id: id, ws: d * 1440 + hhmm, len: len }; }

// ── 1) День-сплит через «Отпуск»: продолжение НЕ схлопывается на день первой части ──
(function () {
    var items = [mk('part1', 3, 784, 190), mk('part2', 4, 480, 32), mk('sibling', 4, 512, 128)];
    shift(items, [[3 * 1440, 12 * 1440]], DS, DE, ACC, FIT);   // дни 3..11 заблокированы
    var d = {}; items.forEach(function (it) { d[it.id] = day(it.ws); });
    assert(d.part2 > d.part1, '#3951: продолжение (part2) на более позднем дне, чем первая часть (part1) — день-сплит сохранён');
    assert(d.part1 === 12, '#3951: первая часть уехала на день 12 (за отпуск)');
    assert(d.part2 === 13 && d.sibling === 13, '#3951: продолжение и сосед отн. дня 4 — на день 13, не в хвост дня 12');
})();

// ── 2) Регресс: сегменты ОДНОГО исходного дня по-прежнему пакуются встык (заполняют день) ──
(function () {
    var items = [mk('a', 3, 480, 100), mk('b', 3, 580, 100)];   // оба на отн. дне 3
    shift(items, [[3 * 1440, 12 * 1440]], DS, DE, ACC, FIT);
    var da = day(items[0].ws), db = day(items[1].ws);
    assert(da === 12 && db === 12, '#3951: два сегмента одного дня — оба на день 12 (встык, день не разрывается)');
    assert(items[1].ws === items[0].ws + items[0].len, '#3951: второй встык за первым (без зазора)');
})();

// ── 3) Регресс (#3907): одиночный сегмент за концом окна уезжает на следующий день ──
(function () {
    var items = [mk('solo', 0, 480, 460)];
    shift(items, [[480, 540]], DS, DE, ACC, 975);   // блок 08:00..09:00 сдвигает старт, конец за потолком
    assert(day(items[0].ws) >= 1, '#3907/#3951: сдвинутый простоем сегмент, вылезающий за смену, — на следующий день');
})();

console.log('\n' + passed + ' assertions passed');
