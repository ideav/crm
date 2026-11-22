// Обёртка гейта для experiments/ord-race-5262.test.php (ideav/crm#5262).
// Предмет на PHP — index.php: OrdLock, Calc_Order, Get_Ord, GetRefOrd, case "_m_ord".

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'ord-race-5262.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, гонка порядка среди равных (ord) не проверена: ' + phpTest);
    console.log('       прогон вручную: php experiments/ord-race-5262.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — ord-race-5262.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — ord-race-5262.test.php');
}
