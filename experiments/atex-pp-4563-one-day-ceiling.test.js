// #4563 — ПОТОЛОК ДНЯ СЧИТАЕТСЯ В ОДНОМ МЕСТЕ.
//
// ЗАЧЕМ. Формула «ёмкость станко-дня» была переписана в коде ДЕСЯТЬ раз независимо, и копии
// разошлись: одни прибавляли нахлёст НАСТРОЙКИ (страж DAY_CAPACITY, трасса бейджа, раскрой),
// другие — нахлёст РЕЗКИ (planUnderfilledDays), третьи не прибавляли ничего (слой размещения,
// генерация, выбор станка). На боевых настройках ateh (08:00–16:30, TOTAL_INTERVALS 20 → потолок
// резки 16:10, обед 12:20×40, MAX_OVERWORK_CUTS 5, MAX_OVERWORK_TUNE 10) это давало ТРИ разных
// потолка ОДНОГО дня — 450, 455 и 460, — и оператор видел то одно число, то другое.
//
// Хуже того, десятая копия (`overfilledDaysFromCuts` — бейдж, тост, вход в выравнивание) мерила
// вообще ДРУГУЮ величину: не сумму минут, а время окончания последнего задания по сохранённому
// planStart. Её можно было обмануть чем угодно, что стои́т в дне, но в старты не попало:
//   • обедом ВНУТРИ «сквозного» задания (issue #4559) — станок паузит в ходе намотки (#3816);
//   • цепочкой, начавшейся РАНЬШЕ окна (issue #4561) — упаковщик её не раскладывает.
// Каждый раз это читалось как новый дефект, а причина была одна: две стороны системы меряют день
// по-разному, одна кричит «переполнен», вторая отвечает «влезает», и кнопка не помогает.
//
// РЕШЕНИЕ ЗАКАЗЧИКА (01.08.2026): потолок ОДИН — `cutEndMin` + нахлёст ПО ВИДУ ОПЕРАЦИИ
// (резка → MAX_OVERWORK_CUTS, настройка → MAX_OVERWORK_TUNE). Живёт в `dayCeilingMin` /
// `dayCapacityMinutes` (10-planning-engine.js); все потребители зовут их.
//
//   A — правило: потолок = cutEnd + нахлёст по виду; обед из ёмкости вычитается всегда;
//   B — мерка переполнения меряет СУММУ МИНУТ и согласована с потолком (endMin − capMin = overMin);
//   C — упаковщик и мерка сходятся: что упаковщик уложил в день, мерка переполнением не считает;
//   D — СТОРОЖ ИСХОДНИКОВ: формулы потолка на месте больше нет ни в одном модуле.
//
// Run with: node experiments/atex-pp-4563-one-day-ceiling.test.js

process.env.TZ = 'UTC';

var fs = require('fs');
var path = require('path');
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// Боевое окно ateh.
var WIN = { startMin: 480, endMin: 990, cutEndMin: 970, lunchDurationMin: 40,
            maxOverworkCutsMin: 5, maxOverworkTuneMin: 10 };

// ── A) ПРАВИЛО ──────────────────────────────────────────────────────────────────────────────────
(function () {
    assert(P.dayCeilingMin(WIN, 'cuts') === 975 && P.dayCeilingMin(WIN, 'tune') === 980,
        'A1 потолок = cutEnd + нахлёст ПО ВИДУ операции (резка 16:15, настройка 16:20)',
        '(' + P.dayCeilingMin(WIN, 'cuts') + ' / ' + P.dayCeilingMin(WIN, 'tune') + ')');
    assert(P.dayCeilingMin(WIN) === P.dayCeilingMin(WIN, 'cuts'),
        'A2 вид не указан → резка (самое частое и самое строгое из двух)');
    assert(P.dayCapacityMinutes(WIN, 'cuts') === 455 && P.dayCapacityMinutes(WIN, 'tune') === 460,
        'A3 ёмкость = потолок − начало смены − обед',
        '(' + P.dayCapacityMinutes(WIN, 'cuts') + ' / ' + P.dayCapacityMinutes(WIN, 'tune') + ')');
    var noOver = { startMin: 480, cutEndMin: 970, lunchDurationMin: 40 };
    assert(P.dayCeilingMin(noOver, 'cuts') === 970 && P.dayCapacityMinutes(noOver, 'cuts') === 450,
        'A4 нахлёст не настроен → потолок ровно cutEnd (фича выключена, поведение прежнее)');
    assert(P.dayCapacityMinutes({ startMin: 480, cutEndMin: 970, lunchDurationMin: 0 }, 'cuts') === 490,
        'A5 обед не задан → из ёмкости не вычитается');
    assert(!isFinite(P.dayCeilingMin({}, 'cuts')) && P.dayCapacityMinutes({}, 'cuts') === 0,
        'A6 окна нет → NaN/0, а не выдуманное число');
})();

// ── B) МЕРКА ПЕРЕПОЛНЕНИЯ — СУММА МИНУТ, СОГЛАСОВАННАЯ С ПОТОЛКОМ ───────────────────────────────
var BASE = new Date(2026, 7, 3, 0, 0, 0, 0).getTime();
function cut(id, hh, mm, occ) {
    var ts = Math.floor((BASE + (hh * 60 + mm) * 60000) / 1000);
    return { id: id, number: String(ts), planDate: String(ts), slitter: { id: '1277' },
             materialName: 'MW308', winding: 'OUT', storedKnifeSetupMin: '0',
             storedMaterialWindingMin: '0', storedCutAndLeaderMin: String(occ) };
}
function measure(cuts) {
    return P.overfilledDaysFromCuts(cuts, { baseMidnightMs: BASE, dayStartMin: WIN.startMin,
        cutEndMin: WIN.cutEndMin, lunchDurationMin: WIN.lunchDurationMin,
        maxOverworkCutsMin: WIN.maxOverworkCutsMin });
}
(function () {
    var cap = P.dayCapacityMinutes(WIN, 'cuts');                    // 455
    assert(measure([cut('a', 8, 0, cap)]).length === 0,
        'B1 день РОВНО в ёмкость (' + cap + ' мин) переполнением не считается');
    var over = measure([cut('a', 8, 0, cap), cut('b', 16, 0, 10)])[0] || {};
    assert(Math.round(over.overMin) === 10 && Math.round(over.loadMin) === cap + 10,
        'B2 перебор = сумма минут дня − ёмкость', '(+' + Math.round(over.overMin) + ')');
    assert(Math.round(over.endMin - over.capMin) === Math.round(over.overMin),
        'B3 endMin − capMin === overMin — фраза «до HH:MM при потолке HH:MM (+N)» сходится',
        '(' + over.endMin + ' − ' + over.capMin + ' = ' + (over.endMin - over.capMin) + ')');
    assert(Math.round(over.capMin) === P.dayCeilingMin(WIN, 'cuts'),
        'B4 потолок мерки — тот же, что у общей функции', '(' + over.capMin + ')');
    // Дыры в дне на вердикт не влияют: меряем РАБОТУ, а не время последней карточки.
    var holes = measure([cut('a', 8, 0, 100), cut('b', 15, 0, 60)]);
    assert(holes.length === 0,
        'B5 день с дырой, но малой работой, переполнением не считается (меряем работу, не хвост)',
        '(' + JSON.stringify(holes.map(function (x) { return x.overMin; })) + ')');
})();

// ── C) УПАКОВЩИК И МЕРКА СХОДЯТСЯ ───────────────────────────────────────────────────────────────
// Упаковщик набивает день до своего потолка; мерка обязана считать такой день НЕпереполненным.
// Раньше это и расходилось: упаковщик «влезает», мерка «+29» (issue #4559/#4561).
(function () {
    var ZERO = { KNIFE: 0, KNIFE_MOVE: 0, MATERIAL_WINDING: 0, BETWEEN_CUTS: 0 };
    function pc(id, runs) {
        return { id: id, slitter: { id: 'm1' }, materialId: 'M1', winding: 'OUT', knifeWidths: [50],
                 knifeCount: 1, rollerWidth: 0, plannedRuns: runs };
    }
    var segs = P.splitMachineQueue([pc('A', 200)], {
        dayStartMin: WIN.startMin, dayEndMin: WIN.cutEndMin, times: ZERO, gapFill: true,
        lunchStartMin: 740, lunchDurationMin: WIN.lunchDurationMin,
        maxOverworkCutsMin: WIN.maxOverworkCutsMin, maxOverworkTuneMin: WIN.maxOverworkTuneMin,
        perPassByCut: { A: 3 }, runsByCut: { A: 200 }
    });
    var day0 = segs.filter(function (s) { return s.dayOffset === 0; });
    var load0 = 0;
    day0.forEach(function (s) { load0 += Number(s.setupMin) + Number(s.durationMin); });
    assert(load0 > 0 && load0 <= P.dayCapacityMinutes(WIN, 'cuts'),
        'C1 упаковщик не набивает день выше ОБЩЕЙ ёмкости',
        '(' + Math.round(load0) + ' ≤ ' + P.dayCapacityMinutes(WIN, 'cuts') + ')');
    assert(measure([cut('A', 8, 0, Math.round(load0))]).length === 0,
        'C2 и мерка такой день переполненным НЕ считает — расхождения нет');
})();

// ── D) СТОРОЖ ИСХОДНИКОВ: формулы потолка на месте больше нет ───────────────────────────────────
// Зелёный гейт ничего не значит, если завтра кто-то снова напишет `cutEndMin - startMin - обед`
// рядом с новой кнопкой: копии расходятся молча и всплывают тикетом через недели. Сканируем модули.
(function () {
    var dir = path.join(__dirname, '..', 'download', 'atex', 'js', 'production-planning');
    var ALLOWED = ['dayCeilingMin', 'dayCapacityMinutes', 'windowFromOpts'];   // сами общие функции
    var bad = [];
    fs.readdirSync(dir).filter(function (f) { return /\.js$/.test(f); }).forEach(function (f) {
        var lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
        var fnDepth = null, depth = 0;
        lines.forEach(function (line, i) {
            // Комментарии и СТРОКОВЫЕ ЛИТЕРАЛЫ — не код: в трассах «нахлёст[резка …]» тот же плюс
            // означает склейку строк, а не арифметику потолка.
            var code = line.replace(/\/\/.*$/, '').replace(/'(?:\\.|[^'\\])*'/g, "''")
                           .replace(/"(?:\\.|[^"\\])*"/g, '""');
            var isAllowedHead = ALLOWED.some(function (n) { return new RegExp('function\\s+' + n + '\\s*\\(').test(code); });
            if (isAllowedHead) fnDepth = depth;
            var opens = (code.match(/{/g) || []).length, closes = (code.match(/}/g) || []).length;
            var inAllowed = fnDepth != null;
            depth += opens - closes;
            if (fnDepth != null && depth <= fnDepth) fnDepth = null;
            if (inAllowed) return;
            // Строка со строковым литералом — СООБЩЕНИЕ (трасса/лог), а не формула: там «+» склеивает
            // текст. Формула потолка строк не содержит, поэтому такие строки пропускаем целиком.
            if (/''|""/.test(code)) return;
            // 1) арифметика с лимитом нахлёста; 2) «конец окна минус начало» — это ёмкость дня.
            var overArith = /(?:maxOverwork\w*)\s*[)\s]*[+\-]|[+\-]\s*\(?\s*(?:Number\()?\s*\w*\.?maxOverwork/.test(code);
            var capArith = /(?:cutEndMin|dayEndMin)\s*\)?\s*(?:\|\|\s*0\s*\)?\s*)?-\s*\(?\s*(?:Number\()?\s*\w*\.?(?:dayStartMin|startMin)/.test(code);
            if (overArith || capArith) bad.push(f + ':' + (i + 1) + '  ' + line.trim().slice(0, 100));
        });
    });
    assert(bad.length === 0,
        'D1 потолок дня нигде не считается формулой на месте — только через dayCeilingMin/dayCapacityMinutes',
        bad.length ? ('\n      ' + bad.join('\n      ')) : '');
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
if (passed !== total) process.exit(1);
