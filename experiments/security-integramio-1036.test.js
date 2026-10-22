// Обёртка гейта для experiments/security-integramio-1036.test.php.
// Предмет на PHP — вход, журнал, диспетчер и dir_admin ядра experiments/index_integram.io.php (#1036).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'security-integramio-1036.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, правки безопасности ядра не проверены: ' + phpTest);
    console.log('       прогон вручную: php experiments/security-integramio-1036.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — security-integramio-1036.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — security-integramio-1036.test.php');
}
