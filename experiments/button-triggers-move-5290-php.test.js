// Обёртка гейта для experiments/button-triggers-move-5290.test.php (#5290: _m_move → UPDATE триггеров).
// Предмет на PHP: ветка _m_move ядра и движок include/button_triggers.php.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'button-triggers-move-5290.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, событие UPDATE при переносе не проверено: ' + phpTest);
    console.log('       прогон вручную: php experiments/button-triggers-move-5290.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — button-triggers-move-5290.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — button-triggers-move-5290.test.php');
}
