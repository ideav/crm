// Обёртка гейта для experiments/ai-included-5633.test.php (ИИ, включённый в оплату, #5633).
// Предмет на PHP: billingAiUnitPrice() из index.php.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'ai-included-5633.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, счётчики биллинга не проверены: ' + phpTest);
    console.log('       прогон вручную: php experiments/ai-included-5633.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — ai-included-5633.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — ai-included-5633.test.php');
}
