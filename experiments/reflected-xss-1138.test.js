// Обёртка гейта для experiments/reflected-xss-1138.test.php — текст из запроса в ответах ядра и TRACE_IT (python2node#1138).
// Предмет на PHP — my_die/Safe_msg_html/Json_die/Trace_allowed из index.php.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'reflected-xss-1138.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, мерка не выполнена: ' + phpTest);
    console.log('       прогон вручную: php experiments/reflected-xss-1138.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — reflected-xss-1138.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — reflected-xss-1138.test.php');
}
