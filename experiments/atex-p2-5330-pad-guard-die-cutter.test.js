// ideav/crm#5330 (ответ владельца на #5328, п.1) — сторож планшета у пульта высечки.
//
// Что проверяется:
//   1. таблица «Планшет» без колонки «Станок высечки» (база Фазы 1, ateh): настройка планшета
//      разбирается в те же три объекта и «Рабочее место», ключа dieCutter в ней нет, куда
//      открывать планшет — решается как раньше;
//   2. таблица с колонкой «Станок высечки» (ateh1): объект пульта высечки разбирается,
//      планшет открывается в /{db}/die-cutter, «Рабочее место» понимает «высечка»;
//   3. пульт высечки не открывается планшету без станка высечки (missingObject);
//   4. пульт высечки берёт станок из настройки планшета — по id или по названию.
//
// Run with: node experiments/atex-p2-5330-pad-guard-die-cutter.test.js

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; return; }
    console.log('  expected:', JSON.stringify(expected));
    console.log('  actual:  ', JSON.stringify(actual));
    process.exitCode = 1;
}

var guard = require('../download/atex/js/pad-guard.js');
var DC = require('../download/atex-p2/js/die-cutter.js').core;

var TOKEN = 'dc8b920daba7af5fb5065cf81abebb59';
function row(cols) { return { i: '900', r: cols }; }

// ── 1. база Фазы 1: колонки «Станок высечки» нет ────────────────────────────────────────────
var PHASE1 = { id: '673803', val: 'Планшет', granted: 'WRITE', reqs: [
    { id: '673807', val: 'Наименование' },
    { id: '673810', val: 'Слиттер' },
    { id: '673811', val: 'Втулкорез' },
    { id: '673812', val: 'Упаковочное место' },
    { id: '673813', val: 'Рабочее место' }
]};
(function() {
    var pad = guard.padFromRows([row([TOKEN, 'MC', '1277:Станок 3', '', '', ''])], TOKEN, 1, PHASE1);
    assertEqual(pad.config, { slitter: { id: '1277', label: 'Станок 3' }, cutter: null, place: null, workspace: '' },
        'Фаза 1: настройка — три объекта и «Рабочее место», ключа dieCutter нет');
    assertEqual(guard.padWorkspace(pad), { ok: true, action: 'slitter', kind: 'slitter', object: { id: '1277', label: 'Станок 3' }, reason: '' },
        'Фаза 1: планшет со слиттером открывается в слиттер');
    var empty = guard.padFromRows([row([TOKEN, 'MC', '', '', '', ''])], TOKEN, 1, PHASE1);
    assertEqual(guard.padWorkspace(empty), { ok: false, action: '', kind: '', object: null, reason: 'none' },
        'Фаза 1: пустая настройка — «не настроен», как раньше');
    var noCol = guard.padFromRows([row([TOKEN, 'MC'])], TOKEN, 1, { id: '673803', val: 'Планшет', reqs: [{ id: '673807', val: 'Наименование' }] });
    assertEqual(noCol.config, { slitter: null, cutter: null, place: null, workspace: '' },
        'таблица без колонок настройки — та же пустая настройка из трёх объектов');
})();

// ── 2. база ateh1: колонка «Станок высечки» есть ───────────────────────────────────────────
var PHASE2 = { id: '673803', val: 'Планшет', granted: 'WRITE', reqs: PHASE1.reqs.concat([{ id: '1003100', val: 'Станок высечки' }]) };
(function() {
    var pad = guard.padFromRows([row([TOKEN, 'ВЫС-1', '', '', '', '', '1000500:3 высечка'])], TOKEN, 1, PHASE2);
    assertEqual(pad.config.dieCutter, { id: '1000500', label: '3 высечка' },
        'ateh1: «Станок высечки» разбирается в объект настройки');
    assertEqual(guard.padWorkspace(pad).action, 'die-cutter',
        'ateh1: планшет со станком высечки открывается в пульт высечки');
    var mixed = guard.padFromRows([row([TOKEN, 'X', '1277:Станок 3', '', '', '', '1000500:3 высечка'])], TOKEN, 1, PHASE2);
    assertEqual(guard.padWorkspace(mixed).reason, 'ambiguous',
        'слиттер и станок высечки сразу — выбор неоднозначен');
    var named = guard.padFromRows([row([TOKEN, 'X', '', '', '', 'высечка', ''])], TOKEN, 1, PHASE2);
    assertEqual([named.config.workspace, guard.padWorkspace(named).action, guard.padWorkspace(named).object],
        ['die-cutter', 'die-cutter', null],
        '«Рабочее место» = «высечка» — пульт высечки, станок выберут в пульте');
    var none = guard.padFromRows([row([TOKEN, 'X', '', '', '', '', ''])], TOKEN, 1, PHASE2);
    assertEqual(none.config.dieCutter, null, 'ateh1: пустая колонка — null');
})();

// ── 3. пульт высечки без станка высечки не открывается ──────────────────────────────────────
(function() {
    var none = guard.padFromRows([row([TOKEN, 'ВЫС-1', '', '', '', '', ''])], TOKEN, 1, PHASE2);
    var block = guard.missingObject(none, 'dieCutter');
    assertEqual(!!block && /«Станок высечки»/.test(block.text), true,
        'планшету не назначен станок высечки — экран «Планшет не настроен»');
    var pad = guard.padFromRows([row([TOKEN, 'ВЫС-1', '', '', '', '', '1000500:3 высечка'])], TOKEN, 1, PHASE2);
    assertEqual(guard.missingObject(pad, 'dieCutter'), null, 'станок высечки назначен — пульт открывается');
    assertEqual(guard.missingObject(pad, 'slitter') !== null, true, 'а слиттер этому планшету не назначен');
})();

// ── 4. станок пульта — из настройки планшета ────────────────────────────────────────────────
(function() {
    var machines = [{ id: '1000500', val: '3 высечка' }, { id: '1000501', val: '4 высечка' }];
    var byRef = { config: { dieCutter: { id: '1000501', label: '4 высечка' } } };
    var byName = { config: { dieCutter: { id: '', label: ' 3 ВЫСЕЧКА ' } } };
    var alien = { config: { dieCutter: { id: '777', label: 'чужой' } } };
    assertEqual(DC.padMachineId(machines, byRef, guard), '1000501', 'станок по ссылке');
    assertEqual(DC.padMachineId(machines, byName, guard), '1000500', 'станок по названию (регистр, пробелы)');
    assertEqual(DC.padMachineId(machines, alien, guard), '', 'станка нет в справочнике — пусто, выбор за оператором');
    assertEqual(DC.padMachineId(machines, { config: { slitter: { id: '1' } } }, guard), '', 'настройки высечки нет — пусто');
    assertEqual(DC.padMachineId(machines, null, guard), '', 'сторожа нет — пусто');
})();

console.log('\n' + passed + '/' + total + ' passed');
