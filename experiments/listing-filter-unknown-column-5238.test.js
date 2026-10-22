// Обёртка гейта для experiments/listing-filter-unknown-column-5238.test.php (ideav/crm#5238).
// Предмет на PHP — фильтр листинга таблицы по несуществующей колонке в index.php.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'listing-filter-unknown-column-5238.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, фильтр листинга по несуществующей колонке не проверен: ' + phpTest);
    console.log('       прогон вручную: php experiments/listing-filter-unknown-column-5238.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — listing-filter-unknown-column-5238.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — listing-filter-unknown-column-5238.test.php');
}
