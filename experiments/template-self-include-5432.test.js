// Обёртка гейта для experiments/template-self-include-5432.test.php (ideav/crm#5432).
// Предмет на PHP — вставка файлов маркером File в Make_tree (index.php): шаблон не вставляет сам себя.

const { spawnSync } = require('child_process');
const path = require('path');

const phpTest = path.join(__dirname, 'template-self-include-5432.test.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    // Пропуск ГРОМКИЙ и только при отсутствии php: на ubuntu-latest (CI) php есть,
    // так что в гейте PR мерка выполняется по-настоящему.
    console.log('SKIP — php не найден в PATH, вставка файлов маркером File не проверена: ' + phpTest);
    console.log('       прогон вручную: php experiments/template-self-include-5432.test.php');
    return;
}

const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) {
    console.log('FAIL — template-self-include-5432.test.php упал (код ' + run.status + ')');
    process.exitCode = 1;
} else {
    console.log('PASS — template-self-include-5432.test.php');
}
