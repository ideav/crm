// Обёртка гейта для experiments/set-new-req-text-5463.test.php (ideav/crm#5463).
// Предмет на PHP — запись SET-запросом в новый реквизит (ветка «A new record» в index.php).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'set-new-req-text-5463.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, запись SET в новый реквизит не проверена: ' + phpTest);
    console.log('       прогон вручную: php experiments/set-new-req-text-5463.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — set-new-req-text-5463.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — set-new-req-text-5463.test.php');
}
