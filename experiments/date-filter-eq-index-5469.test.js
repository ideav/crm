// Обёртка гейта для experiments/date-filter-eq-index-5469.test.php (ideav/crm#5469).
// Предмет на PHP — фильтр по одной дате в Construct_WHERE обоих ядер идёт по индексу.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'date-filter-eq-index-5469.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, фильтр по дате не проверен: ' + phpTest);
    console.log('       прогон вручную: php experiments/date-filter-eq-index-5469.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — date-filter-eq-index-5469.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — date-filter-eq-index-5469.test.php');
}
