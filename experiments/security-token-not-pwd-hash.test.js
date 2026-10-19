// Обёртка гейта для experiments/security-token-not-pwd-hash.test.php.
// Сам предмет на PHP — выдача токенов сессии живёт в index.php.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'security-token-not-pwd-hash.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, токен сессии ≠ хеш пароля не проверено: ' + phpTest);
    console.log('       прогон вручную: php experiments/security-token-not-pwd-hash.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — security-token-not-pwd-hash.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — security-token-not-pwd-hash.test.php');
}
