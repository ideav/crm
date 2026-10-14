// #4983 — JSON-АРХИВ v2: одна запись на строку, ключи по алиасам, числа числами.
//
// Выгрузка журнала планирования (7,7 МБ) нечитаема: JSON_PRETTY_PRINT кладёт каждое поле
// на свою строку с отступом, имена колонок журнала длинные ("Журнал.Сессия"), хотя у них
// есть короткие алиасы ("Сессия"). Формат v2 (issue #4983): шапка — с отступами, записи
// "rows" — по одной строке файла; ключ строки — короткое имя колонки; каноничное целое
// (без ведущих нулей, до 15 цифр) — числом; пустых ключей в строке нет; в шапке — readme.
// Импорт понимает v1 и v2: v2 нормализуется к внутреннему виду v1, разбор данных дальше
// по коду не менялся.
//
// Поведение чистого слоя формата проверяет experiments/json-archive-4983.test.php — на PHP,
// потому что проверяемый код на PHP (include/json_archive.php); этот файл — обёртка, которая
// заводит php-тест в общий гейт (`bash scripts/run-tests.sh`).
//
// Run with: node experiments/json-archive-4983.test.js

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'json-archive-4983.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR тест выполняется по-настоящему.
    console.log('SKIP - php не найден в PATH, проверки формата не выполнены: ' + phpTest);
    console.log('       прогон вручную: php experiments/json-archive-4983.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL - json-archive-4983.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS - json-archive-4983.test.php');
}
