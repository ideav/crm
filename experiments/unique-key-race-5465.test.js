// Обёртка гейта для experiments/unique-key-race-5465.test.php (ideav/crm#5465).
// Предмет на PHP — index.php: UniqueKeyLock.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'unique-key-race-5465.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, гонка уникального значения в _m_new не проверена: ' + phpTest);
    console.log('       прогон вручную: php experiments/unique-key-race-5465.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — unique-key-race-5465.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — unique-key-race-5465.test.php');
}
