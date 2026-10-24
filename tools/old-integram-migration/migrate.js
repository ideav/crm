#!/usr/bin/env node
// Перенос базы со старого Интеграма (integram.io) в новый — issue #4283.
//
// Шаг 1 (SQL, на сервере MySQL нового Интеграма, после копирования таблицы базы):
//   node tools/old-integram-migration/migrate.js sql --db r7ohr > merge-tails.sql
// Повторный перенос в уже переведённую базу (#5253), источник — таблица r7ohr_src рядом с ней:
//   node tools/old-integram-migration/migrate.js transfer --db r7ohr [--src r7ohr_src] [--apply] > transfer.sql
// Шаг 2 (HTTP, по токенам обеих баз):
//   node tools/old-integram-migration/migrate.js files --old https://integram.io/r7ohr --old-token T1 \
//        --new https://ideav.ru/r7ohr --new-token T2 [--apply] [--keep-overrides]
//   node tools/old-integram-migration/migrate.js menu --new https://ideav.ru/r7ohr --new-token T2 [--apply]
// Без --apply команды только печатают, что сделали бы. Подробно — README.md рядом.
'use strict';

const fs = require('fs');
const path = require('path');

// Старое ядро хранит в строке не больше VAL_LIM символов, остаток — кусками по VAL_LIM в
// строках t=0, up=<id строки>, ord=0,1,2… (Insert/Get_tail в experiments/index_integram.io.php).
const VAL_LIM = 127;

// Каталоги dir_admin, которые не переносятся: журналы трассировки и архивы бэкапов.
const SERVICE_DIRS = ['logs', 'backups'];

// Старый main.html подключал jQuery для всех рабочих мест, новый — нет: рабочее место нового ядра
// подключает его само (templates/form.html, dict.html). Шаблону старой базы на jQuery это
// подключение дописывается в начало.
const JQUERY_TAG = '<script src="/js/jquery3.1.1.min.js"></script>';
function withJquery(name, data) {
    if (!/\.html?$/i.test(name)) return null;
    const text = data.toString('utf8');
    if (!/\$\(|\$\.|jQuery/.test(text) || /<script[^>]+jquery[^>]*\.js/i.test(text)) return null;
    return Buffer.from(JQUERY_TAG + '\n' + text, 'utf8');
}

function chars(s) { return Array.from(String(s == null ? '' : s)); }
function padChunk(s) { const n = chars(s).length; return n < VAL_LIM ? s + ' '.repeat(VAL_LIM - n) : s; }

// Значение с хвостами, собранное в одну строку. Каждый кусок, кроме последнего, при записи
// был ровно VAL_LIM символов; MySQL срезал у него хвостовые пробелы — возвращаем их.
function joinTails(parentVal, tails) {
    const sorted = (tails || []).slice().sort((a, b) => Number(a.ord) - Number(b.ord));
    if (!sorted.length) return String(parentVal);
    let out = padChunk(String(parentVal));
    sorted.forEach((t, i) => { out += i === sorted.length - 1 ? String(t.val) : padChunk(String(t.val)); });
    return out;
}

// Операторы шага 1; {T} — имя таблицы базы. Каждый выполняется через PREPARE, чтобы имя
// таблицы задавалось в скрипте один раз — переменной @tbl в первой строке.
const pad = (x) => `CONCAT(${x}, REPEAT(' ', ${VAL_LIM} - CHAR_LENGTH(${x})))`;
const MERGE_STATEMENTS = [
    // 1. Структура как у нового ядра: val -> longtext utf8mb4, индекс t_val с префиксом 127
    `ALTER TABLE {T}
  MODIFY id  int UNSIGNED NOT NULL AUTO_INCREMENT,
  MODIFY t   int UNSIGNED NOT NULL,
  MODIFY up  int UNSIGNED NOT NULL,
  MODIFY ord int UNSIGNED NOT NULL,
  MODIFY val longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  DROP KEY t_val,
  ADD KEY t_val (t, val(127))`,
    // 2. Хвосты (t = 0) — в val родителя; каждый кусок, кроме последнего, добивается пробелами до 127
    `UPDATE {T} a
JOIN (
  SELECT v.id,
         CONCAT(${pad('v.val')},
                GROUP_CONCAT(IF(t.ord = m.last_ord, t.val, ${pad('t.val')}) ORDER BY t.ord SEPARATOR '')) AS new_val
  FROM {T} v
  JOIN {T} t ON t.up = v.id AND t.t = 0
  JOIN (SELECT up, MAX(ord) AS last_ord FROM {T} WHERE t = 0 GROUP BY up) m ON m.up = v.id
  WHERE v.t <> 0
  GROUP BY v.id, v.val
) calculated ON a.id = calculated.id
SET a.val = calculated.new_val`,
    `DELETE FROM {T} WHERE t = 0 AND up <> 0`,
    // 3. Реквизит «Иконка» (391) таблицы «Меню»: в него пишет редактор меню нового ядра
    //    (js/main-app.js, t391). Занятый id 391 не трогается.
    `INSERT IGNORE INTO {T} (id, up, ord, t, val)
SELECT 391, 151, MAX(ord) + 1, 8, 'Иконка' FROM {T} WHERE up = 151 HAVING COUNT(*) > 0`,
];

// Оператор как строка для PREPARE: CONCAT('…`', @tbl, '`…'). {T} — таблица базы (@tbl),
// {S} — таблица-источник переноса (@src), {B} — копия базы до переноса (@bak).
const TABLE_VARS = { T: '@tbl', S: '@src', B: '@bak' };
function prepared(stmt) {
    const lit = (p) => "'" + p.replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
    const parts = stmt.split(/\{([TSB])\}/).map((p, i) => (i % 2 ? `'\`', ${TABLE_VARS[p]}, '\`'` : lit(p)));
    return `SET @q = CONCAT(${parts.join(', ')});\nPREPARE q FROM @q; EXECUTE q; DEALLOCATE PREPARE q;`;
}

// Остановка скрипта, если условие ложно: mysql прерывает прогон на первой ошибке, а ошибку
// даёт обращение к несуществующей таблице с текстом причины в имени.
function guard(cond, from, reason) {
    return prepared(`SELECT IF(${cond}, 'DO 0', 'SELECT 1 FROM \`СТОП: ${reason}\`') INTO @g FROM ${from}`) +
        '\nPREPARE g FROM @g; EXECUTE g; DEALLOCATE PREPARE g;';
}

// SQL шага 1: та же склейка, что joinTails, для всей таблицы базы.
function buildMergeSql(db) {
    if (!/^[A-Za-z0-9_]+$/.test(String(db || ''))) throw new Error('Недопустимое имя базы: ' + db);
    return `SET @tbl = '${db}';  -- таблица базы: единственное место, где задаётся имя

-- #4283: перевод таблицы базы, скопированной со старого Интеграма, на новое ядро.
-- Старое ядро писало куски значения ровно по ${VAL_LIM} символов, MySQL срезал у них хвостовые пробелы;
-- склейка возвращает их, иначе слова на стыках кусков слипаются. Повторный прогон ничего не меняет.
SET SESSION group_concat_max_len = 16777216;

${MERGE_STATEMENTS.map(prepared).join('\n\n')}

-- (необязательно) переименовать таблицу, как в новой схеме:
-- RENAME TABLE \`${db}\` TO \`r1\`;
`;
}

// ---------------------------------------------------------------- Повторный перенос (#5253)
//
// Таблица базы {T} на новом сервере заменяется содержимым таблицы-источника {S} — копии базы
// со старого сервера, уже прогнанной через склейку хвостов (buildMergeSql). Остаются только
// совпадающие типы: строка типа (up=0, кроме корня 1) с тем же id, базовым типом и именем в обеих
// таблицах и её реквизиты с тем же id, типом и значением. Всё остальное в {T} — данные, прочие
// типы и реквизиты — удаляется, недостающее переносится из {S} с прежними id: на id ссылаются
// запросы, шаблоны и меню. Пароли (реквизит 20) пользователей с тем же id и логином остаются
// из {T}: хеш старого сервера здесь не проверяется. Корень (id 1) не трогается.
const USER_T = 18;
const PASSWORD_T = 20;
const TRANSFER_PREP = [
    `CREATE TEMPORARY TABLE _keep_type (id int UNSIGNED PRIMARY KEY)
SELECT a.id FROM {T} a JOIN {S} b ON b.id = a.id AND b.up = 0 AND b.t = a.t AND BINARY b.val = BINARY a.val
WHERE a.up = 0 AND a.id <> 1`,
    `CREATE TEMPORARY TABLE _keep (id int UNSIGNED PRIMARY KEY)
SELECT a.id FROM {T} a JOIN _keep_type k ON k.id = a.up
JOIN {S} b ON b.id = a.id AND b.up = a.up AND b.t = a.t AND BINARY b.val = BINARY a.val`,
    `INSERT INTO _keep SELECT id FROM _keep_type`,
    `INSERT IGNORE INTO _keep VALUES (1)`,
    `CREATE TEMPORARY TABLE _pwd (KEY (up))
SELECT a.up, a.ord, a.val FROM {T} a
JOIN {T} u ON u.id = a.up AND u.t = ${USER_T}
JOIN {S} su ON su.id = u.id AND su.t = ${USER_T} AND BINARY su.val = BINARY u.val
WHERE a.t = ${PASSWORD_T}`,
];
// Временную таблицу MySQL нельзя открыть дважды в одном запросе — счётчики по одному.
const TRANSFER_REPORT = [
    `SELECT COUNT(*) INTO @n_type FROM _keep_type`,
    `SELECT COUNT(*) INTO @n_keep FROM {T} a JOIN _keep k ON k.id = a.id`,
    `SELECT COUNT(*) INTO @n_tbl FROM {T}`,
    `SELECT COUNT(*) INTO @n_src FROM {S}`,
    `SELECT COUNT(DISTINCT up) INTO @n_pwd FROM _pwd`,
    `SELECT @n_type AS \`совпало типов\`, @n_keep AS \`остаётся строк\`, @n_tbl - @n_keep AS \`удаляется строк\`,
       @n_src AS \`строк в источнике\`, @n_pwd AS \`паролей остаётся\``,
    `SELECT 'удаляется' AS \`тип\`, a.id, a.t, a.val FROM {T} a LEFT JOIN _keep_type k ON k.id = a.id
WHERE a.up = 0 AND a.id <> 1 AND k.id IS NULL ORDER BY a.id`,
    `SELECT 'переносится' AS \`тип\`, b.id, b.t, b.val FROM {S} b LEFT JOIN _keep_type k ON k.id = b.id
WHERE b.up = 0 AND b.id <> 1 AND k.id IS NULL ORDER BY b.id`,
];
const TRANSFER_APPLY = [
    `CREATE TABLE {B} LIKE {T}`,
    `INSERT INTO {B} SELECT * FROM {T}`,
    `DELETE a FROM {T} a LEFT JOIN _keep k ON k.id = a.id WHERE k.id IS NULL`,
    `UPDATE {T} a JOIN {S} b ON b.id = a.id SET a.ord = b.ord WHERE a.id <> 1`,
    `INSERT INTO {T} (id, up, ord, t, val)
SELECT b.id, b.up, b.ord, b.t, b.val FROM {S} b
LEFT JOIN {T} a ON a.id = b.id
LEFT JOIN (SELECT DISTINCT up FROM _pwd) p ON b.t = ${PASSWORD_T} AND p.up = b.up
WHERE a.id IS NULL AND p.up IS NULL`,
    `INSERT INTO {T} (up, ord, t, val) SELECT up, ord, ${PASSWORD_T}, val FROM _pwd`,
    // Проверка: каждая строка источника, кроме оставленных паролей, есть в базе как есть.
    `SELECT COUNT(*) AS \`расхождений с источником (должно быть 0)\` FROM {S} b
LEFT JOIN {T} a ON a.id = b.id AND a.up = b.up AND a.ord = b.ord AND a.t = b.t AND BINARY a.val = BINARY b.val
LEFT JOIN (SELECT DISTINCT up FROM _pwd) p ON b.t = ${PASSWORD_T} AND p.up = b.up
WHERE a.id IS NULL AND p.up IS NULL AND b.id <> 1`,
];

const TABLE_NAME = /^[A-Za-z0-9_]+$/;
function buildTransferSql({ db, src, backup, apply = false }) {
    src = src || db + '_src';
    backup = backup || db + '_before_transfer';
    [db, src, backup].forEach((n) => { if (!TABLE_NAME.test(String(n || ''))) throw new Error('Недопустимое имя таблицы: ' + n); });
    if (new Set([db, src, backup]).size < 3) throw new Error('База, источник и копия должны быть разными таблицами');
    const head = `SET @tbl = '${db}';  -- таблица базы, которая заменяется
SET @src = '${src}';  -- источник: копия базы со старого сервера после склейки хвостов (migrate.js sql)
SET @bak = '${backup}';  -- сюда сохраняется база до переноса; существующая таблица останавливает скрипт

-- #5253: перенос базы из источника. Остаются совпадающие типы и их реквизиты, пароли пользователей
-- с тем же id и логином; остальное удаляется и переносится из источника с прежними id.
${apply ? '' : '-- Пробный прогон: только отчёт, база не меняется. Запись — migrate.js transfer … --apply.\n'}`;
    const checks = [
        guard('COUNT(*) > 0', '{S} WHERE t = ' + USER_T, 'в источнике нет пользователей'),
        guard('COUNT(*) = 0', '{S} WHERE t = 0 AND up <> 0', 'в источнике есть хвосты, сначала migrate.js sql'),
    ];
    const body = [
        ...checks,
        'DROP TEMPORARY TABLE IF EXISTS _keep_type, _keep, _pwd;',
        ...TRANSFER_PREP.map(prepared),
        ...TRANSFER_REPORT.map(prepared),
        ...(apply ? TRANSFER_APPLY.map(prepared) : []),
    ];
    return head + '\n' + body.join('\n\n') + '\n' +
        (apply ? `\n-- Источник больше не нужен: DROP TABLE \`${src}\`;\n` : '');
}

// ---------------------------------------------------------------- HTTP-клиент базы

class Client {
    // base — адрес базы: https://integram.io/r7ohr
    constructor({ base, token, fetch: f }) {
        this.base = String(base).replace(/\/+$/, '');
        this.db = this.base.split('/').pop();
        this.token = token;
        this.fetch = f || globalThis.fetch;
        this._xsrf = null;
    }
    url(p) { return this.base + '/' + p; }
    // Старое ядро читает токен из куки <db>. Новое принимает ключ API только заголовком
    // X-Authorization (в запросах с параметром JSON); его кука idb_<db> — сессия устройства,
    // ключ в ней даёт 401, поэтому её не шлём.
    headers() { return { Cookie: `${this.db}=${this.token}`, 'X-Authorization': this.token }; }
    async request(p, opts = {}) {
        const res = await this.fetch(this.url(p), Object.assign({ headers: this.headers() }, opts));
        if (!res.ok) throw new Error(`${this.db}: HTTP ${res.status} на ${p}`);
        return res;
    }
    async getText(p) { return (await this.request(p)).text(); }
    // Ключ API в заголовке новое ядро принимает только в запросах с параметром JSON.
    async getJson(p) {
        if (!/[?&]JSON/.test(p)) p += (p.includes('?') ? '&' : '?') + 'JSON';
        const txt = await this.getText(p);
        try { return JSON.parse(txt); } catch (e) { throw new Error(`${this.db}: не JSON на ${p}: ${txt.slice(0, 200)}`); }
    }
    async getBuffer(p) { return Buffer.from(await (await this.request(p)).arrayBuffer()); }
    async xsrf() {
        if (this._xsrf == null) {
            const j = await this.getJson('xsrf?JSON');
            if (!j || !j._xsrf) throw new Error(`${this.db}: токен не принят (нет _xsrf)`);
            this._xsrf = j._xsrf;
        }
        return this._xsrf;
    }
    async post(action, params) {
        const body = new URLSearchParams();
        body.set('token', this.token);
        body.set('_xsrf', await this.xsrf());
        Object.keys(params).forEach((k) => body.set(k, params[k] == null ? '' : String(params[k])));
        const res = await this.request(action + '?JSON=1', {
            method: 'POST',
            headers: Object.assign(this.headers(), { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }),
            body: body.toString(),
        });
        const txt = await res.text();
        let json = null;
        try { json = JSON.parse(txt); } catch (e) { /* не JSON */ }
        const err = Array.isArray(json) && json[0] && json[0].error ? json[0].error : (json && json.error) || '';
        if (err) throw new Error(`${this.db}: ${action}: ${err}`);
        return json;
    }
    async dirForm(root, addPath, fields, file) {
        const fd = new FormData();
        fd.append(root, '1');
        fd.append('add_path', addPath);
        fd.append('token', this.token);
        fd.append('_xsrf', await this.xsrf());
        Object.keys(fields).forEach((k) => fd.append(k, fields[k]));
        if (file) fd.append('userfile', new Blob([file.data]), file.name);
        const res = await this.request('dir_admin/?JSON=1', { method: 'POST', body: fd });
        return res.text();
    }
}

// ---------------------------------------------------------------- файлы (dir_admin)

function normDir(d) { return String(d || '').replace(/^\/+/, '').replace(/\/+$/, ''); }
function decodeHtml(s) { return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }

// Листинг dir_admin — HTML (templates/dir_admin.html): файлы — ссылки с gf=, подкаталоги — ссылки
// с add_path=<текущий>/<имя>. Ссылки редактора (/ace/…) и «хлебные крошки» пропускаются.
function parseDirListing(html, cur) {
    const here = normDir(cur);
    const files = new Set();
    const dirs = new Set();
    const re = /href="([^"]*)"/g;
    let m;
    while ((m = re.exec(html))) {
        const href = decodeHtml(m[1]);
        if (!/\/dir_admin\/\?/.test(href) || /^\/ace\//.test(href)) continue;
        const q = new URLSearchParams(href.slice(href.indexOf('?') + 1));
        const ap = normDir(q.get('add_path'));
        if (q.has('gf')) { if (ap === here) files.add(q.get('gf')); continue; }
        if (!q.has('add_path') || ap === here) continue;
        const prefix = here ? here + '/' : '';
        if (ap.startsWith(prefix) && !ap.slice(prefix.length).includes('/')) dirs.add(ap);
    }
    return { files: [...files], dirs: [...dirs] };
}

// Общие шаблоны нового ядра (templates/*.html репозитория). Одноимённый файл в
// templates/custom/<db>/ перекрыл бы их старой версией — такие не переносятся.
function repoTemplates() {
    const dir = path.join(__dirname, '..', '..', 'templates');
    try { return fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isFile()); } catch (e) { return ['main.html']; }
}

async function copyFiles({ src, dst, commonTemplates, keepOverrides = false, apply = true, log = console.log }) {
    const common = new Set(commonTemplates || repoTemplates());
    const report = { copied: [], skipped: [], patched: [], warnings: [] };
    for (const root of ['templates', 'download']) {
        const walk = async (dir, dstDir) => {
            const qp = dir ? '/' + dir : '';
            const html = await src.getText(`dir_admin/?${root}=1&add_path=${encodeURIComponent(qp)}`);
            const { files, dirs } = parseDirListing(html, dir);
            for (const name of files) {
                const where = `${root}/${dir ? dir + '/' : ''}${name}`;
                if (root === 'templates' && !dir && common.has(name) && !keepOverrides) {
                    report.skipped.push({ root, dir, name, why: 'перекрыл бы общий шаблон нового ядра' });
                    log(`пропущен ${where}: перекрыл бы общий шаблон нового ядра`);
                    continue;
                }
                // Содержимое читается и при пробном прогоне: нужно знать, какие шаблоны получат jQuery.
                let data = await src.getBuffer(`dir_admin/?${root}=1&add_path=${encodeURIComponent(qp)}&gf=${encodeURIComponent(name)}`);
                const patched = root === 'templates' ? withJquery(name, data) : null;
                if (patched) {
                    data = patched;
                    report.patched.push({ root, dir: dstDir, name });
                    log(`${where}: шаблон на jQuery — дописано подключение jQuery`);
                }
                if (apply) await dst.dirForm(root, dstDir ? '/' + dstDir : '', { upload: 'Загрузить', rewrite: '1' }, { name, data });
                report.copied.push({ root, dir: dstDir, name });
                log(`${apply ? 'скопирован' : 'будет скопирован'} ${where}`);
            }
            for (const sub of dirs) {
                const leaf = sub.split('/').pop();
                if (!dir && SERVICE_DIRS.includes(leaf)) { report.skipped.push({ root, dir: sub, name: '', why: 'служебный каталог' }); continue; }
                // dir_admin приводит имя нового каталога к нижнему регистру
                const dstLeaf = leaf.toLowerCase();
                if (dstLeaf !== leaf) report.warnings.push(`${root}/${sub}: в новой базе каталог будет «${dstLeaf}» — поправьте ссылки на него`);
                const dstSub = (dstDir ? dstDir + '/' : '') + dstLeaf;
                // Без каталога dir_admin молча кладёт загруженный файл в корень — создаём заранее.
                // Уже существующий каталог dir_admin отвергает ошибкой — это не помеха.
                if (apply) await dst.dirForm(root, dstDir ? '/' + dstDir : '', { mkdir: '1', dir_name: dstLeaf }).catch(() => {});
                await walk(sub, dstSub);
            }
        };
        await walk('', '');
    }
    return report;
}

// ---------------------------------------------------------------- меню

// Эталонные запросы меню нового ядра (docs/integram-app-workflow.md §5.9.3; так же устроены в
// базах, созданных новым ядром). Блок MyRoleMenu в templates/main.html читает одноимённый запрос:
// menu_id, menu_up, name, href, icon. Его вычисляемая колонка зовёт [rec] — рекурсивный обход
// меню (функция RECURSIVE) от пунктов запроса [myMenus]; без этих двух запросов SQL меню падает.
// Каждая колонка — значения записи «Колонки запроса» (type 28) по позициям реквизитов:
// 0 — источник, 1 — имя, 2 — формула/псевдоним, 3 — значение (от), 5 — функция, 8 — скрыть,
// 9 — формат, 10 — сортировка. Функции — id (`85` = abn_ID), `@RECURSIVE` — по имени.
const MENU_FORMULA = "IF(МенюID IN([rec]), ПользовательID IS NULL OR (ПользовательID=[USER_ID] AND LOCATE('_request','_request_.FR_RoleID')) OR '_request_.FR_RoleID'=РольID, (ПользовательID=[USER_ID] AND LOCATE('_request','_request_.FR_RoleID')) OR '_request_.FR_RoleID'=РольID)";
const MENU_REFERENCE = [
    { 0: '151', 1: 'name' },
    { 0: '42', 1: 'РольID', 2: 'РольID', 5: '85', 8: 'X', 10: '-1' },
    { 0: '18', 1: 'Пользователь', 2: 'ПользовательID', 5: '85', 8: 'X' },
    { 0: '151', 1: 'menu_id', 2: 'МенюID', 5: '85' },
    { 0: '0', 1: 'Вычисляемое', 2: MENU_FORMULA, 3: '1', 8: 'X' },
    { 0: '151', 1: 'menu_up', 5: '86' },
    { 0: '151', 1: 'МенюOrd', 5: '93', 8: 'X', 10: '2' },
    { 0: '153', 1: 'href' },
    { 0: '391', 1: 'icon', 9: '34', needsReq: '391' },
    // Без реквизита 391 — пустая вычисляемая icon: блок MyRoleMenu выводит только строки, где
    // заполнены все подстановки (index.php, Parse_block), без {icon} меню пустое.
    { 0: '0', 1: 'icon', 2: "''", ifNoReq: '391' },
    { 0: '151', 5: '74' }, // COUNT — группировка, без повторов пунктов
];
const MENU_REPORTS = [
    { name: 'myMenus', cols: [
        { 0: '18', 1: 'ПользовательID', 3: '[USER_ID]', 5: '85', 8: 'X' },
        { 0: '42', 1: 'RoleID', 5: '85', 8: 'X' },
        { 0: '151', 1: 'Меню', 5: '85' },
    ] },
    { name: 'rec', cols: [{ 0: '151', 1: 'Меню', 3: '[myMenus]', 5: '@RECURSIVE' }] },
    { name: 'MyRoleMenu', cols: MENU_REFERENCE },
];

function refId(v) { const m = /^(\d+):/.exec(String(v == null ? '' : v)); return m ? m[1] : String(v == null ? '' : v); }

// План приведения колонок запроса к эталону: если колонки уже эталонные — ничего; иначе создать
// эталонные и удалить прежние (создание первым: сбой посередине не оставляет запрос пустым).
// fn — id функций по имени для значений `@ИМЯ`.
function planReportColumns({ meta, columns, reference, fn = {} }) {
    const byId = (id) => (Array.isArray(meta) ? meta : []).find((t) => String(t.id) === id);
    const t28 = byId('28');
    if (!t28 || !Array.isArray(t28.reqs)) throw new Error('В метаданных нет типа 28 «Колонки запроса»');
    const reqIds = t28.reqs.map((r) => String(r.id));
    const key = (pos) => (pos === 0 ? 't28' : 't' + reqIds[pos - 1]);
    columns.forEach((c) => {
        if (!Array.isArray(c.r) || c.r.length !== reqIds.length + 1) {
            throw new Error(`Колонка ${c.i}: значений ${c.r && c.r.length}, а реквизитов у типа 28 — ${reqIds.length}; правка отменена`);
        }
    });
    const menuReqs = new Set(((byId('151') || {}).reqs || []).map((r) => String(r.id)));
    const warnings = [];
    const resolve = (v) => (/^@/.test(v) ? String(fn[v.slice(1)] || v) : v);
    const wanted = reference.filter((w) => {
        if (w.ifNoReq) {
            if (menuReqs.has(w.ifNoReq)) return false;
            warnings.push(`У таблицы «Меню» нет реквизита ${w.ifNoReq} «Иконка»: колонка icon — пустая вычисляемая, редактор меню не сохранит иконки; реквизит создаёт SQL шага 1`);
            return true;
        }
        return !w.needsReq || menuReqs.has(w.needsReq);
    }).map((w) => {
        const out = {};
        Object.keys(w).filter((k) => /^\d+$/.test(k)).forEach((k) => { out[k] = resolve(w[k]); });
        return out;
    });
    const sig = (vals) => Array.from({ length: reqIds.length + 1 }, (_, k) => refId(vals[k])).join('\u0001');
    const have = columns.map((c) => sig(c.r)).sort();
    const want = wanted.map((w) => sig(w)).sort();
    if (have.join('\n') === want.join('\n')) return { ops: [], warnings };
    const ops = wanted.map((w) => {
        const params = {};
        Object.keys(w).forEach((pos) => { params[key(Number(pos))] = w[pos]; });
        return { kind: 'create', params };
    });
    columns.forEach((c) => ops.push({ kind: 'delete', id: String(c.i), was: c.r }));
    return { ops, warnings };
}

function planMenuReport({ meta, columns }) {
    return planReportColumns({ meta, columns, reference: MENU_REFERENCE });
}

async function fixMenu({ client, apply = false, log = console.log }) {
    const meta = await client.getJson('metadata');
    const step = async (what, fnApply) => {
        if (!apply) { log('будет: ' + what); return null; }
        const res = await fnApply();
        log('сделано: ' + what);
        return res;
    };
    const idOf = (res, fallback) => String((res && (res.id || res.obj)) || fallback);
    // Функция RECURSIVE (таблица «Функция», 63) — ядро узнаёт её по имени (index.php, RECURSIVE).
    const fns = await client.getJson('object/63?JSON_OBJ&LIMIT=0,100000');
    const fn = {};
    (Array.isArray(fns) ? fns : []).forEach((f) => { fn[String(f.r[0])] = String(f.i); });
    if (!fn.RECURSIVE) {
        fn.RECURSIVE = idOf(await step('создать функцию RECURSIVE', () => client.post('_m_new/63', { up: 1, t63: 'RECURSIVE' })), '<новая RECURSIVE>');
    }
    const reports = await client.getJson('object/22?JSON_OBJ&LIMIT=0,100000');
    const plans = {};
    let changed = 0;
    for (const def of MENU_REPORTS) {
        let rep = (Array.isArray(reports) ? reports : []).find((q) => q.r && q.r[0] === def.name);
        let columns = [];
        if (rep) columns = await client.getJson(`object/28?JSON_OBJ&F_U=${rep.i}&LIMIT=0,100000`);
        else rep = { i: idOf(await step(`создать запрос ${def.name}`, () => client.post('_m_new/22', { up: 1, t22: def.name })), `<новый ${def.name}>`) };
        const plan = planReportColumns({ meta, columns: Array.isArray(columns) ? columns : [], reference: def.cols, fn });
        plans[def.name] = plan;
        plan.warnings.forEach((w) => log('ВНИМАНИЕ: ' + w));
        for (const op of plan.ops) {
            changed++;
            if (op.kind === 'delete') await step(`${def.name}: удалить прежнюю колонку ${op.id}: ${JSON.stringify(op.was)}`, () => client.post(`_m_del/${op.id}`, {}));
            else await step(`${def.name}: создать колонку ${JSON.stringify(op.params)}`, () => client.post('_m_new/28', Object.assign({ up: rep.i }, op.params)));
        }
    }
    if (!changed) log('Запросы меню (myMenus, rec, MyRoleMenu) уже в формате нового ядра');
    const plan = plans.MyRoleMenu;
    // Пункты меню, которые новый main.html не покажет как есть.
    const t151 = (meta || []).find((t) => String(t.id) === '151') || { reqs: [] };
    const hrefPos = t151.reqs.findIndex((r) => String(r.id) === '153') + 1;
    // Пункты меню — подчинённые записи ролей: читаются по каждой роли (F_U).
    const roles = hrefPos > 0 ? await client.getJson('object/42?JSON_OBJ&LIMIT=0,100000') : [];
    const items = [];
    for (const role of Array.isArray(roles) ? roles : []) {
        const part = await client.getJson(`object/151?JSON_OBJ&F_U=${role.i}&LIMIT=0,100000`);
        if (Array.isArray(part)) items.push(...part);
    }
    items.forEach((m) => {
        const href = String(m.r[hrefPos] || '');
        if (href.includes('[USER_ID]')) log(`ВНИМАНИЕ: пункт меню ${m.i} «${m.r[0]}»: [USER_ID] в адресе новое меню не подставляет — ${href}`);
        if (href.includes("'")) log(`ВНИМАНИЕ: пункт меню ${m.i} «${m.r[0]}»: апостроф в адресе ломает меню — ${href}`);
    });
    return plan;
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) { out._.push(a); continue; }
        const k = a.slice(2);
        if (['apply', 'keep-overrides'].includes(k)) out[k] = true;
        else out[k] = argv[++i];
    }
    return out;
}

async function main(argv) {
    const a = parseArgs(argv);
    const need = (...ks) => ks.forEach((k) => { if (!a[k]) throw new Error('Не задан --' + k); });
    switch (a._[0]) {
        case 'sql':
            need('db');
            process.stdout.write(buildMergeSql(a.db));
            return;
        case 'transfer':
            need('db');
            process.stdout.write(buildTransferSql({ db: a.db, src: a.src, backup: a.backup, apply: !!a.apply }));
            return;
        case 'files': {
            need('old', 'old-token', 'new', 'new-token');
            const src = new Client({ base: a.old, token: a['old-token'] });
            const dst = new Client({ base: a.new, token: a['new-token'] });
            const r = await copyFiles({ src, dst, keepOverrides: !!a['keep-overrides'], apply: !!a.apply });
            r.warnings.forEach((w) => console.log('ВНИМАНИЕ: ' + w));
            console.log(`Файлов: ${r.copied.length}, пропущено: ${r.skipped.length}${a.apply ? '' : ' (пробный прогон, для записи — --apply)'}`);
            return;
        }
        case 'menu':
            need('new', 'new-token');
            await fixMenu({ client: new Client({ base: a.new, token: a['new-token'] }), apply: !!a.apply });
            if (!a.apply) console.log('(пробный прогон, для записи — --apply)');
            return;
        default:
            console.log('Команды: sql --db <база> | transfer --db <база> [--src <источник>] [--backup <копия>] [--apply] |files --old <url> --old-token <t> --new <url> --new-token <t> [--apply] [--keep-overrides] | menu --new <url> --new-token <t> [--apply]');
    }
}

module.exports = { VAL_LIM, joinTails, buildMergeSql, buildTransferSql, Client, parseDirListing, copyFiles, planReportColumns, planMenuReport, fixMenu, MENU_REFERENCE, MENU_REPORTS };

if (require.main === module) {
    main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}
