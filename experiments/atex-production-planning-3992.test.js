// Unit tests for #3992 + #3989 Фаза 2 — настройки и перерывы нового алгоритма (ТЗ
// docs/atex_planning_tz.md §5/§5.1/§14):
//   • захлёст за конец смены по ключам с суффиксом _MN (MAX_OVERWORK_CUTS_MN/_TUNE_MN),
//     с откатом на старые имена (обратная совместимость);
//   • два внутридневных перерыва (FIRST_INTERVAL/SECCOND_INTERVAL) + обед как
//     НЕрабочие паузы дня (прозрачны для планирования, рисуются на Ганте);
//   • явная длительность дня DAY_DURATION_MN.
//
// Run with: node experiments/atex-production-planning-3992.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, failed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) { passed++; } else { failed++; process.exitCode = 1; }
}
function eq(a, b, name) { assert(a === b, name + ' (' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + ')'); }

// ---------------------------------------------------------------------------
console.log('\n== #3992: захлёст читается по ключам _MN ==');
// Новые ключи _MN.
var wNew = planning.resolveWorkingWindow({ DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', MAX_OVERWORK_CUTS_MN: 5, MAX_OVERWORK_TUNE_MN: 10 });
eq(wNew.maxOverworkCutsMin, 5, 'MAX_OVERWORK_CUTS_MN=5 читается');
eq(wNew.maxOverworkTuneMin, 10, 'MAX_OVERWORK_TUNE_MN=10 читается');
// Старые ключи (обратная совместимость).
var wOld = planning.resolveWorkingWindow({ DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', MAX_OVERWORK_CUTS: 7, MAX_OVERWORK_TUNE: 12 });
eq(wOld.maxOverworkCutsMin, 7, 'откат на старый MAX_OVERWORK_CUTS=7');
eq(wOld.maxOverworkTuneMin, 12, 'откат на старый MAX_OVERWORK_TUNE=12');
// _MN имеет приоритет над старым.
var wBoth = planning.resolveOverworkLimits({ MAX_OVERWORK_CUTS_MN: 5, MAX_OVERWORK_CUTS: 99 });
eq(wBoth.cutsMin, 5, '_MN приоритетнее старого ключа');
// Пусто → выкл (null), но задан один → второй наследует.
var wOne = planning.resolveOverworkLimits({ MAX_OVERWORK_CUTS_MN: 5 });
eq(wOne.cutsMin, 5, 'задан только cuts → cuts=5');
eq(wOne.tuneMin, 5, 'tune наследует cuts (#3847)');
var wNone = planning.resolveOverworkLimits({});
eq(wNone.cutsMin, null, 'ничего не задано → null (захлёст выкл)');
// Пустая строка в _MN не должна перекрывать заполненный старый ключ.
var wEmpty = planning.resolveOverworkLimits({ MAX_OVERWORK_CUTS_MN: '', MAX_OVERWORK_CUTS: 8 });
eq(wEmpty.cutsMin, 8, 'пустой _MN → откат на старый ключ');

// ---------------------------------------------------------------------------
console.log('\n== DAY_DURATION_MN ==');
eq(planning.resolveDayDurationMin({ DAY_DURATION_MN: 450 }), 450, 'DAY_DURATION_MN=450');
eq(planning.resolveDayDurationMin({}), 450, 'дефолт 450');
eq(planning.resolveDayDurationMin({ DAY_DURATION: 480 }), 480, 'откат на DAY_DURATION без суффикса');

// ---------------------------------------------------------------------------
console.log('\n== два перерыва + обед (intraDayBreaks) ==');
var breaks = planning.intraDayBreaks({
    FIRST_INTERVAL: '10:00', SECCOND_INTERVAL: '15:00', INTERVAL_DURATION_MN: 10,
    LUNCH_START: '12:20', LUNCH_DURATION_MN: 40
});
eq(breaks.length, 3, 'три паузы: два перерыва + обед');
eq(breaks[0].startMin, 600, 'первый перерыв в 10:00 (600 мин)');
eq(breaks[0].durationMin, 10, 'перерыв 10 мин');
eq(breaks[0].kind, 'break', 'kind перерыва = break');
eq(breaks[1].startMin, 740, 'обед в 12:20 (740 мин) — по времени между перерывами');
eq(breaks[1].kind, 'lunch', 'kind обеда = lunch');
eq(breaks[2].startMin, 900, 'второй перерыв в 15:00 (900 мин)');
// Опечатка ТЗ: принимаем и корректное написание SECOND_INTERVAL.
var breaksAlt = planning.intraDayBreaks({ SECOND_INTERVAL: '15:00', INTERVAL_DURATION_MN: 10 });
eq(breaksAlt.length, 1, 'SECOND_INTERVAL (без опечатки) тоже распознаётся');
eq(breaksAlt[0].startMin, 900, 'SECOND_INTERVAL 15:00 → 900 мин');
// LUNCH_DURATION без _MN тоже работает; перерыв без длительности не добавляется.
var breaksLunchOld = planning.intraDayBreaks({ LUNCH_START: '12:20', LUNCH_DURATION: 40 });
eq(breaksLunchOld.length, 1, 'LUNCH_DURATION без суффикса — распознаётся');
var breaksNone = planning.intraDayBreaks({});
eq(breaksNone.length, 0, 'ничего не задано → нет пауз');
// intraBreaks/ dayDurationMin также попадают в resolveWorkingWindow (для нового движка).
var w = planning.resolveWorkingWindow({ DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30' });
eq(typeof w.maxOverworkCutsMin, 'object', 'без захлёста → null (выкл)');   // null → typeof object

// ---------------------------------------------------------------------------
console.log('\n----------------------------------------');
console.log('ИТОГО: ' + passed + ' passed, ' + failed + ' failed');
