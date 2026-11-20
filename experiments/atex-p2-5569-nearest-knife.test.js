// ideav/crm#5569 — подбор ближайшего подходящего ножа и отметка «нужно заказать нож».
//
//   1. допуск размера LABEL_DIE_SIZE_TOLERANCE_MM: точного ножа нет — берётся ближайший по
//      размеру в пределах допуска («Подбор ножа» = «близкий»); точный всегда важнее близкого;
//      без настройки (0) подбор точный, как прежде;
//   2. нож, у которого этикетки не помещаются на раппорт вала (на раппорте × (длина + м/э) >
//      раппорт + 0,5 мм; длина фактическая, без неё номинальная), автоподбор пропускает;
//   3. «Нужно заказать нож» — ручная отметка менеджера на позиции: держит позицию, в
//      планирование высечки она не идёт; поле необязательное в схеме базы;
//   4. допуск читают и «Заказы этикетки», и планирование высечки (одинаковый подбор).
//
// Run with: node experiments/atex-p2-5569-nearest-knife.test.js

process.env.TZ = 'UTC';
var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var LP = require('../download/atex/js/label-production.js').core;
var LO = require('../download/atex-p2/js/label-orders.js').core;
var C = require('../download/atex-p2/js/die-planning-core.js').core;

function die(id, w, l, extra) {
    var d = { id: id, no: 'N' + id, width: w, length: l, base: 'Бумага', streams: 2, selectable: true, revs: 0 };
    Object.keys(extra || {}).forEach(function(k) { d[k] = extra[k]; });
    return d;
}
function ids(r) { return (r.candidates || []).map(function(d) { return d.id; }).join(','); }
var POS = { width: 58, length: 40, base: 'Бумага', orderStreams: 1 };

// ── 1. Допуск размера ────────────────────────────────────────────────────────
(function() {
    assert(LP.DIE_PICK && LP.DIE_PICK.NEAR === 'близкий', 'DIE_PICK.NEAR = «близкий»', JSON.stringify(LP.DIE_PICK));
    var dies = [die('1', 58, 41, { revs: 10 }), die('2', 58, 39.3, { revs: 500 }), die('3', 58, 42)];
    var exact = LP.pickDie(POS, dies);
    assert(!exact.ok && /нет ножа 58×40/.test(exact.reason), 'без допуска — только точный размер', JSON.stringify(exact));

    var near = LP.pickDie(POS, dies, { sizeTolerance: 1.65 });
    assert(near.ok && near.die.id === '2', 'ближайший по размеру (0,7 мм), а не меньший пробег (1 мм)', JSON.stringify(near.die && near.die.id));
    assert(near.ok && near.near === true, 'результат помечен как близкий');
    assert(ids(near) === '2,1', 'кандидаты — в пределах допуска, по близости; 42 (2 мм) вне допуска', ids(near));

    var withExact = LP.pickDie(POS, dies.concat([die('4', 58, 40, { revs: 900000 })]), { sizeTolerance: 1.65 });
    assert(withExact.ok && withExact.die.id === '4' && !withExact.near, 'точный нож важнее близкого, даже с большим пробегом', JSON.stringify(withExact.die && withExact.die.id));
    assert(ids(withExact) === '4', 'при точном кандидаты — только точные', ids(withExact));

    var width = LP.pickDie(POS, [die('5', 59.7, 40)], { sizeTolerance: 1.65 });
    assert(!width.ok && /нет ножа 58×40 \(допуск ±1,65 мм\)/.test(width.reason), 'допуск по каждой стороне; причина называет допуск', JSON.stringify(width.reason));

    var base = LP.pickDie(POS, [die('6', 58, 39.5, { base: 'ПП' })], { sizeTolerance: 1.65 });
    assert(!base.ok && /другой основе/.test(base.reason), 'близкий нож проходит те же проверки (основа)', JSON.stringify(base.reason));

    var pd = LP.positionDie(POS, dies, { sizeTolerance: 1.65 });
    assert(pd.ok && pd.pick === 'близкий' && pd.die.id === '2', 'positionDie: «Подбор ножа» = близкий', JSON.stringify({ pick: pd.pick }));
    var pdExact = LP.positionDie(POS, [die('4', 58, 40)], { sizeTolerance: 1.65 });
    assert(pdExact.pick === 'подобран', 'точный — «подобран»', pdExact.pick);
})();

// ── 2. Раппорт ───────────────────────────────────────────────────────────────
(function() {
    // 723938: 7 × (50 + 3) = 371 мм на вал 116 (368,3 мм) — не помещается.
    var bad = die('10', 40, 50, { labelsPerRepeat: 7, labelGap: 3, repeatMm: 368.3, revs: 0 });
    var good = die('11', 40, 50, { labelsPerRepeat: 6, labelGap: 3, repeatMm: 330.2, revs: 90000 });
    var r = LP.pickDie({ width: 40, length: 50, base: 'Бумага', orderStreams: 1 }, [bad, good]);
    assert(r.ok && r.die.id === '11', 'нож «не на раппорт» пропущен, взят следующий подходящий', JSON.stringify(r.die && r.die.id));
    assert(ids(r) === '11', 'в кандидатах его нет', ids(r));
    var only = LP.pickDie({ width: 40, length: 50, base: 'Бумага', orderStreams: 1 }, [bad]);
    assert(!only.ok && /не помещаются на раппорт/.test(only.reason), 'другого нет — причина «не помещаются на раппорт»', JSON.stringify(only.reason));

    // 740617: 8 × (39,3 + 1,98) = 330,24 на вал 104 (330,2) — помещается по фактической длине.
    var fact = die('12', 58, 40, { labelsPerRepeat: 8, labelGap: 1.98, repeatMm: 330.2, actualLength: 39.3 });
    assert(LP.pickDie(POS, [fact]).ok, 'фактическая длина 39,3: 330,24 ≤ 330,2 + 0,5');
    var nominal = die('13', 58, 40, { labelsPerRepeat: 8, labelGap: 1.98, repeatMm: 330.2 });
    assert(!LP.pickDie(POS, [nominal]).ok, 'без фактической — номинальная 40: 335,8 > 330,7');
    var unknown = die('14', 58, 40, { labelsPerRepeat: 8, labelGap: 1.98 });
    assert(LP.pickDie(POS, [unknown]).ok, 'раппорт вала неизвестен — проверка не применяется');
})();

// ── 3. «Нужно заказать нож» ──────────────────────────────────────────────────
(function() {
    var f = LP.labelPositionFlags({ pick: 'близкий' });
    assert(f.ready, 'близкий нож позицию не держит', JSON.stringify(f));
    var o = LP.labelPositionFlags({ pick: 'подобран', dieToOrder: true });
    assert(!o.ready && o.blocks.indexOf('нужно заказать нож') !== -1, 'отметка держит позицию', JSON.stringify(o));

    var row = { 'РулоновID': '7', 'Ширина, мм': '58', 'Длина, мм': '40', 'Заказать нож': '1' };
    var pos = LO.positionFromRow(row, {});
    assert(pos.dieToOrder === true, 'positionFromRow читает «Заказать нож»', JSON.stringify(pos.dieToOrder));
    assert(LO.positionFromRow({ 'РулоновID': '8' }, {}).dieToOrder === false, 'пусто — отметки нет');

    var meta = [{ id: '1', val: 'Заказанное количество', reqs: [{ id: '11', val: 'Нужно заказать нож' }] }];
    var t = LP.resolveProductionTables(meta, 'этикетка');
    assert(t.tables.position && t.tables.position.reqs.dieToOrder === '11', 'реквизит «Нужно заказать нож» в конфигурации позиции', JSON.stringify(t.tables.position));
    var t0 = LP.resolveProductionTables([{ id: '1', val: 'Заказанное количество', reqs: [] }], 'этикетка');
    assert(t0.missing.every(function(m) { return !/Нужно заказать нож|Длина этикетки факт/.test(m); }), 'новые поля необязательны: их отсутствие — не «не найдено»',
        JSON.stringify(t0.missing.filter(function(m) { return /заказать|факт/.test(m); })));
})();

// ── 4. Настройка допуска в обоих рабочих местах ──────────────────────────────
(function() {
    var dies = [die('2', 58, 39.3, { labelsPerRepeat: 1, repeatMm: 330.2, streams: 1 })];
    var pos = { id: 'p1', width: 58, length: 40, base: 'Бумага', orderStreams: 1, rolls: 10, labelsPerRoll: 1000 };
    var plan = LO.planPosition(pos, dies, { mrLength: 2000, dieSizeTolerance: 1.65 });
    assert(plan.die.ok && plan.write.diePick === 'близкий' && plan.write.die === '2', 'planPosition: допуск из настроек, пишет «близкий»', JSON.stringify(plan.write));
    assert(!LO.planPosition(pos, dies, { mrLength: 2000 }).die.ok, 'без настройки — точный подбор');

    var S = C.readSettings([{ key: 'LABEL_DIE_SIZE_TOLERANCE_MM', type: 'ATEH1', value: '1,65' }], 'ateh1');
    assert(S.dieSizeTolerance === 1.65, 'планирование читает LABEL_DIE_SIZE_TOLERANCE_MM', JSON.stringify(S.dieSizeTolerance));
    var formed = C.formJobs({ positions: [pos], dies: dies, jobs: [], settings: S, mrLength: 2000 });
    assert(formed.create.length === 1 && formed.create[0].dieId === '2', 'formJobs подбирает с тем же допуском', JSON.stringify(formed));
    var blocked = C.formJobs({ positions: [Object.assign({}, pos, { dieToOrder: true })], dies: dies, jobs: [], settings: S, mrLength: 2000 });
    assert(blocked.create.length === 0 && /нужно заказать нож/.test(blocked.skipped[0].reason), 'позиция с отметкой в задания не идёт', JSON.stringify(blocked.skipped));

    var built = LO.buildDies([{ id: '1', val: 'N1', reqs: { g: '1,98', a: '39,3' } }], { die: { reqs: { labelGap: 'g', actualLength: 'a' } } }, {}, {}, null);
    assert(String(built[0].labelGap) === '1,98' && String(built[0].actualLength) === '39,3', 'buildDies отдаёт м/э и фактическую длину', JSON.stringify(built[0]));
})();

console.log('\n' + passed + '/' + total + ' passed');
