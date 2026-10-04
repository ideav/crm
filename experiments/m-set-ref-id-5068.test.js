// Обёртка гейта для experiments/m-set-ref-id-5068.test.php (issue #5068).
// Сам предмет на PHP — запись ссылки в _m_set живёт в index.php (ApplyMSet).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'm-set-ref-id-5068.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, запись ссылки не проверена: ' + phpTest);
    console.log('       прогон вручную: php experiments/m-set-ref-id-5068.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — m-set-ref-id-5068.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — m-set-ref-id-5068.test.php');
}
