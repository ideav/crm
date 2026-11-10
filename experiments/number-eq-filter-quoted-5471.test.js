// Обёртка гейта для experiments/number-eq-filter-quoted-5471.test.php (issue #5471).
// Сам предмет на PHP — фильтр «равно» по NUMBER/SIGNED живёт в index.php.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'number-eq-filter-quoted-5471.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, фильтр NUMBER (#5471) не проверен: ' + phpTest);
    console.log('       прогон вручную: php experiments/number-eq-filter-quoted-5471.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — number-eq-filter-quoted-5471.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — number-eq-filter-quoted-5471.test.php');
}
