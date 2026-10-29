// Перевод таблицы старого Интеграма на новое ядро (migrate.js sql, шаг импорта
// scripts/import-old-integram.sh) на таблице в том виде, в каком её отдаёт mysqldump старого сервера:
// val varchar(127) и индекс t_val (t, val) по всей колонке. Ядро старого сервера создаёт таблицы
// базы именно так (integram.io/r7ohr, дамп 29.10.2026).
//
// Перевод val в longtext при живом индексе t_val (t, val) без префикса MariaDB 11.4 (образ
// Docker-установки) отвергает: «Specified key was too long; max key length is 3072 bytes».
// Индекс снимается до перевода колонки.
//
// Проверка — на настоящем сервере БД: IGT_MYSQL — команда клиента, читающая SQL со stdin, например
// `docker exec -i db mariadb -uroot -px test`. Без IGT_MYSQL тест пропускается.
//
//   IGT_MYSQL="docker exec -i db mariadb -uroot -px test" node --test experiments/old-integram-merge-old-key.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execSync } = require('child_process');

const M = require(path.join(__dirname, '..', 'tools', 'old-integram-migration', 'migrate.js'));

const OLD_TABLE = `
CREATE TABLE oldkey (
  id int(4) unsigned NOT NULL AUTO_INCREMENT,
  t int(4) unsigned NOT NULL,
  up int(4) unsigned NOT NULL,
  ord int(4) unsigned NOT NULL,
  val varchar(127) NOT NULL,
  PRIMARY KEY (id),
  KEY t_val (t, val),
  KEY up_t (up, t)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC;
INSERT INTO oldkey (id, t, up, ord, val) VALUES (1,1,1,0,'ROOT'),(3,3,0,0,'SHORT'),(18,3,0,0,'Пользователь'),
 (100,3,0,0,'Заказ'),(5000,100,1,1,REPEAT('а',127)),(7000,0,5000,0,'хвост');
`;

test('таблица старого сервера с индексом t_val (t, val) переводится: val longtext, t_val с префиксом 127, хвосты склеены',
    { skip: !process.env.IGT_MYSQL && 'нет IGT_MYSQL' }, () => {
    const run = (sql) => execSync(process.env.IGT_MYSQL + ' --default-character-set=utf8mb4 -N -B', { input: sql, encoding: 'utf8' });
    run('DROP TABLE IF EXISTS oldkey;' + OLD_TABLE);
    try {
        run(M.buildMergeSql('oldkey'));
        const rows = (q) => run(q).trim().split('\n').map((l) => l.split('\t'));
        assert.deepStrictEqual(rows("SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'oldkey' AND column_name = 'val'"), [['longtext']]);
        assert.deepStrictEqual(rows("SELECT column_name, IFNULL(sub_part, '-') FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'oldkey' AND index_name = 't_val' ORDER BY seq_in_index"),
            [['t', '-'], ['val', '127']]);
        assert.deepStrictEqual(rows("SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'oldkey' AND index_name = 'up_t'"), [['2']]);
        assert.deepStrictEqual(rows("SELECT val = CONCAT(REPEAT('а',127),'хвост') FROM oldkey WHERE id = 5000"), [['1']]);
        assert.deepStrictEqual(rows('SELECT COUNT(*) FROM oldkey WHERE t = 0'), [['0']]);
    } finally {
        run('DROP TABLE IF EXISTS oldkey');
    }
});
