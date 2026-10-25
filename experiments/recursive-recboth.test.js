// Обёртка гейта для experiments/recursive-recboth.test.php (порт гирлянды vecmory, ai2o#92).
// Предмет на PHP — генерация WITH RECURSIVE в Get_block_data (index.php).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'recursive-recboth.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, SQL фрагмента RECURSIVE не проверен: ' + phpTest);
    console.log('       прогон вручную: php experiments/recursive-recboth.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — recursive-recboth.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — recursive-recboth.test.php');
}
