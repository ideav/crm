// Unit tests for «Максимальный запас» core (ideav/crm#3391).
// Verifies the pure helpers that classify a finished-product nomenclature as
// stockable (Склад) or waste (Отходы) against table «Максимальный запас» (67113):
//   • parseMaxStockRows / buildMaxStockIndex — JSON_OBJ rows → index;
//   • maxStockKey                            — canonical material|width|length|winding key;
//   • maxStockMatches / maxStockLimit        — lookup + max allowed stock;
//   • isStockableNomenclature                — membership (feature off when table empty);
//   • stockStripPurpose                      — Склад vs Отходы;
//   • filterStockableWidths                  — keep only stockable добор widths.
//
// Run with: node experiments/atex-production-planning-3391.test.js

process.env.TZ = 'UTC';

var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// ── Метаданные таблицы «Максимальный запас» (как в issue #3391, table/67113) ──
var maxStockMeta = {
    id: '67113', val: 'Максимальный запас', reqs: [
        { id: '67114', val: 'Вид сырья' },
        { id: '67115', val: 'Ширина, мм' },
        { id: '67116', val: 'Длина, м' },
        { id: '67117', val: 'Тип намотки' },
        { id: '67118', val: 'Диаметр втулки' },
        { id: '67119', val: 'Лидер' },
        { id: '67120', val: 'Примечание' }
    ]
};

// Виды сырья — ссылки «id:label»; берём условные id для MW308 / MWR200.
var MW308 = '1100', MWR200 = '1101';
var SLEEVE_GREY = '8193', LEADER_BRAND = '66408';

// JSON_OBJ-строки: r[0] — главное значение (макс. запас, число), далее реквизиты.
// Ссылочные поля в формате «id:Подпись».
function row(i, limit, mat, width, length, winding, note) {
    return { i: String(i), r: [
        String(limit),
        mat + ':MW',
        String(width),
        String(length),
        winding,
        SLEEVE_GREY + ':1 пластик серый',
        LEADER_BRAND + ':Фирменный',
        note || ''
    ] };
}

// Подмножество таблицы из issue (включая дубль MW308 60×300 OUT: 3150 и 1620).
var rows = [
    row(1, 1740, MW308, 30, 300, 'OUT'),
    row(2, 660, MW308, 80, 300, 'OUT'),
    row(3, 600, MW308, 60, 450, 'OUT'),
    row(4, 120, MWR200, 110, 300, 'OUT'),
    row(5, 3150, MW308, 60, 300, 'OUT', 'с прозрачным лидером (П)'),
    row(6, 1620, MW308, 60, 300, 'OUT', '(П)')
];

// ── maxStockKey ──
assertEqual(
    planning.maxStockKey({ material: MW308, width: 30, length: 300, winding: 'OUT' }),
    MW308 + '|30|300|OUT', 'maxStockKey: material|width|length|winding');
assertEqual(
    planning.maxStockKey({ material: MW308, width: '60.00', length: '300.00', winding: 'out' }),
    MW308 + '|60|300|OUT', 'maxStockKey: числа округляются, намотка нормализуется');

// ── parseMaxStockRows ──
var parsed = planning.parseMaxStockRows(rows, maxStockMeta);
assertEqual(parsed.length, 6, 'parseMaxStockRows: разобраны все строки');
assertEqual(parsed[0], {
    material: MW308, width: 30, length: 300, winding: 'OUT',
    sleeve: SLEEVE_GREY, leader: LEADER_BRAND, limit: 1740
}, 'parseMaxStockRows: первая строка разобрана корректно');
assertEqual(planning.parseMaxStockRows([], maxStockMeta), [], 'parseMaxStockRows: пустой вход → []');
assertEqual(planning.parseMaxStockRows(rows, null), [], 'parseMaxStockRows: без метаданных → []');

// ── buildMaxStockIndex ──
var index = planning.buildMaxStockIndex(rows, maxStockMeta);
assertEqual(index.empty, false, 'buildMaxStockIndex: непустая таблица');
assertEqual(index.byKey[MW308 + '|30|300|OUT'], 1740, 'buildMaxStockIndex: лимит по ключу');
// Дубль 60×300 OUT (3150 и 1620) сворачивается в один ключ с максимумом 3150.
assertEqual(index.byKey[MW308 + '|60|300|OUT'], 3150, 'buildMaxStockIndex: дубль → максимальный лимит');

var emptyIndex = planning.buildMaxStockIndex([], null);
assertEqual(emptyIndex.empty, true, 'buildMaxStockIndex: пустая таблица → empty');

// ── maxStockConfigured ──
assertEqual(planning.maxStockConfigured(index), true, 'maxStockConfigured: настроена');
assertEqual(planning.maxStockConfigured(emptyIndex), false, 'maxStockConfigured: пустая → выключена');
assertEqual(planning.maxStockConfigured(null), false, 'maxStockConfigured: null → выключена');

// ── maxStockLimit / maxStockMatches ──
assertEqual(planning.maxStockLimit(index, { material: MW308, width: 60, length: 300, winding: 'OUT' }),
    3150, 'maxStockLimit: дубль → максимум 3150');
assertEqual(planning.maxStockLimit(index, { material: MWR200, width: 110, length: 300, winding: 'OUT' }),
    120, 'maxStockLimit: MWR200 110×300 OUT → 120');
assertEqual(planning.maxStockLimit(index, { material: MW308, width: 999, length: 300, winding: 'OUT' }),
    null, 'maxStockLimit: нет в списке → null');
assertEqual(planning.maxStockMatches(index, { material: MW308, width: 60, length: 300, winding: 'OUT' }).length,
    2, 'maxStockMatches: дубль → 2 строки');

// ── isStockableNomenclature ──
assertEqual(planning.isStockableNomenclature(index, { material: MW308, width: 30, length: 300, winding: 'OUT' }),
    true, 'isStockable: точное совпадение → true');
assertEqual(planning.isStockableNomenclature(index, { material: MW308, width: 30, length: 300, winding: 'IN' }),
    false, 'isStockable: другая намотка → false');
assertEqual(planning.isStockableNomenclature(index, { material: MW308, width: 30, length: 600, winding: 'OUT' }),
    false, 'isStockable: другая длина → false');
assertEqual(planning.isStockableNomenclature(index, { material: '9999', width: 30, length: 300, winding: 'OUT' }),
    false, 'isStockable: другое сырьё → false');
assertEqual(planning.isStockableNomenclature(index, { material: MW308, width: 31, length: 300, winding: 'OUT' }),
    false, 'isStockable: другая ширина → false');
// Таблица не настроена → фича выключена, всё «стокабельно» (поведение не меняем).
assertEqual(planning.isStockableNomenclature(emptyIndex, { material: '9999', width: 1, length: 1, winding: '' }),
    true, 'isStockable: таблица выключена → true (поведение прежнее)');

// ── sleeve/leader narrowing (доуточнение при наличии у обеих сторон) ──
assertEqual(planning.isStockableNomenclature(index,
    { material: MW308, width: 30, length: 300, winding: 'OUT', sleeve: SLEEVE_GREY }),
    true, 'isStockable: совпадающая втулка → true');
assertEqual(planning.isStockableNomenclature(index,
    { material: MW308, width: 30, length: 300, winding: 'OUT', sleeve: '7777' }),
    false, 'isStockable: чужая втулка → false');
assertEqual(planning.isStockableNomenclature(index,
    { material: MW308, width: 30, length: 300, winding: 'OUT', leader: '7777' }),
    false, 'isStockable: чужой лидер → false');

// ── stockStripPurpose ──
assertEqual(planning.stockStripPurpose(index, { material: MW308, width: 30, length: 300, winding: 'OUT' }),
    'Склад', 'stockStripPurpose: в списке → Склад');
assertEqual(planning.stockStripPurpose(index, { material: MW308, width: 31, length: 300, winding: 'OUT' }),
    'Отходы', 'stockStripPurpose: не в списке → Отходы');
assertEqual(planning.stockStripPurpose(emptyIndex, { material: MW308, width: 31, length: 300, winding: 'OUT' }),
    'Склад', 'stockStripPurpose: таблица выключена → Склад (прежнее поведение)');

// ── filterStockableWidths (добор джамбо) ──
var preferred = [
    { width: 30, popularity: 10 },   // стокабельная (MW308 30×300 OUT)
    { width: 60, popularity: 8 },    // стокабельная (MW308 60×300 OUT)
    { width: 45, popularity: 5 },    // нет в списке → отход
    { width: 80, popularity: 3 }     // стокабельная (MW308 80×300 OUT)
];
var profile = { material: MW308, winding: 'OUT', length: 300 };
assertEqual(planning.filterStockableWidths(index, preferred, profile).map(function(p) { return p.width; }),
    [30, 60, 80], 'filterStockableWidths: оставляет только целесообразные к хранению');
// Профиль с длиной 450 → из preferred остаётся только 60 (MW308 60×450 OUT в списке).
assertEqual(planning.filterStockableWidths(index, preferred, { material: MW308, winding: 'OUT', length: 450 })
    .map(function(p) { return p.width; }),
    [60], 'filterStockableWidths: учитывает длину профиля');
// Таблица выключена → список не меняется.
assertEqual(planning.filterStockableWidths(emptyIndex, preferred, profile).map(function(p) { return p.width; }),
    [30, 60, 45, 80], 'filterStockableWidths: таблица выключена → список без изменений');

console.log('\n' + passed + ' assertions passed');
