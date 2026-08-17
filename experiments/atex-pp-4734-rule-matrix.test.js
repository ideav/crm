// Матрица разрешений и приоритетов (issue #4734) — документ обязан описывать ЖИВОЙ код.
//
// ЗАЧЕМ. Сводная таблица правил полезна ровно до тех пор, пока ей можно верить. Прежние сводки
// расходились с кодом молча: ТЗ §12.2 обещало «программа вернёт просроченную 🔒 в срок сама» ещё
// долго после того, как рескью замка убрали целиком (#4434 п.1), — и разбор #4728 нашёл это
// глазами. Здесь то же самое ловит гейт:
//   • состав правил §15 и их режимы в документе сверяются с реестром PP_INVARIANTS;
//   • каждая ссылка «имя:строка» проверяется по исходнику — строка обязана содержать это имя.
// Поэтому переименование метода или новое правило роняют тест, пока документ не поправлен.
//
// Run with: node experiments/atex-pp-4734-rule-matrix.test.js

process.env.TZ = 'UTC';
global.window = { db: 'testdb', xsrf: 'x' };

var fs = require('fs');
var path = require('path');
var planning = require('../download/atex/js/production-planning.js').planning;

var ROOT = path.join(__dirname, '..');
var DOC = path.join(ROOT, 'docs', 'atex_planning_rule_matrix.md');
var MODULES = path.join(ROOT, 'download', 'atex', 'js', 'production-planning');
var MAIN_MODULE = '20-controller.js';

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

// ── 2. Ссылки «имя:строка» ведут в живой код ────────────────────────────────────────────────
// Формы: `moveCutToDay:4324` (метод 20-controller.js), `20-controller.js:10598` (файл модуля),
// `:5403` (строка 20-controller.js без имени — проверяем только существование).
var sourceCache = {};
function sourceLines(file) {
    if (!sourceCache[file]) {
        var full = path.join(MODULES, file);
        sourceCache[file] = fs.existsSync(full) ? fs.readFileSync(full, 'utf8').split('\n') : null;
    }
    return sourceCache[file];
}

var named = [], fileRefs = [], bare = [];
(doc.match(/`[^`]+`/g) || []).forEach(function(tok) {
    var body = tok.slice(1, -1);
    var mFile = body.match(/^([\w.-]+\.js):(\d+)$/);
    if (mFile) { fileRefs.push({ file: mFile[1], line: Number(mFile[2]) }); return; }
    var mNamed = body.match(/^([A-Za-z_$][\w$]*):(\d+)$/);
    if (mNamed) { named.push({ name: mNamed[1], line: Number(mNamed[2]) }); return; }
    var mBare = body.match(/^:(\d+)$/);
    if (mBare) bare.push(Number(mBare[1]));
});

assert(named.length >= 15, 'документ ссылается на код именами', 'ссылок «имя:строка»: ' + named.length);

var badNamed = named.filter(function(ref) {
    var lines = sourceLines(MAIN_MODULE);
    var line = lines && lines[ref.line - 1];
    return !line || line.indexOf(ref.name) === -1;
});
assert(badNamed.length === 0, 'каждая ссылка «имя:строка» ведёт на строку с этим именем',
    badNamed.map(function(r) { return r.name + ':' + r.line; }).join(', '));

var badFiles = fileRefs.filter(function(ref) {
    var lines = sourceLines(ref.file);
    return !lines || ref.line > lines.length;
});
assert(badFiles.length === 0, 'каждая ссылка «файл.js:строка» существует',
    badFiles.map(function(r) { return r.file + ':' + r.line; }).join(', '));

var mainLen = (sourceLines(MAIN_MODULE) || []).length;
var badBare = bare.filter(function(n) { return n < 1 || n > mainLen; });
assert(badBare.length === 0, 'ссылки «:строка» лежат внутри ' + MAIN_MODULE, badBare.join(', '));

// ── 3. Действия матрицы существуют как методы ───────────────────────────────────────────────
// Точка входа каждого действия §1 — метод контроллера. Переименовали метод — строка матрицы
// перестала описывать рабочее место, и это надо увидеть сразу.
var ENTRY_POINTS = ['generateCuts', 'runGenerateCuts', 'optimizeQueue', 'runOptimizeQueue',
    'settleDeviations', 'moveCutToDay', 'moveCutInDay', 'reorderCutInDay', 'deleteCutTask',
    'runDeleteCutTask', 'recalcSetupTiming', 'recalcFromCut', 'levelDayLoad',
    'levelOverfilledAfterWrite', 'autoSequenceQueue', 'autoSequenceQueueAfterMerge',
    'manualShiftRefused', 'recalcMismatchRows', 'reconcilePlanStarts', 'capacityBreaksStored'];
var src = (sourceLines(MAIN_MODULE) || []).join('\n');
var missing = ENTRY_POINTS.filter(function(name) {
    return src.indexOf('prototype.' + name + ' = function') === -1;
});
assert(missing.length === 0, 'точки входа матрицы существуют в ' + MAIN_MODULE, missing.join(', '));

var notMentioned = ENTRY_POINTS.filter(function(name) { return doc.indexOf(name) === -1; });
assert(notMentioned.length === 0, 'каждая точка входа названа в документе', notMentioned.join(', '));

// ── 4. Документ связан с ТЗ и алгоритмом ────────────────────────────────────────────────────
// Сирота-документ не читают: матрицу ищут из ТЗ §15 и из описания алгоритма.
['docs/atex_planning_tz.md', 'docs/atex_production_planning_algorithm.md'].forEach(function(rel) {
    var text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert(text.indexOf('atex_planning_rule_matrix.md') >= 0, rel + ' ссылается на матрицу');
});

console.log('\n' + passed + '/' + total + ' проверок пройдено');
