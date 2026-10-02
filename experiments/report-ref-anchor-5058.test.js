// Обёртка гейта для experiments/report-ref-anchor-5058.test.php (issue #5058).
// Сам предмет на PHP — выбор якоря ссылки в отчёте (refAnchors) живёт в index.php.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'report-ref-anchor-5058.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, выбор якоря ссылки не проверен: ' + phpTest);
    console.log('       прогон вручную: php experiments/report-ref-anchor-5058.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — report-ref-anchor-5058.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — report-ref-anchor-5058.test.php');
}
