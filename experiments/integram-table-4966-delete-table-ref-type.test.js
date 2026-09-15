/*
 * Issue #4966: «Ошибка удаления таблицы: Нельзя удалить тип при наличии его
 * экземпляров (всего: 1)!» при удалении ПУСТОЙ таблицы из табличного компонента.
 *
 * Экземпляр, которого «нет» — ref-тип «ссылка на таблицу»: `_d_ref` заводит его
 * строкой `up=0, t={tableId}, val=''` (index.php, «Create Ref»), а проверка в
 * `_d_del` считает `SELECT COUNT(id) FROM z WHERE t={tableId} AND t!=up` — и
 * ref-тип попадает в этот счёт наравне с записями. Его надо снимать молча.
 *
 * Тест гоняет deleteTable / deleteTableReferences / deleteReferenceRequisite из
 * js/integram-table/11-column-settings.js против модели сервера, повторяющей
 * index.php:
 *   - `metadata/{id}` НИКОГДА не отдаёт `referenced` (поле строится из $refs, а
 *     в ветке isOne выбирается одна строка obj.id={id} — заполнить $refs нечем);
 *     `referenced` есть только в `metadata` по всей базе;
 *   - отказ `_d_del` — это `die()`: HTTP 200 и простой текст, не JSON.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// --- Загружаем методы прямо из исходника модуля -----------------------------

const moduleSource = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'integram-table', '11-column-settings.js'),
    'utf8'
);

function extractMethod(name, optional) {
    // Методы класса в модуле имеют отступ 8 пробелов (IIFE + тело класса).
    const re = new RegExp(`(?:^|\\n)        (async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{`);
    const match = moduleSource.match(re);
    if (!match) {
        if (optional) return '';
        throw new Error(`Could not find method ${name} in module source`);
    }
    const start = match.index + match[0].length - 1; // позиция открывающей {
    let depth = 0;
    for (let i = start; i < moduleSource.length; i++) {
        const ch = moduleSource[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return moduleSource.slice(match.index + 1, i + 1);
        }
    }
    throw new Error(`Could not find matching closing brace for ${name}`);
}

const REQUIRED = ['deleteTable', 'deleteTableReferences', 'deleteReferenceRequisite'];
// Помощники появляются вместе с фиксом #4966; до фикса их просто нет.
const OPTIONAL = ['findTableReferences', 'fetchMetadataJson', 'referencedIds', 'describeTableReferrers'];

const methodSources = REQUIRED.map(n => extractMethod(n, false))
    .concat(OPTIONAL.map(n => extractMethod(n, true)))
    .filter(Boolean)
    .join('\n');

const Host = new Function('fetchRef', `
    const fetch = (...args) => fetchRef(...args);
    class Host {
        constructor(opts) { Object.assign(this, opts); }
        getApiBase() { return this._apiBase; }
        getServerError(result) {
            if (Array.isArray(result)) return (result[0] && result[0].error) || null;
            return result && result.error ? result.error : null;
        }
        ${methodSources}
    }
    return Host;
`)((...args) => global.fetch(...args));

// --- Модель сервера ---------------------------------------------------------

const API = 'https://example.test/db';

function jsonResponse(status, body) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return {
        ok: status >= 200 && status < 300,
        status,
        async text() { return text; },
        async json() { return JSON.parse(text); },
    };
}

// index.php: отказ по экземплярам — это die(): статус 200 и простой текст.
function dieResponse(text) {
    return {
        ok: true,
        status: 200,
        async text() { return text; },
        async json() { throw new Error('not json'); },
    };
}

function instancesError(count) {
    return `Нельзя удалить тип при наличии его экземпляров (всего: ${count})!`;
}

/**
 * @param {object} state
 *   tableId, tableName  — удаляемая таблица
 *   refTypeId           — id ref-типа «ссылка на таблицу» (null, если его нет)
 *   records             — сколько в таблице настоящих записей
 *   referrers           — колонки других таблиц, использующие ref-тип:
 *                         [{ tableId, tableName, reqId, typeName, alias }]
 *   referencedInSingle  — сервер отдаёт `referenced` и в metadata/{id}
 */
function makeServer(state) {
    const s = Object.assign({ records: 0, referrers: [], referencedInSingle: false }, state);
    const calls = [];

    function tableEntry() {
        const entry = {
            id: s.tableId, up: '0', type: '3', val: s.tableName,
            unique: '0', granted: 'WRITE', export: '1', delete: '1', reqs: [],
        };
        if (s.refTypeId) entry.referenced = s.refTypeId;
        return entry;
    }

    function referrerEntries() {
        const byTable = new Map();
        for (const r of s.referrers) {
            if (!byTable.has(r.tableId))
                byTable.set(r.tableId, {
                    id: r.tableId, up: '0', type: '3', val: r.tableName,
                    unique: '0', granted: 'WRITE', reqs: [],
                });
            byTable.get(r.tableId).reqs.push({
                num: byTable.get(r.tableId).reqs.length + 1,
                id: r.reqId,
                val: r.typeName,
                orig: s.tableId,           // orig = ref ?: ref_id — id таблицы-цели
                type: '3',
                ref: s.tableId,            // refs.id — таблица, на которую ссылаются
                ref_id: s.refTypeId,       // req.t — ref-тип
                attrs: r.alias ? JSON.stringify({ alias: r.alias }) : '',
            });
        }
        return Array.from(byTable.values());
    }

    async function fetchImpl(url) {
        const u = String(url);
        calls.push(u);

        let m = u.match(/\/metadata\/(\d+)$/);
        if (m) {
            if (m[1] !== String(s.tableId)) return jsonResponse(404, 'not found');
            const entry = tableEntry();
            // Ветка isOne индекса не умеет заполнять `referenced`.
            if (!s.referencedInSingle) delete entry.referenced;
            return jsonResponse(200, entry);
        }

        if (/\/metadata$/.test(u))
            return jsonResponse(200, [tableEntry()].concat(referrerEntries()));

        m = u.match(/\/_d_del\/(\d+)\?JSON$/);
        if (m) {
            const id = m[1];
            if (s.refTypeId && id === String(s.refTypeId)) {
                // Экземпляры ref-типа — реквизиты других таблиц (req.t = refTypeId).
                if (s.referrers.length) return dieResponse(instancesError(s.referrers.length));
                s.refTypeId = null;
                return jsonResponse(200, { id, obj: String(s.tableId), next_act: '', args: '', warnings: '' });
            }
            if (id === String(s.tableId)) {
                const instances = s.records + (s.refTypeId ? 1 : 0);
                if (instances > 0) return dieResponse(instancesError(instances));
                return jsonResponse(200, { id, obj: '', next_act: 'tables', args: '', warnings: '' });
            }
            return dieResponse(`Не найден id=${id}`);
        }

        throw new Error(`Unexpected fetch to ${u}`);
    }

    return { fetch: fetchImpl, calls, state: s };
}

function deletedIds(calls) {
    return calls
        .map(u => u.match(/\/_d_del\/(\d+)\?JSON$/))
        .filter(Boolean)
        .map(m => m[1]);
}

// --- Тесты ------------------------------------------------------------------

async function testDropsLeftoverRefTypeSilently() {
    const server = makeServer({ tableId: '865427', tableName: 'Тег', refTypeId: '865428' });
    global.fetch = server.fetch;

    const tbl = new Host({ _apiBase: API });
    const result = await tbl.deleteTable('865427');

    assert.strictEqual(result.success, true,
        `пустая таблица с оставшимся ref-типом должна удаляться молча, получено: ${result.error}`);
    assert.deepStrictEqual(deletedIds(server.calls), ['865428', '865427'],
        'сначала снимается ref-тип, потом удаляется сама таблица');
    console.log('PASS ref-тип «ссылка на таблицу» снимается молча, таблица удаляется');
}

async function testRealRecordsStillBlockDeletion() {
    // Обратная сторона: настоящие записи по-прежнему держат таблицу, и текст
    // ошибки сервера доходит до пользователя целиком.
    const server = makeServer({ tableId: '865427', tableName: 'Тег', refTypeId: null, records: 2 });
    global.fetch = server.fetch;

    const tbl = new Host({ _apiBase: API });
    const result = await tbl.deleteTable('865427');

    assert.strictEqual(result.success, false, 'таблица с записями удаляться не должна');
    assert.ok(result.error.includes(instancesError(2)),
        `ошибка сервера должна доходить целиком, получено: ${result.error}`);
    console.log('PASS таблица с записями не удаляется, ошибка сервера показана целиком');
}

async function testNamesReferringColumnsWhenRefTypeIsInUse() {
    // Ref-тип занят колонкой другой таблицы — снять его нельзя, и пользователь
    // должен узнать, ЧТО именно мешает, а не «экземпляров: 1».
    const server = makeServer({
        tableId: '865427', tableName: 'Тег', refTypeId: '865428',
        referrers: [{ tableId: '865500', tableName: 'Заказы', reqId: '865501', typeName: 'Тег', alias: 'Метка' }],
    });
    global.fetch = server.fetch;

    const tbl = new Host({ _apiBase: API });
    const result = await tbl.deleteTable('865427');

    assert.strictEqual(result.success, false, 'занятый ref-тип не даёт удалить таблицу');
    assert.ok(result.error.includes('Заказы'),
        `ошибка должна называть таблицу-источник ссылки, получено: ${result.error}`);
    assert.ok(result.error.includes('Метка'),
        `ошибка должна называть колонку (псевдоним), получено: ${result.error}`);
    assert.deepStrictEqual(deletedIds(server.calls), ['865428'],
        'саму таблицу удалять не пробуем, раз ссылку снять не вышло');
    console.log('PASS занятый ref-тип: названы таблица и колонка, таблица не тронута');
}

async function testUsesReferencedFromSingleTableMetadataWhenPresent() {
    // Если сервер когда-нибудь отдаст `referenced` и в metadata/{id} — путь
    // #2746 продолжает работать без обращения к метаданным всей базы.
    const server = makeServer({
        tableId: '865427', tableName: 'Тег', refTypeId: '865428', referencedInSingle: true,
    });
    global.fetch = server.fetch;

    const tbl = new Host({ _apiBase: API });
    const result = await tbl.deleteTable('865427');

    assert.strictEqual(result.success, true, `ожидали успех, получено: ${result.error}`);
    assert.deepStrictEqual(deletedIds(server.calls), ['865428', '865427']);
    const firstAllMeta = server.calls.findIndex(u => /\/metadata$/.test(u));
    const refDelete = server.calls.findIndex(u => /\/_d_del\/865428\?JSON$/.test(u));
    assert.ok(firstAllMeta === -1 || firstAllMeta > refDelete,
        'метаданные всей базы не запрашиваются, пока таблица сама называет referenced');
    console.log('PASS `referenced` из metadata/{id} используется напрямую');
}

(async function run() {
    await testDropsLeftoverRefTypeSilently();
    await testRealRecordsStillBlockDeletion();
    await testNamesReferringColumnsWhenRefTypeIsInUse();
    await testUsesReferencedFromSingleTableMetadataWhenPresent();
    console.log('\nAll issue #4966 tests passed.');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
