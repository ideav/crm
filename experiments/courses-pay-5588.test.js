// Обёртка гейта для experiments/courses-pay-5588.test.php (ideav/crm#5588).
// Предмет на PHP — include/courses_pay.php: оплата авторских курсов a<N> (Каталог) и промокод на них.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'courses-pay-5588.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть.
    console.log('SKIP — php не найден в PATH, оплата курсов не проверена: ' + phpTest);
    console.log('       прогон вручную: php experiments/courses-pay-5588.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — courses-pay-5588.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — courses-pay-5588.test.php');
}
