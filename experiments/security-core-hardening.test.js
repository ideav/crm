// Обёртка гейта для experiments/security-core-hardening.test.php.
// Сам предмет на PHP — вход, xsrf, диспетчер команд и dir_admin живут в index.php.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'security-core-hardening.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, правки безопасности ядра не проверены: ' + phpTest);
    console.log('       прогон вручную: php experiments/security-core-hardening.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — security-core-hardening.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — security-core-hardening.test.php');
}
