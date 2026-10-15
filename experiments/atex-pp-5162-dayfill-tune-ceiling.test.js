// #5162 (разбор #5157): объектив «Упорядочить» меряет добор хвост-настройкой ТЕМ ЖЕ потолком,
// что и упаковщик, — нахлёстом НАСТРОЙКИ.
//
// Правило заказчика 15.10.2026 (#5157): «ноль проходов тоже нормально — в этот день ложится одна
// настройка, а все проходы на следующий день». Упаковщик кладёт такую настройку под потолок
// нахлёста настройки (availFor(day,'tune') = cutEndMin + MAX_OVERWORK_TUNE_MN, #3847/#4144), и мерка
// недобора в упаковщике получает тот же потолок (freeTuneFor). Мерка объектива
// (`planUnderfilledDays` — хранимый план и кандидаты «Упорядочить») потолка настройки не получала и
// судила хвост-настройку потолком РЕЗКИ: день, куда упаковщик кладёт настройку, объектив считал
// законно недобранным, и «одна арифметика» (#4499/#4745) расходилась на величину
// MAX_OVERWORK_TUNE_MN − MAX_OVERWORK_CUTS_MN.
//
// Run with: node experiments/atex-pp-5162-dayfill-tune-ceiling.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };

var mod = require('../download/atex/js/production-planning.js');
var Controller = mod.Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var BASE = new Date(2026, 9, 16, 0, 0, 0, 0).getTime();          // «С» = Пт 16.10.2026 (день 0)
function tsAt(dayOffset, minutes) { return Math.floor(BASE / 1000) + dayOffset * 86400 + minutes * 60; }
var DAY_SETTINGS = { DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', LUNCH_START: '12:20',
    LUNCH_DURATION: '40', TOTAL_INTERVALS: '20', MAX_OVERWORK_CUTS_MN: '5', MAX_OVERWORK_TUNE_MN: '10' };
// ёмкость дня 450; потолок резки 455, потолок настройки 460.

function cutOf(id, dayOffset, startMin, runs, knife, material, work, over) {
    var c = { id: id, orderId: 'ORD' + id, firstPartId: id, slitter: { id: '1277', label: 'Станок 1' },
        materialId: 'MW308', winding: 'OUT', knifeWidths: [59, 59], knifeCount: 15, rollerWidth: 0,
        plannedRuns: runs, isFoil: false, status: '', fixed: false,
        planDate: String(tsAt(dayOffset, startMin)), number: String(tsAt(dayOffset, startMin)),
        duration: String(work), storedKnifeSetupMin: String(knife), storedMaterialWindingMin: String(material),
        storedCutAndLeaderMin: String(work) };
    for (var k in (over || {})) c[k] = over[k];
    return c;
}
function ctrlSelf(cuts) {
    var self = Object.create(Controller.prototype);
    self.busy = false;
    self.meta = {};
    self.cuts = cuts;
    self.filter = { date: '2026-10-16', dateTo: '2026-10-19' };
    self.slitters = [{ id: '1277', label: 'Станок 1' }];
    self.daySettings = DAY_SETTINGS;
    self.changeTimes = { BETWEEN_CUTS: 0, CLEANUP_SHIFT: 30, KNIFE: 30, MATERIAL_WINDING: 15 };
    self.supplies = []; self.genPositions = [];
    self.freezeByDay = {}; self.calendarByDay = {}; self.downtimesBySlitter = {};
    self.nowMs = function () { return BASE; };
    return self;
}
// День 0 держит 407 мин: под потолок резки свободно 48, под потолок настройки — 53.
// День 1: целое задание D (другие ножи и сырьё: наладка = ножи 30 + сырьё), 4 прохода по 3.5.
function planWith(donorSetupMaterial) {
    return [cutOf('A', 0, 8 * 60, 100, 0, 15, 392),
            cutOf('D', 1, 8 * 60, 4, 30, donorSetupMaterial, 14,
                  { materialId: 'MR220', knifeWidths: [35, 35], knifeCount: 25 })];
}

// ── 1. Наладка 50: проход с наладкой (53.5) не влезает ни под резку (48), ни под настройку; сама наладка 50
//       влезает только под потолок НАСТРОЙКИ (53). Упаковщик положил бы её в хвост дня 0 —
//       объектив обязан назвать день недобранным. ─────────────────────────────────────────────
(function () {
    var cuts = planWith(20);
    var rows = ctrlSelf(cuts).planUnderfilledDays(cuts, null);
    assert(rows.length === 1 && rows[0] === '1277|20261016',
        '#5162: наладка донора влезает под нахлёст настройки — день 16.10 недобран', 'rows=' + JSON.stringify(rows));
})();

// ── 2. Наладка 55 не влезает и под потолок настройки (53) — день законно недобран. ──────────
(function () {
    var cuts = planWith(25);
    var rows = ctrlSelf(cuts).planUnderfilledDays(cuts, null);
    assert(rows.length === 0,
        '#5162: наладка донора не влезает и под нахлёст настройки — недобора нет', 'rows=' + JSON.stringify(rows));
})();

console.log('Итог: ' + passed + '/' + total);
