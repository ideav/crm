// Обёртка гейта для experiments/mail-endpoint-5494.test.php.
// Сам предмет на PHP — эндпоинт /_mail и SMTP-клиент живут в include/mail.php (#5494).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'mail-endpoint-5494.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    console.log('SKIP - php not found in PATH, mail endpoint (#5494) not checked: ' + phpTest);
    console.log('       manual run: php experiments/mail-endpoint-5494.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL - mail-endpoint-5494.test.php failed (code ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS - mail-endpoint-5494.test.php');
}
