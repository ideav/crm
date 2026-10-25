// Обёртка гейта для experiments/m-save-number-5220.test.php (issue #5220).
// Сам предмет на PHP — запись числа в _m_save живёт в index.php (ApplyMSet).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'm-save-number-5220.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, запись числа в _m_save не проверена: ' + phpTest);
    console.log('       прогон вручную: php experiments/m-save-number-5220.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — m-save-number-5220.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — m-save-number-5220.test.php');
}
