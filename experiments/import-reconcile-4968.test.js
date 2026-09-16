// #4968 — РАЗРЕШЕНИЕ КОНФЛИКТОВ ПРИ ИМПОРТЕ: реквизит архива и реквизит базы.
//
// Реквизиты архива приезжают со своими идентификаторами, в целевой базе занятыми чужими
// записями, поэтому каждому ищется аналог среди реквизитов местного типа. Поиск шёл ПО
// ПРЕФИКСУ подписи, а базовый тип стоит в подписи последним:
//     архив  "Дата:DATE"        местная структура  "Дата:DATETIME"
// префикс совпадал, и значения колонки даты уезжали в колонку даты-времени. Подпись ссылки
// при этом склеивалась без разделителя ("ref:1079" + "9001" = "ref:10799001") и не совпадала
// ни с чем — повторная загрузка того же архива каждый раз заводила ссылку заново.
//
// Проверяет поведение include/import_reconcile.php — на PHP, потому что проверяемый код на
// PHP, и проверять его переписыванием логики на node значило бы тестировать копию.
// Этот файл — обёртка, которая заводит php-тест в общий гейт (`bash scripts/run-tests.sh`).
//
// Run with: node experiments/import-reconcile-4968.test.js

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'import-reconcile-4968.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR тест выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, проверки сведения не выполнены: ' + phpTest);
    console.log('       прогон вручную: php experiments/import-reconcile-4968.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — import-reconcile-4968.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — import-reconcile-4968.test.php');
}
