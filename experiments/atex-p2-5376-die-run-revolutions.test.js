// ideav/crm#5376 п.3: пробег и ресурс ножа измеряются в оборотах (об), а не в метрах.
// Один оборот = один раппорт вала = зубья × 3.175 мм; обороты = метры × 1000 / раппорт.
//   - съём на пульте высечки пишет в «Движение пробега» обороты вала задания;
//   - пробег ножа, износ и предупреждение пульта считаются в оборотах;
//   - прогноз планирования: открытые задания ножа = метраж × 1000 / раппорт вала;
//   - ресурс по умолчанию — настройка DIE_RESOURCE_DEFAULT_REV;
//   - «начальный остаток» из 1С пишется как есть, в оборотах.
//
// Run with: node experiments/atex-p2-5376-die-run-revolutions.test.js
'use strict';

var LP = require('../download/atex/js/label-production.js').core;
var DC = require('../download/atex-p2/js/die-cutter.js').core;
var PC = require('../download/atex-p2/js/die-planning-core.js').core;
var LI = require('../download/atex-p2/js/label-import-core.js');

var pass = 0, total = 0;
function assert(cond, msg, extra) {
    total++;
    if (cond) { pass++; console.log('PASS — ' + msg); }
    else { console.log('FAIL — ' + msg + (extra !== undefined ? '  ' + extra : '')); process.exitCode = 1; }
}
function safe(fn, dflt) { try { return fn(); } catch (e) { return dflt === undefined ? 'ERR ' + e.message : dflt; } }

var REPEAT_96 = 96 * 3.175;   // 304.8 мм
var REPEAT_142 = 142 * 3.175; // 450.85 мм

// ── Модель: обороты ↔ метры ──
assert(safe(function() { return LP.revsFromMeters(100, REPEAT_96); }) === 328, '100 м на валу 96 зубьев = 328 об', String(safe(function() { return LP.revsFromMeters(100, REPEAT_96); })));
assert(safe(function() { return LP.revsFromMeters(100, REPEAT_142); }) === 222, '100 м на валу 142 зуба = 222 об');
assert(safe(function() { return isNaN(LP.revsFromMeters(100, 0)); }) === true, 'раппорт неизвестен — оборотов нет (NaN), а не ноль');
assert(LP.PRODUCTION_CONFIGS['этикетка'].tables.dieRun.reqs.revs === 'Обороты пробега', 'колонка движения пробега — «Обороты пробега»');
assert(LP.PRODUCTION_CONFIGS['этикетка'].tables.dieBrand.reqs.resource === 'Ресурс, об', 'ресурс марки ножа — «Ресурс, об»');

// ── Пробег и износ в оборотах ──
var mil = safe(function() { return LP.dieMileage([{ id: 1, date: 1, kind: 'начальный остаток', revs: 12000 }, { id: 2, date: 2, kind: 'вырубка', revs: 328 }]); }, {});
assert(mil.revs === 12328, 'пробег ножа = начальный остаток + вырубка, в оборотах', JSON.stringify(mil));
var idx = safe(function() { return LP.dieMileageIndex([{ die_id: 'D1', run_id: 1, run_date: 1, run_kind: 'вырубка', revs: '500' }, { die_id: 'D1', run_id: 2, run_date: 2, run_kind: 'вырубка', revs: '250' }]); }, {});
assert(idx.D1 && idx.D1.revs === 750, 'индекс пробега по отчёту die_runs считает колонку revs', JSON.stringify(idx));
assert(safe(function() { return LP.dieResource('', '1000000').revs; }) === 1000000, 'ресурс по умолчанию — в оборотах');
assert(safe(function() { return LP.dieResource('490000', '1000000'); }).revs === 490000, 'ресурс марки главнее умолчания');
assert(safe(function() { return LP.dieWearLevel(900000, 1000000); }) === 'near' && safe(function() { return LP.dieWearLevel(1000000, 1000000); }) === 'over', 'износ: от 90 % — near, от 100 % — over');
assert(safe(function() { return LP.initialRunPlan([], 5000); }).revs === 5000, 'начальный остаток нового ножа — в оборотах');

// ── Пульт высечки: съём пишет обороты ──
var job = { id: '10', dieId: 'D1', status: 'запланировано', footage: 1000, pullsPlan: 10, pullsFact: 0, streams: 2, repeatMm: REPEAT_96, rollLenM: 0 };
var plan = safe(function() { return DC.takeoffPlan(job, [job], [], [], 3, 100); }, {});
assert(plan.ok === true && JSON.stringify(plan.runs) === '[328,328,328]', 'три съёма по 100 м на валу 96 зубьев пишут 3 × 328 об', JSON.stringify(plan));
var job142 = Object.assign({}, job, { repeatMm: REPEAT_142 });
assert(JSON.stringify((safe(function() { return DC.takeoffPlan(job142, [job142], [], [], 1, 100); }, {})).runs) === '[222]', 'вал 142 зуба: 100 м = 222 об');
var noRep = Object.assign({}, job, { repeatMm: 0 });
var bad = safe(function() { return DC.takeoffPlan(noRep, [noRep], [], [], 1, 100); }, {});
assert(bad.ok === false && /раппорт/.test(bad.error || ''), 'раппорт вала неизвестен — ошибка, ни одной записи с выдуманным числом', JSON.stringify(bad));
assert((safe(function() { return DC.takeoffPlan(noRep, [noRep], [], [], 0, 0); }, {})).ok === true, 'дописать хвосты (0 съёмов) раппорт не требует');

// пробег за смену и вырубленное по заданию — в оборотах
var runs = [
    { id: '1', date: 100, revs: 5000, kind: 'начальный остаток', jobId: '', dieId: 'D1' },
    { id: '2', date: 200, revs: 328, kind: 'вырубка', jobId: '10', dieId: 'D1' },
    { id: '3', date: 1000, revs: 328, kind: 'вырубка', jobId: '10', dieId: 'D1' }
];
var now = safe(function() { return DC.dieMileageNow('D1', runs, 500); }, {});
assert(now.revs === 5656 && now.today === 328 && now.start === 5328, 'пробег сейчас / за смену / на начало — в оборотах', JSON.stringify(now));
var rem = safe(function() { return DC.jobRemainingRevs(job, runs); });
assert(rem === 3281 - 656, 'осталось оборотов задания = метраж × 1000 / раппорт − вырубленное', String(rem));

// предупреждение пульта: сравнение оборотов с ресурсом в оборотах, текст в «об»
var w = safe(function() { return DC.dieWearNotice(910000, 10000, 1000000); }, null);
assert(w && w.level === 'near' && w.share === 91 && w.after === 92, 'предупреждение от 90 % ресурса в оборотах', JSON.stringify(w));
assert(w && /\d об(?![а-я])/.test(w.text) && !/\d м(?![а-я])/.test(w.text), 'в тексте предупреждения обороты (об), не метры', w && w.text);

// ── Планирование: прогноз износа в оборотах ──
var cfg = safe(function() { return PC.readSettings([{ key: 'DIE_RESOURCE_DEFAULT_REV', type: '', value: '900 000' }], 'x'); }, {});
assert(cfg.dieResource === 900000, 'ресурс по умолчанию читается из DIE_RESOURCE_DEFAULT_REV');
assert(PC.DEFAULTS.dieResource === 300000, 'ресурс по умолчанию без настройки — 300 000 об (медиана пробега списанных ножей из 1С)');
var jobs = [{ id: 'a', dieId: 'D1', footage: 1000, repeatMm: REPEAT_96, status: 'запланировано' },
    { id: 'b', dieId: 'D1', footage: 500, repeatMm: REPEAT_96, status: 'запланировано' },
    { id: 'c', dieId: 'D2', footage: 500, repeatMm: 0, status: 'запланировано' }];
var open = safe(function() { return PC.openRevsByDie(jobs); }, {});
assert(open.D1 === 3281 + 1640, 'открытые задания ножа в оборотах: метраж × 1000 / раппорт', JSON.stringify(open));
assert(open.D2 === undefined || open.D2 === 0, 'вал без раппорта: оборотов нет, число не выдумывается', JSON.stringify(open));
var fl = safe(function() { return PC.jobFlags(jobs[0], { dies: { D1: { state: 'Рабочий', mileage: 95000, resource: 100000 } }, openRevs: { D1: 4921 } }); }, { warnings: [] });
assert(fl.warnings.some(function(x) { return /ресурс ножа: прогноз пробега 100 %/.test(x); }), 'прогноз = пробег + открытые обороты; ≥ 90 % — предупреждение', JSON.stringify(fl));
var fl2 = safe(function() { return PC.jobFlags(jobs[0], { dies: { D1: { state: 'Рабочий', mileage: 1000, resource: 100000 } }, openRevs: { D1: 4921 } }); }, { warnings: [] });
assert(!fl2.warnings.some(function(x) { return /ресурс ножа/.test(x); }), 'далеко от ресурса — предупреждения нет');
var di = safe(function() { return PC.dieInfo([{ id: 'D1', revs: 777, brandId: 'B', state: 'Рабочий', no: '1' }], { B: '490000' }, 1000000); }, {});
assert(di.D1 && di.D1.mileage === 777 && di.D1.resource === 490000, 'dieInfo: пробег и ресурс в оборотах', JSON.stringify(di));

// ── Импорт 1С: «Пробег» — обороты, пишется как есть ──
var t = { die: { id: '1', reqs: {}, reqNames: {} }, cylinder: { id: '2', reqs: {} }, dieRun: { id: '3', reqs: { revs: '31', kind: '32' } } };
var ctx = { tables: t, dies: {}, dupInBase: {}, runsByDie: {}, initialKindId: '77', dict: { cylinder: {}, base: {}, brand: {}, state: {} }, labels: {} };
var parsed = { items: [{ row: 2, key: 'K1', values: {}, mileage: 12000, mileageSource: 'Ножи', warnings: [], errors: [] }], duplicates: [] };
var pl = safe(function() { return LI.planKnives(parsed, ctx, { now: '1790000000' }); }, { ops: [] });
var run = (pl.ops || []).filter(function(o) { return o.table === '3'; })[0];
assert(run && run.fields.t31 === '12000', 'начальный остаток из 1С записан в «Обороты пробега» без пересчёта', JSON.stringify(pl.ops));

console.log('\nИтого: ' + pass + ' из ' + total);
