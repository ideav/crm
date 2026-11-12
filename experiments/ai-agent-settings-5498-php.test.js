// Обёртка гейта для experiments/ai-agent-settings-5498.test.php (crm#5498).
// Предмет на PHP: окно шестерёнки ИИ-чата — GET ai/agent/settings (aiAgentSettingsRequest, index.php).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'ai-agent-settings-5498.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, настройка модели ИИ-чата не проверена: ' + phpTest);
    console.log('       прогон вручную: php experiments/ai-agent-settings-5498.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — ai-agent-settings-5498.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — ai-agent-settings-5498.test.php');
}
