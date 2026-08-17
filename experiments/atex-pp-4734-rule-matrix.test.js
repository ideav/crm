// Матрица разрешений и приоритетов (issue #4734) — документ обязан описывать ЖИВОЙ код.
//
// ЗАЧЕМ. Сводная таблица правил полезна ровно до тех пор, пока ей можно верить. Прежние сводки
// расходились с кодом молча: ТЗ §12.2 обещало «программа вернёт просроченную 🔒 в срок сама» ещё
// долго после того, как рескью замка убрали целиком (#4434 п.1), — и разбор #4728 нашёл это
// глазами. Здесь то же самое ловит гейт:
//   • состав правил §15 и их режимы в документе сверяются с реестром PP_INVARIANTS;
//   • каждая функция, названная в документе, обязана существовать — методы спрашиваются У
//     ПРОТОТИПА (`typeof Controller.prototype[name] === 'function'`), чистые — у экспорта `planning`.
// Поэтому переименование метода или новое правило роняют тест, пока документ не поправлен.
//
// ПОЧЕМУ БЕЗ НОМЕРОВ СТРОК. Первая версия проверяла ссылки вида `имя:1234` по строке исходника — и
// уронила ГЛАВНУЮ ветку соседним PR: #4769 вставил в тот же файл 61 строку, и все ссылки ниже
// вставки «переехали», хотя ни документ, ни его правда не менялись. Номер строки — свойство чужого
// коммита, а не кода; проверять надо ИМЯ.
//
// Run with: node experiments/atex-pp-4734-rule-matrix.test.js

process.env.TZ = 'UTC';
global.window = { db: 'testdb', xsrf: 'x' };

var fs = require('fs');
var path = require('path');
var mod = require('../download/atex/js/production-planning.js');
var planning = mod.planning;
var Controller = mod.Controller;

var ROOT = path.join(__dirname, '..');
var DOC = path.join(ROOT, 'docs', 'atex_planning_rule_matrix.md');

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var doc = fs.readFileSync(DOC, 'utf8');
var docLines = doc.split('\n');

// ── 1. Реестр §15: состав, actor, mode, gate ────────────────────────────────────────────────
// Строки таблицы вида: | `FROZEN_DAY` | auto | drop | — | о чём |
var docRules = {};
docLines.forEach(function(line) {
    var m = line.match(/^\|\s*`([A-Z_]+)`\s*\|\s*(\w+)\s*\|\s*(\w+)\s*\|\s*([\w—-]+)\s*\|/);
    if (m) docRules[m[1]] = { actor: m[2], mode: m[3], gate: m[4] === '—' ? null : m[4] };
});

var registry = {};
(planning.invariants || []).forEach(function(r) {
    if (r && r.id) registry[r.id] = { actor: r.actor, mode: r.mode, gate: r.gate || null };
});

var inDoc = Object.keys(docRules).sort();
var inReg = Object.keys(registry).sort();
assert(inDoc.length > 0, 'таблица §15 в документе разобрана', 'правил в документе: ' + inDoc.length);
assert(inDoc.join(',') === inReg.join(','),
    'состав правил документа совпадает с реестром PP_INVARIANTS',
    'документ=[' + inDoc.join(' ') + '] реестр=[' + inReg.join(' ') + ']');

inReg.forEach(function(id) {
    var d = docRules[id], r = registry[id];
    if (!d) return;   // о расхождении состава уже сказано выше
    assert(d.actor === r.actor, 'actor правила ' + id + ' описан верно',
        'документ=' + d.actor + ' реестр=' + r.actor);
    assert(d.mode === r.mode, 'mode правила ' + id + ' описан верно',
        'документ=' + d.mode + ' реестр=' + r.mode);
    assert(d.gate === r.gate, 'gate правила ' + id + ' описан верно',
        'документ=' + d.gate + ' реестр=' + r.gate);
});

// ── 2. Каждая названная функция существует ──────────────────────────────────────────────────
// Матрица ссылается на код ИМЕНАМИ. Методы контроллера спрашиваем у прототипа, чистые функции —
// у экспорта `planning`: это поведение (метод есть/нет), а не написание кода.
var ENTRY_POINTS = ['generateCuts', 'runGenerateCuts', 'optimizeQueue', 'runOptimizeQueue',
    'settleDeviations', 'moveCutToDay', 'moveWholeCutToDay', 'moveCutInDay', 'reorderCutInDay',
    'deleteCutTask', 'runDeleteCutTask', 'recalcSetupTiming', 'recalcFromCut', 'recalcStartUpdates',
    'computeCutSetupUpdates', 'levelDayLoad', 'levelOverfilledAfterWrite', 'autoSequenceQueue',
    'autoSequenceQueueAfterMerge', 'manualShiftRefused', 'recalcMismatchRows', 'reconcilePlanStarts',
    'capacityBreaksStored', 'plannerUnderfilledDays', 'slitterOnVacationDay', 'healCutBatches',
    'reload', 'render', 'start'];
var missing = ENTRY_POINTS.filter(function(name) { return typeof Controller.prototype[name] !== 'function'; });
assert(missing.length === 0, 'каждая точка входа матрицы существует как метод контроллера', missing.join(', '));

var notMentioned = ENTRY_POINTS.filter(function(name) {
    // Имя может стоять и с сигнатурой: `autoSequenceQueueAfterMerge(SETUP, preserveOrder=true, …)`.
    return doc.indexOf('`' + name + '`') === -1 && doc.indexOf('`' + name + '(') === -1;
});
assert(notMentioned.length === 0, 'каждая точка входа названа в документе', notMentioned.join(', '));

// Чистые функции модуля, на которые ссылается матрица, — через экспорт `planning`.
var PURE = ['guardPlanOps', 'manualShiftFrom', 'levelingOptsFrom', 'levelingScopeFrom',
    'actionFrameFields', 'actionFrameDayKeys'];
var missingPure = PURE.filter(function(name) { return typeof planning[name] !== 'function'; });
assert(missingPure.length === 0, 'чистые функции матрицы экспортированы', missingPure.join(', '));

// Номеров строк в ссылках больше нет: они устаревают от чужого коммита в тот же файл.
var lineRefs = (doc.match(/`[^`]*[A-Za-z_$:]:\d+`/g) || []);
assert(lineRefs.length === 0, 'ссылок с номерами строк в документе нет', lineRefs.join(', '));

// ── 4. Документ связан с ТЗ и алгоритмом ────────────────────────────────────────────────────
// Сирота-документ не читают: матрицу ищут из ТЗ §15 и из описания алгоритма.
['docs/atex_planning_tz.md', 'docs/atex_production_planning_algorithm.md'].forEach(function(rel) {
    var text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert(text.indexOf('atex_planning_rule_matrix.md') >= 0, rel + ' ссылается на матрицу');
});

console.log('\n' + passed + '/' + total + ' проверок пройдено');
