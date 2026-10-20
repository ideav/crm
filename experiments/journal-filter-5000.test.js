// Обёртка гейта для experiments/journal-filter-5000.test.php (issue #5000).
// Сам предмет на PHP — фильтры журнала живут в index.php.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'journal-filter-5000.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, фильтры журнала не проверены: ' + phpTest);
    console.log('       прогон вручную: php experiments/journal-filter-5000.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — journal-filter-5000.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — journal-filter-5000.test.php');
}
