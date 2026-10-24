// Перенос базы старого Интеграма в локальную установку нового: файлы базы из архива старого
// сервера (templates/custom/<db>, download/<db>) раскладываются в корень нового сайта с теми же
// правилами, что и перенос через dir_admin (migrate.js files).
//
//   node --test experiments/old-integram-onprem-import.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const M = require(path.join(__dirname, '..', 'tools', 'old-integram-migration', 'migrate.js'));

function tree(root) {
    const out = {};
    const walk = (dir) => {
        for (const n of fs.readdirSync(dir)) {
            const p = path.join(dir, n);
            if (fs.statSync(p).isDirectory()) walk(p);
            else out[path.relative(root, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8');
        }
    };
    if (fs.existsSync(root)) walk(root);
    return out;
}

function put(root, files) {
    for (const [rel, text] of Object.entries(files)) {
        const p = path.join(root, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, text);
    }
}

test('файлы из каталога: шаблоны и download базы, без служебных и перекрывающих, jQuery дописан', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'onprem-'));
    const src = path.join(tmp, 'old');
    const dst = path.join(tmp, 'new');
    put(src, {
        'templates/custom/r7/main.html': 'старый main',
        'templates/custom/r7/svod.html': '<div></div><script>$(".x").hide()</script>',
        'templates/custom/r7/sub/main.html': 'не корень — переносится',
        'templates/custom/r7/logs/trace.log': 'журнал',
        'templates/custom/r7/backups/a.zip': 'архив',
        'templates/custom/other/x.html': 'чужая база',
        'download/r7/report.html': 'отчёт',
        'download/r7/Img/a.png': 'png',
    });
    put(dst, { 'templates/custom/r7/existing.html': 'уже есть' });

    const dry = M.copyDirFiles({ src, dst, db: 'r7', commonTemplates: ['main.html'], apply: false, log: () => {} });
    assert.deepStrictEqual(tree(dst), { 'templates/custom/r7/existing.html': 'уже есть' }, 'пробный прогон ничего не пишет');

    const r = M.copyDirFiles({ src, dst, db: 'r7', commonTemplates: ['main.html'], apply: true, log: () => {} });
    assert.deepStrictEqual(r.copied.map((f) => f.path).sort(), dry.copied.map((f) => f.path).sort());
    const got = tree(dst);
    assert.deepStrictEqual(Object.keys(got).sort(), [
        'download/r7/Img/a.png',
        'download/r7/report.html',
        'templates/custom/r7/existing.html',
        'templates/custom/r7/sub/main.html',
        'templates/custom/r7/svod.html',
    ]);
    assert.ok(got['templates/custom/r7/svod.html'].startsWith('<script src="/js/jquery3.1.1.min.js"></script>\n<div>'));
    assert.strictEqual(got['download/r7/report.html'], 'отчёт', 'download не правится');
    assert.deepStrictEqual(r.skipped.map((s) => s.path).sort(), [
        'templates/custom/r7/backups',
        'templates/custom/r7/logs',
        'templates/custom/r7/main.html',
    ]);
});

test('файлы из каталога: нет каталогов базы в архиве — ошибка, а не тихий ноль', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'onprem-'));
    put(path.join(tmp, 'old'), { 'templates/custom/other/x.html': 'x' });
    assert.throws(() => M.copyDirFiles({ src: path.join(tmp, 'old'), dst: path.join(tmp, 'new'), db: 'r7', apply: false, log: () => {} }),
        /нет ни templates\/custom\/r7, ни download\/r7/);
});

// Таблица со старого сервера может прийти без индекса t_val (схема старого ядра) — склейка
// не должна падать на его удалении, а после неё индекс есть и повторный прогон ничего не меняет.
test('склейка на MySQL: таблица без индекса t_val и повторный прогон', { skip: !process.env.IGT_MYSQL && 'нет IGT_MYSQL' }, () => {
    const { execSync } = require('child_process');
    const run = (sql) => execSync(process.env.IGT_MYSQL + ' --default-character-set=utf8mb4 -N -B', { input: sql, encoding: 'utf8' });
    run(`DROP TABLE IF EXISTS oldkey;
CREATE TABLE oldkey (id int NOT NULL AUTO_INCREMENT PRIMARY KEY, up int NOT NULL, ord int NOT NULL, t int NOT NULL, val varchar(127) NOT NULL, KEY up (up)) DEFAULT CHARSET=utf8;
INSERT INTO oldkey VALUES (1,0,0,0,'root'), (2,1,0,3,'${'а'.repeat(127)}'), (3,2,0,0,'хвост');`);
    run(M.buildMergeSql('oldkey'));
    run(M.buildMergeSql('oldkey'));
    const keys = run("SELECT index_name, GROUP_CONCAT(CONCAT(column_name, IFNULL(CONCAT('(', sub_part, ')'), '')) ORDER BY seq_in_index) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'oldkey' AND index_name IN ('t_val', 'up_t') GROUP BY index_name ORDER BY 1");
    // up_t ядро называет в USE INDEX (index.php, «Get Object type name»)
    assert.strictEqual(keys.trim(), 't_val\tt,val(127)\nup_t\tup,t');
    assert.strictEqual(run('SELECT CHAR_LENGTH(val) FROM oldkey WHERE id = 2').trim(), String(127 + 5));
    assert.strictEqual(run('SELECT COUNT(*) FROM oldkey').trim(), '2');
    run('DROP TABLE oldkey');
});
