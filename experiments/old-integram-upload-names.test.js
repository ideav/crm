// Обёртка гейта для experiments/old-integram-upload-names.test.php (перенос со старого Интеграма).
// Предмет на PHP — scripts/old-integram-upload-names.php: имена загруженных файлов для нового ядра.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'old-integram-upload-names.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, имена загруженных файлов не проверены: ' + phpTest);
    console.log('       прогон вручную: php experiments/old-integram-upload-names.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — old-integram-upload-names.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — old-integram-upload-names.test.php');
}
