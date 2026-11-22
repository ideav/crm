// Обёртка гейта для experiments/report-sql-request-1140.test.php (значения из адреса запроса в SQL, p2n#1140).
// Сам предмет на PHP — условие собирает Compile_Report в index.php.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'report-sql-request-1140.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, значения из адреса в SQL не проверены: ' + phpTest);
    console.log('       прогон вручную: php experiments/report-sql-request-1140.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — report-sql-request-1140.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — report-sql-request-1140.test.php');
}
