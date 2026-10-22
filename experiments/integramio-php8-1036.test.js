// Обёртка гейта для experiments/integramio-php8-1036.test.php: разбор и вид значений под PHP 8.
// Мерка гоняется на обоих ядрах — integram.io (integram.io/index.php) и ideav.ru (index.php).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'integramio-php8-1036.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, поведение ядер под PHP 8 не проверено: ' + phpTest);
    console.log('       прогон вручную: php experiments/integramio-php8-1036.test.php');
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
        console.log('FAIL — integramio-php8-1036.test.php на ' + core + ' (код ' + run.status + ')');
        process.exitCode = 1;
    } else {
        console.log('PASS — integramio-php8-1036.test.php на ' + core);
    }
}
