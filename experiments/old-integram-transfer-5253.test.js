// #5253 — повторный перенос базы со старого Интеграма в уже переведённую (integram.io/r7ohr →
// ideav.ru/r7ohr): migrate.js transfer.
//
// ЧТО ПРОВЕРЯЕТСЯ (SQL, который выдаёт buildTransferSql):
//   1) имена таблиц проверяются, база, источник и копия — разные таблицы;
//   2) пробный прогон (без --apply) ничего не пишет, кроме временных таблиц сеанса;
//   3) с --apply база копируется до первого удаления, а проверки источника (есть пользователи,
//      хвосты склеены) идут раньше любой записи;
//   4) на настоящем MySQL (если задан IGT_MYSQL — команда клиента, читающая SQL со stdin, например
//      `docker exec -i db mariadb -uroot -px test`): после переноса база совпадает с источником,
//      кроме корня и паролей пользователей с тем же id и логином, которые остаются из базы; хвосты
//      склеены с пробелами на стыках; повторный --apply останавливается на существующей копии.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execSync } = require('child_process');

const M = require(path.join(__dirname, '..', 'tools', 'old-integram-migration', 'migrate.js'));

// SQL, который выполнит сервер: каждый `SET @q = CONCAT(…)` собирается с подстановкой имён таблиц.
function executed(sql, vars) {
    const out = [];
    const re = /SET @(q|g) = CONCAT\(((?:'(?:[^']|'')*'|@\w+|,|\s)+)\)/g;
    let m;
    while ((m = re.exec(sql))) {
        const parts = m[2].match(/'(?:[^']|'')*'|@\w+/g);
        out.push(parts.map((p) => (p[0] === '@' ? vars[p.slice(1)] : p.slice(1, -1).replace(/''/g, "'").replace(/\\\\/g, '\\'))).join(''));
    }
    return out;
}
const VARS = { tbl: 'r7ohr', src: 'r7ohr_src', bak: 'r7ohr_before_transfer' };
// Таблица, в которую пишет оператор, или null для чтения.
function writes(stmt) {
    const m = /^\s*(?:CREATE\s+(TEMPORARY\s+)?TABLE|INSERT\s+(?:IGNORE\s+)?INTO|DELETE\s+\w+\s+FROM|UPDATE|DROP\s+(TEMPORARY\s+)?TABLE(?:\s+IF\s+EXISTS)?|ALTER\s+TABLE|TRUNCATE)\s+`?(\w+)`?/i.exec(stmt);
    return m ? m[3] : null;
}

test('имена таблиц проверяются, база, источник и копия различны', () => {
    assert.throws(() => M.buildTransferSql({ db: 'r7ohr; drop table my' }), /Недопустимое имя/);
    assert.throws(() => M.buildTransferSql({ db: 'r7ohr', src: 'r7ohr' }), /разными таблицами/);
    assert.throws(() => M.buildTransferSql({ db: 'r7ohr', backup: 'r7ohr_src' }), /разными таблицами/);
});

test('пробный прогон пишет только во временные таблицы', () => {
    const stmts = executed(M.buildTransferSql({ db: 'r7ohr' }), VARS);
    assert.ok(stmts.length > 5);
    const temps = new Set(stmts.filter((s) => /^\s*CREATE\s+TEMPORARY/i.test(s)).map(writes));
    const touched = stmts.map(writes).filter(Boolean).filter((t) => !temps.has(t));
    assert.deepStrictEqual(touched, []);
});

test('--apply: проверки источника и копия базы раньше удаления', () => {
    const stmts = executed(M.buildTransferSql({ db: 'r7ohr', apply: true }), VARS);
    const firstWrite = stmts.findIndex((s) => ['r7ohr', 'r7ohr_before_transfer'].includes(writes(s)));
    const guards = stmts.map((s, i) => (/INTO @g FROM `r7ohr_src`/.test(s) ? i : -1)).filter((i) => i >= 0);
    assert.strictEqual(guards.length, 2);
    guards.forEach((i) => assert.ok(i < firstWrite));
    const copy = stmts.findIndex((s) => /^INSERT INTO `r7ohr_before_transfer` SELECT \* FROM `r7ohr`$/.test(s));
    const del = stmts.findIndex((s) => /^DELETE a FROM `r7ohr`/.test(s));
    assert.ok(copy >= 0 && del > copy, `копия ${copy}, удаление ${del}`);
});

// --------------------------------------------------------------- на настоящем MySQL

const FIXTURE = `
CREATE TABLE r7ohr (id int UNSIGNED NOT NULL AUTO_INCREMENT, up int UNSIGNED NOT NULL, ord int UNSIGNED NOT NULL,
  t int UNSIGNED NOT NULL, val longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  PRIMARY KEY (id), KEY up_t (up, t), KEY t_val (t, val(127))) DEFAULT CHARSET=utf8mb4;
INSERT INTO r7ohr VALUES (1,1,0,1,'ROOT'),(3,0,0,3,'SHORT'),(8,0,0,8,'CHARS'),
 (18,0,0,3,'Пользователь'),(20,0,0,6,'Password'),(50,18,1,20,''),
 (100,0,0,3,'Заказ'),(101,100,1,8,':ALIAS=Комментарий:'),(102,100,2,3,''),
 (151,0,0,3,'Меню'),(152,151,1,3,''),(391,151,2,8,'Иконка'),
 (200,0,0,3,'временная'),(201,200,1,3,''),
 (1000,1,1,18,'admin'),(6000,1000,1,20,'NEWHASH'),(1004,1,2,18,'tmp'),(1005,1004,1,20,'TMPHASH'),
 (5000,1,1,200,'чужая запись'),(5001,5000,1,201,'x');
CREATE TABLE r7ohr_src LIKE r7ohr;
INSERT INTO r7ohr_src VALUES (1,1,0,1,'ROOT'),(3,0,0,3,'SHORT'),(8,0,0,8,'CHARS'),
 (18,0,0,3,'Пользователь'),(20,0,0,6,'Password'),(50,18,1,20,''),
 (100,0,0,3,'Заказ'),(101,100,1,8,''),(102,100,3,3,''),(151,0,0,3,'Меню'),(152,151,1,3,''),
 (200,0,0,3,'Временная'),(300,0,0,3,'Новая'),(301,300,1,3,''),
 (1000,1,1,18,'admin'),(1001,1000,1,20,'OLDHASH'),(1002,1,2,18,'bob'),(1003,1002,1,20,'OLD2'),
 (5000,1,1,100,REPEAT('а',126)),(7000,5000,0,0,REPEAT('б',126)),(7001,5000,1,0,'хвост'),
 (5001,5000,1,101,'коммент'),(6000,1,2,300,'новая запись');
`;

test('перенос на MySQL: база = источник, кроме корня и сохранённых паролей', { skip: !process.env.IGT_MYSQL && 'нет IGT_MYSQL' }, () => {
    const run = (sql) => execSync(process.env.IGT_MYSQL + ' --default-character-set=utf8mb4 -N -B', { input: sql, encoding: 'utf8' });
    run('DROP TABLE IF EXISTS r7ohr, r7ohr_src, r7ohr_before_transfer;' + FIXTURE);
    assert.throws(() => run(M.buildTransferSql({ db: 'r7ohr' })), /СТОП: в источнике есть хвосты/);
    run(M.buildMergeSql('r7ohr_src'));
    const before = run('SELECT COUNT(*) FROM r7ohr');
    run(M.buildTransferSql({ db: 'r7ohr' }));
    assert.strictEqual(run('SELECT COUNT(*) FROM r7ohr'), before, 'пробный прогон ничего не меняет');

    const report = run(M.buildTransferSql({ db: 'r7ohr', apply: true }));
    assert.match(report, /\n0\n?$/, 'расхождений с источником 0');
    const rows = (q) => run(q).trim().split('\n').map((l) => l.split('\t'));
    const got = rows('SELECT id, up, ord, t, val FROM r7ohr WHERE NOT (t = 20 AND up = 1000) ORDER BY id');
    const want = rows("SELECT id, up, ord, t, val FROM r7ohr_src WHERE id <> 1001 ORDER BY id");
    assert.deepStrictEqual(got, want);
    // пароль admin (тот же id и логин) — из базы, под новым id: 6000 в источнике занят записью
    assert.deepStrictEqual(rows('SELECT val FROM r7ohr WHERE t = 20 AND up = 1000'), [['NEWHASH']]);
    assert.deepStrictEqual(rows("SELECT val = CONCAT(REPEAT('а',126),' ',REPEAT('б',126),' хвост') FROM r7ohr WHERE id = 5000"), [['1']]);
    assert.deepStrictEqual(rows('SELECT COUNT(*) FROM r7ohr_before_transfer'), [['20']]);
    assert.throws(() => run(M.buildTransferSql({ db: 'r7ohr', apply: true })), /already exists/);
    run('DROP TABLE r7ohr, r7ohr_src, r7ohr_before_transfer');
});

test('клиент: ключ API — заголовком X-Authorization и кукой <db>; JSON-запросы с параметром JSON', async () => {
    const seen = [];
    const fetch = async (url, opts) => {
        seen.push({ url, headers: opts.headers });
        return { ok: true, text: async () => '{"ok":1}' };
    };
    const c = new M.Client({ base: 'https://example.test/r7ohr', token: 'KEY', fetch });
    await c.getJson('metadata');
    await c.getJson('object/22?JSON_OBJ&LIMIT=0,10');
    assert.deepStrictEqual(seen.map((s) => s.url), [
        'https://example.test/r7ohr/metadata?JSON',
        'https://example.test/r7ohr/object/22?JSON_OBJ&LIMIT=0,10',
    ]);
    const h = seen[0].headers;
    assert.strictEqual(h['X-Authorization'], 'KEY');
    // Новое ядро: ключ в куке idb_<db> — чужая сессия устройства, ответ 401.
    assert.strictEqual(h.Cookie, 'r7ohr=KEY');
});
