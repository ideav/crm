/*
 * Поведенческий тест установщика шаблона «Сопоставление каталогов» (issue #4950,
 * находки боевой установки — #4949).
 *
 * Установщик гоняется целиком против стенда, эмулирующего ручки Интеграма, и
 * проверяются ЗАПРОСЫ, которые он сделал: заведена ли недостающая функция отчёта,
 * какие объекты попали в гранты ролей, куда легли ассеты. Разбор текста скрипта
 * ничего из этого поймать не может: до правки все три проверки красные при
 * полностью зелёном `-DryRun`.
 *
 * Без pwsh тест сообщает о пропуске и выходит успешно: гейт репозитория обязан
 * оставаться зависимым только от Node.
 */
const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

const root = path.join(__dirname, '..');
const DB = 'stand';

function hasPwsh() {
    try {
        execSync(process.platform === 'win32' ? 'where pwsh' : 'command -v pwsh', { stdio: 'ignore' });
        return true;
    } catch { return false; }
}

if (!hasPwsh()) {
    console.log('SKIP: test-issue-4950-xcom-installer-live (нет pwsh — установщик запустить нечем)');
    process.exit(0);
}

const templateTables = JSON.parse(fs.readFileSync(path.join(root, 'docs/xcom_metadata.json'), 'utf8'));
// Системные таблицы и данные посторонней задачи — как в базе, созданной при регистрации.
const foreignTables = [
    { id: '18', val: 'Пользователь', reqs: [] },
    { id: '22', val: 'Запрос', reqs: [] },
    { id: '28', val: 'Колонки запроса', reqs: [] },
    { id: '42', val: 'Роль', reqs: [] },
    { id: '44', val: 'FROM', reqs: [] },
    { id: '116', val: 'Объекты', reqs: [] },
    { id: '151', val: 'Меню', reqs: [] },
    { id: '415', val: 'Клиент', reqs: [] },
    { id: '446', val: 'Задача', reqs: [] }
];
const metadata = foreignTables.concat(templateTables);
const templateTableIds = new Set(templateTables.map(table => String(table.id)));

// Справочник свежей базы: часть нужных шаблону функций в нём отсутствует.
const standFunctions = { 85: 'abn_ID', 73: 'SUM', 235: 'GROUP_CONCAT' };
const functions = { ...standFunctions };
const calls = { created: [], updated: [], grants: [], uploads: [], dirs: [] };
let sequence = 900;

// Тело режется по границам частей. Имя поля PowerShell пишет БЕЗ кавычек
// (`name=userfile; filename=x.js`), а у строковых полей добавляет Content-Type —
// поэтому значение берётся после пустой строки своей части.
function multipartField(body, name) {
    for (const part of body.split(/\r?\n--/)) {
        if (!new RegExp(`name="?${name}"?(?:[;\\r\\n]|$)`).test(part)) continue;
        return part.split(/\r?\n\r?\n/).slice(1).join('\n\n').replace(/\r?\n$/, '');
    }
    return null;
}

function multipartFileName(body) {
    const match = body.match(/filename="?([^";\r\n]+)"?/);
    return match ? match[1] : null;
}

const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('latin1');
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const endpoint = url.pathname.replace(`/${DB}/`, '').replace(/\/$/, '');
        const send = payload => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); };

        if (endpoint === 'xsrf') return send({ _xsrf: 'stand-xsrf', token: 'stand-token', user: 'claude', role: 'admin', id: '1' });
        if (endpoint === 'metadata') return send(metadata);
        if (endpoint === '_ref_reqs/104') {
            const wanted = (url.searchParams.get('q') || '').toLowerCase();
            const found = {};
            for (const [id, name] of Object.entries(functions)) if (name.toLowerCase() === wanted) found[id] = name;
            return send(found); // формат ручки — словарь, а не массив объектов
        }
        if (endpoint.startsWith('object/')) return send([]);
        if (endpoint === 'dir_admin') {
            if (multipartField(body, 'mkdir')) calls.dirs.push(multipartField(body, 'dir_name'));
            else calls.uploads.push({ addPath: multipartField(body, 'add_path'), file: multipartFileName(body) });
            return send({ ok: true });
        }
        if (endpoint.startsWith('_m_new/')) {
            const table = endpoint.split('/')[1].split('?')[0];
            const fields = Object.fromEntries(new URLSearchParams(body));
            sequence += 1;
            if (table === '63') functions[sequence] = fields.t63;
            if (table === '116') calls.grants.push(fields.t116);
            calls.created.push({ table, fields });
            return send({ id: String(sequence), obj: String(sequence) });
        }
        if (endpoint.startsWith('_m_set/')) {
            calls.updated.push({ id: endpoint.split('/')[1].split('?')[0], fields: Object.fromEntries(new URLSearchParams(body)) });
            return send({ ok: true });
        }
        return send([]);
    });
});

// Установщик запускается АСИНХРОННО: стенд живёт в этом же процессе, и spawnSync
// заблокировал бы цикл событий — сервер не ответил бы ни на один запрос.
function runInstaller(port) {
    return new Promise((resolve) => {
        const child = spawn('pwsh', [
            '-NoProfile', '-File', path.join(root, 'docs/create_xcom_matching.ps1'),
            '-BaseUrl', `http://127.0.0.1:${port}`, '-DbName', DB, '-Token', 'stand-token',
            '-SkipSchema', '-LogPath', path.join(require('os').tmpdir(), 'xcom-stand.log')
        ], { shell: process.platform === 'win32' });
        let stdout = '', stderr = '';
        child.stdout.on('data', chunk => (stdout += chunk));
        child.stderr.on('data', chunk => (stderr += chunk));
        child.on('close', status => resolve({ status, stdout, stderr }));
    });
}

server.listen(0, '127.0.0.1', async () => {
    const run = await runInstaller(server.address().port);
    server.close();

    assert.strictEqual(run.status, 0, `установщик упал:\n${run.stdout}\n${run.stderr}`);

    // 1. Функции, которых в справочнике базы нет, заводятся — а не роняют установку.
    const reports = JSON.parse(fs.readFileSync(path.join(root, 'docs/xcom_reports.json'), 'utf8'));
    const needed = new Set(reports.flatMap(report => (report.columns || []).map(column => column.function).filter(Boolean)));
    const missing = [...needed].filter(name => !Object.values(standFunctions).includes(name));
    const createdFunctions = calls.created.filter(call => call.table === '63').map(call => call.fields.t63);
    assert(missing.length > 0, 'стенд обязан не иметь хотя бы одной нужной функции — иначе проверка ничего не значит');
    missing.forEach(name => assert(createdFunctions.includes(name),
        `установщик должен завести '${name}' в справочнике t63, создано: ${JSON.stringify(createdFunctions)}`));

    // 2. Гранты ролей не выходят за таблицы шаблона.
    const foreignGrants = calls.grants.filter(id => !templateTableIds.has(id) && id !== '269' && Number(id) < 400);
    assert.deepStrictEqual(foreignGrants, [],
        `роли шаблона получили гранты на посторонние объекты базы: ${JSON.stringify(foreignGrants)}`);

    // 3. Ассеты кладутся в подкаталоги, на которые ссылаются рабочие места.
    const jsUploads = calls.uploads.filter(upload => /\.js$/.test(upload.file || ''));
    assert(jsUploads.length > 0, 'установщик ничего не залил');
    jsUploads.forEach(upload => assert.strictEqual(upload.addPath, '/js', `js-ассет ${upload.file} ушёл в ${upload.addPath}`));
    assert(calls.dirs.includes('js') && calls.dirs.includes('css'),
        `каталоги ассетов не создаются перед заливкой, создано: ${JSON.stringify(calls.dirs)}`);

    // 4. Токенизация ставится именно SET-запросом: без «Присвоить» (t132) отчёт
    //    только читает, справочник остаётся пустым и подбор молчит.
    const setters = calls.updated.filter(update => update.fields.t132);
    assert.strictEqual(setters.length, 2, `ожидались SET-колонки обеих сторон, отправлено: ${setters.length}`);
    setters.forEach(update => {
        assert(/REGEXP_REPLACE/.test(update.fields.t132), 'разбор наименования уходит выражением');
        assert.strictEqual(update.fields.t102, '!%', 'берутся только записи без токенов');
    });
    const batches = calls.updated.filter(update => update.fields.t134 === '10000');
    assert.strictEqual(batches.length, 2, 'обоим токенизаторам ставится размер пачки');

    console.log('OK: test-issue-4950-xcom-installer-live');
});
