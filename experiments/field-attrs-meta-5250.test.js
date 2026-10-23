// Обёртка гейта для experiments/field-attrs-meta-5250.test.php (ideav/crm#5250).
// Предмет на PHP — атрибуты колонки объектом field_attrs в metadata (include/field_attrs.php).

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'field-attrs-meta-5250.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, field_attrs не проверен: ' + phpTest);
    console.log('       прогон вручную: php experiments/field-attrs-meta-5250.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — field-attrs-meta-5250.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — field-attrs-meta-5250.test.php');
}
