// Обёртка гейта для experiments/superuser-role-menu-leak-5238.test.php (ideav/crm#5238).
// Предмет на PHP — FR_RoleID меню роли суперпользователя не утекает в листинг таблицы.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'superuser-role-menu-leak-5238.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, утечка FR_RoleID меню роли не проверена: ' + phpTest);
    console.log('       прогон вручную: php experiments/superuser-role-menu-leak-5238.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — superuser-role-menu-leak-5238.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — superuser-role-menu-leak-5238.test.php');
}
