// Обёртка гейта для experiments/cources-pay-92.test.php (ideav/courses#92).
// Предмет на PHP — include/cources_pay.php: ссылка на оплату курса и вебхук Точки.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'cources-pay-92.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть.
    console.log('SKIP — php не найден в PATH, оплата курсов не проверена: ' + phpTest);
    console.log('       прогон вручную: php experiments/cources-pay-92.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — cources-pay-92.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — cources-pay-92.test.php');
}
