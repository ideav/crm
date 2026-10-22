// Обёртка гейта для experiments/menu-layout-setting-5221.test.php (ideav/crm#5221).
// Предмет на PHP — чтение файла раскладки меню базы (index.php).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'menu-layout-setting-5221.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, раскладка меню базы не проверена: ' + phpTest);
    console.log('       прогон вручную: php experiments/menu-layout-setting-5221.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — menu-layout-setting-5221.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — menu-layout-setting-5221.test.php');
}
