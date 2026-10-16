// Обёртка гейта для experiments/restore-apply-5166.test.php (issue #5166).
// Сам предмет на PHP — бэкап и восстановление базы из архива живут в index.php.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'restore-apply-5166.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, восстановление из бэкапа не проверено: ' + phpTest);
    console.log('       прогон вручную: php experiments/restore-apply-5166.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — restore-apply-5166.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — restore-apply-5166.test.php');
}
