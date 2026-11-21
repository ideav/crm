// #5269 — WEB-SOCKET В ЯДРЕ, PHP-сторона: ядро копит изменения данных из журнала, после
// ответа строит события с цепочкой типов и шлёт их подписанным POST демону ws-server/.
// Проверяет include/ws_push.php и проводку в index.php (logChange, Report_tx_rollback) — на
// PHP, потому что проверяемый код на PHP.
// Этот файл — обёртка, которая заводит php-тест в общий гейт (`bash scripts/run-tests.sh`).
//
// Run with: node experiments/ws-push-5269.test.js

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'ws-push-5269.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR тест выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, проверки web-socket не выполнены: ' + phpTest);
    console.log('       прогон вручную: php experiments/ws-push-5269.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — ws-push-5269.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — ws-push-5269.test.php');
}
