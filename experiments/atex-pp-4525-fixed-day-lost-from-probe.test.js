// Tests for ideav/crm#4525 — «Зафиксированные (🔒) задания сдвинуты» говорим только о ЗАПИСЫВАЕМОМ
// плане, а не о пробной раскладке.
//
// СИМПТОМ (боевое, ateh 30.07.2026): по кнопке «Сгенерировать» оператор видит красный тост
// «Зафиксированные (🔒) задания сдвинуты: №652892 — их день нерабочий…», хотя правило «зафиксированное
// не тесним» не нарушено: в базе после генерации 652892 стои́т ровно там, где стояло (Станок 3,
// 03.08, 🔒, 126 проходов). Оператор справедливо спрашивает: «как могло так выйти?».
//
// КОРЕНЬ. `onFixedDayLost` зовётся из КАЖДОЙ раскладки, а их за один расчёт много: кроме итоговой,
// рескью просрочки (#4118/#4203 «дозаклад по станкам») прогоняет ПРОБНЫЕ по каждому станку-кандидату.
// В базе Станок 4 в «Отпуске» 30.07–06.08 (вся неделя планирования) — проба по нему честно сообщает
// «день 🔒 нерабочий, размещено с дня 8», и это попадало в общий сборник `fixedDayLost`, из которого
// собирается тост. Итоговый план при этом задание не двигал.
//
// ПРАВИЛО: тост о сдвиге 🔒 — только если в ЗАПИСЫВАЕМЫХ операциях есть обновление этого задания
// с ДРУГИМ днём. Нет обновления или день тот же — это была проба, молчим (но в консоли движок
// по-прежнему кричит: разработчику нужна каждая такая ситуация).
//
// Run with: node experiments/atex-pp-4525-fixed-day-lost-from-probe.test.js

process.env.TZ = 'Europe/Moscow';
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// Дни «сейчас» (ГГГГММДД) и день предлагаемого старта — как их считает контроллер (planDateDayKey).
var DAY_NOW = { '652892': 20260803, '654294': 20260731, '777': 20260731 };
var TS_DAY = { '100': 20260803, '200': 20260804, '300': 20260731 };
function ofTs(ts) { var v = TS_DAY[String(ts)]; return v == null ? null : v; }

// ── 1. ГЛАВНОЕ: проба по станку в «Отпуске» тоста не даёт ────────────────────────────────────
(function () {
    // Рескью перебрал станки; по Станку 4 (отпуск всю неделю) проба сказала «день нерабочий».
    // Итоговый план 652892 не трогает вовсе.
    var lost = [{ cutId: '652892', fixedDay: 4, placedDay: 8 }];
    var ops = { updates: [{ cutId: '654294', planStartTs: '300' }], creates: [], deletes: [] };
    assertEqual(P.realFixedDayLost(lost, ops, DAY_NOW, ofTs), [],
        'проба по станку в отпуске: плана эта запись не касается → молчим');
})();

// ── 2. Задание в плане есть, но день ТОТ ЖЕ — тоже не сдвиг ─────────────────────────────────
(function () {
    var lost = [{ cutId: '652892', fixedDay: 4, placedDay: 8 }];
    var ops = { updates: [{ cutId: '652892', planStartTs: '100' }] };   // 100 → 03.08 = тот же день
    assertEqual(P.realFixedDayLost(lost, ops, DAY_NOW, ofTs), [],
        'план переставил время внутри своего дня — это не сдвиг замка');
})();

// ── 3. Настоящий сдвиг называем ─────────────────────────────────────────────────────────────
(function () {
    var lost = [{ cutId: '652892', fixedDay: 4, placedDay: 8 }];
    var ops = { updates: [{ cutId: '652892', planStartTs: '200' }] };   // 200 → 04.08 = другой день
    assertEqual(P.realFixedDayLost(lost, ops, DAY_NOW, ofTs), lost,
        'план правда уводит 🔒 в другой день — говорим (случай #4434: день нерабочий)');
})();

// ── 4. Дубли от нескольких проб схлопываются ────────────────────────────────────────────────
(function () {
    var lost = [{ cutId: '652892', fixedDay: 4, placedDay: 8 },
                { cutId: '652892', fixedDay: 4, placedDay: 9 },
                { cutId: '652892', fixedDay: 4, placedDay: 11 }];
    var ops = { updates: [{ cutId: '652892', planStartTs: '200' }] };
    var res = P.realFixedDayLost(lost, ops, DAY_NOW, ofTs);
    assertEqual(res.length, 1, 'одно задание — одна строка, сколько бы проб ни было');
    assertEqual(res[0].placedDay, 8, 'оставляем первую (её же печатал движок в консоль)');
})();

// ── 5. Нечем сравнить — не молчим (лучше лишний тост, чем скрытый сдвиг замка) ──────────────
(function () {
    var lost = [{ cutId: '652892', fixedDay: 4, placedDay: 8 }];
    assertEqual(P.realFixedDayLost(lost, { updates: [] }, null, ofTs), lost,
        'нет карты дней → отдаём как есть');
    assertEqual(P.realFixedDayLost(lost, { updates: [] }, DAY_NOW, null), lost,
        'нет функции дня по ts → отдаём как есть');
    assertEqual(P.realFixedDayLost([], { updates: [] }, DAY_NOW, ofTs), [],
        'пустой список — пустой результат');
})();

// ── 6. Смешанный случай: одна проба, один настоящий сдвиг ───────────────────────────────────
(function () {
    var lost = [{ cutId: '652892', fixedDay: 4, placedDay: 8 },     // проба, плана не касается
                { cutId: '777', fixedDay: 1, placedDay: 3 }];        // настоящий переезд
    var ops = { updates: [{ cutId: '777', planStartTs: '200' }] };
    var res = P.realFixedDayLost(lost, ops, DAY_NOW, ofTs);
    assertEqual(res.map(function (f) { return f.cutId; }), ['777'],
        'называем только то задание, которое план действительно двигает');
    assert(res.length === 1, 'лишних строк в тосте нет');
})();

console.log('\n' + passed + '/' + total + ' passed');
if (passed !== total) process.exitCode = 1;
