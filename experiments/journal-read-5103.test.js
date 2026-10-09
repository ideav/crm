// Обёртка гейта для experiments/journal-read-5103.test.php (issue #5103).
// Сам предмет на PHP — журнал базы читает index.php.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'journal-read-5103.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, чтение журнала не проверено: ' + phpTest);
    console.log('       прогон вручную: php experiments/journal-read-5103.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — journal-read-5103.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — journal-read-5103.test.php');
}
