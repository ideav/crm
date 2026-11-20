// Обёртка гейта для experiments/sso-cabinet-84.test.php (ideav/courses#84).
// Предмет на PHP — вход в базу через кабинет my (Sso_enter в Validate_Token, index.php).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'sso-cabinet-84.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть.
    console.log('SKIP — php не найден в PATH, вход через кабинет my не проверен: ' + phpTest);
    console.log('       прогон вручную: php experiments/sso-cabinet-84.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — sso-cabinet-84.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — sso-cabinet-84.test.php');
}
