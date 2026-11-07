// Обёртка гейта для experiments/boolean-tristate-5442.test.php (issue #5442).
// Сам предмет на PHP — BOOLEAN да / нет / не задано живёт в index.php.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'boolean-tristate-5442.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, BOOLEAN (#5442) не проверен: ' + phpTest);
    console.log('       прогон вручную: php experiments/boolean-tristate-5442.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — boolean-tristate-5442.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — boolean-tristate-5442.test.php');
}
