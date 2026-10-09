// Обёртка гейта для experiments/ai-agent-callback-no-db.test.php (callback без БД → HTTP 500).
// Предмет на PHP: api_dump()/updateBilling() без соединения с БД (путь callback ИИ-агента).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'ai-agent-callback-no-db.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, ответ callback без БД не проверен: ' + phpTest);
    console.log('       прогон вручную: php experiments/ai-agent-callback-no-db.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — ai-agent-callback-no-db.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — ai-agent-callback-no-db.test.php');
}
