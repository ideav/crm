// Обёртка гейта для experiments/ai-agent-llm-flag-1242.test.php (python2node#1242).
// Предмет на PHP: флаг llm_configured в запросе агенту (callIntegramAgent, index.php).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'ai-agent-llm-flag-1242.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, флаг своей модели не проверен: ' + phpTest);
    console.log('       прогон вручную: php experiments/ai-agent-llm-flag-1242.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — ai-agent-llm-flag-1242.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — ai-agent-llm-flag-1242.test.php');
}
