// Обёртка гейта для experiments/edit-obj-mask-5462.test.php (#5462).
// Сам предмет на PHP — маски строк в карточке edit_obj и маски @N живут в index.php.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'edit-obj-mask-5462.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, маски в edit_obj не проверены: ' + phpTest);
    console.log('       прогон вручную: php experiments/edit-obj-mask-5462.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — edit-obj-mask-5462.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — edit-obj-mask-5462.test.php');
}
