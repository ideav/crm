// Обёртка гейта для experiments/required-strict-5219.test.php (ideav/crm#5219).
// Предмет на PHP — строгая проверка обязательных реквизитов _m_new/_m_save (index.php).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'required-strict-5219.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, строгий режим не проверен: ' + phpTest);
    console.log('       прогон вручную: php experiments/required-strict-5219.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — required-strict-5219.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — required-strict-5219.test.php');
}
