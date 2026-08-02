// Tests for ideav/crm#4572 — окно ВЫПОЛНЕННОГО задания заканчивается «Закончено».
//
// Правило (решение заказчика 02.08.2026, вариант 2): у выполненной части первая колонка = момент
// фактического начала, а «Закончено» пишется не позже, чем НАЧАЛОСЬ следующее задание станка.
// Но длина окна считалась из хранимых минут (наладка + резки) и за это фактическое окно вылезала —
// значит бары/карточки всё равно налезали бы друг на друга.
//
// Поэтому у ВЫПОЛНЕННОГО задания правый край окна — «Закончено», и в очереди, и в Ганте:
//   • только УКОРАЧИВАЕМ (удлинять фактом нельзя — это вернуло бы наложения, #4334: факт не
//     двигает и не растягивает ПЛАНОВЫЙ бар);
//   • наладка внутри окна остаётся — она тоже была; режется хвост намотки;
//   • хранимые «Длительность»/«Резка и Лидер» НЕ трогаются: расчёт по настройке и фактическим
//     резкам остаётся честным, укорачивается только показ.
//
// Run with: node experiments/atex-pp-4572-done-bar-fact-window.test.js

process.env.TZ = 'Europe/Moscow';

var planning = require('../download/atex/js/production-planning.js').planning;
var gantt = require('../download/atex/js/cut-gantt.js');

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    var ok = a === e;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (ожидалось ' + e + ', получено ' + a + ')'));
    if (ok) passed++; else process.exitCode = 1;
}

var BASE = new Date(2026, 7, 1, 0, 0, 0, 0).getTime();          // полночь 01.08.2026
function tsAt(hh, mm) { return Math.floor(new Date(2026, 7, 1, hh, mm, 0, 0).getTime() / 1000); }

// Задание: старт окна 08:00, наладка 30, намотка+лидер 120 → расчётное окно 08:00–10:30.
function cut(over) {
    return Object.assign({
        id: 'c1', planDate: String(tsAt(8, 0)),
        storedKnifeSetupMin: 30, storedMaterialWindingMin: 0, storedCutAndLeaderMin: 120,
        endDate: ''
    }, over || {});
}

// ── 1) очередь: окно выполненного укорачивается до «Закончено» ───────────────
(function() {
    var open1 = planning.scheduleFromStored([cut()], BASE)[0];
    assertEqual([open1.startMin, open1.finishMin, open1.durationMin], [510, 630, 120],
        'не выполнено → окно по хранимым минутам: намотка 08:30–10:30');

    // Оператор закрыл в 09:15 — следующее задание началось тогда же.
    var done = planning.scheduleFromStored([cut({ endDate: String(tsAt(9, 15)) })], BASE)[0];
    assertEqual(done.finishMin, 555, '#4572 выполненное: правый край окна = «Закончено» (09:15)');
    assertEqual(done.durationMin, 45, 'минуты окна пересчитаны под факт (08:30→09:15)');
    assertEqual(done.setupMin, 30, 'наладка в окне остаётся — она тоже была');

    // «Закончено» ПОЗЖЕ расчётного конца — окно не растягиваем.
    var late = planning.scheduleFromStored([cut({ endDate: String(tsAt(14, 0)) })], BASE)[0];
    assertEqual([late.finishMin, late.durationMin], [630, 120],
        '#4334 факт НЕ растягивает окно — только укорачивает');

    // «Закончено» раньше конца НАЛАДКИ — окно не схлопываем в отрицательное.
    var tooEarly = planning.scheduleFromStored([cut({ endDate: String(tsAt(8, 10)) })], BASE)[0];
    assertEqual([tooEarly.startMin, tooEarly.finishMin], [510, 630],
        '«Закончено» раньше старта намотки → окно не трогаем (иначе отрицательная длительность)');
})();

// ── 2) Гант: та же мерка — бар выполненного кончается на «Закончено» ─────────
(function() {
    var core = require('../download/atex/js/cut-gantt.js').gantt;
    // Бар: старт 08:30 (planDate), наладка 30, резка+лидер 120 → расчётное окно 08:30–11:00.
    function bar(over) {
        // setupKnifeMin/setupMaterialMin — те же поля, что Гант читает у резки (cutSetupMin).
        return Object.assign({ planDate: String(tsAt(8, 30)), cutTimeMin: 120,
            setupKnifeMin: 30, setupMaterialMin: 0, endDate: '' }, over || {});
    }
    assertEqual(core.cutBarSpanMin(bar(), 30, null, null), 150,
        'не выполнено → подпись бара = наладка 30 + резка 120');
    assertEqual(core.cutBarSpanMin(bar({ endDate: String(tsAt(9, 45)) }), 30, null, null), 75,
        '#4572 выполненное → бар кончается на «Закончено» (08:30→09:45)');
    assertEqual(core.cutBarTime(bar({ endDate: String(tsAt(9, 45)) }), 30, null, null),
        '08:30-09:45 (75 мин)', 'подпись бара показывает фактическое окно');
    assertEqual(core.cutBarSpanMin(bar({ endDate: String(tsAt(15, 0)) }), 30, null, null), 150,
        '#4334 факт позже расчёта бар НЕ растягивает');

    // Ширина в пикселях идёт из cutBarSegments — она обязана совпасть с подписью, иначе
    // нарисованный бар шире окна и налезает на соседа.
    var ppm = 1;   // 1 px за минуту — сравниваем пиксели с минутами напрямую
    assertEqual(core.cutBarSegments(bar(), ppm, 1).totalPx, 150,
        'не выполнено → ширина бара = наладка 30 + резка 120');
    var doneSeg = core.cutBarSegments(bar({ endDate: String(tsAt(9, 45)) }), ppm, 1);
    assertEqual(doneSeg.totalPx, 75,
        '#4572 ширина НАРИСОВАННОГО бара тоже по фактическому окну — наложения нет');
    assertEqual([doneSeg.knifeMin, doneSeg.cutPx], [30, 45],
        'наладка в баре остаётся (30), режется хвост резки (120 → 45)');
})();

console.log('\n' + passed + '/' + total + ' passed');
if (passed !== total) process.exitCode = 1;
