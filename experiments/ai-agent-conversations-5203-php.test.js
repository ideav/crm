// Обёртка гейта для experiments/ai-agent-conversations-5203.test.php (crm#5203).
// Предмет на PHP: раздельные диалоги ИИ-чата (aiAgentChats*, index.php).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'ai-agent-conversations-5203.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, диалоги не проверены: ' + phpTest);
    console.log('       прогон вручную: php experiments/ai-agent-conversations-5203.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — ai-agent-conversations-5203.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — ai-agent-conversations-5203.test.php');
}
