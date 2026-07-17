// Юнит-тест обфускации экспорта конфигурации — issue #4253.
// Запуск: node experiments/test-issue-4253-obfuscate.js
const assert = require('assert');
const OBF = require('../js/migr-obfuscate.js');

// ---- rule 4: маскирование текста ----
// Пример из issue: «Социалистическая» (id 1057) -> «Соxxxxисxxxxскxx1057»
assert.strictEqual(OBF.maskText('Социалистическая', 1057), 'Соxxxxисxxxxскxx1057');
assert.strictEqual(OBF.maskText('Пушкина', 1057), 'Пуxxxxа1057');     // 7 знаков: 2 + 4 + 1
assert.strictEqual(OBF.maskText('Ул', 5), 'Ул5');                     // ровно 2 знака
assert.strictEqual(OBF.maskText('А', 5), 'А5');                       // 1 знак
assert.strictEqual(OBF.maskText('Абв', 5), 'Абx5');                   // 3 знака: 2 + 1
assert.strictEqual(OBF.maskText('', 5), '5');                         // пусто -> только id

// ---- rule 3: обфускация сумм (детерминированный rng) ----
assert.strictEqual(OBF.obfuscateSum('1000', () => 0), '500');         // factor 0.5
assert.strictEqual(OBF.obfuscateSum('1000', () => 1), '15000');       // factor 15
assert.strictEqual(OBF.obfuscateSum('2000', () => 0.5), '15500');     // factor 7.75
assert.strictEqual(OBF.obfuscateSum('1', () => 1 / 7), '2.571');      // обрезка до 3 знаков справа
assert.strictEqual(OBF.obfuscateSum('1 234.50', () => 0), '617.25');  // пробелы-разделители
assert.strictEqual(OBF.obfuscateSum('0', () => 0), '0');              // ноль — как есть
assert.strictEqual(OBF.obfuscateSum('нет', () => 0), 'нет');          // не число — как есть

// у результата не больше 3 знаков после запятой
['3.14159', '99999.99999', '7', '0.123456'].forEach(function(v){
    var out = OBF.obfuscateSum(v, () => 1 / 3);
    var dot = out.indexOf('.');
    assert.ok(dot === -1 || (out.length - dot - 1) <= 3, 'слишком много знаков: ' + out);
});

// ---- классификация базовых типов ----
[13, 14, 15].forEach(function(tc){ assert.ok(OBF.isSumType(tc), 'sum ' + tc); });
[2, 3, 8, 12].forEach(function(tc){ assert.ok(OBF.isTextType(tc), 'text ' + tc); });
[9, 4, 11, 10, 17, 7].forEach(function(tc){
    assert.ok(!OBF.isSumType(tc) && !OBF.isTextType(tc), 'нейтральный ' + tc);
});

// ---- obfuscateValue: ссылки/даты/булевы не трогаем ----
assert.strictEqual(OBF.obfuscateValue('42:Центральный', 3, true, 99), '42:Центральный'); // rule 5 (ref)
assert.strictEqual(OBF.obfuscateValue('20240101', 9, false, 99), '20240101');            // DATE — как есть
assert.strictEqual(OBF.obfuscateValue('X', 11, false, 99), 'X');                         // BOOLEAN — как есть
assert.strictEqual(OBF.obfuscateValue('', 3, false, 99), '');                            // пусто — как есть
assert.strictEqual(OBF.obfuscateValue('Ленина', 3, false, 7), OBF.maskText('Ленина', 7));// текст
assert.strictEqual(OBF.obfuscateValue('500', 14, false, 7, () => 0), '250');             // сумма

// ---- buildRefTargets ----
const meta = [
    { id: '900', up: '0', type: '3', val: 'Улицы', reqs: [
        { num: 1, id: '910', val: 'Название', type: '3', orig: '910' },
        { num: 2, id: '911', val: 'Район', type: '3', orig: '42', ref: '42', ref_id: '42' },
        { num: 3, id: '912', val: 'Сумма', type: '14', orig: '912' }
    ]},
    { id: '42', up: '0', type: '3', val: 'Район', referenced: '911', reqs: [
        { num: 1, id: '420', val: 'Название', type: '3', orig: '420' }
    ]},
    // справочник, отмеченный ТОЛЬКО серверным флагом referenced (ссылки нет в reqs meta)
    { id: '43', up: '0', type: '3', val: 'Округ', referenced: '999', reqs: [] }
];
const refTargets = OBF.buildRefTargets(meta);
assert.strictEqual(refTargets['42'], true, 'таблица 42 — справочник (ref_id)');
assert.strictEqual(refTargets['43'], true, 'таблица 43 — справочник (флаг referenced -> собственный id)');
assert.ok(!refTargets['911'], 'значение флага referenced не попадает в множество');
assert.ok(!refTargets['900'], 'таблица 900 не справочник');

// ---- tableMode ----
assert.strictEqual(OBF.tableMode('42', 'Район', 10, refTargets), 'keep');   // справочник, ≤30
assert.strictEqual(OBF.tableMode('42', 'Район', 40, refTargets), 'text');   // справочник, >30 -> текст
assert.strictEqual(OBF.tableMode('900', 'Улицы', 10, refTargets), 'text');  // не справочник
assert.strictEqual(OBF.tableMode('901', 'Статусы заказа', 10, {}), 'keep'); // по названию (rule 5)
assert.strictEqual(OBF.tableMode('901', 'Статусы заказа', 40, {}), 'text'); // название, но >30

// ---- processTable: обфускация записей ----
const columns = [
    { old_req_id: '910', name: 'Улица', type_code: 3, ref_target: null },   // текст
    { old_req_id: '911', name: 'Район', type_code: 3, ref_target: '42' },   // ссылка
    { old_req_id: '912', name: 'Сумма', type_code: 14, ref_target: null }   // сумма
];
const rec = { old_id: '1057', up: '1', values: ['Социалистическая', 'Пушкина', '42:Центральный', '1000'] };
const out = OBF.processTable({
    records: [rec], columns: columns, tableId: '900', tableName: 'Улицы',
    tableBaseCode: 3, refTargets: refTargets, rng: () => 0
});
assert.strictEqual(out.mode, 'text');
assert.deepStrictEqual(out.records[0].values, ['Соxxxxисxxxxскxx1057', 'Пуxxxxа1057', '42:Центральный', '500']);
assert.strictEqual(out.records[0].old_id, '1057'); // id/up сохраняются
assert.strictEqual(out.records[0].up, '1');

// keep-режим: справочник ≤30 — записи не меняются
const keep = OBF.processTable({
    records: [{ old_id: '5', up: '0', values: ['В работе'] }],
    columns: [], tableId: '42', tableName: 'Район', tableBaseCode: 3, refTargets: refTargets, rng: () => 0
});
assert.strictEqual(keep.mode, 'keep');
assert.deepStrictEqual(keep.records[0].values, ['В работе']);

// rule 2: не больше 200 записей
const many = [];
for (let i = 0; i < 250; i++) { many.push({ old_id: String(i), up: '0', values: ['row' + i] }); }
const capped = OBF.processTable({
    records: many, columns: [], tableId: '900', tableName: 'Данные', tableBaseCode: 3, refTargets: {}, rng: () => 0
});
assert.strictEqual(capped.records.length, OBF.OBF_MAX_RECORDS);
assert.strictEqual(capped.records.length, 200);

console.log('PASS issue-4253 obfuscation (maskText/obfuscateSum/tableMode/processTable)');
