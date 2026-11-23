// Обёртка гейта для experiments/report-global-subst-5664.test.php (_global_ в SQL отчёта — данные, issue #5664).
// Сам предмет на PHP — подстановку делает Compile_Report в index.php.
// rules: none (defect #5664)

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'report-global-subst-5664.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, подстановка _global_ в SQL не проверена: ' + phpTest);
    console.log('       прогон вручную: php experiments/report-global-subst-5664.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — report-global-subst-5664.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — report-global-subst-5664.test.php');
}
