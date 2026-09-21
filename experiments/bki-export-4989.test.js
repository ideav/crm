// #4989 — ВЫГРУЗКА BKI: данные обязаны заканчивать ответ, без HTML-страницы приложения.
//
// Поведение проверяет experiments/bki-export-4989.test.php — на PHP, потому что проверяемый
// код на PHP (index.php: exportHeader + DataExportBki), и проверять его переписыванием на
// node значило бы тестировать копию, а не оригинал. Этот файл — обёртка, которая заводит
// php-тест в общий гейт (`bash scripts/run-tests.sh`). Образец — json-archive-4968.test.js.
//
// Run with: node experiments/bki-export-4989.test.js

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'bki-export-4989.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR тест выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, проверки выгрузки не выполнены: ' + phpTest);
    console.log('       прогон вручную: php experiments/bki-export-4989.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — bki-export-4989.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — bki-export-4989.test.php');
}
