// #4357 — «Хочу перенести задание на Станок 3, не получается»: перенос ПРОДОЛЖЕНИЯ разорванного по
// дням задания молча отменялся.
//
// КОРЕНЬ (трасса ideav.ru + скриншоты issue #4357; ateh, 22–23.07): голова 640784 — 109 проходов,
// 22.07, Станок 1 (1277), 🔒; хвост 640812 — 49 проходов, 23.07, просрочен (срок 22.07). Оператор
// переносит ХВОСТ на Станок 3 (1282) в начало 22.07 — место там есть, ножи те же.
// moveCutToDay честно пишет planStart + «Слиттер»=1282 и говорит «перенесено» (тост — ДО пересборки),
// после чего сам же запускает пересборку плана. А планировщик первым делом зовёт
// mergeContinuationChains: цепочка «голова + продолжения» схлопывается в ОДНО логическое задание —
// копию ГОЛОВЫ (её станок, её день) с суммой проходов, сегменты пере-нарезает упаковщик. То есть
// перенесённого хвоста во входе плана НЕТ ВООБЩЕ: план пересчитывается от головы (Станок 1, 🔒),
// 158 проходов × 3.2 ≈ 506 мин снова не влезают в смену 455 мин → задание опять режется, и запись
// 640812 переписывается обратно на Станок 1/23.07. Замки переноса (pinCutIds/weightPositionCutIds/
// machineLockByCut) бессильны — они адресуются по id сегмента, которого во входе нет.
//
// ФИКС (#4357): при переносе ПРОДОЛЖЕНИЕ отвязываем от цепочки — пишем ему «ID первой части» = свой
// id (daySplitDetachCutId). Дальше это самостоятельное задание на свои 49 проходов, голова остаётся
// со своими 109, перенос доживает до конца. ГОЛОВУ не отвязываем: её перенос двигает всю цепочку.
//
// Run with: node experiments/atex-production-planning-4357-segment-move.test.js

var mod = require('../download/atex/js/production-planning.js');
var P = mod.planning;
var Controller = mod.Controller;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var BASE = new Date(2026, 6, 22, 0, 0, 0, 0).getTime();   // «С» = 22.07.2026 (день 0)
function ts(day) { return String(Math.floor((BASE + day * 86400000) / 1000) + 480 * 60); }
var K8 = [110, 110, 110, 110, 110, 110, 110, 110];

// Сегмент цепочки: head — «ID первой части» (id головы). fixed — как 🔒 у головы на ateh.
function seg(id, sid, day, runs, head, fixed) {
    return { id: id, orderId: 'ORD', firstPartId: head, slitter: { id: sid }, materialId: 'MW308',
             winding: 'OUT', knifeWidths: K8, knifeCount: 8, rollerWidth: 0, plannedRuns: runs,
             isFoil: false, length: 300, planDate: ts(day), status: '', fixed: !!fixed };
}
function filler(id, day) {
    return { id: id, orderId: 'O' + id, firstPartId: id, slitter: { id: '1282' }, materialId: 'MR194',
             winding: 'OUT', knifeWidths: [110], knifeCount: 1, rollerWidth: 0, plannedRuns: 2,
             isFoil: false, length: 300, planDate: ts(day), status: '', fixed: false };
}
// Пересборка — та же, которой moveCutToDay завершает перенос: buildSequenceOps(cuts, 'SETUP', false,
// moveScope). moveScope повторяет диалог из issue: «в начало дня» (pinCutIds) + «в пределах одного
// станка» (withinSlitterIds = целевой + исходный).
var MOVE_SCOPE = { pinCutIds: ['640812'], withinSlitterIds: ['1282', '1277'] };
var SUPPLIES = [{ cutId: '640784', positionId: 'P1', dueKey: 20260722 },
                { cutId: '640812', positionId: 'P1', dueKey: 20260722 }];
var GEN_POSITIONS = [{ id: 'P1', dueKey: 20260722 }];
function planSelf(cuts) {
    return {
        cuts: cuts, changeTimes: { BETWEEN_CUTS: 0, CLEANUP_SHIFT: 0 },
        daySettings: { SLOT_PLACEMENT: '1', DEADLINE_COST_MN: '200', DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30' },
        opTimes: { WIND_300: 3.2 }, filter: { date: '2026-07-22' },
        supplies: SUPPLIES, footageBySupply: {}, genPositions: GEN_POSITIONS,
        slitters: [{ id: '1277', label: 'Станок 1' }, { id: '1282', label: 'Станок 3' }],
        nowMs: function () { return BASE; },
        workingWindow: Controller.prototype.workingWindow,
        slotPlacementOn: Controller.prototype.slotPlacementOn,
        dayIsWorking: function () { return true; },
        slitterOnVacationDay: function () { return false; },
        planningPrevSetupBySlitter: function () { return {}; },
        blockedRangesBySlitter: function () { return {}; }
    };
}
function resequence(cuts, moveScope) {
    return Controller.prototype.buildSequenceOps.call(planSelf(cuts), cuts, 'SETUP', false, moveScope).ops;
}
function placeOf(ops, id) {
    var u = (ops.updates || []).filter(function (x) { return String(x.cutId) === id; })[0];
    if (!u) return null;
    return { slitter: String(u.slitterId), day: Math.round((Number(u.planStartTs) * 1000 - BASE) / 86400000),
             runs: Number(u.plannedRuns) };
}

// ── 1) Правило отвязки — daySplitDetachCutId ──────────────────────────────────────────────────────
var chainCuts = [seg('640784', '1277', 0, 109, '640784', true), seg('640812', '1277', 1, 49, '640784', false)];
assert(P.daySplitDetachCutId(chainCuts, '640812') === '640812',
    '#4357: ПРОДОЛЖЕНИЕ цепочки при переносе отвязывается (маркер = свой id)');
assert(P.daySplitDetachCutId(chainCuts, '640784') === null,
    '#4357: ГОЛОВА не отвязывается — её перенос двигает всю цепочку');
assert(P.daySplitDetachCutId([filler('F1', 0)], 'F1') === null,
    '#4357: целое (не разорванное) задание отвязывать нечего');
assert(P.daySplitDetachCutId(chainCuts, '') === null && P.daySplitDetachCutId([], 'X') === null,
    '#4357: пустой ввод — null (без исключений)');
// Цепочка из трёх дней: середина и хвост — оба продолжения.
var chain3 = [seg('H', '1277', 0, 100, 'H', true), seg('C1', '1277', 1, 100, 'H', false),
              seg('C2', '1277', 2, 50, 'H', false)];
assert(P.daySplitDetachCutId(chain3, 'C1') === 'C1' && P.daySplitDetachCutId(chain3, 'C2') === 'C2'
    && P.daySplitDetachCutId(chain3, 'H') === null,
    '#4357: в цепочке 3+ дней отвязываются и середина, и хвост, но не голова');

// ── 2) Репро: пока сегмент в цепочке, перенос стирается пересборкой ───────────────────────────────
// Запись хвоста УЖЕ переписана переносом на Станок 3 / 22.07 (день 0) — так её оставил moveCutToDay,
// вместе с замками переноса. Пересборка обязана это уважить, но цепочка схлопывается в голову.
(function () {
    var ops = resequence([seg('640784', '1277', 0, 109, '640784', true),
                          seg('640812', '1282', 0, 49, '640784', true),
                          filler('F1', 0), filler('F2', 0)], MOVE_SCOPE);
    var tail = placeOf(ops, '640812');
    assert(tail && tail.slitter === '1277',
        '#4357 репро: без отвязки хвост возвращается на станок ГОЛОВЫ (1277), а не на выбранный '
        + 'оператором 1282 — = ' + (tail && tail.slitter));
    assert(tail && tail.day === 1,
        '#4357 репро: и на прежний день 23.07 (день 1), за срок — перенос стёрт целиком — = день ' + (tail && tail.day));
})();

// ── 3) Фикс: отвязанный сегмент остаётся там, куда его перенесли ──────────────────────────────────
(function () {
    // Единственное отличие от репро — у хвоста СВОЙ «ID первой части» (это и пишет фикс).
    var ops = resequence([seg('640784', '1277', 0, 109, '640784', true),
                          seg('640812', '1282', 0, 49, '640812', true),
                          filler('F1', 0), filler('F2', 0)], MOVE_SCOPE);
    var tail = placeOf(ops, '640812'), head = placeOf(ops, '640784');
    assert(tail && tail.slitter === '1282',
        '#4357 фикс: отвязанный хвост остаётся на выбранном станке 1282 (Станок 3) — = ' + (tail && tail.slitter));
    assert(tail && tail.day === 0,
        '#4357 фикс: и на выбранном дне 22.07 (день 0) — в срок, а не за сроком — = день ' + (tail && tail.day));
    assert(tail && tail.runs === 49 && head && head.runs === 109,
        '#4357 фикс: проходы не потерялись и не задвоились — голова 109, хвост 49 (было 158)');
    assert(head && head.slitter === '1277' && head.day === 0,
        '#4357 фикс: голова осталась на своём станке и дне (её перенос не трогали)');
})();

// ── 4) Проводка: moveCutToDay пишет маркер отвязки именно продолжению ─────────────────────────────
(function () {
    // Метаданные резки: id таблицы + нужные реквизиты (как в ateh: «Слиттер» 1156, «Зафиксировано»,
    // «ID первой части»). reqIdByName ищет по ИМЕНИ реквизита.
    var cutMeta = { id: '1078', reqs: [
        { id: '1156', val: 'Слиттер' }, { id: '81530', val: 'Зафиксировано' },
        { id: '196458', val: 'ID первой части' }] };
    function stubSelf(cuts) {
        var posts = [];
        return {
            posts: posts, busy: false, cuts: cuts, meta: { cut: cutMeta },
            filter: { date: '2026-07-22', dateTo: '2026-07-23' },
            slitters: [{ id: '1277', label: 'Станок 1' }, { id: '1282', label: 'Станок 3' }],
            daySettings: {}, changeTimes: {}, opTimes: {},
            notify: function (msg) { this.lastNotify = String(msg); },
            nowMs: function () { return BASE; },
            workingWindow: function () { return { startMin: 480, endMin: 990, cutEndMin: 990 }; },
            slitterOnVacationDay: function () { return false; },
            setBusy: function () {}, showProgress: function () {}, updateProgress: function () {},
            hideProgress: function () {}, render: function () {},
            post: function (path, fields) { posts.push({ path: path, fields: fields || {} }); return Promise.resolve({}); },
            reload: function () { return Promise.resolve(); },
            autoSequenceQueue: function () { return Promise.resolve(true); }
        };
    }
    function fieldsOf(self, id) {
        var p = self.posts.filter(function (x) { return x.path.indexOf('_m_set/' + id) === 0; })[0];
        return p ? p.fields : null;
    }
    var cuts = [seg('640784', '1277', 0, 109, '640784', true), seg('640812', '1277', 1, 49, '640784', false)];

    // (а) переносим ХВОСТ на Станок 3, 22.07, «в начало дня», с фиксацией — как в issue.
    var selfTail = stubSelf(cuts);
    return Controller.prototype.moveCutToDay.call(selfTail, cuts[1], '2026-07-22', 'start', true, '1282', true)
        .then(function () {
            var f = fieldsOf(selfTail, '640812') || {};
            assert(f['t196458'] === '640812',
                '#4357 проводка: продолжению записан «ID первой части» = свой id (отвязка) — = ' + f['t196458']);
            assert(f['t1156'] === '1282',
                '#4357 проводка: и новый станок 1282 в том же _m_set — = ' + f['t1156']);
            assert(/отвязано от разорванного задания/.test(selfTail.lastNotify || ''),
                '#4357 проводка: оператору сказано, что кусок стал отдельным заданием — «' + selfTail.lastNotify + '»');

            // (б) переносим ГОЛОВУ — маркер не трогаем (двигается вся цепочка).
            var cuts2 = [seg('640784', '1277', 0, 109, '640784', true), seg('640812', '1277', 1, 49, '640784', false)];
            var selfHead = stubSelf(cuts2);
            return Controller.prototype.moveCutToDay.call(selfHead, cuts2[0], '2026-07-22', 'start', true, '1282', true)
                .then(function () {
                    var fh = fieldsOf(selfHead, '640784') || {};
                    assert(fh['t196458'] === undefined,
                        '#4357 проводка: ГОЛОВЕ маркер отвязки не пишется (перенос двигает всю цепочку)');
                    assert(!/отвязано/.test(selfHead.lastNotify || ''),
                        '#4357 проводка: и про отвязку оператору не врём — «' + selfHead.lastNotify + '»');

                    // (в) целое задание (не цепочка) — тоже без отвязки.
                    var solo = [filler('F1', 0)];
                    var selfSolo = stubSelf(solo);
                    return Controller.prototype.moveCutToDay.call(selfSolo, solo[0], '2026-07-23', 'weight', false, '1277', true)
                        .then(function () {
                            var fs = fieldsOf(selfSolo, 'F1') || {};
                            assert(fs['t196458'] === undefined,
                                '#4357 проводка: у неразорванного задания маркер не трогаем');
                        });
                });
        })
        .then(function () {
            console.log('\n' + passed + '/' + total + ' проверок прошло');
            if (passed !== total) process.exitCode = 1;
        });
})();
