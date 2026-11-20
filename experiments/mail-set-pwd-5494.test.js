// Обёртка гейта для experiments/mail-set-pwd-5494.test.php.
// Сам предмет на PHP — шифрование пароля приложения почты при _m_set (ApplyMSet, #5494).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'mail-set-pwd-5494.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    console.log('SKIP - php not found in PATH, mail password via _m_set (#5494) not checked: ' + phpTest);
    console.log('       manual run: php experiments/mail-set-pwd-5494.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL - mail-set-pwd-5494.test.php failed (code ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS - mail-set-pwd-5494.test.php');
}
