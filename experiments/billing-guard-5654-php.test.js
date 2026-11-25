// Обёртка гейта для experiments/billing-guard-5654.test.php (счётчики биллинга базы, #5654).
// Предмет на PHP: billingAddRequest()/billingCounterAdd() из index.php на заглушке mysqli.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'billing-guard-5654.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, счётчики биллинга не проверены: ' + phpTest);
    console.log('       прогон вручную: php experiments/billing-guard-5654.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — billing-guard-5654.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — billing-guard-5654.test.php');
}
