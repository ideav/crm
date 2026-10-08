// Обёртка гейта для experiments/ai-log-suffix-839.test.php (python2node#839).
// Сам предмет на PHP — логи базы пишет index.php.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'ai-log-suffix-839.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, метка ~ai в логах не проверена: ' + phpTest);
    console.log('       прогон вручную: php experiments/ai-log-suffix-839.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — ai-log-suffix-839.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — ai-log-suffix-839.test.php');
}
