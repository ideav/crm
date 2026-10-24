// Обёртка гейта для experiments/report-in-transaction-5261.test.php (issue #5261).
// Сам предмет на PHP — транзакцию запроса ведёт index.php.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'report-in-transaction-5261.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, транзакция запроса не проверена: ' + phpTest);
    console.log('       прогон вручную: php experiments/report-in-transaction-5261.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — report-in-transaction-5261.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — report-in-transaction-5261.test.php');
}
