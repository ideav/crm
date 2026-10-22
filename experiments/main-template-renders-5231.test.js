// Обёртка гейта для experiments/main-template-renders-5231.test.php (ideav/crm#5231).
// Предмет на PHP — разбор templates/main.html шаблонизатором index.php (Make_tree/Parse_block).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'main-template-renders-5231.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, разбор main.html не проверен: ' + phpTest);
    console.log('       прогон вручную: php experiments/main-template-renders-5231.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — main-template-renders-5231.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — main-template-renders-5231.test.php');
}
