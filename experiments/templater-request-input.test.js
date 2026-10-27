// Обёртка гейта для experiments/templater-request-input.test.php — ввод из запроса в шаблонизаторе.
// Предмет на PHP — Make_tree/Parse_block/Get_file из index.php.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'templater-request-input.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, шаблонизатор не проверен: ' + phpTest);
    console.log('       прогон вручную: php experiments/templater-request-input.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — templater-request-input.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — templater-request-input.test.php');
}
