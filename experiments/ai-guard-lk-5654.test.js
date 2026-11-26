// Обёртка гейта для experiments/ai-guard-lk-5654.test.php.
// Сам предмет на PHP — страж данных ИИ-чата из ЛК живёт в include/ai_guard_lk.php (#5654).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'ai-guard-lk-5654.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    console.log('SKIP - php not found in PATH, guard LK (#5654) not checked: ' + phpTest);
    console.log('       manual run: php experiments/ai-guard-lk-5654.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL - ai-guard-lk-5654.test.php failed (code ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS - ai-guard-lk-5654.test.php');
}
