// Обёртка гейта для experiments/ai-agent-core-token-5131.test.php (ideav/crm#5131).
// Сам предмет на PHP — токен ядра для ИИ-агента выпускает index.php.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'ai-agent-core-token-5131.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, токен ядра для ИИ-агента не проверен: ' + phpTest);
    console.log('       прогон вручную: php experiments/ai-agent-core-token-5131.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — ai-agent-core-token-5131.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — ai-agent-core-token-5131.test.php');
}
