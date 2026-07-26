// Tests for ideav/crm#4413 — «По кнопке Упорядочить не учтён отпуск, его добавили перед запуском».
//
// Сценарий заказчика (ateh, Станок 2, Пт 24.07.2026): «Отпуск» 08:00–15:00 добавили прямо перед
// нажатием, задание № 1 (237 мин) так и осталось стоять с 08:00 — ВНУТРИ отпуска. Ожидалось, что
// оно сдвинется за отпуск и разорвётся на следующий день. Вместо этого — тост «Просрочка не
// устранена…», план не тронут.
//
// КОРЕНЬ: планировщик отпуск учитывает (кандидат B честно ставит задание на 15:00 и переносит
// остаток на следующий день — проверено ниже), но РЕШЕНИЕ применять план принималось только по
// двум числам: дни опоздания и минуты переналадки. Сдвиг за отпуск ни того, ни другого не улучшает
// (день тот же, конфигурация та же) → objB == before → «ни один кандидат не лучше» → план выброшен.
//
// ФИКС: задание, стоящее в окне «Отпуска» своего станка, — не «дорого», а НЕВЫПОЛНИМО. Это старший
// критерий объектива (DOWNTIME_CONFLICT_WEIGHT выше LATE_DAY_WEIGHT): план, снимающий нарушение,
// применяется даже при тех же опозданиях и той же переналадке. Не удалось снять — говорим об этом
// прямо, а не «просрочка не устранена»/«очередь оптимальна».
//
// Run with: node experiments/atex-4413-optimize-downtime.test.js

process.env.TZ = 'UTC';

var mod = require('../download/atex/js/production-planning.js');
var planning = mod.planning;
var Controller = mod.Controller;

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

var BASE = new Date(2026, 6, 24, 0, 0, 0, 0).getTime();          // «С» = Пт 24.07.2026 (день 0)
function tsAt(dayOffset, minutes) { return Math.floor(BASE / 1000) + dayOffset * 86400 + minutes * 60; }
var VAC_FROM = 8 * 60, VAC_TO = 15 * 60;                         // «Отпуск» 08:00–15:00 в день 0

// ── 1) Чистая downtimeConflictCuts: кто стоит в окне простоя ────────────────
(function () {
    var blocked = { m1: [[VAC_FROM, VAC_TO]] };
    function it(id, start, occ, sid) { return { id: id, slitterId: sid || 'm1', windowStartMin: start, occMin: occ }; }

    assertEqual(planning.downtimeConflictCuts([it('inside', VAC_FROM, 237)], blocked), ['inside'],
        'задание стартует внутри «Отпуска» — нарушение');
    assertEqual(planning.downtimeConflictCuts([it('overlapStart', VAC_FROM - 30, 60)], blocked), ['overlapStart'],
        'задание началось раньше, но въезжает в «Отпуск» — тоже нарушение');
    assertEqual(planning.downtimeConflictCuts([it('after', VAC_TO, 75)], blocked), [],
        'задание сразу ПОСЛЕ окна простоя — чисто');
    assertEqual(planning.downtimeConflictCuts([it('before', VAC_FROM - 60, 60)], blocked), [],
        'задание закончилось ровно к началу простоя — чисто');
    assertEqual(planning.downtimeConflictCuts([it('other', VAC_FROM, 237, 'm2')], blocked), [],
        'простой ЧУЖОГО станка задание не нарушает');
    assertEqual(planning.downtimeConflictCuts([it('point', VAC_FROM + 10, 0)], blocked), ['point'],
        'без хранимых минут занятости меряем точкой старта');
    assertEqual(planning.downtimeConflictCuts([it('a', VAC_FROM, 237), it('b', VAC_TO, 60), it('c', VAC_FROM + 60, 30)], blocked),
        ['a', 'c'], 'нарушители перечислены в порядке очереди');
    assertEqual(planning.downtimeConflictCuts([it('x', VAC_FROM, 60)], {}), [],
        'простоев нет — нарушений нет');
})();

// ── 2) Планировщик отпуск УЧИТЫВАЕТ: сдвиг за окно + разрыв на следующий день ──
var K11 = [80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80];
function cutOf(id, dayOffset, minutes, runs, over) {
    var c = { id: id, orderId: 'ORD' + id, firstPartId: id, slitter: { id: '101', label: 'Станок 2' },
        materialId: 'MW308', winding: 'OUT', knifeWidths: K11, knifeCount: 11, rollerWidth: 0,
        plannedRuns: runs, isFoil: false, length: 300, status: '', fixed: false,
        planDate: String(tsAt(dayOffset, minutes)), number: String(tsAt(dayOffset, minutes)),
        duration: '237', storedKnifeSetupMin: '30', storedMaterialWindingMin: '15', storedCutAndLeaderMin: '237' };
    for (var k in (over || {})) c[k] = over[k];
    return c;
}
var SUPPLIES = [{ cutId: 'T1', positionId: 'P1', dueKey: 20260728 }];
var GEN_POSITIONS = [{ id: 'P1', dueKey: 20260728 }];
var DAY_SETTINGS = { DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', LUNCH_START: '12:20',
    LUNCH_DURATION: '40', TOTAL_INTERVALS: '15' };

function planSelf(cuts, blockedBySlitter) {
    return {
        cuts: cuts, changeTimes: { BETWEEN_CUTS: 0, CLEANUP_SHIFT: 30, KNIFE: 30, MATERIAL_WINDING: 15 },
        daySettings: DAY_SETTINGS, opTimes: { WIND_300: 3.95 },
        filter: { date: '2026-07-24', dateTo: '2026-07-24' },
        supplies: SUPPLIES, footageBySupply: {}, genPositions: GEN_POSITIONS,
        slitters: [{ id: '101', label: 'Станок 2' }],
        nowMs: function () { return BASE; },
        workingWindow: Controller.prototype.workingWindow,
        slotPlacementOn: Controller.prototype.slotPlacementOn,
        dayIsWorking: function (ms) { var d = new Date(Number(ms)).getDay(); return d !== 0 && d !== 6; },
        slitterOnVacationDay: function () { return false; },
        planningPrevSetupBySlitter: function () { return {}; },
        blockedRangesBySlitter: function () { return blockedBySlitter; }
    };
}
function opsFor(cuts, blocked) {
    return Controller.prototype.buildSequenceOps.call(planSelf(cuts, blocked), cuts, 'SETUP', false, null).ops;
}
function minutesOf(ts) { return (Number(ts) * 1000 - BASE) / 60000; }

(function () {
    var cuts = [cutOf('T1', 0, 8 * 60, 60)];
    var plain = opsFor(cuts, {});
    assertEqual(minutesOf(plain.updates[0].planStartTs), 8 * 60, 'без отпуска задание стоит с 08:00');
    assertEqual((plain.creates || []).length, 0, 'без отпуска разрывать нечего');

    var withVac = opsFor(cuts, { '101': [[VAC_FROM, VAC_TO]] });
    assertEqual(minutesOf(withVac.updates[0].planStartTs), VAC_TO,
        'ПЛАНИРОВЩИК отпуск учитывает: задание стартует сразу после него (15:00)');
    assert((withVac.creates || []).length === 1, 'остаток вынесен в продолжение — задание разорвано по дням');
    var cont = withVac.creates[0];
    assertEqual(Math.floor(minutesOf(cont.planStartTs) / 1440), 1, 'продолжение — на следующий день');
    assert(Number(withVac.updates[0].plannedRuns) + Number(cont.plannedRuns) === 60,
        'проходы целы: голова + продолжение = исходные 60');
})();

// ── 3) Контроллер: planDowntimeConflicts видит нарушителя ───────────────────
function ctrlSelf(cuts, downtimes) {
    var self = Object.create(Controller.prototype);
    self.busy = false;
    self.meta = {};                                   // «Календаря» нет → выходные не блокируем
    self.cuts = cuts;
    self.filter = { date: '2026-07-24', dateTo: '2026-07-24' };
    self.slitters = [{ id: '101', label: 'Станок 2' }];
    self.downtimesBySlitter = downtimes || {};
    self.calendarByDay = {};
    self.daySettings = DAY_SETTINGS;
    self.supplies = SUPPLIES; self.genPositions = GEN_POSITIONS;
    self.nowMs = function () { return BASE; };
    return self;
}
var VACATION = { '101': [{ id: 'v1', start: tsAt(0, VAC_FROM), end: tsAt(0, VAC_TO), notes: 'ТО' }] };

(function () {
    var cuts = [cutOf('T1', 0, 8 * 60, 60)];
    var c = ctrlSelf(cuts, VACATION);
    assertEqual(c.planDowntimeConflicts(cuts, null, null), ['T1'],
        'задание, стоящее с 08:00 в отпуске 08:00–15:00, — нарушитель');

    // Тот же план, но задание сдвинуто за отпуск (как его ставит кандидат): нарушения нет.
    var moved = {}; moved['T1'] = tsAt(0, VAC_TO);
    assertEqual(c.planDowntimeConflicts(cuts, moved, { T1: 1 }), [],
        'после сдвига за окно простоя нарушений нет');

    assertEqual(ctrlSelf(cuts, {}).planDowntimeConflicts(cuts, null, null), [],
        'без «Отпуска» нарушений нет (обычный план)');
})();

// ── 4) runOptimizeQueue: план, снимающий отпуск, ПРИМЕНЯЕТСЯ ────────────────
// Опоздания и переналадка у текущего плана и у кандидата ОДИНАКОВЫ — до #4413 такой план
// выбрасывался («ни один кандидат не лучше»), и задание оставалось стоять в отпуске.
function optimizeScenario(cfg) {
    var cuts = [cutOf('T1', 0, 8 * 60, 60)];
    var self = ctrlSelf(cuts, cfg.downtimes);
    var notes = [];
    self.setBusy = function () {};
    self.notify = function (msg, kind) { notes.push({ msg: msg, kind: kind }); };
    self.render = function () {};
    self.planChangeoverMin = function () { return 45; };                 // одинаково до и после
    self.planLatenessDays = function () { return cfg.late == null ? 0 : cfg.late; };
    self.computeReassignmentPlan = function () { return { changed: false, slitterByRecordId: {}, slitterReqId: '9' }; };
    self.buildSequenceOps = function () {
        return { ops: cfg.ops, cutsById: { T1: cuts[0] } };
    };
    self.optimizeWindowLabel = function () { return '24.07.2026'; };
    self.fillOptimizeMovesTrace = function () {};
    var preview = null;
    self.startPlanPreview = function (payload) { preview = payload; return true; };
    self.runOptimizeQueue();
    return { preview: preview, notes: notes, cuts: cuts };
}
var OPS_MOVED = { updates: [{ cutId: 'T1', planStartTs: tsAt(0, VAC_TO), plannedRuns: 1 }],
                  creates: [{ parentCutId: 'T1', planStartTs: tsAt(1, 8 * 60), plannedRuns: 59 }], deletes: [] };
var OPS_STUCK = { updates: [{ cutId: 'T1', planStartTs: tsAt(0, 8 * 60), plannedRuns: 60 }], creates: [], deletes: [] };

(function () {
    var r = optimizeScenario({ downtimes: VACATION, ops: OPS_MOVED });
    assert(!!r.preview, '#4413: план, уводящий задание из окна «Отпуска», ПОКАЗАН (раньше выбрасывался)');
    assertEqual([r.preview && r.preview.downtimeBefore, r.preview && r.preview.downtimeAfter], [1, 0],
        'в предпросмотре видно, ради чего переставили: в «Отпуске» 1 → 0');
    assertEqual([r.preview && r.preview.lateBefore, r.preview && r.preview.lateAfter], [0, 0],
        'опоздания при этом не изменились — решение приняло именно нарушение простоя');

    // Контроль: тех же чисел без «Отпуска» недостаточно — план не трогаем (поведение #4047 цело).
    var same = optimizeScenario({ downtimes: {}, ops: OPS_MOVED });
    assert(!same.preview, 'без нарушения простоя равные опоздания и переналадка план НЕ двигают');
    assert(same.notes.filter(function (n) { return /оптимальна/.test(n.msg); }).length === 1,
        'и тогда честно сообщаем «очередь уже оптимальна»');
})();

// ── 5) Снять нарушение не вышло — говорим ПРО ОТПУСК, а не «просрочка/оптимально» ──
(function () {
    var r = optimizeScenario({ downtimes: VACATION, ops: OPS_STUCK, late: 25 });
    assert(!r.preview, 'кандидат оставил задание в отпуске → план не трогаем');
    var warn = r.notes.filter(function (n) { return n.kind === 'warning' && /Отпуск/.test(n.msg); });
    assert(warn.length === 1, 'предупреждаем именно про «Отпуск» станка, а не про просрочку');
    assert(/стоят задания — 1/.test(warn[0].msg), 'в тексте — сколько заданий осталось в окне простоя');
    assert(r.notes.filter(function (n) { return /оптимальна/.test(n.msg); }).length === 0,
        '«очередь оптимальна» при задании в отпуске не рапортуем');
})();

// ── 6) Трасса [pp-opt]: нарушение видно в СТАРТ, кандидатах и вердикте ──────
(function () {
    var lines = planning.formatOptimizeTrace({
        start: { cutCount: 1, fixedCount: 0, slitterCount: 1, windowLabel: '24.07.2026',
                 lateBefore: 0, coBefore: 45, downtimeBefore: 1, downtimeIds: ['T1'] },
        candidates: [{ key: 'B', title: 'порядок/дни на текущих станках', late: 0, changeover: 45, downtime: 0 }],
        choice: { action: 'B', title: 'порядок/дни на текущих станках' },
        stop: { code: 'preview', text: 'предпросмотр показан' }
    });
    var text = lines.join('\n');
    assert(/в окне «Отпуска» станка заданий 1 \(T1\)/.test(text), 'СТАРТ: сколько заданий стоит в отпуске и каких');
    assert(/ЛУЧШЕ: в окне «Отпуска» 1 → 0 заданий/.test(text), 'вердикт кандидата — по нарушению простоя');
    assert(/старше срока/.test(text), 'в трассе объяснено, почему это важнее срока');

    // Без нарушений строка не появляется — обычная трасса не «толстеет».
    var plain = planning.formatOptimizeTrace({
        start: { cutCount: 1, fixedCount: 0, slitterCount: 1, windowLabel: '24.07.2026', lateBefore: 0, coBefore: 45 },
        candidates: [{ key: 'B', title: 'порядок/дни на текущих станках', late: 0, changeover: 40 }],
        choice: { action: 'B', title: 'порядок/дни на текущих станках' }, stop: { code: 'preview', text: 'ок' }
    }).join('\n');
    assert(!/Отпуск/.test(plain), 'нет нарушений — про «Отпуск» в трассе ни слова');
    assert(/ЛУЧШЕ: опоздания те же, переналадка -5 мин/.test(plain), 'обычный вердикт по переналадке цел');
})();

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' passed');
});
