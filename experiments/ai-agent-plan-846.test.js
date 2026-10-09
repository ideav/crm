// Обёртка гейта для experiments/ai-agent-plan-846.test.php (python2node#846).
// Сам предмет на PHP — проводка действий над планом агента живёт в index.php.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'ai-agent-plan-846.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, проводка плана агента не проверена: ' + phpTest);
    console.log('       прогон вручную: php experiments/ai-agent-plan-846.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — ai-agent-plan-846.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — ai-agent-plan-846.test.php');
}
