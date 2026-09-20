// Обёртка гейта для experiments/m-batch-4981.test.php (issue #4981).
// Сам предмет на PHP — пакетная запись и правка первой колонки живут в index.php.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'm-batch-4981.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, пакетная запись не проверена: ' + phpTest);
    console.log('       прогон вручную: php experiments/m-batch-4981.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — m-batch-4981.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — m-batch-4981.test.php');
}
