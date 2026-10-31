// ideav/crm#5315 — Фаза 2 atex, шаг 6: раскрой джамбо и пульт большого слиттера.
//
// Что проверяется (ядро download/atex-p2/js/jumbo-cut-map.js):
//   1. ходовые ширины из «Настройки» («251-258; 307-318») разбираются в диапазоны, кривая
//      строка — ошибка, а не тихий пропуск;
//   2. потребность в форматах: открытые задания высечки без мастер-рулона → группы
//      «сырьё × диапазон формата ножа»; выполненные и обеспеченные не считаются;
//   3. покрытие потребности складом и очередью резки: чужое сырьё и формат вне диапазона
//      не покрывают; резка, которая даст рулон позже план-старта высечки, — «не успевает»;
//   4. жёсткое правило §9.7 состава: карта раскроя не выходит за фактическую ширину партии,
//      сумма полос + кромка = ширина — на ВСЕХ вариантах подбора по случайным входам;
//      каждая полоса лежит в диапазоне своей потребности или ходовой ширины;
//   5. подбор закрывает дефицит, когда ширины хватает, и не режет под чужое сырьё;
//   6. выпуск мастер-рулонов: полосы × съёмы по длине, ровно столько записей; повтор после
//      сбоя продолжает съём, а не начинает заново; номера рулонов не повторяются.
//
// Run with: node experiments/atex-p2-5315-jumbo-cut-map.test.js

process.env.TZ = 'UTC';

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var JC;
try {
    JC = require('../download/atex-p2/js/jumbo-cut-map.js').core;
} catch (e) {
    assert(false, 'модуль jumbo-cut-map.js загружается в Node', e.message);
    console.log('\n' + passed + '/' + total + ' проверок пройдено.');
    return;
}
assert(!!JC, 'модуль jumbo-cut-map.js загружается в Node');

// ── 1. Ходовые ширины ───────────────────────────────────────────────────────
(function() {
    var r = JC.parseWidthRanges('251-258; 307-318');
    assert(r.ok && r.ranges.length === 2 && r.ranges[0].min === 251 && r.ranges[0].max === 258 &&
        r.ranges[1].min === 307 && r.ranges[1].max === 318, 'ходовые «251-258; 307-318» → два диапазона', JSON.stringify(r));
    var d = JC.parseWidthRanges('251–258, 310');
    assert(d.ok && d.ranges.length === 2 && d.ranges[1].min === 310 && d.ranges[1].max === 310,
        'тире и одиночная ширина разбираются', JSON.stringify(d));
    var e = JC.parseWidthRanges('258-251; abc');
    assert(!e.ok && e.errors.length === 2, 'перевёрнутый диапазон и мусор — ошибки строки', JSON.stringify(e));
    var z = JC.parseWidthRanges('');
    assert(z.ok && z.ranges.length === 0, 'пустая настройка — ходовых ширин нет');
})();

// ── 2. Потребность в форматах ───────────────────────────────────────────────
var DAY = 86400;
var T0 = 1790226000; // 24.09.2026 08:00 МСК
var dieRows = [
    { job_id: 'j1', job_start: String(T0 + DAY), job_status: 'Запланировано', footage: '9000', master_roll_id: '', die_id: 'd1', min_format: '266', opt_format: '271', used_format: '270', material_id: 'm1', material: 'Бумага' },
    { job_id: 'j2', job_start: String(T0), job_status: '', footage: '9853', master_roll_id: '', die_id: 'd2', min_format: '266', opt_format: '271', used_format: '270', material_id: 'm1', material: 'Бумага' },
    { job_id: 'j3', job_start: String(T0), job_status: 'Выполнено', footage: '5000', master_roll_id: '', die_id: 'd1', min_format: '266', opt_format: '271', used_format: '270', material_id: 'm1', material: 'Бумага' },
    { job_id: 'j4', job_start: String(T0), job_status: 'Запланировано', footage: '5000', master_roll_id: 'mr9', die_id: 'd1', min_format: '266', opt_format: '271', used_format: '270', material_id: 'm1', material: 'Бумага' },
    { job_id: 'j5', job_start: String(T0 + 2 * DAY), job_status: 'Запланировано', footage: '4000', master_roll_id: '', die_id: 'd3', min_format: '317', opt_format: '322', used_format: '320', material_id: 'm2', material: 'ПП' }
];
var groups = JC.demandGroups(dieRows, { tolerance: 15 });
(function() {
    assert(groups.length === 2, 'две группы потребности: 266 бумага и 317 ПП', JSON.stringify(groups));
    var g = groups.filter(function(x) { return x.materialId === 'm1'; })[0] || {};
    assert(g.meters === 18853, 'метраж группы — сумма открытых заданий без мастер-рулона (9000 + 9853)', String(g.meters));
    assert(g.min === 266 && g.max === 281 && g.opt === 271, 'диапазон формата = [мин, мин + допуск]', g.min + '..' + g.max);
    assert(g.due === T0, 'срок группы — самый ранний план-старт', String(g.due));
    assert(g.jobs.join(',') === 'j2,j1', 'в группе только открытые задания без мастер-рулона, по сроку', g.jobs.join(','));
    assert(groups[0].materialId === 'm1', 'группы упорядочены по сроку');
    var wide = JC.demandGroups([{ job_id: 'x', job_start: String(T0), footage: '100', min_format: '300', opt_format: '330', material_id: 'm1' }], { tolerance: 15 });
    assert(wide[0].max === 330, 'оптимальный формат шире допуска расширяет диапазон до него', String(wide[0].max));
    var noFormat = JC.demandGroups([{ job_id: 'x', job_start: String(T0), footage: '100', min_format: '', opt_format: '', used_format: '', material_id: 'm1' }], { tolerance: 15 });
    assert(noFormat.length === 0 && JC.demandGroups.lastSkipped && JC.demandGroups.lastSkipped.length === 1,
        'задание без формата ножа в потребность не попадает и называется в пропущенных');
})();

// ── 3. Покрытие складом и очередью ──────────────────────────────────────────
(function() {
    var stock = [
        { id: 'r1', format: 270, materialId: 'm1', rest: 2000, status: 'на складе' },
        { id: 'r2', format: 290, materialId: 'm1', rest: 2000, status: 'на складе' },   // вне диапазона
        { id: 'r3', format: 270, materialId: 'm2', rest: 2000, status: 'на складе' },   // чужое сырьё
        { id: 'r4', format: 270, materialId: 'm1', rest: 2000, status: 'брак' },
        { id: 'r5', format: 270, materialId: 'm1', rest: 0, status: 'израсходован' }
    ];
    var queue = [
        { jobId: 'c1', materialId: 'm1', format: 272, meters: 8000, readyAt: T0 + DAY / 2 },
        { jobId: 'c2', materialId: 'm2', format: 320, meters: 4000, readyAt: T0 + 3 * DAY }
    ];
    var cov = JC.coverDemand(groups, JC.stockSupply(stock), queue);
    var g1 = cov.filter(function(g) { return g.materialId === 'm1'; })[0];
    var g2 = cov.filter(function(g) { return g.materialId === 'm2'; })[0];
    assert(g1.stock === 2000, 'склад покрывает только своё сырьё, формат в диапазоне, не брак и не израсходованный', String(g1.stock));
    assert(g1.planned === 8000 && g1.deficit === 18853 - 2000 - 8000, 'очередь резки уменьшает дефицит', g1.planned + ' / ' + g1.deficit);
    assert(g1.late === true, 'резка, готовая позже план-старта первого задания, — «не успевает»', String(g1.late));
    assert(g2.deficit === 0 && g2.late === true, 'ПП покрыт резкой c2, но она готова позже срока', JSON.stringify(g2));
    var again = JC.coverDemand(groups, JC.stockSupply(stock), queue);
    assert(again[0].stock === g1.stock, 'покрытие не портит входные списки: повторный расчёт даёт то же');
})();

// ── 4. Жёсткое правило §9.7: карта не выходит за ширину — по всем вариантам ─
function rangesOf(variant, demand, running) {
    var bad = [];
    variant.strips.forEach(function(s) {
        var ok;
        if (s.purpose === JC.PURPOSE.DEFICIT) {
            var g = demand.filter(function(x) { return x.key === s.groupKey; })[0];
            // под заказ — не шире оптимального формата (лишняя ширина — скрытый отход)
            ok = g && s.format >= g.min && s.format <= Math.min(g.max, Math.max(g.opt, g.min));
        } else {
            ok = running.some(function(r) { return s.format >= r.min && s.format <= r.max; });
        }
        if (!ok) bad.push(s.format + ' ' + s.purpose);
    });
    return bad;
}
(function() {
    var seed = 5315;
    function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
    var violations = [];
    var cases = 0, variants = 0;
    for (var i = 0; i < 300; i++) {
        var width = 900 + Math.floor(rnd() * 700);
        var length = 2000 + Math.floor(rnd() * 3) * 1000;
        var minEdge = Math.floor(rnd() * 3) * 5;
        var nG = 1 + Math.floor(rnd() * 4);
        var demand = [];
        for (var k = 0; k < nG; k++) {
            var mn = 100 + Math.floor(rnd() * 300);
            demand.push({ key: 'g' + k, materialId: rnd() < 0.85 ? 'm1' : 'm2', min: mn, max: mn + Math.floor(rnd() * 16), opt: mn + 3,
                deficit: Math.floor(rnd() * 20000), due: T0 + k * DAY });
        }
        var running = rnd() < 0.7 ? [{ min: 251, max: 258 }, { min: 307, max: 318 }] : [];
        var batch = { width: width, length: length, materialId: 'm1' };
        var res = JC.cutMapVariants(batch, demand, running, { minEdge: minEdge });
        cases++;
        (res.variants || []).forEach(function(v) {
            variants++;
            var sum = v.strips.reduce(function(a, s) { return a + s.format * s.count; }, 0);
            if (sum + v.edge !== width) violations.push('сумма ' + sum + ' + кромка ' + v.edge + ' ≠ ' + width);
            if (v.edge < minEdge) violations.push('кромка ' + v.edge + ' < мин ' + minEdge);
            if (!JC.checkCutMap(width, v.strips, v.edge, minEdge).ok) violations.push('checkCutMap отверг вариант подбора');
            var bad = rangesOf(v, demand, running);
            if (bad.length) violations.push('полосы вне диапазона: ' + bad.join(', '));
            v.strips.forEach(function(s) {
                if (s.purpose !== JC.PURPOSE.DEFICIT) return;
                var g = demand.filter(function(x) { return x.key === s.groupKey; })[0];
                if (!g || g.materialId !== 'm1') violations.push('полоса под потребность чужого сырья');
            });
        });
    }
    assert(violations.length === 0, 'карта раскроя: сумма полос + кромка = ширина, кромка ≥ минимальной, полосы в своих диапазонах, под заказ не шире оптимального (' + cases + ' партий, ' + variants + ' вариантов)',
        violations.slice(0, 3).join(' | '));
    assert(variants > cases, 'подбор предлагает варианты (не пусто)', variants + ' на ' + cases);
})();

// ── 5. Подбор закрывает дефицит ──────────────────────────────────────────────
(function() {
    var demand = [{ key: 'g270', materialId: 'm1', min: 266, max: 281, opt: 271, deficit: 18853, due: T0 }];
    var running = [{ min: 251, max: 258 }, { min: 307, max: 318 }];
    var res = JC.cutMapVariants({ width: 1528, length: 4000, materialId: 'm1' }, demand, running, { minEdge: 0 });
    var cover = res.variants.filter(function(v) { return v.kinds.indexOf('cover') !== -1; })[0];
    assert(cover && cover.covered.g270 === 18853, 'вариант «закрыть дефицит» закрывает 18 853 м (5 полос × 4000 м)', cover && JSON.stringify(cover.covered));
    var waste = res.variants.filter(function(v) { return v.kinds.indexOf('waste') !== -1; })[0];
    assert(waste && waste.edge <= cover.edge, 'вариант «минимальный отход» не хуже по кромке', waste && (waste.edge + ' vs ' + cover.edge));
    var other = JC.cutMapVariants({ width: 1528, length: 4000, materialId: 'm2' }, demand, running, { minEdge: 0 });
    assert(other.variants.every(function(v) { return v.strips.every(function(s) { return s.purpose !== JC.PURPOSE.DEFICIT; }); }),
        'партия другого сырья под эту потребность не режется');
    var none = JC.cutMapVariants({ width: 1528, length: 4000, materialId: 'm1' }, [], [], { minEdge: 0 });
    assert(none.variants.length === 0 && /нет/.test(none.reason || ''), 'нет ни потребности, ни ходовых ширин — подбор говорит, почему пусто', none.reason);
    var bad = JC.cutMapVariants({ width: 0, length: 4000, materialId: 'm1' }, demand, running, {});
    assert(bad.variants.length === 0 && /ширин/.test(bad.reason || ''), 'партия без ширины — отказ с причиной', bad.reason);
})();

// ── checkCutMap и ручной ввод полос ──────────────────────────────────────────
(function() {
    var strips = [{ format: 270, count: 3 }, { format: 325, count: 2 }];
    assert(JC.checkCutMap(1528, strips, 68).ok, '270 × 3 + 325 × 2 + кромка 68 = 1528 — карта верна');
    assert(!JC.checkCutMap(1528, strips, 60).ok, 'кромка не сходится с шириной — карта отвергнута');
    assert(!JC.checkCutMap(1400, strips, -60).ok, 'полосы шире партии — карта отвергнута');
    assert(!JC.checkCutMap(1528, strips, 3, 5).ok, 'кромка меньше минимальной — карта отвергнута');
    var p = JC.parseStripsText('270x3 + 325х2');
    assert(p.ok && p.strips.length === 2 && p.strips[1].format === 325 && p.strips[1].count === 2, 'ручной ввод «270x3 + 325х2» разбирается', JSON.stringify(p));
    var q = JC.parseStripsText('270 × 3, 310');
    assert(q.ok && q.strips[1].count === 1, 'полоса без «× N» — одна', JSON.stringify(q));
    assert(!JC.parseStripsText('270x').ok && !JC.parseStripsText('').ok, 'кривой ввод полос — ошибка');
    assert(JC.mapLabel(strips) === '270 × 3 + 325 × 2', 'подпись карты', JC.mapLabel(strips));
})();

// ── 6. Съёмы и выпуск мастер-рулонов ─────────────────────────────────────────
(function() {
    assert(JSON.stringify(JC.pullLengths(4000, 2000)) === '[2000,2000]', 'джамбо 4000 м → 2 съёма по 2000 м');
    assert(JSON.stringify(JC.pullLengths(4500, 2000)) === '[2000,2000,500]', 'остаток длины — последним коротким съёмом');
    assert(JC.pullLengths(0, 2000).length === 0 && JC.pullLengths(4000, 0).length === 0, 'без длины съёмов нет');
    var strips = [{ format: 270, count: 3, purpose: 'под дефицит' }, { format: 325, count: 2, purpose: 'в запас' }];
    var plan = JC.releasePlan(strips, [2000, 2000]);
    assert(plan.length === 10, 'выпуск = полосы × съёмы: 5 × 2 = 10 мастер-рулонов', String(plan.length));
    assert(plan.filter(function(r) { return r.format === 325 && r.pull === 1; }).length === 2, 'в каждом съёме — по рулону на полосу');
    var pr = JC.pullProgress(strips, [2000, 2000], 7);
    assert(pr.perPull === 5 && pr.pullIndex === 1 && pr.inPull === 2 && pr.done === false,
        'после сбоя на 7-м рулоне: идёт съём 2, в нём уже 2 рулона', JSON.stringify(pr));
    var todo = JC.pullRolls(strips, [2000, 2000], 7);
    assert(todo.length === 3 && todo.every(function(r) { return r.pull === 1; }) && todo[0].format === 270 && todo[2].format === 325,
        'повтор приёмки создаёт только недостающие 3 рулона съёма 2', JSON.stringify(todo));
    var fin = JC.pullProgress(strips, [2000, 2000], 10);
    assert(fin.done === true && JC.pullRolls(strips, [2000, 2000], 10).length === 0, 'все рулоны приняты — задание выполнено, лишних не создаётся');
    assert(JSON.stringify(JC.nextRollNumbers(['МР-0169', 'МР-0102', 'Д-0101', ''], 2)) === '["МР-0170","МР-0171"]',
        'номера мастер-рулонов продолжают последний и не повторяются');
    assert(JC.nextRollNumbers([], 1)[0] === 'МР-0001', 'первый мастер-рулон — МР-0001');
})();

// ── 7. Состояние из записей базы и модули рабочих мест ───────────────────────
(function() {
    var t = {
        material: { id: '10', reqs: { jumboWidth: '52', jumboLength: '54' } },
        jumboBatch: { id: '11', reqs: { material: '55', arrived: '57', width: '59', length: '61', rest: '62', warehouse: '63' } },
        jumboJob: { id: '16', reqs: { jumboBatch: '109', duration: '110', status: '112', edgeWaste: '114' } },
        jumboStrip: { id: '17', reqs: { count: '116', purpose: '118' } },
        masterRoll: { id: '18', reqs: { format: '120', length: '121', material: '122', jumboJob: '124', rest: '125', status: '127', warehouse: '128' } }
    };
    var raw = {
        materials: [{ id: 'm1', val: 'Бумага', reqs: { 52: '1530', 54: '4000' } }],
        batches: [
            { id: 'b1', val: 'Д-0001', reqs: { ref_55: '10:m1', 55: 'Бумага', 59: '1528', 61: '', 62: '' } },          // ширина по паспорту, длина из сырья
            { id: 'b2', val: 'Д-0002', reqs: { ref_55: '10:m1', 55: 'Бумага', 59: '', 61: '4000', 62: '0.00' } },      // вырезана
            { id: 'b3', val: 'Д-0003', reqs: { ref_55: '10:m1', 55: 'Бумага', 59: '', 61: '', 62: '4000' } }           // стоит в задании
        ],
        jobs: [
            { id: 'j1', val: String(T0), reqs: { ref_109: '11:b3', 110: '90', 112: 'В работе', 114: '68' } },
            { id: 'j0', val: String(T0 - DAY), reqs: { ref_109: '11:b2', 110: '90', 112: 'Выполнено', 114: '5' } }
        ],
        stripRows: [
            { strip_id: '102', job_id: 'j1', strip_format: '325', strip_count: '2', strip_purpose: 'в запас' },
            { strip_id: '101', job_id: 'j1', strip_format: '270', strip_count: '3', strip_purpose: 'под дефицит' }
        ],
        rolls: [
            { id: 'r2', val: 'МР-0002', reqs: { 120: '270', 121: '2000', ref_122: '10:m1', ref_124: '16:j1', 125: '2000', 127: 'на складе' } },
            { id: 'r1', val: 'МР-0001', reqs: { 120: '270', 121: '2000', ref_122: '10:m1', ref_124: '16:j1', 125: '2000', 127: 'на складе' } }
        ]
    };
    var st = JC.buildState(raw, t, 2000);
    var b1 = st.batches.b1.geometry;
    assert(b1.width === 1528 && b1.length === 4000 && b1.rest === 4000, 'партия: ширина по паспорту, длина из сырья, пустой остаток = вся длина', JSON.stringify(b1));
    assert(st.batchesToCut.map(function(b) { return b.id; }).join(',') === 'b1', 'к резке — только партии с остатком, не стоящие в открытом задании',
        st.batchesToCut.map(function(b) { return b.id; }).join(','));
    var j1 = st.openJobs[0];
    assert(st.openJobs.length === 1 && j1.id === 'j1', 'выполненное задание в очередь не попадает');
    assert(j1.strips.map(function(s) { return s.format; }).join(',') === '270,325', 'полосы задания — из отчёта jumbo_tasks, по порядку записи');
    assert(j1.created === 2 && j1.progress.pullIndex === 0 && j1.progress.inPull === 2 && j1.rolls[0].id === 'r1', 'принятые рулоны задания считаются по ссылке, по порядку записи', JSON.stringify(j1.progress));
    var q = JC.queueSupply(st.openJobs, 2000);
    var m270 = q.filter(function(x) { return x.format === 270; })[0];
    assert(m270 && m270.meters === 4 * 2000 && m270.readyAt === T0 + 90 * 60, 'очередь даёт только непринятые рулоны: 270 — 6 − 2 = 4 рулона', JSON.stringify(m270));
    var s = JC.readSettings([{ key: 'JUMBO_RUNNING_WIDTHS', type: 'ATEH', value: '251-258; 307-318' }, { key: 'MASTER_ROLL_LENGTH_M', type: '', value: 'много' }], 'ateh1');
    assert(s.runningWidths.length === 2 && s.rollLength === 2000 && s.errors.length === 1 && s.tolerance === 15, 'настройки: ходовые ширины, кривое число — ошибка и значение по умолчанию', JSON.stringify(s));
    var f = JC.jobFields(t, { start: T0, batchId: 'b1', minutes: 90, edge: 68 });
    assert(f.t16 === String(T0) && f.t109 === 'b1' && f.t112 === 'Запланировано' && f.t114 === '68', 'поля нового задания первичной резки', JSON.stringify(f));

    var JS = require('../download/atex-p2/js/jumbo-slitter.js').core;
    assert(JS.batchRestAfter(4000, [2000, 2000], 1) === 2000 && JS.batchRestAfter(4000, [2000, 2000], 2) === 0,
        'остаток партии — от длины и принятых съёмов (повтор не вычитает дважды)');
    var grid = JS.rollGrid(j1);
    assert(grid.length === 5 && grid[0].cells[0].no === 'МР-0001' && grid[1].cells[0].no === 'МР-0002' && !grid[2].cells[0] && !grid[0].cells[1],
        'сетка пульта: полоса × съём, принятые рулоны на своих местах');

    var JCut = require('../download/atex-p2/js/jumbo-cutting.js').core;
    var demand = [{ key: 'g', materialId: 'm1', min: 266, max: 281, opt: 271, deficit: 5000 }];
    var mv = JCut.manualVariant(st.batches.b1, [{ format: 270, count: 3 }, { format: 325, count: 2 }], demand, 0);
    assert(mv.ok && mv.variant.edge === 68 && mv.variant.strips[0].purpose === 'под дефицит' && mv.variant.strips[1].purpose === 'в запас' && mv.variant.coveredTotal === 5000,
        'ручная карта: кромка = ширина − полосы, полоса в диапазоне дефицита — «под дефицит»', JSON.stringify(mv));
    assert(!JCut.manualVariant(st.batches.b1, [{ format: 325, count: 5 }], demand, 0).ok, 'ручная карта шире партии отвергнута');
    assert(JCut.fromInput(JCut.toInput(T0)) === T0 && JCut.toInput(T0) === '2026-09-24T08:00', 'план-старт в поле ввода — по Москве', JCut.toInput(T0));
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено.');
