// Обёртка гейта для experiments/integramio-export-php8.test.php: вид DATE/FILE при выгрузке под PHP 8.
// Мерка гоняется на обоих ядрах — integram.io (integram.io/index.php) и ideav.ru (index.php).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'integramio-export-php8.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть.
    console.log('SKIP — php не найден в PATH, выгрузка под PHP 8 не проверена: ' + phpTest);
    console.log('       прогон вручную: php experiments/integramio-export-php8.test.php');
    return;
}

for (const core of [path.join('..', 'integram.io', 'index.php'), path.join('..', 'index.php')]) {
    const run = spawnSync('php', [phpTest], {
        encoding: 'utf8',
        env: { ...process.env, INDEX_PHP: path.join(__dirname, core) },
    });
    process.stdout.write(run.stdout || '');
    process.stderr.write(run.stderr || '');
    if (run.status !== 0) {
        console.log('FAIL — integramio-export-php8.test.php на ' + core + ' (код ' + run.status + ')');
        process.exitCode = 1;
    } else {
        console.log('PASS — integramio-export-php8.test.php на ' + core);
    }
}
