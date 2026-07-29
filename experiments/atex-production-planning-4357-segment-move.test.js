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

// ── 1) Части задания — splitChainPartsOf (#4488 заменил отвязку сшиванием) ────────────────────────
var chainCuts = [seg('640784', '1277', 0, 109, '640784', true), seg('640812', '1277', 1, 49, '640784', false)];
assert(P.splitChainPartsOf(chainCuts, '640812').map(function (c) { return c.id; }).join(',') === '640784,640812',
    '#4488: по ЛЮБОЙ части видны все части задания в порядке дней (голова первой)');
assert(P.splitChainPartsOf(chainCuts, '640784').length === 2,
    '#4488: по голове — те же части (перенос двигает задание целиком)');
assert(P.splitChainPartsOf([filler('F1', 0)], 'F1').length === 1,
    '#4488: целое задание — одна часть, сшивать нечего');
assert(P.splitChainPartsOf(chainCuts, '').length === 0 && P.splitChainPartsOf([], 'X').length === 0,
    '#4488: пустой ввод — пусто (без исключений)');
// Цепочка из трёх дней: части видны по любой из них.
var chain3 = [seg('H', '1277', 0, 100, 'H', true), seg('C1', '1277', 1, 100, 'H', false),
              seg('C2', '1277', 2, 50, 'H', false)];
assert(P.splitChainPartsOf(chain3, 'C1').length === 3 && P.splitChainPartsOf(chain3, 'C2').length === 3
    && P.splitChainPartsOf(chain3, 'H').length === 3,
    '#4488: в цепочке 3+ дней все три части видны по середине, хвосту и голове');

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

// ── 3) Фикс #4488: цепочка СШИТА — планировщик получает одну запись там, куда её перенесли ────────
(function () {
    // Так выглядит вход после mergeSplitChain: одна запись (сумма проходов 109+49) на выбранном
    // станке и дне, со своим «ID первой части». Отвязки сегмента (#4357) больше нет — она делала из
    // одной работы два задания с двумя наладками (правило #4488: хвостов не остаётся).
    var ops = resequence([seg('640812', '1282', 0, 158, '640812', true),
                          filler('F1', 0), filler('F2', 0)], MOVE_SCOPE);
    var whole = placeOf(ops, '640812');
    assert(whole && whole.slitter === '1282',
        '#4488 фикс: слитое задание остаётся на выбранном станке 1282 (Станок 3) — = ' + (whole && whole.slitter));
    assert(whole && whole.day === 0,
        '#4488 фикс: и на выбранном дне 22.07 (день 0) — в срок, а не за сроком — = день ' + (whole && whole.day));
    assert(whole && whole.runs > 0,
        '#4488 фикс: проходы на месте (что не влезло в смену, планировщик отрежет от НОВОГО места)');
})();

// ── 4) Проводка: moveCutToDay пишет маркер отвязки именно продолжению ─────────────────────────────
(function () {
    // Метаданные резки: id таблицы + нужные реквизиты (как в ateh: «Слиттер» 1156, «Зафиксировано»,
    // «ID первой части»). reqIdByName ищет по ИМЕНИ реквизита.
    var cutMeta = { id: '1078', reqs: [
        { id: '1156', val: 'Слиттер' }, { id: '81530', val: 'Зафиксировано' },
        { id: '196458', val: 'ID первой части' }, { id: '16403', val: 'Кол-во резок план' }] };
    // #4488: перенос части задания сшивает цепочку — стенду нужны метаданные «Партии ГП» и
    // «Обеспечения» (их сливает та же машинерия) и чтение по F_U (в стенде записей нет).
    var fbMeta = { id: '1081', reqs: [
        { id: 'w', val: 'Ширина, мм' }, { id: 's', val: 'Кол-во полос' }, { id: 'r', val: 'Кол-во рулонов' },
        { id: 'p', val: 'Кол-во план' }, { id: 'o', val: 'ID заказа' }] };
    var supMeta = { id: '1077', reqs: [
        { id: '1149', val: 'Метраж, м' }, { id: '15016', val: 'Партия ГП' }, { id: '16424', val: 'Кол-во рулонов' }] };
    function stubSelf(cuts) {
        var posts = [];
        return {
            posts: posts, busy: false, cuts: cuts,
            meta: { cut: cutMeta, finishedBatch: fbMeta, supply: supMeta },
            supplies: [], positionLengthById: {}, footageBySupply: {},
            getJson: function () { return Promise.resolve([]); },
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
    // #4488: вместо отвязки цепочка СШИВАЕТСЯ в перетаскиваемую запись, и едет целое задание.
    var selfTail = stubSelf(cuts);
    return Controller.prototype.moveCutToDay.call(selfTail, cuts[1], '2026-07-22', 'start', true, '1282', true)
        .then(function () {
            var f = fieldsOf(selfTail, '640812') || {};
            assert(f['t196458'] === '640812',
                '#4488 проводка: у слитого задания «ID первой части» = свой id — оно снова цельное — = ' + f['t196458']);
            assert(f['t16403'] === '158',
                '#4488 проводка: проходы сложены (109 + 49) — хвост подтянулся, а не остался — = ' + f['t16403']);
            assert(selfTail.posts.some(function (p) { return p.path.indexOf('_m_del/640784') === 0; }),
                '#4488 проводка: вторая часть удалена — двух записей одной работы не осталось');
            // Целое (158 проходов) в смену не влезает — планировщик режет его от НОВОГО места и
            // говорит об этом: сколько проходов встало на выбранный день и сколько уехало. Это и есть
            // разница с прежним поведением: рвётся собранное задание, а не остаётся забытый хвост.
            assert(/собрано из частей|перенесено|разорвано по дням/i.test(selfTail.lastNotify || ''),
                '#4488 проводка: оператору сказано, что стало с заданием — «' + selfTail.lastNotify + '»');

            // (б) переносим ГОЛОВУ — маркер не трогаем (двигается вся цепочка).
            var cuts2 = [seg('640784', '1277', 0, 109, '640784', true), seg('640812', '1277', 1, 49, '640784', false)];
            var selfHead = stubSelf(cuts2);
            return Controller.prototype.moveCutToDay.call(selfHead, cuts2[0], '2026-07-22', 'start', true, '1282', true)
                .then(function () {
                    var fh = fieldsOf(selfHead, '640784') || {};
                    assert(fh['t196458'] === '640784' || fh['t196458'] === undefined,
                        '#4488 проводка: у головы маркер цепочки остаётся её собственным id');
                    assert(!/отвязано/.test(selfHead.lastNotify || ''),
                        '#4488 проводка: об отвязке речи больше нет — «' + selfHead.lastNotify + '»');

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
