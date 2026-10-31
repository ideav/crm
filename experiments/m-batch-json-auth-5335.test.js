// Обёртка гейта для experiments/m-batch-json-auth-5335.test.php (ideav/crm#5335).
// Предмет на PHP — _m_batch отвечает JSON при авторизации заголовком без ?JSON (index.php).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'm-batch-json-auth-5335.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, JSON-ответ _m_batch не проверен: ' + phpTest);
    console.log('       прогон вручную: php experiments/m-batch-json-auth-5335.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — m-batch-json-auth-5335.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — m-batch-json-auth-5335.test.php');
}
