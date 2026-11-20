// Обёртка гейта для experiments/download-attachment-hardening.test.php.
// Предмет на PHP: восстановление файлов из архива (Code_restore_apply) обязано проходить
// имена через BlackList — иначе в download/ и templates/custom/ попадают php/sh-расширения.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'download-attachment-hardening.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему. Локально php нет —
    // честный прогон этой мерки: сервер 92.242.60.37 (php 8.3 с ext/zip не нужен,
    // ZipArchive стабится) или docker php в WSL.
    console.log('SKIP — php не найден в PATH, восстановление из архива не проверено: ' + phpTest);
    console.log('       прогон вручную: php experiments/download-attachment-hardening.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — download-attachment-hardening.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — download-attachment-hardening.test.php');
}
