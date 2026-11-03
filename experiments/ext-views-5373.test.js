// Обёртка гейта для experiments/ext-views-5373.test.php (#5373: read-only вьюхи для внешнего SQL-клиента).
// Предмет на PHP: план вьюх include/ext_views.php по метаданным-фикстуре, без БД.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'ext-views-5373.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, план ext-вьюх не проверен: ' + phpTest);
    console.log('       прогон вручную: php experiments/ext-views-5373.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — ext-views-5373.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — ext-views-5373.test.php');
}
