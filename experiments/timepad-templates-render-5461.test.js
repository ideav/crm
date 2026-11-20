// Обёртка гейта для experiments/timepad-templates-render-5461.test.php (ideav/crm#5461).
// Предмет на PHP — разбор шаблонов базы timepad (templates/timepad/*.html) шаблонизатором index.php.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'timepad-templates-render-5461.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, разбор шаблонов timepad не проверен: ' + phpTest);
    console.log('       прогон вручную: php experiments/timepad-templates-render-5461.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — timepad-templates-render-5461.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — timepad-templates-render-5461.test.php');
}
