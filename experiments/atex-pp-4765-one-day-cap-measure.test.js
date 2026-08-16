// Тесты: ideav/crm#4765 — «Лимит дня не соблюдается и вижу десятки создаваемых записей _m_new».
//
// СИМПТОМ (боевая ateh1, 16.08.2026, лог из тикета). После «Урегулировать» в шапке дня стои́т
// «Пн, 17.08.2026 (470 мин)» и красная метка «+15 мин сверх смены» при потолке 455, а в консоли —
// «⚖️ #4751: выравнивание сошлось на долге 15 (проходов: 2)» и НИ ОДНОЙ строки «#4408: день не
// помещается в смену». Оператору при этом ушёл тост «День выровнен по смене … — лишнее разбито по
// потолку и уехало вперёд». То есть выравнивание одновременно ЗНАЛО о переполнении (долг 15) и
// ОТЧИТАЛОСЬ, что его нет.
//
// ПРИЧИНА — ДВЕ МЕРКИ ОДНОГО ДНЯ ВНУТРИ ОДНОЙ ФУНКЦИИ. `levelDayLoad` брала задачу меркой
// `overfilledDaysOf(sid, opts)`, где `opts` несёт рамку ручного действия — его дни (`dayKeys`,
// #4582) и его права (`manual`, #4574). Итог же проверялся `overfilledDaysOf(sid)` — БЕЗ `opts`, а
// такая мерка ограничена окном фильтра [С;По] и не видит замороженных дней. Работа «Урегулировать»
// уезжает ровно ЗА это окно (остаток встаёт перед следующим заданием станка, #4569), поэтому
// выходная мерка о переполненном дне не знала вовсе: `left` пуст → `warnOverfilledDays` не звучит,
// а тост об успехе звучит.
//
// Проверено на живой ateh1 16.08.2026 при окне [12.08;16.08]:
//   overfilledDaysOf('1277')                       → []            (мерка выхода)
//   overfilledDaysOf('1277', {manual:true,         → [день 5: 497 мин при потолке 455, +42]
//                             dayKeys:['20260817']})
//
// ЧТО ПРОВЕРЯЕМ:
//   A — воспроизведение: тот же станок, те же задания, две мерки дают разный ответ (это ВХОД, а не
//       дефект: рамка ручного действия шире окна фильтра — так и задумано, #4569/#4582);
//   B — выравнивание отчитывается ТОЙ ЖЕ меркой, которой брало задачу: день остался за потолком —
//       успеха не объявляем;
//   C — и предупреждаем о нём (`warnOverfilledDays`), назвав станок, день и перебор;
//   D — регресс: день ДЕЙСТВИТЕЛЬНО выровнен — прежний тост об успехе на месте;
//   E — регресс #4408/#4531: вызов `warnOverfilledDays` без рамки работает как раньше.
//
// Run with: node experiments/atex-pp-4765-one-day-cap-measure.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };
var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// Смена 08:00–16:30, обед 12:20×40, буфер уборки 15 → окно резки до 16:10, потолок резки 16:15,
// ёмкость дня 455 мин (те же числа, что в боевом логе тикета).
var DAY_SETTINGS = { DAY_START_HOUR: '08:00', DAY_END_HOUR: '16:30', LUNCH_START: '12:20',
    LUNCH_DURATION: '40', TOTAL_INTERVALS: '15' };
var SID = '101';
var WINDOW_DAY = [2026, 6, 31];   // 31.07.2026 — окно фильтра [С;По] (месяц — индекс)

function tsAt(dayShift, hh, mm) {
    return Math.floor(new Date(WINDOW_DAY[0], WINDOW_DAY[1], WINDOW_DAY[2] + dayShift, hh, mm, 0, 0).getTime() / 1000);
}
// Задание: старт окна + ХРАНИМЫЕ минуты занятости (ровно то, что складывает бейдж «(N мин)»).
function cutOf(id, dayShift, hh, mm, knife, material, cutTime) {
    var ts = String(tsAt(dayShift, hh, mm));
    return { id: id, number: ts, planDate: ts,
        slitter: { id: SID, label: 'Станок 1' },
        materialId: '500', materialName: 'MW308', winding: 'IN',
        knifeWidths: [110, 110], knifeCount: 2, plannedRuns: 12, length: 450,
        storedKnifeSetupMin: String(knife), storedMaterialWindingMin: String(material),
        storedCutAndLeaderMin: String(cutTime) };
}

// День ЗА окном фильтра: 01.08 = 470 мин при потолке 455 (перебор 15 — как в боевом логе).
function dayBeyondWindow() {
    return [
        cutOf('a', 1, 8, 0, 30, 15, 395),    // 440 мин
        cutOf('b', 1, 15, 20, 0, 0, 30)      // +30 → 470
    ];
}

function makeController(cuts) {
    var self = Object.create(Controller.prototype);
    self.cuts = cuts;
    self.slitters = [{ id: SID, label: 'Станок 1' }];
    self.supplies = [];
    // Окно оператора кончается ДО дня, куда уехала работа, — ровно случай «Урегулировать» (#4569).
    self.filter = { slitter: '', status: '', date: '2026-07-31', dateTo: '2026-07-31', query: '' };
    self.daySettings = DAY_SETTINGS;
    self.changeTimes = {};
    self.meta = {};
    self.freezeByDay = {};
    self.notes = [];
    self.notify = function(msg, kind) { self.notes.push({ msg: msg, kind: kind }); };
    // Недобор в этом стенде не участвует: мерим ровно потолок (#4743 проверяется своим тестом).
    self.plannerUnderfilledDays = function() { return []; };
    return self;
}

// Рамка ручного действия: день 01.08 назван явно (его же «Урегулировать» и разморозило, #4577).
var MANUAL_OPTS = { manual: true, dayKeys: ['20260801'], unfrozenDayKeys: ['20260801'],
                    manualShift: { '101': tsAt(1, 8, 0) } };

// ── A: воспроизведение — две мерки одного станка отвечают по-разному ─────────────────────────
(function () {
    var c = makeController(dayBeyondWindow());
    var plain = c.overfilledDaysOf(SID) || [];
    var framed = c.overfilledDaysOf(SID, MANUAL_OPTS) || [];
    assert(plain.length === 0,
        '#4765-A: мерка БЕЗ рамки о дне за окном [С;По] не знает', '(дней ' + plain.length + ')');
    assert(framed.length === 1 && Math.round(framed[0].overMin) === 15 && Math.round(framed[0].loadMin) === 470,
        '#4765-A: мерка С рамкой действия видит его: 470 мин при потолке 455 (+15)',
        '(дней ' + framed.length + ', +' + (framed[0] || {}).overMin + ' мин, ' + (framed[0] || {}).loadMin + ' мин)');
})();

// ── B/C: не выровняли — не объявляем успех и говорим, что осталось ───────────────────────────
(function () {
    var c = makeController(dayBeyondWindow());
    // Паровоз прошёл и ничего не изменил: разгружать нечем (в дне одни 🔒 по одному проходу).
    c.autoSequenceQueueAfterMerge = function() { return Promise.resolve(false); };
    return c.levelDayLoad([SID], MANUAL_OPTS).then(function() {
        var success = c.notes.filter(function(n) { return n.kind === 'success'; });
        var warnings = c.notes.filter(function(n) { return n.kind === 'warning'; });
        assert(success.length === 0,
            '#4765-B: день остался за потолком — «День выровнен по смене» НЕ говорим',
            '(успехов ' + success.length + ': ' + ((success[0] || {}).msg || '').slice(0, 60) + ')');
        assert(warnings.length === 1,
            '#4765-C: о нём предупреждаем ровно одним сообщением', '(предупреждений ' + warnings.length + ')');
        var text = (warnings[0] || {}).msg || '';
        assert(text.indexOf('Не помещается в смену') === 0 && text.indexOf('Станок 1') !== -1,
            '#4765-C: в предупреждении назван станок', '(' + text.slice(0, 80) + '…)');
        assert(text.indexOf('01.08.2026') !== -1 && text.indexOf('+15 мин') !== -1
               && text.indexOf('16:15') !== -1,
            '#4765-C: и день, перебор и потолок — те же числа, что в бейдже', '(' + text + ')');
    });
})();

// ── D: регресс — день действительно выровнен, прежний тост об успехе на месте ────────────────
(function () {
    var c = makeController(dayBeyondWindow());
    // Паровоз вывез хвост на следующий день — по ТОЙ ЖЕ мерке переполнения больше нет.
    c.autoSequenceQueueAfterMerge = function() {
        c.cuts = [cutOf('a', 1, 8, 0, 30, 15, 395)];
        return Promise.resolve(true);
    };
    return c.levelDayLoad([SID], MANUAL_OPTS).then(function(changed) {
        var success = c.notes.filter(function(n) { return n.kind === 'success'; });
        var warnings = c.notes.filter(function(n) { return n.kind === 'warning'; });
        assert(changed === true && success.length === 1 && warnings.length === 0,
            '#4765-D: выровняли — говорим об успехе и не предупреждаем ни о чём',
            '(успехов ' + success.length + ', предупреждений ' + warnings.length + ')');
        assert(((success[0] || {}).msg || '').indexOf('День выровнен по смене') === 0,
            '#4765-D: текст успеха прежний (регресс #4473)');
    });
})();

// ── E: регресс #4408/#4531 — вызов без рамки работает как раньше ─────────────────────────────
(function () {
    // День ВНУТРИ окна фильтра: рамка не нужна, старая мерка его видит.
    var c = makeController([cutOf('a', 0, 8, 0, 30, 15, 395), cutOf('b', 0, 15, 20, 0, 0, 30)]);
    var days = c.warnOverfilledDays(SID);
    assert(days.length === 1 && Math.round(days[0].overMin) === 15 && c.notes.length === 1,
        '#4765-E: одиночный вызов без рамки — один день, одно сообщение',
        '(дней ' + days.length + ', сообщений ' + c.notes.length + ')');
    assert(((c.notes[0] || {}).msg || '').indexOf('Станок 1') !== -1,
        '#4765-E: и станок в нём назван, как раньше');
})();

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' проверок прошли');
});
