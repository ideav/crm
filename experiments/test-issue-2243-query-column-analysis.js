'use strict';

// Test the query column parsing logic from issue #2243
// API: object/28/?F_U={query_id}&JSON_OBJ&LIMIT=1000
// r[0] format: "ID:Name" where ID is table/column id from metadata
// Skip "0:..." (computed fields)

const sampleColumns = [
    { i: 7638, r: ["0:Вычисляемое", "Месяц", "CONCAT(SUBSTRING(СтартРаботы, 1, 6), '01')", "", "", "", "", "", "", "", "", "", "", ""] },
    { i: 7628, r: ["8150:Вакансия актуальная -> Старт работы", "Старт работы", "СтартРаботы", "", "", "", "", "", "X", "", "", "", "", ""] },
    { i: 157709, r: ["8153:Вакансия актуальная -> Выход", "Выход", "Выход", "", "", "", "", "", "X", "", "", "", "", ""] },
    { i: 157713, r: ["7931:Тип найма", "Тип найма", "", "", "", "", "", "", "X", "", "", "", "", ""] },
    { i: 157715, r: ["7931:Тип найма", "Тип наймаID", "ТипНаймаID", "", "", "", "85:abn_ID", "", "X", "", "", "", "", ""] },
    { i: 157718, r: ["0:Вычисляемое", "TTS ОШ.Факт", "COALESCE(...)", "", "", "77:AVG", "", "", "", "", "", "", "", ""] },
    { i: 157842, r: ["8143:Вакансия актуальная -> План", "Закрыто.План", "План", "", "", "73:SUM", "", "", "", "", "", "", "", ""] }
];

const catalogTables = [
    { id: '7931', name: 'Тип найма' },
    { id: '8150', name: 'Вакансия актуальная' },
    { id: '8143', name: 'Вакансия актуальная' },
    { id: '8152', name: 'Вакансия актуальная' },
    { id: '8153', name: 'Вакансия актуальная' }
];

function mapById(items) {
    const map = new Map();
    (items || []).forEach(function(item) {
        const id = String(item.id || '').trim();
        if (id) map.set(id, item);
    });
    return map;
}

function parseQueryColumns(columns, tableById, selectedTables) {
    let addedTables = 0;
    for (const col of columns) {
        const r0 = col.r && col.r[0] ? String(col.r[0]) : '';
        const colon = r0.indexOf(':');
        if (colon < 1) continue;
        const rawId = r0.slice(0, colon).trim();
        if (!rawId || rawId === '0' || !/^\d+$/.test(rawId)) continue;
        if (selectedTables.has(rawId)) continue;
        const known = tableById.get(rawId);
        const name = known ? (known.name || rawId) : (r0.slice(colon + 1).trim() || rawId);
        selectedTables.set(rawId, { id: rawId, name: name, exportData: false, filter: '' });
        addedTables += 1;
    }
    return addedTables;
}

const tableById = mapById(catalogTables);
const selectedTables = new Map();

const added = parseQueryColumns(sampleColumns, tableById, selectedTables);

console.log('Added tables:', added);
console.log('Selected tables:', Array.from(selectedTables.entries()).map(([id, t]) => `${id}: ${t.name}`));

// Assertions
const ids = Array.from(selectedTables.keys());
console.assert(!ids.includes('0'), 'Should not include computed (id=0)');
console.assert(ids.includes('8150'), 'Should include 8150');
console.assert(ids.includes('8153'), 'Should include 8153');
console.assert(ids.includes('7931'), 'Should include 7931 (only once even though referenced twice)');
console.assert(ids.includes('8143'), 'Should include 8143');
console.assert(ids.length === 4, 'Should have 4 unique table ids: ' + ids.join(', '));

// Test selected-first sorting
const catalog = [
    { id: '100', name: 'Alpha' },
    { id: '7931', name: 'Тип найма' },
    { id: '200', name: 'Beta' },
    { id: '8150', name: 'Вакансия актуальная' }
];

const sorted = catalog.slice().sort((a, b) => {
    const aSelected = selectedTables.has(a.id) ? 0 : 1;
    const bSelected = selectedTables.has(b.id) ? 0 : 1;
    return aSelected - bSelected;
});

const sortedIds = sorted.map(t => t.id);
console.log('Sorted (selected first):', sortedIds);
console.assert(sortedIds.indexOf('7931') < sortedIds.indexOf('100'), 'Selected 7931 should come before non-selected 100');
console.assert(sortedIds.indexOf('8150') < sortedIds.indexOf('200'), 'Selected 8150 should come before non-selected 200');

console.log('\nAll assertions passed!');
