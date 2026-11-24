// Обёртка гейта для experiments/route-id-5704.test.php (ideav/crm#5704).
// Предмет на PHP — адрес по имени: промах → 404 (Route_id в index.php).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'route-id-5704.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, адрес по имени не проверен: ' + phpTest);
    console.log('       прогон вручную: php experiments/route-id-5704.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — route-id-5704.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — route-id-5704.test.php');
}
