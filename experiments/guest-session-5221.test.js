// Обёртка гейта для experiments/guest-session-5221.test.php (ideav/crm#5221).
// Предмет на PHP — вход гостем в Validate_Token (index.php).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'guest-session-5221.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, вход гостем не проверен: ' + phpTest);
    console.log('       прогон вручную: php experiments/guest-session-5221.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — guest-session-5221.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — guest-session-5221.test.php');
}
