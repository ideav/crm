// #4968 — JSON-АРХИВ ТАБЛИЦЫ: выгрузка метаданных и данных в JSON и загрузка обратно.
//
// Формат BKI (`include/delimiters.php` + разбор в index.php) — построчный текст, где поля
// разделены `;`, части поля — `:`, значения мульти-ссылки — `,`. Значение, содержащее
// разделитель, экранируется, а разбор прячет экранированные последовательности в маркеры.
// Маркерами были последовательности `%3B`/`%3A`/`%2C`/`%5C` — то есть ОБЫЧНЫЙ ТЕКСТ, который
// сплошь и рядом встречается в данных (URL-кодирование). Значение
//     https://host/path?a=1%3Bb&c=2%3Ad
// после Mask→UnMask возвращалось как
//     https://host/path?a=1;b&c=2:d
// — архив тихо портил данные, и восстановление из него давало не то, что выгружали.
//
// JSON-архив снимает проблему целиком: границы значений задаёт сам JSON, экранирование
// разделителей в данных не нужно, значение с `;`, `:`, `,` и переводом строки едет как есть.
// Метаданные (типы, базовые типы, ссылки, ключевые и мульти-реквизиты) едут рядом с данными,
// поэтому загрузка обратно сводит колонки архива с колонками базы ПО ПОЛНОМУ ЗНАЧЕНИЮ, а не
// по префиксу: `Дата:DATE` больше не попадает в локальную `Дата:DATETIME`.
//
// Поведение чистого слоя формата проверяет experiments/json-archive-4968.test.php — на PHP,
// потому что проверяемый код на PHP (include/json_archive.php, include/delimiters.php) и
// проверять его переписыванием логики на node значило бы тестировать копию, а не оригинал.
// Этот файл — обёртка, которая заводит php-тест в общий гейт (`bash scripts/run-tests.sh`).
//
// Run with: node experiments/json-archive-4968.test.js

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'json-archive-4968.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR тест выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, проверки формата не выполнены: ' + phpTest);
    console.log('       прогон вручную: php experiments/json-archive-4968.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — json-archive-4968.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — json-archive-4968.test.php');
}
