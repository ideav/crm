// Обёртка гейта для experiments/courses-content-gate.test.php (защита платного курса).
// Предмет на PHP — include/courses_content.php: урок платного курса отдаётся только при «Доступе».

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'courses-content-gate.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть.
    console.log('SKIP — php не найден в PATH, защита платного курса не проверена: ' + phpTest);
    console.log('       прогон вручную: php experiments/courses-content-gate.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — courses-content-gate.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — courses-content-gate.test.php');
}
