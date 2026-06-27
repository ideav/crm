// Тест issue #3763 (js/integram-table.js):
// При экспорте таблицы (CSV/XLSX/буфер) DATE/DATETIME-колонки должны выгружаться
// как дата/дата-время (DD.MM.YYYY / DD.MM.YYYY HH:MM:SS), а не сырым unix-штампом.
// prepareExportDataFromRows — чистый метод; инстанс через Object.create без конструктора.
const path = require('path');
const assert = require('assert');

const IntegramTable = require(path.join(__dirname, '..', 'js', 'integram-table.js'));
assert(typeof IntegramTable === 'function', 'IntegramTable exported');

const t = Object.create(IntegramTable.prototype);

// Колонки: первая текстовая, DATE, DATETIME, BOOLEAN, REF — порядок как в таблице.
t.columns = [
    { id: '1', format: 'SHORT' },     // примечание (текст)
    { id: '2', format: 'DATE' },      // отпуск (дата)
    { id: '3', format: 'DATETIME' },  // окончание (дата-время)
    { id: '4', format: 'BOOLEAN' },   // флаг
    { id: '5', format: 'REF', ref_id: 7 } // ссылка "id:Значение"
];

// Значения штампов из реального экспорта (issue #3763).
const TS_DATE = '1783314000';
const TS_DT = '1783889940';

// Строка данных в том же порядке, что this.columns.
const row = ['Тех. обслуживание', TS_DATE, TS_DT, '1', '42:ООО Ромашка'];

const out = t.prepareExportDataFromRows([row], t.columns)[0];

// --- DATE: штамп → дата как на экране ---
const expectedDate = t.formatDateDisplay(t.parseDDMMYYYY(TS_DATE));
assert(/^\d{2}\.\d{2}\.\d{4}$/.test(out[1]), `DATE экспортируется как DD.MM.YYYY, получено: ${ out[1] }`);
assert.notStrictEqual(out[1], TS_DATE, 'DATE НЕ должна остаться сырым штампом');
assert.strictEqual(out[1], expectedDate, 'DATE-экспорт совпадает с отображением ячейки');

// --- DATETIME: штамп → дата-время как на экране ---
const expectedDT = t.formatDateTimeDisplay(t.parseDDMMYYYYHHMMSS(TS_DT));
assert(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}$/.test(out[2]), `DATETIME экспортируется как DD.MM.YYYY HH:MM:SS, получено: ${ out[2] }`);
assert.notStrictEqual(out[2], TS_DT, 'DATETIME НЕ должна остаться сырым штампом');
assert.strictEqual(out[2], expectedDT, 'DATETIME-экспорт совпадает с отображением ячейки');

// --- остальные форматы не сломаны ---
assert.strictEqual(out[0], 'Тех. обслуживание', 'текст без изменений');
assert.strictEqual(out[3], 'Да', 'BOOLEAN → Да/Нет');
assert.strictEqual(out[4], 'ООО Ромашка', 'REF без префикса "id:"');

// --- пустые DATE/DATETIME остаются пустыми ---
const emptyRow = ['', '', '', '', ''];
const emptyOut = t.prepareExportDataFromRows([emptyRow], t.columns)[0];
assert.strictEqual(emptyOut[1], '', 'пустая DATE остаётся пустой');
assert.strictEqual(emptyOut[2], '', 'пустая DATETIME остаётся пустой');

// --- уже отформатированная дата проходит как есть (не штамп) ---
const humanRow = ['x', '01.06.2026', '01.06.2026 10:30:00', '', ''];
const humanOut = t.prepareExportDataFromRows([humanRow], t.columns)[0];
assert.strictEqual(humanOut[1], '01.06.2026', 'готовая DATE-строка без изменений');
assert.strictEqual(humanOut[2], '01.06.2026 10:30:00', 'готовая DATETIME-строка без изменений');

// --- resolveColumnFormat: символьный формат и числовой тип дают одно и то же ---
assert.strictEqual(t.resolveColumnFormat({ format: 'DATETIME' }), 'DATETIME', 'символьный формат');
assert.strictEqual(t.resolveColumnFormat({ type: '4' }), 'DATETIME', 'числовой тип 4 → DATETIME');
assert.strictEqual(t.resolveColumnFormat({ type: '9' }), 'DATE', 'числовой тип 9 → DATE');

console.log('OK: test-issue-3763-export-datetime');
