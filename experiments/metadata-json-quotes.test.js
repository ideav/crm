// Обёртка гейта для experiments/metadata-json-quotes.test.php (кавычки в именах).
// Предмет на PHP — валидный JSON metadata/obj_meta (index.php).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'metadata-json-quotes.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, JSON metadata не проверен: ' + phpTest);
    console.log('       прогон вручную: php experiments/metadata-json-quotes.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — metadata-json-quotes.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — metadata-json-quotes.test.php');
}
