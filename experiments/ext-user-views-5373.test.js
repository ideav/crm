// Обёртка гейта для experiments/ext-user-views-5373.test.php (#5373: SQL-доступ пользователя по правам его роли).
// Предмет на PHP: план вьюх пользователя (include/ext_views.php) по фикстуре и грантам роли, без БД.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'ext-user-views-5373.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, план ext-вьюх не проверен: ' + phpTest);
    console.log('       прогон вручную: php experiments/ext-user-views-5373.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — ext-user-views-5373.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — ext-user-views-5373.test.php');
}
