// Обёртка гейта для experiments/captcha-admin-token-1139.test.php.
// Сам предмет на PHP — капча входа и мастер-токен живут в index.php (#1139).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'captcha-admin-token-1139.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, капча входа и мастер-токен (#1139) не проверены: ' + phpTest);
    console.log('       прогон вручную: php experiments/captcha-admin-token-1139.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — captcha-admin-token-1139.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — captcha-admin-token-1139.test.php');
}
