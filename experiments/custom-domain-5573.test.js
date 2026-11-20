// Обёртка гейта для experiments/custom-domain-5573.test.php.
// Сам предмет на PHP — свой домен базы живёт в include/custom_domain.php (#5573).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'custom-domain-5573.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    console.log('SKIP - php not found in PATH, custom domain (#5573) not checked: ' + phpTest);
    console.log('       manual run: php experiments/custom-domain-5573.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL - custom-domain-5573.test.php failed (code ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS - custom-domain-5573.test.php');
}
