// Unit tests for #4001 — «Упорядочить» пере-выбирает станок для СУЩЕСТВУЮЩИХ резок
// (computeSlitterReassignment): жадный chooseSlitterBySetup + rebalanceSlitterLoad, как при
// генерации, но без пересоздания резок. Проверяем инварианты назначения:
//   • лимит ширины джамбо станка соблюдается (широкое сырьё не идёт на «j<1000»);
//   • стоп-лист сырья соблюдается;
//   • одинаковая конфигурация группируется на один станок;
//   • 🔒 (fixed) не переназначаются (в результате их нет);
//   • станок в отпуске в день резки не выбирается;
//   • пустой вход → пустой результат.
// (Персистентность/мутацию self.cuts и applySplitPlan changed-only проверяют 3781/3795.)
//
// Run with: node experiments/atex-production-planning-4001.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, failed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else { failed++; process.exitCode = 1; }
}

function slitter(id, code, stop) {
    return { id: id, stopMaterialIds: stop || [], widthCode: planning.parseActualWidthCode(code || '') };
}
// Станки как на ateh: 1 и 4 несут лимит ширины «j<1000».
var slitters = [slitter('1', 'j<1000'), slitter('2', ''), slitter('3', ''), slitter('4', 'j<1000')];
var nomWidths = { WIDE: 1000, NARROW: 900 };
var DAY = 20260706;
var SEC = 1751760000; // произвольный unix-сек внутри дня DAY (точное значение неважно для теста)

function desc(o) {
    return {
        id: o.id, slitterId: o.slitterId != null ? o.slitterId : '1',
        materialId: o.materialId, winding: o.winding || 'OUT',
        knifeWidths: o.knifeWidths || [300], knifeCount: (o.knifeWidths || [300]).length,
        isFoil: !!o.isFoil, width: o.width || 300, planDate: o.planDate != null ? o.planDate : SEC,
        plannedRuns: o.plannedRuns || 10, runLength: o.runLength || 450, duration: o.duration || 40
    };
}
var CTX = { slitters: slitters, weights: {}, dayCapacityMin: 450, nominalWidthByMaterial: nomWidths };

// 1) Лимит ширины: WIDE (номинал 1000) → станок 2/3, НЕ 1/4.
var rWide = planning.computeSlitterReassignment([desc({ id: 'w', materialId: 'WIDE' })], [], CTX);
assert(['2', '3'].indexOf(rWide.slitterById['w']) >= 0,
    'широкое сырьё (номинал 1000) назначено на станок 2/3, не на 1/4 (' + rWide.slitterById['w'] + ')');

// 2) Стоп-лист: материал STOP запрещён на 2 и 3 → идёт на 1/4 (у них нет стопа и нет лимита для NARROW).
var slittersStop = [slitter('1', ''), slitter('2', '', ['STOP']), slitter('3', '', ['STOP']), slitter('4', '')];
var rStop = planning.computeSlitterReassignment(
    [desc({ id: 's', materialId: 'STOP' })], [],
    { slitters: slittersStop, weights: {}, dayCapacityMin: 450, nominalWidthByMaterial: {} });
assert(['1', '4'].indexOf(rStop.slitterById['s']) >= 0,
    'сырьё из стоп-листа 2/3 назначено на станок 1/4 (' + rStop.slitterById['s'] + ')');

// 3) Одинаковая конфигурация (сырьё+намотка+ножи) в один день → один станок (группировка переналадки).
var rGroup = planning.computeSlitterReassignment([
    desc({ id: 'g1', materialId: 'NARROW', knifeWidths: [200, 200] }),
    desc({ id: 'g2', materialId: 'NARROW', knifeWidths: [200, 200] })
], [], CTX);
assert(rGroup.slitterById['g1'] === rGroup.slitterById['g2'],
    'две резки одинаковой конфигурации — на одном станке (' + rGroup.slitterById['g1'] + '=' + rGroup.slitterById['g2'] + ')');

// 4) 🔒 fixed не переназначаются — их нет в результате.
var rFixed = planning.computeSlitterReassignment(
    [desc({ id: 'm', materialId: 'NARROW' })],
    [desc({ id: 'f', materialId: 'NARROW', slitterId: '2' })], CTX);
assert(rFixed.slitterById['m'] != null, 'movable «m» получает станок');
assert(!('f' in rFixed.slitterById), 'fixed «f» НЕ переназначается (отсутствует в результате)');

// 5) Станок в отпуске в день резки не выбирается (vacationForDay).
var rVac = planning.computeSlitterReassignment(
    [desc({ id: 'v', materialId: 'NARROW' })], [],
    { slitters: slitters, weights: {}, dayCapacityMin: 450, nominalWidthByMaterial: nomWidths,
      vacationForDay: function() { return { '2': true, '3': true }; } });
assert(['1', '4'].indexOf(rVac.slitterById['v']) >= 0,
    'станки 2/3 в отпуске → NARROW идёт на 1/4 (' + rVac.slitterById['v'] + ')');

// 6) Пустой вход → пустой результат (без падения).
var rEmpty = planning.computeSlitterReassignment([], [], CTX);
assert(Object.keys(rEmpty.slitterById).length === 0, 'пустой movable → пустой результат');

// 7) Каждая movable-резка получает НЕПУСТОЙ станок.
var rAll = planning.computeSlitterReassignment([
    desc({ id: 'a', materialId: 'NARROW' }),
    desc({ id: 'b', materialId: 'WIDE' }),
    desc({ id: 'c', materialId: 'NARROW', knifeWidths: [100, 100, 100] })
], [], CTX);
assert(['a', 'b', 'c'].every(function(id) { return rAll.slitterById[id] && rAll.slitterById[id] !== ''; }),
    'каждая резка получила непустой станок');
assert(['2', '3'].indexOf(rAll.slitterById['b']) >= 0, 'широкая b — на 2/3 даже в смешанном наборе');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
