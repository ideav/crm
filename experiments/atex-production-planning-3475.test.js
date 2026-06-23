// Unit tests for the «Удалить задания дня» selection (ideav/crm#3475).
// Verifies the pure helper dayDeletionTargets — какие «Производственные резки» и
// «Обеспечения» попадают под кнопку «Удалить» для выбранного дня:
//   • резки берутся по плановой дате именно выбранного дня (unix-штамп и «ГГГГ-ММ-ДД»);
//   • завершённые резки и резки без плановой даты — не трогаем;
//   • обеспечения отбираются по cutId из набора резок дня;
//   • пустая дата → пустой набор (удалять нечего).
//
// Run with: node experiments/atex-production-planning-3475.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) {
        passed++;
    } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// «Дата план» резки в cut_planning — unix-штамп (секунды) первой DATETIME-колонки.
var tsDay = Math.floor(Date.UTC(2026, 5, 19, 8, 30) / 1000);   // 2026-06-19 08:30 UTC
var tsNext = Math.floor(Date.UTC(2026, 5, 20, 9, 0) / 1000);   // 2026-06-20

var cuts = [
    { id: '1', planDate: String(tsDay), status: 'В очереди' },   // выбранный день (unix)
    { id: '2', planDate: '2026-06-19', status: 'Начато' },       // тот же день, но дата строкой
    { id: '3', planDate: String(tsNext), status: 'В очереди' },  // другой день
    { id: '4', planDate: String(tsDay), status: 'Завершён' },    // тот день, но завершён — не трогаем
    { id: '5', planDate: '', status: 'В очереди' }               // без даты — к дню не относим
];
var supplies = [
    { id: 's1', cutId: '1' },
    { id: 's2', cutId: '1' },
    { id: 's3', cutId: '3' },   // обеспечение чужого дня
    { id: 's4', cutId: '4' },   // обеспечение завершённой резки — не трогаем
    { id: 's5', cutId: '5' }    // обеспечение недатированной резки
];

var res = planning.dayDeletionTargets(cuts, supplies, '2026-06-19');
assertEqual(res.cuts.map(function(c) { return c.id; }), ['1', '2'],
    'резки выбранного дня (unix + строка), без завершённых и недатированных');
assertEqual(res.supplies.map(function(s) { return s.id; }), ['s1', 's2'],
    'обеспечения только по резкам дня (cutId ∈ {1,2})');

// Другой день — свой набор резок/обеспечений.
var resNext = planning.dayDeletionTargets(cuts, supplies, '2026-06-20');
assertEqual(resNext.cuts.map(function(c) { return c.id; }), ['3'], 'резки соседнего дня');
assertEqual(resNext.supplies.map(function(s) { return s.id; }), ['s3'], 'обеспечения соседнего дня');

// Пустая дата — удалять нечего (день не выбран).
assertEqual(planning.dayDeletionTargets(cuts, supplies, ''), { cuts: [], supplies: [] },
    'пустая дата → пустой набор');

// День без заданий — пустой набор.
assertEqual(planning.dayDeletionTargets(cuts, supplies, '2026-07-01'), { cuts: [], supplies: [] },
    'день без резок → пустой набор');

// Терпимость к пустым входам.
assertEqual(planning.dayDeletionTargets(null, null, '2026-06-19'), { cuts: [], supplies: [] },
    'null-входы не падают');

console.log('\n' + passed + ' assertions passed');
