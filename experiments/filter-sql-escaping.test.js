// Сторож против возврата инъекции через фильтр F_/FR_/TO_.
//
// Значение фильтра приходит из адресной строки и попадает в WHERE внутри кавычек.
// Если его подставить как '$value', оно рвёт литерал: F_{колонка}=' OR '1'='1
// давало `vals.val='' OR '1'='1'` — условие всегда истинно. Найдено на живой базе
// upsound 31.07.2026 (имя артиста "Yan Pol' Musique" роняло запрос).
//
// Поведение проверяет experiments/filter_sqli.test.php — он на PHP и в гейт не входит.
// Здесь статическая проверка обоих ядер, чтобы регрессия не проехала мимо CI.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CORES = ['index.php', 'experiments/index_upsound_260723.fixed.php'];

/** Тело Construct_WHERE — от объявления до следующей функции верхнего уровня. */
function constructWhereBody(source) {
    const start = source.indexOf('\nfunction Construct_WHERE(');
    assert.notStrictEqual(start, -1, 'в ядре нет функции Construct_WHERE');
    const next = source.indexOf('\nfunction ', start + 1);
    return source.slice(start, next === -1 ? source.length : next);
}

for (const core of CORES) {
    const source = fs.readFileSync(path.join(ROOT, core), 'utf8');

    test(`${core}: экранирование значения фильтра на месте`, () => {
        assert.match(source, /function Escape_Filter_Val\(/,
            'нет функции Escape_Filter_Val — экранировать значение фильтра нечем');
        assert.match(source, /\$sql_value = Escape_Filter_Val\(\$value\)/,
            'не готовится экранированная копия $sql_value');
    });

    test(`${core}: значение фильтра не подставляется в SQL сырым`, () => {
        // Ищем '$value' внутри строки, собирающей SQL: это и есть разрыв литерала.
        // Комментарии отбрасываем — в них такая запись встречается как пояснение.
        // Файлы ядра в CRLF, поэтому режем по \r?\n: в JS точка не матчит \r,
        // и без этого хвостовой комментарий не отсекается.
        const raw = constructWhereBody(source)
            .split(/\r?\n/)
            .map((line) => line.replace(/#.*$/, ''))
            .filter((line) => /'\$value'/.test(line));
        assert.deepStrictEqual(raw.map((l) => l.trim()), [],
            'сырая подстановка \'$value\' — используйте $sql_value или Escape_Filter_Val()');
    });

    test(`${core}: от экранирования освобождается только плейсхолдер или целиком закавыченное`, () => {
        // Старое условие пропускало ЛЮБОЕ значение, внутри которого есть апостроф.
        assert.doesNotMatch(constructWhereBody(source),
            /strpos\(\$value, "'"\) !== FALSE \? \$value :/,
            'значение с апострофом снова уходит в SQL без экранирования');
    });
}
