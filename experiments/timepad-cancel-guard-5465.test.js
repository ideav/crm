// Обёртка гейта для experiments/timepad-cancel-guard-5465.test.php (ideav/crm#5465).
// Предмет на PHP — условие when триггеров отмены timepad.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'timepad-cancel-guard-5465.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, условие отмены билета timepad не проверено: ' + phpTest);
    console.log('       прогон вручную: php experiments/timepad-cancel-guard-5465.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — timepad-cancel-guard-5465.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — timepad-cancel-guard-5465.test.php');
}
