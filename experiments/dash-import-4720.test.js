// #4720 — модель в базе должна совпадать с предпросмотром: один лист, границы [С; По], «Метка».
//
// После импорта Лангемака в finmo оказалось: три записи листа с одним именем, пустые «С»/«По» у
// дэшборда и названия блоков («OpEx 1», «COGS», «Cash Inflows») в «Метке» вместо имени компании.
//
// Run with: node experiments/dash-import-4720.test.js

var DI = require('../js/dash-import.js');

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; } else {
        console.log('  ожидалось:', JSON.stringify(expected));
        console.log('  получено: ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// ── 1. Подчинённые читаются по F_U, а не по up ───────────────────────────────────────────
// `up` действует при СОЗДАНИИ записи; при чтении он не фильтрует и молча отдаёт пустой список —
// лист «не находился», и каждый прогон создавал ещё один одноимённый.
var path = DI.childListPath(551, '1687');
assert(/[?&]F_U=1687(&|$)/.test(path), 'подчинённые фильтруются параметром F_U', path);
assert(path.indexOf('up=') === -1, 'параметра up при ЧТЕНИИ нет — он ничего не фильтрует', path);
assert(path.indexOf('object/551/') === 0 && /JSON_OBJ/.test(path), 'адрес читает нужную таблицу в объектном виде', path);
assert(/LIMIT=0,500/.test(path) && /LIMIT=0,50(&|$)/.test(DI.childListPath(537, 9, 50)),
    'предел выборки по умолчанию 500 и задаётся явно');
assert(DI.childListPath(551, 'a b').indexOf('F_U=a%20b') !== -1, 'значение родителя экранируется');

// ── 2. Границы модели [С; По] ────────────────────────────────────────────────────────────
// Без них отбор периодов не выполняется вовсе: в диапазон берутся периоды, целиком лежащие
// внутри [С; По] дэшборда (docs/kb/dashboard.md) — модель открывается без колонок.
assertEqual(DI.modelDateRange([2026, 2027, 2035]), { from: '01.01.2026', to: '31.12.2035' },
    'границы выводятся из годов файла: первое января первого года — 31 декабря последнего');
assertEqual(DI.modelDateRange([2030, 2026, 2028]), { from: '01.01.2026', to: '31.12.2030' },
    'порядок годов в файле не важен — берутся крайние');
assertEqual(DI.modelDateRange([2026]), { from: '01.01.2026', to: '31.12.2026' },
    'один год — границы этого же года');
assert(DI.modelDateRange([]) === null, 'нет годов — границ не выдумываем');

// ── 3. «Метка» — это компания, а не название блока ───────────────────────────────────────
// Метка (Строка → 524) служит и подписью модели, и ключом, по которому значение находит строку.
// Названия блоков файла («OpEx 1», «COGS») — это заголовки панелей, им в метке не место.
var t = function (v) { return { v: v, f: null }; }, _ = null;
var grid = [
    [_, t('Годы:'), t(2026), t(2027), t(2028)],
    [t('OpEx 1'), t('ФОТ'), t(10), t(20), t(30)],
    [t('COGS'), t('Себестоимость'), t(1), t(2), t(3)]
];
var res = DI.recognizeModel('Лангемак.xlsx', [{ name: 'Лист1', grid: grid, merges: [] }]);
var rows = res.model.sheets[0].panels[0].rows;
assertEqual(rows.map(function (r) { return r.label; }), ['OpEx 1', 'COGS'],
    'распознавание по-прежнему видит блок в колонке A — он нужен для имени панели');
assert(res.model.name === 'Лангемак', 'имя модели — из имени файла; оно же пойдёт в «Метку»');

// Ключ значения строится на метке МОДЕЛИ: иначе повторный залив не узнает уже записанное число.
assert(DI.valueKey('ФОТ', 2026, 'Лангемак') !== DI.valueKey('ФОТ', 2026, 'OpEx 1'),
    'метка входит в ключ значения — путать компанию с блоком нельзя');

console.log('\n' + passed + ' проверок прошли из ' + total);
