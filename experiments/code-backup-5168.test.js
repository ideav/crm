// Обёртка гейта для experiments/code-backup-5168.test.php (issue #5168).
// Сам предмет на PHP — архивация и восстановление файлов базы живут в index.php.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'code-backup-5168.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, архивация файлов не проверена: ' + phpTest);
    console.log('       прогон вручную: php experiments/code-backup-5168.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — code-backup-5168.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — code-backup-5168.test.php');
}
