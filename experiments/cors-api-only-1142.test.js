// Обёртка гейта для experiments/cors-api-only-1142.test.php (python2node#1142).
// Предмет на PHP — Cors_headers_list() из index.php: CORS только у API-запросов.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'cors-api-only-1142.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, CORS ядра не проверен: ' + phpTest);
    console.log('       прогон вручную: php experiments/cors-api-only-1142.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — cors-api-only-1142.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — cors-api-only-1142.test.php');
}
