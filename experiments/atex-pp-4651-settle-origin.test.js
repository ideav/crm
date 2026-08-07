// issue #4651 (из #4650): ОСТАТОК «Урегулировать» НАЗЫВАЕТ СВОЁ ПРОИСХОЖДЕНИЕ.
//
// Что видел диспетчер (боевая ateh, заказ 4608, Станок 1): две карточки без ничего общего —
// 07.08 «300 x 27» завершена и 11.08 «300 x 18» ждёт. Читается как «резка перекинулась на 11.08»,
// хотя работа цела: оператор нарезал 27 проходов из 45, и «Урегулировать» (#4564) отрезало
// сделанное от несделанного.
//
// Подпись цепочки дробления (#4617) на этих карточках не появляется ПО ПОСТРОЕНИЮ: разделение по
// факту выводит выполненную часть из цепочки (сама себе «ID первой части»), а остаток делает новой
// головой — общей цепочки у половин нет. Связь держит ОТДЕЛЬНЫЙ реквизит «ID выполненной части»
// (settledFromId), как «ID первой части» (#3892) держит цепочку дробления: гадать по данным
// («тот же заказ + у соседа в прошлом есть Закончено») нельзя — на повторно резавшемся заказе
// такая догадка врёт.
//
// Покрываем:
//   1) settleSplitNote — обе половины называют друг друга; чужие/неразделённые молчат;
//   2) splitPartiallyDoneCuts — остаток рождается со ссылкой на выполненную часть;
//   3) applySplitPlan — ссылка уходит в БД реквизитом, а обычное продолжение по дням её НЕ несёт.
//
// Run with: node experiments/atex-pp-4651-settle-origin.test.js

process.env.TZ = 'Europe/Moscow';
global.window = { db: 'testdb', xsrf: 'x' };

var api = require('../download/atex/js/production-planning.js');
var P = api.planning;
var Controller = api.Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
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
function tsAt(y, m, d, hh, mm) { return Math.floor(new Date(y, m - 1, d, hh, mm, 0, 0).getTime() / 1000); }
function dayLabel(planDate) {
    var d = new Date(Number(planDate) * 1000);
    return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + d.getFullYear();
}

// ── 1) Боевые числа 4608: обе карточки называют свою половину ─────────────────────────────────
(function () {
    // 667620 — выполненная часть (27 проходов, 07.08, закрыта); 669318 — остаток (18, 11.08).
    var done = { id: '667620', orderId: '4608', plannedRuns: 27, planDate: String(tsAt(2026, 8, 7, 19, 20)),
        endDate: String(tsAt(2026, 8, 7, 20, 6)), firstPartId: '667620', settledFromId: '' };
    var rest = { id: '669318', orderId: '4608', plannedRuns: 18, planDate: String(tsAt(2026, 8, 11, 9, 1)),
        endDate: '', firstPartId: '669318', settledFromId: '667620' };
    var cuts = [done, rest];

    var noteDone = P.settleSplitNote(done, cuts, dayLabel);
    var noteRest = P.settleSplitNote(rest, cuts, dayLabel);
    assert(!!noteDone && !!noteRest, 'подпись есть на ОБЕИХ половинах');
    assertEqual(noteDone.role, 'done', 'исходная запись — ВЫПОЛНЕННАЯ часть');
    assertEqual(noteDone.text, 'сделано 27 из 45 · остаток 18 → 11.08.2026',
        'выполненная часть: «сделано 27 из 45 · остаток 18 → 11.08.2026»');
    assertEqual(noteRest.role, 'rest', 'созданная запись — ОСТАТОК');
    assertEqual(noteRest.text, 'остаток задания 4608 · сделано 27 из 45 07.08.2026',
        'остаток: «остаток задания 4608 · сделано 27 из 45 07.08.2026»');
    assert(/№669318/.test(noteDone.title), 'подсказка выполненной части называет номер остатка',
        '(' + noteDone.title + ')');
    assert(/№667620/.test(noteRest.title), 'подсказка остатка называет номер выполненной части',
        '(' + noteRest.title + ')');
    assert(/27 \+ 18 = 45/.test(noteDone.title) && /27 \+ 18 = 45/.test(noteRest.title),
        'обе подсказки показывают, что работа цела: 27 + 18 = 45');
})();

// ── 2) Задание без разделения молчит, чужая ссылка не притягивается ───────────────────────────
(function () {
    var plain = { id: '700', orderId: '4600', plannedRuns: 12, planDate: String(tsAt(2026, 8, 10, 8, 0)),
        firstPartId: '700', settledFromId: '' };
    assertEqual(P.settleSplitNote(plain, [plain], dayLabel), null,
        'обычное задание — подписи нет (делить было нечего)');

    // Остаток есть, а выполненной части в очереди не видно (вне диапазона/удалена) — не гадаем.
    var orphan = { id: '701', orderId: '4600', plannedRuns: 8, planDate: String(tsAt(2026, 8, 11, 8, 0)),
        firstPartId: '701', settledFromId: '999999' };
    assertEqual(P.settleSplitNote(orphan, [orphan], dayLabel), null,
        'выполненной части не видно → молчим, а не выдумываем числа');

    // Ссылка на саму себя (данные битые) подписью не становится.
    var selfRef = { id: '702', orderId: '4600', plannedRuns: 5, planDate: String(tsAt(2026, 8, 11, 8, 0)),
        firstPartId: '702', settledFromId: '702' };
    assertEqual(P.settleSplitNote(selfRef, [selfRef], dayLabel), null,
        'ссылка на саму себя — не разделение');
})();

// ── 3) Остаток, который ПОСЛЕ разделения разбило по дням: половина = вся его цепочка ──────────
(function () {
    var done = { id: 'D', orderId: '4608', plannedRuns: 27, planDate: String(tsAt(2026, 8, 7, 19, 20)),
        firstPartId: 'D', settledFromId: '' };
    var restHead = { id: 'R', orderId: '4608', plannedRuns: 12, planDate: String(tsAt(2026, 8, 11, 8, 0)),
        firstPartId: 'R', settledFromId: 'D' };
    var restTail = { id: 'R2', orderId: '4608', plannedRuns: 6, planDate: String(tsAt(2026, 8, 12, 8, 0)),
        firstPartId: 'R', settledFromId: '' };
    var cuts = [done, restHead, restTail];
    function chainRuns(part) {
        return P.splitChainPartsOf(cuts, part && part.id).reduce(function (s, p) {
            return s + (Number(p && p.plannedRuns) || 0);
        }, 0);
    }
    var noteDone = P.settleSplitNote(done, cuts, dayLabel, chainRuns);
    assertEqual(noteDone.text, 'сделано 27 из 45 · остаток 18 → 11.08.2026',
        'остаток, разбитый по дням (12 + 6), в подписи остаётся ОДНОЙ половиной: 18 из 45');
})();

// ── 4) splitPartiallyDoneCuts: остаток рождается со ссылкой на выполненную часть ──────────────
(function () {
    var inst = Object.create(Controller.prototype);
    inst.cuts = [{ id: '667620', orderId: '4608', slitter: { id: '1' }, plannedRuns: 45, actualRuns: 27,
        firstPartId: '667620', planDate: String(tsAt(2026, 8, 7, 8, 0)),
        startDate: String(tsAt(2026, 8, 7, 19, 20)), endDate: '' }];
    inst.meta = { cut: { id: '1078', reqs: [
        { id: '16411', val: 'Закончено' },
        { id: '196458', val: 'ID первой части' },
        { id: '196459', val: 'ID выполненной части' }
    ] } };
    var applied = null;
    inst.applySplitPlan = function (ops) { applied = ops; return Promise.resolve(true); };
    inst.post = function () { return Promise.resolve({}); };
    inst.splitPartiallyDoneCuts([{ id: '667620', doneRuns: 27, restRuns: 18,
        donePlanStart: tsAt(2026, 8, 7, 19, 20), doneCloseTs: tsAt(2026, 8, 7, 20, 6),
        restPlanStart: tsAt(2026, 8, 11, 9, 1) }]);

    assertEqual(applied.creates.length, 1, 'остаток — одна новая запись');
    assertEqual(applied.creates[0].settledFromId, '667620',
        '#4651 остаток ссылается на ВЫПОЛНЕННУЮ часть, от которой отрезан');
    assertEqual(applied.updates[0].firstPartId, '667620',
        'семантика цепочки дробления не тронута: выполненная часть по-прежнему сама себе голова');
})();

// ── 5) applySplitPlan: ссылка уходит в БД; продолжение по дням её НЕ несёт ────────────────────
(function () {
    function meta(id, pairs) {
        return { id: String(id), reqs: pairs.map(function (p) { return { id: String(p[0]), val: p[1] }; }) };
    }
    var SETTLED = '189b';
    var cutMeta = meta(100, [
        ['190', 'Вид сырья'], ['191', 'Слиттер'], ['192', 'Партия сырья'], ['193', 'Кол-во план'],
        ['194', 'Статус'], ['196', 'Тип намотки'], ['198', 'Лидер'], ['197', 'Метраж, м'],
        ['199', 'Длительность, минут'], ['189', 'ID первой части'], [SETTLED, 'ID выполненной части']
    ]);
    var fbMeta = meta(200, [['201', 'Ширина, мм'], ['202', 'Кол-во полос'], ['203', 'Кол-во рулонов'],
        ['204', 'Кол-во план'], ['205', 'В работе']]);
    var supMeta = meta(300, [['301', 'Метраж, м'], ['302', 'Кол-во рулонов'], ['303', 'В работе'],
        ['304', 'Статус'], ['305', 'Партия ГП']]);
    var CREATE_CUT = '_m_new/100?JSON&up=1';

    function controller() {
        var root = { getAttribute: function () { return 'testdb'; } };
        var c = new Controller(root);
        c.meta.cut = cutMeta; c.meta.finishedBatch = fbMeta; c.meta.supply = supMeta;
        c.cuts = [{ id: 'H', length: 300, materialId: 'M1', status: 'В работе', slitter: { id: 'S1' },
                    batchId: 'B1', winding: 'OUT', leaders: [], firstPartId: 'H',
                    plannedRuns: 45, number: 1000 }];
        c.supplies = [];
        c.footageBySupply = {};
        c.posts = [];
        var idc = 0;
        c.post = function (path, params) {
            c.posts.push({ path: path, params: params || {} });
            return Promise.resolve({ obj: 'NEW' + (++idc) });
        };
        c.loadStripsForCut = function () { return Promise.resolve([]); };
        c.resolveLeaderId = function () { return ''; };
        c.reload = function () { return Promise.resolve(); };
        c.reconcileOrphanOrderSupplies = function () { return Promise.resolve(0); };
        c.persistCutSetupColumns = function () { return Promise.resolve(); };
        c.reconcilePlanStarts = function () { return Promise.resolve(); };
        c.reportPlanAudit = function () {}; c.reportOverfilledDays = function () {};
        c.setBusy = function () {}; c.showProgress = function () {}; c.updateProgress = function () {};
        c.hideProgress = function () {}; c.render = function () {};
        c.notify = function () {};
        return c;
    }
    function createdCut(c) {
        return c.posts.filter(function (p) { return p.path === CREATE_CUT; })[0];
    }

    var settle = controller();
    return settle.applySplitPlan({
        updates: [{ cutId: 'H', sequence: 1, planStartTs: 1000, plannedRuns: 27 }],
        creates: [{ parentCutId: 'H', sequence: 2, planStartTs: 90000, plannedRuns: 18,
                    firstPartSelf: true, settledFromId: 'H' }],
        deletes: []
    }).then(function () {
        var made = createdCut(settle);
        assert(!!made, '«Урегулировать»: остаток создан');
        assertEqual(made.params['t' + SETTLED], 'H',
            '#4651 в БД ушёл реквизит «ID выполненной части» = id выполненной половины');

        var daySplit = controller();
        return daySplit.applySplitPlan({
            updates: [{ cutId: 'H', sequence: 1, planStartTs: 1000, plannedRuns: 40 }],
            creates: [{ parentCutId: 'H', sequence: 2, planStartTs: 90000, plannedRuns: 5 }],
            deletes: []
        }).then(function () {
            var seg = createdCut(daySplit);
            assert(!!seg, 'разбиение по дням: продолжение создано');
            assert(seg.params['t' + SETTLED] === undefined,
                'обычное продолжение по дням ссылки на «выполненную часть» НЕ несёт — их связывает цепочка');
            console.log('\n' + passed + '/' + total + ' passed');
            if (passed !== total) process.exitCode = 1;
        });
    });
})();
