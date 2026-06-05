// Регрессия ideav/crm#3159: рабочее место «Пульт втулкореза» должно делать
// «Задание на втулки» для обеспечения позиции заказа.
//
// Таблицы получили alias, поэтому в метаданных таблица «Задание на втулки»
// идентифицируется по alias, а её главное значение (первая колонка) — это
// плановое количество втулок «К-во план». Проверяем, что:
//   • таблица находится по alias (а старый поиск только по val — нет);
//   • план берётся из главного значения строки, а не из реквизита;
//   • при записи план уходит как главное значение, реквизиты — отдельно.
//
// Использует реальный фрагмент метаданных из задачи (metadata_all.9.json).
// Запуск: node experiments/test-issue-3159-sleeve-cutter-task-alias.js

var path = require('path');
var fs = require('fs');
var core = require('../download/atex/js/sleeve-cutter.js').core;

var META = JSON.parse(fs.readFileSync(path.join(__dirname, 'metadata_all.9.json'), 'utf8'));

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

// ── Воспроизведение бага: поиск только по val не находит таблицу ──
var byValOnly = META.filter(function(t) {
    return String(t.val).trim().toLowerCase() === 'задание на втулки';
})[0] || null;
assertEqual(byValOnly, null,
    'регрессия: таблица «Задание на втулки» НЕ находится поиском только по val (теперь val=«К-во план»)');

// ── Фикс: поиск по val ИЛИ alias находит таблицу 1080 ──
var task = core.tableByName(META, 'Задание на втулки');
assertEqual(task && task.id, '1080', 'tableByName: «Задание на втулки» найдена по alias');
assertEqual(task && task.val, 'К-во план', 'у найденной таблицы главное значение — «К-во план»');
assertEqual(core.aliasOf(task), 'Задание на втулки', 'aliasOf: alias из поля alias/attrs');

// Поиск по val тоже продолжает работать (таблицы без alias).
assertEqual(core.tableByName(META, 'Позиция заказа') && core.tableByName(META, 'Позиция заказа').id, '1076',
    'tableByName: таблица без alias находится по val');
assertEqual(core.tableByName(META, 'Втулкорез') && core.tableByName(META, 'Втулкорез').id, '1071',
    'tableByName: «Втулкорез» по val');
// По «техническому» val таблицы с alias тоже находим (на случай старых имён).
assertEqual(core.tableByName(META, 'К-во план') && core.tableByName(META, 'К-во план').id, '1080',
    'tableByName: таблица с alias находится и по val');
assertEqual(core.tableByName(META, 'нет такой'), null, 'tableByName: неизвестное имя → null');

// ── Реквизиты задания находятся по именам внутри таблицы 1080 ──
assertEqual(core.reqIdByName(task, 'Втулкорез'), '1180', 'reqIdByName: Втулкорез');
assertEqual(core.reqIdByName(task, 'Диаметр, мм'), '1181', 'reqIdByName: Диаметр, мм');
assertEqual(core.reqIdByName(task, 'Кол-во факт'), '1183', 'reqIdByName: Кол-во факт');
assertEqual(core.reqIdByName(task, 'Статус'), '1184', 'reqIdByName: Статус');

// Порядок колонок JSON_OBJ: [главное значение(1080), Втулкорез, Диаметр, Факт, Статус].
assertEqual(core.colIndex(task, 'Втулкорез'), 1, 'colIndex: Втулкорез → 1');
assertEqual(core.colIndex(task, 'Диаметр, мм'), 2, 'colIndex: Диаметр → 2');
assertEqual(core.colIndex(task, 'Кол-во факт'), 3, 'colIndex: Факт → 3');
assertEqual(core.colIndex(task, 'Статус'), 4, 'colIndex: Статус → 4');

// ── taskFromRow: план = главное значение (первая колонка), не реквизит ──
var row = { i: 401, r: ['100', '203:ВР-41/76', '76', '45', 'В работе'] };
assertEqual(core.taskFromRow(task, row), {
    id: '401',
    planQty: '100',      // ← главное значение r[0]
    cutterId: '203',
    cutterAuto: false,
    diameter: '76',
    factQty: '45',
    status: 'В работе'
}, 'taskFromRow: план из первой колонки, реквизиты по именам');

// Пустая строка-заглушка (нет реквизитов в строке).
assertEqual(core.taskFromRow(task, { i: 402, r: ['60'] }).planQty, '60',
    'taskFromRow: план читается даже без остальных колонок');

// ── Запись: план — главное значение, реквизиты — отдельно ──
var draft = { id: null, planQty: '120', cutterId: '203', diameter: '76', factQty: '0', status: 'Ожидает' };
assertEqual(core.taskMainValue(draft), 120, 'taskMainValue: план → число для главного значения');
assertEqual(core.taskMainValue({ planQty: '' }), '', 'taskMainValue: пустой план → ""');
assertEqual(core.taskReqFields(task, draft), {
    t1180: '203',   // Втулкорез
    t1181: 76,      // Диаметр, мм
    t1183: 0,       // Кол-во факт
    t1184: 'Ожидает' // Статус
}, 'taskReqFields: реквизиты по id из метаданных, без главного значения (плана)');

console.log('\n' + passed + ' assertions passed');
