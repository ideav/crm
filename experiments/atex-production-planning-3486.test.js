// Unit tests for fulfillmentIdsFromRows (ideav/crm#3486).
// Кнопка «🗑» в карточке резки удаляет задание: сначала «Обеспечения» резки, затем
// саму резку. Id «Обеспечений» приходят отчётом report/81463?JSON_KV&FR_cutID=<id>
// в виде [{ cutID, fulfillmentID }, ...]. Чистый помощник fulfillmentIdsFromRows
// извлекает из этих строк список id «Обеспечений»:
//   • колонка fulfillmentID → массив id (порядок отчёта сохраняется);
//   • дубли схлопываются, пустые/'null' пропускаются;
//   • при заданном cutId чужие строки отбрасываются (подстраховка к серверному FR_cutID);
//   • без cutId возвращаются все fulfillmentID;
//   • терпимость к alt-именам (cut_id/fulfillment_id) и пустым входам.
//
// Run with: node experiments/atex-production-planning-3486.test.js

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

// Ответ отчёта 81463 из тикета: одна резка 76337 → семь обеспечений.
var rows = [
    { cutID: '76337', fulfillmentID: '76414' },
    { cutID: '76337', fulfillmentID: '76419' },
    { cutID: '76337', fulfillmentID: '76424' },
    { cutID: '76337', fulfillmentID: '76429' },
    { cutID: '76337', fulfillmentID: '76434' },
    { cutID: '76337', fulfillmentID: '76439' },
    { cutID: '76337', fulfillmentID: '76444' }
];
assertEqual(planning.fulfillmentIdsFromRows(rows, '76337'),
    ['76414', '76419', '76424', '76429', '76434', '76439', '76444'],
    'все fulfillmentID резки 76337 в порядке отчёта');

// Без cutId — берём всё, что есть в строках.
assertEqual(planning.fulfillmentIdsFromRows(rows, null),
    ['76414', '76419', '76424', '76429', '76434', '76439', '76444'],
    'без cutId — все fulfillmentID');

// Подстраховка: если отчёт вернул строки разных резок, оставляем только запрошенную.
var mixed = [
    { cutID: '76337', fulfillmentID: '76414' },
    { cutID: '99999', fulfillmentID: '88888' },   // чужая резка — отбросить
    { cutID: '76337', fulfillmentID: '76419' }
];
assertEqual(planning.fulfillmentIdsFromRows(mixed, '76337'), ['76414', '76419'],
    'чужие cutID отброшены при заданном cutId');

// Дубли схлопываются, пустые/'null' пропускаются.
var dirty = [
    { cutID: '76337', fulfillmentID: '76414' },
    { cutID: '76337', fulfillmentID: '76414' },   // дубль
    { cutID: '76337', fulfillmentID: '' },        // пусто
    { cutID: '76337', fulfillmentID: null },      // null
    { cutID: '76337', fulfillmentID: 'null' },    // строка 'null'
    { cutID: '76337', fulfillmentID: '76419' }
];
assertEqual(planning.fulfillmentIdsFromRows(dirty, '76337'), ['76414', '76419'],
    'дедуп + пропуск пустых/null');

// Числовые значения приводятся к строке.
assertEqual(planning.fulfillmentIdsFromRows([{ cutID: 76337, fulfillmentID: 76414 }], 76337),
    ['76414'], 'числовые cutID/fulfillmentID приводятся к строке');

// Терпимость к alt-именам колонок (snake_case).
assertEqual(planning.fulfillmentIdsFromRows([{ cut_id: '76337', fulfillment_id: '76414' }], '76337'),
    ['76414'], 'alt-имена cut_id/fulfillment_id');

// Строки без явного cutID не отбрасываются (FR_cutID уже отфильтровал серверно).
assertEqual(planning.fulfillmentIdsFromRows([{ fulfillmentID: '76414' }], '76337'),
    ['76414'], 'строка без cutID не отбрасывается');

// Пустые/битые входы не падают.
assertEqual(planning.fulfillmentIdsFromRows(null, '76337'), [], 'null-строки → []');
assertEqual(planning.fulfillmentIdsFromRows([], '76337'), [], 'пустой массив → []');
assertEqual(planning.fulfillmentIdsFromRows([null, undefined], '76337'), [], 'null-элементы пропускаются');

console.log('\n' + passed + ' assertions passed');
