// Tests for ideav/crm#3957 — «на первый станок накидали после отпуска».
//
// Причина (лог из #3951, «⚖ выравнивание»): rebalanceSlitterLoad балансировал загрузку по span/
// endPos, но its machineDayOff (в контроллере) учитывал ТОЛЬКО отпуск станка (slitterOnVacationDay),
// НЕ выходные/праздники (#3788). Реальное расписание пропускает и то, и другое (calendarBlockedRanges
// + downtimeBlockedRanges). Из-за этого содержимое Станка 1, влезающее в рабочие дни ДО выходных
// перед отпуском, «не доходило» до отпуска в модели span/endPos: цикл обрывался на первом свободном
// дне (Станок 1 показывался как «4д» вместо «12д»), выравнивание не видело перегруза за отпуском и
// НЕ стекало хвост на свободные станки — Станок 1 копил работу после отпуска, пока 2/3/4 простаивали.
//
// Фикс #3957: machineDayOff = balanceDayOff = «выходной/праздник (#3788, для всех) ИЛИ отпуск станка».
// Модель span/endPos пропускает те же дни, что и расписание → хвост за отпуском стекает.
//
// Run with: node experiments/atex-production-planning-3957.test.js

process.env.TZ = 'UTC';
var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;
var Controller = api.Controller;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++;
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assert(cond, name) { assertEqual(!!cond, true, name); }

// ── 1) balanceDayOff = !dayIsWorking ИЛИ отпуск станка (композиция wiring) ──
(function () {
    var ctrl = Object.create(Controller.prototype);
    var WORKING = 1000, WEEKEND = 2000, VAC = 3000;   // условные «дни» (мс-заглушки)
    ctrl.dayIsWorking = function (ms) { return ms !== WEEKEND; };                 // выходной = WEEKEND
    ctrl.slitterOnVacationDay = function (id, ms) { return String(id) === '1' && ms === VAC; };  // отпуск Станка 1 в VAC
    assert(ctrl.balanceDayOff('1', WORKING) === false, '#3957 balanceDayOff: рабочий день, нет отпуска → НЕ off');
    assert(ctrl.balanceDayOff('1', WEEKEND) === true, '#3957 balanceDayOff: выходной → off (для любого станка)');
    assert(ctrl.balanceDayOff('2', WEEKEND) === true, '#3957 balanceDayOff: выходной → off и для станка без отпуска');
    assert(ctrl.balanceDayOff('1', VAC) === true, '#3957 balanceDayOff: отпуск станка → off');
    assert(ctrl.balanceDayOff('2', VAC) === false, '#3957 balanceDayOff: у станка 2 в этот день отпуска нет → НЕ off');
})();

// ── 2) end-to-end: выходные + отпуск → хвост за отпуском стекает; ТОЛЬКО отпуск → баг (не стекает) ──
// Модель как в логе #3951: выходные каждые 7 дней на смещениях %7∈{3,4}; отпуск Станка 1 дни 5..11.
// Станок 1 перегружен (18 задач), 2/3/4 — по 5. cap=450, задача 150 (3 в день).
(function () {
    var CAP = 450;
    function plan(id, sid) { return { id: id, slitterId: String(sid), materialId: 'A', winding: 'OUT', knifeWidths: [50], knifeCount: 1, isFoil: false, duration: 150 }; }
    function dist(p) { var o = {}; p.forEach(function (x) { o[x.slitterId] = (o[x.slitterId] || 0) + 1; }); return o; }
    function weekend(d) { var m = ((d % 7) + 7) % 7; return m === 3 || m === 4; }
    function vac1(d) { return d >= 5 && d <= 11; }
    function build() {
        var plans = [];
        ['1', '2', '3', '4'].forEach(function (m) { var n = (m === '1') ? 18 : 5; for (var j = 0; j < n; j++) plans.push(plan(m + '_' + j, m)); });
        return plans;
    }

    // Баг (учитывается только отпуск): Станок 1 «доходит» лишь до дня ~4 (не видит отпуск за выходными) —
    // выравнивание балансирует по минутам, оставляя Станку 1 работу, которая в реальности за отпуском.
    var bug = build();
    var rBug = planning.rebalanceSlitterLoad(bug, [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }],
        { weights: null, dayCapacityMin: CAP, machineDayOff: function (id, d) { return String(id) === '1' && vac1(d); } });
    assert(rBug.loadAfter['1'].days <= 5, '#3957 БАГ (только отпуск): Станок 1 в модели кончает рано (span ≤ 5), отпуск за выходными не виден');

    // Фикс (выходные + отпуск, как balanceDayOff): Станок 1 виден как заканчивающий на конец отпуска
    // (span = 12), хвост стекает — у Станка 1 остаётся только доотпускная работа (влезает в дни 0..2).
    var fix = build();
    var rFix = planning.rebalanceSlitterLoad(fix, [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }],
        { weights: null, dayCapacityMin: CAP, machineDayOff: function (id, d) { return weekend(d) || (String(id) === '1' && vac1(d)); } });
    assertEqual(rFix.loadAfter['1'].days, 12, '#3957 ФИКС: Станок 1 = конец отпуска (span 12), выходные+отпуск учтены');
    // Доотпускная ёмкость Станка 1 = рабочие дни 0,1,2 (дни 3,4 — выходные, 5..11 — отпуск) = 3×450 = 1350.
    assert(rFix.loadAfter['1'].minutes <= 1350, '#3957 ФИКС: работа Станка 1 (' + Math.round(rFix.loadAfter['1'].minutes) + 'м) влезает в дни ДО отпуска (≤ 1350) — хвоста за отпуском нет');
    assert((dist(fix)['1'] || 0) < (dist(bug)['1'] || 0), '#3957 ФИКС: у Станка 1 заданий меньше, чем в баге (хвост стёк на 2/3/4)');
    assert(rFix.moves.length > rBug.moves.length, '#3957 ФИКС: переносов больше (реальный перегруз за отпуском виден)');
})();

// Подневная настройка (perDaySetupMin) заменена реальной укладкой packMachine — см. #3965
// (atex-production-planning-3965.test.js): настройка считается у КАЖДОЙ резки, дата окончания
// станка берётся из фактической укладки по дням, а не из ёмкости-минус-перекалибровка.

console.log('\n' + passed + ' assertions passed');
