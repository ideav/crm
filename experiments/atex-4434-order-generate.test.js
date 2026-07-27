// Tests for ideav/crm#4434 — дефекты кнопок «Упорядочить» и «Сгенерировать».
//
// п.1 ЗАМОК ДНЯ АБСОЛЮТЕН. Ни «Упорядочить», ни «Сгенерировать», ни балансировка, ни рескью
//     просрочки не переносят зафиксированное (🔒) задание на другой день и не кладут ничего нового
//     в замороженный день. Раньше 🔒 уезжало двумя путями: (а) рескью просроченного 🔒 снимал замок
//     дня (#4224/#4424), (б) переполненный ДРУГИМ заданием день выталкивал 🔒 веткой stranded
//     (#4304). Теперь: указатель дня не уходит вперёд, пока на дне есть неразмещённые 🔒; резка,
//     влезающая в ПУСТОЙ день, кладётся на свой день целиком (с перегрузом), а не переносится;
//     сегмент 🔒 не выталкивается потолком нахлёста. Единственное исключение — день 🔒 целиком
//     нерабочий: тогда движок кричит (console.error + ops.fixedDayLost), а не двигает молча.
//
// п.2 «Почему 2 задания в 1 день в 8 утра?» Цепочка дробления, чья ГОЛОВА раньше «С», целиком
//     исключается из входа планировщика (#4294), но её продолжение / наладочный хвост стои́т
//     ВНУТРИ окна (28.07, 08:00). Планировщик его не видел и набивал тот же день с 08:00 — два
//     задания стартовали в одну минуту. Теперь время таких заданий отдаётся станку как простой.
//
// п.3 После РУЧНОГО перемещения (↑↓ / drag-drop) наладка пересчитывается СРАЗУ и сама — красная
//     кнопка «↻ Пересчитать наладку» после перестановки больше не появляется.
//
// п.4 «Какое НОВОЕ задание и почему оно оторвано от заказа? Откуда ОТХОДЫ?» — это продолжение
//     день-сплита. «Обеспечения» логической резки висят на ГОЛОВЕ цепочки, поэтому карточка
//     продолжения писала «нет связей», теряла «(срок: …)» и красила ВСЕ полосы «(ОТХОДЫ)».
//     Связи/срок/назначение полос продолжения читаются по голове («ID первой части»).
//
// п.5 «Полосы не по убыванию — почему система штрафов не работает?» Направленный штраф
//     KNIVES_INCREASE_COST_MN брался в цели пересортировки из ДЕФОЛТОВ КОДА (planWeight(null, …)),
//     то есть значение из таблицы «Настройка» не применялось никогда. Плюс день, где разных
//     конфигураций больше RESEQ_MAX_NODES, отменял пересортировку ВСЕЙ очереди станка.
//
// Run with: node experiments/atex-4434-order-generate.test.js

process.env.TZ = 'Europe/Moscow';

var mod = require('../download/atex/js/production-planning.js');
var Controller = mod.Controller;
var P = mod.planning;

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

// База «С» = Вт 28.07.2026. Смещения дней: 0 Вт, 1 Ср, 2 Чт, 3 Пт, 4–5 выходные, 6 Пн.
var BASE = new Date(2026, 6, 28, 0, 0, 0, 0).getTime();
var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, KNIFE_MOVE: 0, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
var OP_TIMES = { WIND_300: 1.2 };
function daySettings(extra) {
    var s = { DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', LUNCH_START: '12:20',
        LUNCH_DURATION: '40', TOTAL_INTERVALS: '20', MAX_OVERWORK_CUTS_MN: '5', MAX_OVERWORK_TUNE_MN: '10',
        SLOT_PLACEMENT: '1', DEADLINE_COST_MN: '200', EXACT_DEADLINE_COST_MN: '9',
        ORDER_DIFF_PENALTY_MN: '12', MAX_SLOTS_DISTANCE_HR: '24', MAX_DISTANCE_COST_MN: '10' };
    Object.keys(extra || {}).forEach(function (k) { s[k] = extra[k]; });
    return s;
}
function ts(dayOff, minute) { return String(Math.floor(BASE / 1000) + dayOff * 86400 + minute * 60); }
function widths(n, w) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
function dayKeyOf(dayOff) {
    var d = new Date(BASE + dayOff * 86400000);
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
// Задание: runs проходов по 300 м. o — { fixed, knives, width, mat, winding, firstPartId, status }.
function cut(id, dayOff, minute, runs, o) {
    o = o || {};
    var mins = Math.ceil(runs * OP_TIMES.WIND_300) + 2 * runs;
    return { id: id, orderId: 'O' + id, firstPartId: o.firstPartId || id,
        slitter: { id: '1279', label: 'Станок 2' },
        materialId: o.mat || 'MW308', winding: o.winding || 'OUT', batchId: o.batch || '',
        knifeWidths: widths(o.knives || 11, o.width || 80), knifeCount: o.knives || 11, rollerWidth: 0,
        plannedRuns: runs, isFoil: false, length: 300, status: o.status || '',
        startDate: '', endDate: '', fixed: !!o.fixed,
        planDate: ts(dayOff, minute), number: ts(dayOff, minute),
        duration: String(Math.ceil(runs * OP_TIMES.WIND_300)),
        storedKnifeSetupMin: '30', storedMaterialWindingMin: '15',
        storedCutAndLeaderMin: String(mins) };
}
function planSelf(cuts, dues, opts) {
    opts = opts || {};
    var self = Object.create(Controller.prototype);
    self.cuts = cuts;
    self.changeTimes = TIMES; self.opTimes = OP_TIMES; self.daySettings = daySettings(opts.settings);
    self.filter = { date: '2026-07-28', dateTo: '2026-08-21' };
    self.supplies = Object.keys(dues).map(function (id) {
        return { id: 's' + id, cutId: id, positionId: 'p' + id, rolls: 1, dueKey: dayKeyOf(dues[id]), orderNo: 'ord' + id };
    });
    self.genPositions = Object.keys(dues).map(function (id) {
        return { id: 'p' + id, materialId: 'MW308', width: 80, qty: 1, length: 300, dueKey: dayKeyOf(dues[id]), approved: true };
    });
    self.footageBySupply = {}; self.positionLengthById = {};
    self.slitters = [{ id: '1279', label: 'Станок 2' }];
    self.downtimesBySlitter = {}; self.calendarByDay = {};
    self.freezeByDay = {};
    (opts.freezeDays || []).forEach(function (d) { self.freezeByDay[dayKeyOf(d)] = { id: 'f' + d, notes: '' }; });
    self.meta = { cut: { id: '1078', reqs: [] }, calendar: { id: '1' },
        freeze: (opts.freezeDays && opts.freezeDays.length) ? { id: '2' } : null };
    self.nowMs = function () { return BASE; };
    self.prevSetupBySlitter = {};
    return self;
}
// → { cutId: { day, min } } по обновлениям плана + сам ops.
function place(cuts, dues, opts) {
    var self = planSelf(cuts, dues, opts);
    var ops = Controller.prototype.buildSequenceOps.call(self, cuts, 'SETUP', false, null).ops;
    var byId = {};
    (ops.updates || []).forEach(function (u) {
        var ms = Number(u.planStartTs) * 1000;
        byId[String(u.cutId)] = { day: Math.floor((ms - BASE) / 86400000), min: Math.round((ms - BASE) / 60000) % 1440 };
    });
    return { days: byId, ops: ops };
}

// ── п.1: 🔒 держит свой день, даже когда день переполнен ДРУГИМ заданием ────────────────────────
(function () {
    // bigfix (300 проходов, 🔒 на дне 0) не влезает в день и рвётся по потолку (#4304 — это про
    // размер самой резки, голова остаётся на дне 0). fix2 (🔒 на том же дне 0) раньше выталкивался
    // веткой stranded на день 2 — «зафиксировал, а оно переехало».
    var cuts = [cut('bigfix', 0, 480, 300, { fixed: true }), cut('fix2', 0, 600, 20, { fixed: true })];
    var res = place(cuts, { bigfix: 9, fix2: 9 });
    assertEqual(res.days['bigfix'].day, 0, 'п.1: голова 🔒 bigfix осталась на своём дне 0');
    assertEqual(res.days['fix2'].day, 0, 'п.1: 🔒 fix2 остался на своём дне 0 — переполнение дня его не выталкивает');
    assert(!(res.ops.fixedDayLost && res.ops.fixedDayLost.length),
        'п.1: рабочий день удержан — ops.fixedDayLost пуст');
})();

// ── п.1: просроченный 🔒 НЕ спасается переносом (рескью #4224/#4424 отменён) ────────────────────
(function () {
    var cuts = [cut('free', 1, 480, 20), cut('late', 3, 480, 8, { fixed: true })];
    var res = place(cuts, { free: 9, late: 1 });   // late зафиксирован на дне 3 при сроке день 1
    assertEqual(res.days['late'].day, 3, 'п.1: просроченный 🔒 остался на своём дне 3 (в срок его не тянут)');
})();

// ── п.1: НЕзафиксированное просроченное по-прежнему спасается ───────────────────────────────────
(function () {
    var cuts = [cut('big', 3, 480, 57), cut('free', 3, 600, 8)];
    var res = place(cuts, { big: 9, free: 1 });
    assert(res.days['free'].day <= 1, 'п.1: обычное просроченное задание уходит в срок (регрессия #4118/#4200)');
})();

// ── п.1: в замороженный день планировщик не кладёт НИЧЕГО нового ────────────────────────────────
(function () {
    // День 0 переполнен большой резкой; день 1 ЗАМОРОЖЕН и пуст — перелив обязан его перепрыгнуть.
    var cuts = [cut('big', 0, 480, 200), cut('x', 0, 600, 20)];
    var res = place(cuts, { big: 9, x: 9 }, { freezeDays: [1] });
    assert(res.days['x'].day !== 1, 'п.1: новая резка не встала в замороженный день 1 (день ' + res.days['x'].day + ')');
})();

// ── п.1: задания замороженного дня остаются в нём, чужие туда не въезжают ───────────────────────
(function () {
    var cuts = [cut('a', 0, 480, 20), cut('b', 0, 600, 20), cut('c', 1, 480, 20)];
    var res = place(cuts, { a: 9, b: 9, c: 9 }, { freezeDays: [0] });
    assertEqual([res.days['a'].day, res.days['b'].day], [0, 0], 'п.1: задания замороженного дня 0 остались в нём');
    assert(res.days['c'].day !== 0, 'п.1: задание другого дня не въехало в замороженный день 0');
})();

// ── п.2: время исключённых из раскладки заданий — как простой станка (чистая функция) ───────────
(function () {
    var cuts = [
        cut('head', -1, 950, 0),                       // голова 27.07 (раньше «С») — вне окна
        cut('cont', 0, 480, 6, { firstPartId: 'head' }) // продолжение 28.07 08:00 — В ОКНЕ
    ];
    var ranges = P.excludedCutBlockedRanges(cuts, ['head', 'cont'], BASE);
    assertEqual(Object.keys(ranges), ['1279'], 'п.2: интервалы построены для станка задания');
    // 08:00 = 480 мин от полуночи дня 0; занятость = 30 + 15 + (ceil(6×1.2)+2×6) = 65 мин.
    assertEqual(ranges['1279'], [[480, 545]], 'п.2: занятое продолжением время отдано станку как простой');
})();

// ── п.2: «2 задания в 1 день в 8 утра» — новая резка не садится поверх исключённой ──────────────
(function () {
    var cuts = [
        cut('head', -1, 950, 0),                        // setup-хвост 27.07 (голова цепочки, раньше «С»)
        cut('cont', 0, 480, 6, { firstPartId: 'head' }), // продолжение 28.07 08:00 — в раскладку не входит
        cut('fresh', 0, 600, 5, { knives: 10, width: 90 })
    ];
    var res = place(cuts, { head: 9, cont: 9, fresh: 9 });
    assert(res.days['cont'] == null, 'п.2: цепочка прошлого дня не пере-планируется (#4294)');
    assertEqual(res.days['fresh'].day, 0, 'п.2: новая резка осталась в дне 0');
    assert(res.days['fresh'].min >= 545,
        'п.2: новая резка стартует ПОСЛЕ занятого продолжением времени (' + res.days['fresh'].min + ' ≥ 545), а не в 08:00');
})();

// ── п.2: измерить занятость нечем — не занижаем день молча, а пропускаем и кричим ───────────────
(function () {
    var c = cut('cont', 0, 480, 6);
    c.storedKnifeSetupMin = ''; c.storedMaterialWindingMin = ''; c.storedCutAndLeaderMin = ''; c.duration = '';
    var warned = [];
    var origWarn = console.warn;
    console.warn = function () { warned.push([].slice.call(arguments).join(' ')); };
    var ranges;
    try { ranges = P.excludedCutBlockedRanges([c], ['cont'], BASE); } finally { console.warn = origWarn; }
    assertEqual(ranges, {}, 'п.2: без тайминга интервал не выдумываем');
    assert(warned.length === 1 && /#4434/.test(warned[0]), 'п.2: о неизмеримой занятости КРИЧИМ в консоль');
})();

// ── п.3: ручная перестановка ↑↓ пересчитывает наладку сама ──────────────────────────────────────
(function () {
    var a = { id: 'A', slitter: { id: '101' }, planDate: '1000', startDate: '', fixed: false };
    var b = { id: 'B', slitter: { id: '101' }, planDate: '2000', startDate: '', fixed: false };
    var recalcCalls = [];
    var self = {
        busy: false, meta: { cut: { id: '1078' } },
        setBusy: function () {}, render: function () {},
        notify: function () {},
        post: function () { return Promise.resolve({}); },
        reload: function () { return Promise.resolve(); },
        recalcSetupTiming: function (sid, opts) { recalcCalls.push({ sid: sid, opts: opts }); return Promise.resolve(true); }
    };
    return Controller.prototype.moveCutInDay.call(self, [a, b], 0, 1).then(function (res) {
        assert(res === true, 'п.3: ↑↓ перестановка выполнена');
        assertEqual(recalcCalls.length, 1, 'п.3: после ↑↓ пересчёт наладки вызван автоматически');
        assertEqual([recalcCalls[0].sid, recalcCalls[0].opts.auto], ['101', true],
            'п.3: пересчёт идёт по станку задания и в тихом (auto) режиме');
    });
})();

// ── п.3: drag-drop перестановка тоже пересчитывает наладку сама ─────────────────────────────────
(function () {
    var day = [
        { id: 'A', slitter: { id: '101' }, planDate: '1000', startDate: '', fixed: false },
        { id: 'B', slitter: { id: '101' }, planDate: '2000', startDate: '', fixed: false },
        { id: 'C', slitter: { id: '101' }, planDate: '3000', startDate: '', fixed: false }
    ];
    var recalcCalls = [];
    var self = {
        busy: false, meta: { cut: { id: '1078' } },
        setBusy: function () {}, render: function () {},
        notify: function () {},
        post: function () { return Promise.resolve({}); },
        reload: function () { return Promise.resolve(); },
        recalcSetupTiming: function (sid, opts) { recalcCalls.push({ sid: sid, opts: opts }); return Promise.resolve(true); }
    };
    return Controller.prototype.reorderCutInDay.call(self, day, 'C', 'A').then(function (res) {
        assert(res === true, 'п.3: drag-drop перестановка выполнена');
        assertEqual(recalcCalls.length, 1, 'п.3: после drag-drop пересчёт наладки вызван автоматически');
        assertEqual(recalcCalls[0].opts.auto, true, 'п.3: тихий (auto) режим — без тоста «пересчитывать нечего»');
    });
})();

// ── п.4: связи/срок/полосы продолжения читаются по ГОЛОВЕ цепочки ───────────────────────────────
(function () {
    var supplies = [{ id: 's1', cutId: 'head', positionId: 'p1', rolls: 4, dueKey: 20260730, orderNo: '4379' }];
    var positions = [{ id: 'p1', materialId: 'MW308', width: 40, qty: 4, length: 450, dueKey: 20260730, approved: true }];
    var head = { id: 'head', firstPartId: 'head', materialId: 'MW308', length: 450 };
    var cont = { id: 'cont', firstPartId: 'head', materialId: 'MW308', length: 450 };

    assertEqual(P.supplyHostCutId(cont, supplies), 'head', 'п.4: носитель связей продолжения — голова цепочки');
    assertEqual(P.supplyHostCutId(head, supplies), 'head', 'п.4: у головы носитель — она сама');

    var contLinks = { id: P.supplyHostCutId(cont, supplies) };
    assertEqual(P.cutDueKeys(contLinks, supplies, positions, true), [20260730],
        'п.4: продолжение получает «(срок: …)» головы, а не пустой срок');
    assertEqual(Object.keys(P.cutOrderedWidthKeys(contLinks, supplies, positions)).length, 1,
        'п.4: ширина 40 мм признана «в заказ» → полоса больше не красится «(ОТХОДЫ)»');
    assertEqual(Object.keys(P.cutOrderedWidthKeys(cont, supplies, positions)).length, 0,
        'п.4: контроль — по id самого продолжения «в заказ» не находится ничего (тот самый баг)');
})();

// ── п.4: у продолжения ЕСТЬ свои связи (его отвязали #4357) — читаем по нему, не по голове ──────
(function () {
    var supplies = [
        { id: 's1', cutId: 'head', positionId: 'p1', rolls: 4, dueKey: 20260730, orderNo: '4379' },
        { id: 's2', cutId: 'cont', positionId: 'p2', rolls: 2, dueKey: 20260731, orderNo: '4380' }
    ];
    var cont = { id: 'cont', firstPartId: 'head' };
    assertEqual(P.supplyHostCutId(cont, supplies), 'cont', 'п.4: свои связи авторитетнее головы');
})();

// ── п.5: вес KNIVES_INCREASE_COST_MN из «Настройки» РЕАЛЬНО применяется ─────────────────────────
// Восемь заданий двух сырьевых блоков в одном дне. При дефолтном весе (+20) группировка по сырью
// сильнее направления ножей, и день идёт 18→11→9→22. Подняв вес в «Настройке», оператор обязан
// получить строгое убывание — раньше вес из таблицы в этой ветке НЕ ЧИТАЛСЯ (planWeight(null, …)).
(function () {
    var spec = [[22, 40], [10, 90], [18, 50], [22, 40], [9, 100], [16, 55], [11, 80], [20, 45]];
    function build() {
        var cuts = [], dues = {};
        spec.forEach(function (s, i) {
            var id = 'm' + i;
            cuts.push(cut(id, 0, 480 + i * 40, 4, { knives: s[0], width: s[1], mat: (i % 2 ? 'MW411' : 'MW308') }));
            dues[id] = 8;
        });
        return { cuts: cuts, dues: dues };
    }
    function knifeRow(res, cuts) {
        var byId = {}; cuts.forEach(function (c) { byId[String(c.id)] = c; });
        return Object.keys(res.days).map(function (id) { return { id: id, ts: res.days[id], k: byId[id].knifeCount }; })
            .sort(function (a, b) { return (a.ts.day - b.ts.day) || (a.ts.min - b.ts.min); })
            .map(function (r) { return r.k; });
    }
    function isDesc(row) {
        for (var i = 1; i < row.length; i++) if (row[i] > row[i - 1]) return false;
        return true;
    }
    var def = build();
    var rowDefault = knifeRow(place(def.cuts, def.dues), def.cuts);
    var hi = build();
    var rowHeavy = knifeRow(place(hi.cuts, hi.dues, { settings: { KNIVES_INCREASE_COST_MN: '200' } }), hi.cuts);

    assert(JSON.stringify(rowDefault) !== JSON.stringify(rowHeavy),
        'п.5: вес KNIVES_INCREASE_COST_MN из «Настройки» МЕНЯЕТ порядок (' + rowDefault.join(',') + ' → ' + rowHeavy.join(',') + ')');
    assert(isDesc(rowHeavy),
        'п.5: при весе 200 ножи встают строго по убыванию (' + rowHeavy.join(',') + ')');
})();

// ── п.5: широкий день больше не отменяет пересортировку ОСТАЛЬНЫХ дней очереди ──────────────────
// resequenceWithinDays раньше возвращал null, если ХОТЬ ОДИН день шире точного перебора
// (RESEQ_MAX_NODES) — и весь станок оставался без «ножей по убыванию».
(function () {
    var wide = [], dues = {};
    for (var i = 0; i < 14; i++) {
        var id = 'g' + i;
        wide.push(cut(id, 0, 480 + i * 20, 1, { knives: 3 + (i * 5) % 20, width: 40 + i }));
        dues[id] = 10;
    }
    var res = place(wide, dues);
    var byId = {}; wide.forEach(function (c) { byId[String(c.id)] = c; });
    var row = Object.keys(res.days).map(function (id) { return { id: id, ts: res.days[id], k: byId[id].knifeCount }; })
        .sort(function (a, b) { return (a.ts.day - b.ts.day) || (a.ts.min - b.ts.min); });
    var firstDay = row.filter(function (r) { return r.ts.day === row[0].ts.day; }).map(function (r) { return r.k; });
    // Порядок пришёл из жадной цепочки: она стартует с самой «широкой» конфигурации.
    assertEqual(firstDay[0], Math.max.apply(null, firstDay),
        'п.5: широкий день пересортирован — начинается с максимума полос (' + firstDay.join(',') + ')');
    var drops = 0;
    for (var j = 1; j < firstDay.length; j++) if (firstDay[j] > firstDay[j - 1]) drops++;
    assert(drops <= 1, 'п.5: ряд полос широкого дня практически монотонен — ростов ' + drops + ' (' + firstDay.join(',') + ')');
})();

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' passed');
});
