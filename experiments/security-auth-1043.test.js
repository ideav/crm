// Обёртка гейта для experiments/security-auth-1043.test.php.
// Сам предмет на PHP — пароли, сессии, блокировка входа, права MCP и кука входа живут в index.php.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'security-auth-1043.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, правки безопасности ядра не проверены: ' + phpTest);
    console.log('       прогон вручную: php experiments/security-auth-1043.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — security-auth-1043.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — security-auth-1043.test.php');
}
