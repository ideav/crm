// Сторож против возврата #4661 в ядре: фильтр `F_/FR_/TO_` по ИМЕНИ колонки.
//
// Ядро переводит имя колонки в id реквизита через REQNAMES — а там лежит имя ТИПА
// («С_т»), тогда как в UI и в API колонка зовётся своим псевдонимом («С»). Имя, которое
// не нашлось, ядро подставляло в SQL идентификатором: `LEFT JOIN … ON aС.t=С` →
// `Unknown column 'По' in 'on clause'`, ответ — HTML-ошибка вместо JSON. На живой базе
// finmo так молча пустел словарь периодов дэшборда (`object/Квартал?FR_С=>=…`).
//
// Поведение ядра целиком проверяется только с БД; здесь — статический сторож, что
// разрешение по псевдониму на месте (как в experiments/filter-sql-escaping.test.js).
//
// Run with: node experiments/filter-alias-resolve-4661.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.php'), 'utf8');

test('index.php: псевдоним колонки попадает в карту имён', () => {
    assert.match(source, /\$GLOBALS\["REQALIASES"\]\[\$row\["t"\]\] = \$val;/,
        'REQALIASES не заполняется — фильтровать по псевдониму нечем');
    // $val — это как раз FetchAlias(attrs, val), то есть имя, которое видно в UI.
    assert.match(source, /\$val = isset\(\$row\["ref_id"\]\) \? FetchAlias\(/,
        'в $val больше не лежит псевдоним колонки — карта REQALIASES потеряла смысл');
});

test('index.php: имя фильтра ищется и среди псевдонимов', () => {
    const lookup = source.slice(source.indexOf('# Replace field name with its ID'),
        source.indexOf('$GLOBALS["CONDS"][$col][$pre] = $value;'));
    assert.notStrictEqual(lookup.length, 0, 'не найден блок разрешения имени фильтра');
    assert.match(lookup, /array_search\(\$col, \$GLOBALS\["REQNAMES"\]\)/,
        'разрешение по имени типа пропало');
    assert.match(lookup, /array_search\(\$col, \$GLOBALS\["REQALIASES"\]\)/,
        'разрешение по псевдониму отсутствует — FR_С снова уедет в SQL идентификатором');
});
