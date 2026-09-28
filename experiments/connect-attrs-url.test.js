// _connect — адрес «Коннектора» из настроек столбца типа CONNECT (226).
//
// `_d_attrs` сохраняет настройки столбца как JSON {"default":"<адрес>"}, а `_connect` подставлял
// их в адрес как есть — коннектор нельзя было настроить штатно. Проверяет ConnectUrl
// (include/field_attrs.php) на PHP, потому что проверяемый код на PHP.
// Этот файл — обёртка, которая заводит php-тест в общий гейт (`bash scripts/run-tests.sh`).
//
// Run with: node experiments/connect-attrs-url.test.js

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'connect-attrs-url.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR тест выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, проверки адреса коннектора не выполнены: ' + phpTest);
    console.log('       прогон вручную: php experiments/connect-attrs-url.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — connect-attrs-url.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — connect-attrs-url.test.php');
}
