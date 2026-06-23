// Unit tests for #3535 — вкладки очереди показывают ВСЕ станки справочника,
// не пропуская те, у кого нет резок в выбранный день.
// Контракт mergeStationTabs(slitters, groups):
//   • один таб на каждый станок справочника в порядке справочника (даже без резок);
//   • станки без резок получают группу с cuts:[] (счётчик 0);
//   • группы с резками без станка / с удалённым из справочника станком —
//     дописываются в конце в исходном порядке groups (не теряем задания).
//
// Run with: node experiments/atex-production-planning-3535.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;
var merge = planning.mergeStationTabs;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function ids(tabs) { return tabs.map(function(t) { return t.slitter.id; }); }
function counts(tabs) { return tabs.map(function(t) { return t.cuts.length; }); }

var slitters = [
    { id: '1', label: 'Слиттер №1' },
    { id: '2', label: 'Слиттер №2' },
    { id: '3', label: 'Слиттер №3' }
];

// Резки есть только у станка №2 → всё равно три вкладки в порядке справочника,
// у №1 и №3 счётчик 0.
var groupsOnly2 = [
    { slitter: { id: '2', label: 'Слиттер №2' }, cuts: [{ id: 'a' }, { id: 'b' }] }
];
var t1 = merge(slitters, groupsOnly2);
assert(JSON.stringify(ids(t1)) === JSON.stringify(['1', '2', '3']), 'все три станка в порядке справочника');
assert(JSON.stringify(counts(t1)) === JSON.stringify([0, 2, 0]), 'счётчики: только №2 непустой');
assert(t1[1].cuts === groupsOnly2[0].cuts, 'группа станка №2 — та же ссылка (резки не копируются)');

// Резок нет вообще → три пустые вкладки (раньше так было только для пустой очереди).
var t2 = merge(slitters, []);
assert(JSON.stringify(ids(t2)) === JSON.stringify(['1', '2', '3']), 'пустая очередь → все станки видны');
assert(JSON.stringify(counts(t2)) === JSON.stringify([0, 0, 0]), 'пустая очередь → все счётчики 0');

// Порядок вкладок = порядок справочника, а не алфавит/порядок groups.
var slittersReordered = [{ id: '3', label: 'В' }, { id: '1', label: 'А' }, { id: '2', label: 'Б' }];
var t3 = merge(slittersReordered, groupsOnly2);
assert(JSON.stringify(ids(t3)) === JSON.stringify(['3', '1', '2']), 'порядок вкладок берётся из справочника');

// Группа с резками без станка (id=null) — в конце, не теряется.
var groupsWithNone = [
    { slitter: { id: '1', label: 'Слиттер №1' }, cuts: [{ id: 'x' }] },
    { slitter: { id: null, label: 'Без станка' }, cuts: [{ id: 'y' }] }
];
var t4 = merge(slitters, groupsWithNone);
assert(JSON.stringify(ids(t4)) === JSON.stringify(['1', '2', '3', null]), 'группа «без станка» дописана в конце');
assert(t4[3].cuts.length === 1, 'резки «без станка» сохранены');

// Резки станка, которого нет в справочнике (удалён) — тоже не теряются.
var groupsDeleted = [
    { slitter: { id: '9', label: 'Удалённый' }, cuts: [{ id: 'z' }] }
];
var t5 = merge(slitters, groupsDeleted);
assert(JSON.stringify(ids(t5)) === JSON.stringify(['1', '2', '3', '9']), 'удалённый станок дописан в конце');

// Пустой справочник станков → показываем то, что вернул groupBySlitter (фоллбэк).
var t6 = merge([], groupsOnly2);
assert(JSON.stringify(ids(t6)) === JSON.stringify(['2']), 'нет справочника → группы как есть');
var t7 = merge([], []);
assert(t7.length === 0, 'нет ни станков, ни резок → пусто (рисуется «Заданий в очереди нет»)');

console.log('\n' + passed + ' passed');
