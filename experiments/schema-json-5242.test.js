// Обёртка гейта для experiments/schema-json-5242.test.php (ideav/crm#5242).
// Предмет на PHP — схема одним JSON и поля по именам (include/schema_json.php).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'schema-json-5242.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, схема одним JSON не проверена: ' + phpTest);
    console.log('       прогон вручную: php experiments/schema-json-5242.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — schema-json-5242.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — schema-json-5242.test.php');
}
