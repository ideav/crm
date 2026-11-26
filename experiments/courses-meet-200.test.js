// Обёртка гейта для experiments/courses-meet-200.test.php (ideav/courses#200).
// Предмет на PHP — include/courses_meet.php: видеовстречи (ключи Jitsi, блок-лист, коды гостей).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'courses-meet-200.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть.
    console.log('SKIP — php не найден в PATH, видеовстречи не проверены: ' + phpTest);
    console.log('       прогон вручную: php experiments/courses-meet-200.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — courses-meet-200.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — courses-meet-200.test.php');
}
