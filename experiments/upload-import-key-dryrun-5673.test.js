// Issue #5673: форма загрузки (templates/upload.html) — ключ обновления, «пробелы не стирают»
// и пробный прогон. Исполняются настоящие функции шаблона; jQuery, FormData и запросы — заглушки.
//  - каждая порция загрузки несёт importKey и keepFilled;
//  - пробный прогон шлёт ВЕСЬ файл одним запросом с dryRun=1 (повторы ключа ищутся по всему файлу);
//  - счётчики порций складываются в итог загрузки.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'templates', 'upload.html'), 'utf8');
function extractFunction(name) {
    const start = source.indexOf('function ' + name + '(');
    assert(start !== -1, name + ' must be defined in templates/upload.html');
    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let i = bodyStart; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('Unable to extract ' + name);
}

function makeContext(ui) {
    const sent = [];
    const html = {};
    const $ = (sel) => ({
        val: (v) => (v === undefined ? (ui[sel] !== undefined ? ui[sel] : '') : (ui[sel] = v)),
        prop: () => !!ui[sel],
        attr: () => ui[sel + '@up-id'],
        html: (h) => { html[sel] = h; return { show: () => {} }; },
        show: () => {},
    });
    class FormData { constructor() { this.f = {}; } append(k, v) { this.f[k] = v; } }
    class File { constructor(parts) { this.text = parts.join(''); } }
    const ctx = {
        $, FormData, File, sent, html, ajax: '', chunkSize: 2, autoParent: undefined, newType: undefined,
        chosenType: 300, origMap: { 300: 0, 301: 1 }, importReqNames: { 302: 'Отдел' }, importTotals: null,
        showNotification: (m) => { throw new Error('notification: ' + m); },
        getUpType: () => 400,
        intApi: (m, u, b, fd, index) => sent.push({ u, b, fields: fd.f, text: fd.f.bki_file.text, index }),
    };
    vm.runInNewContext(['serializeUploadCellValue', 'escapeSlashesNSemicolons', 'escape', 'doImport', 'importForm', 'importText',
        'doDryRun', 'importStatText', 'addImportTotals', 'showImportTotals'].map(extractFunction).join('\n'), ctx);
    return ctx;
}
const rows = [undefined, ['Иванов', 'T1'], ['Петров', 'T2'], ['Козлов', 'T3']];

// 1. Порции загрузки: обе несут ключ и флаг, строк по chunkSize
let c = makeContext({ '#import-key': '301', '#keep-filled': true });
c.toImport = rows;
c.doImport();
c.doImport(c.sent[0].index);
assert.strictEqual(c.sent.length, 2, 'три строки при chunkSize=2 — две порции');
for (const s of c.sent) {
    assert.strictEqual(s.fields.importKey, '301', 'importKey в каждой порции');
    assert.strictEqual(s.fields.keepFilled, 1, 'keepFilled в каждой порции');
    assert.strictEqual(s.fields.dryRun, undefined, 'обычная загрузка — без dryRun');
}
assert.strictEqual(c.sent[0].text, 'DATA\r\nИванов;T1;\r\nПетров;T2;\r\n');
assert.strictEqual(c.sent[1].text, 'DATA\r\nКозлов;T3;\r\n');

// 2. Без выбора ключа параметров нет — сервер ищет по настройке таблицы
c = makeContext({});
c.toImport = rows;
c.doImport();
assert.strictEqual(c.sent[0].fields.importKey, undefined);
assert.strictEqual(c.sent[0].fields.keepFilled, undefined);

// 3. Пробный прогон — весь файл одним запросом
c = makeContext({ '#import-key': '301' });
c.toImport = rows;
c.doDryRun();
assert.strictEqual(c.sent.length, 1, 'один запрос');
assert.strictEqual(c.sent[0].b, 'dry');
assert.strictEqual(c.sent[0].fields.dryRun, 1);
assert.strictEqual(c.sent[0].fields.importKey, '301');
assert.strictEqual(c.sent[0].text, 'DATA\r\nИванов;T1;\r\nПетров;T2;\r\nКозлов;T3;\r\n');

// 4. Итог загрузки — сумма счётчиков порций; новые значения справочников — по имени колонки
c = makeContext({});
c.addImportTotals({ created: 1, updated: 2, unchanged: 0, deleted: 0, skipped: 0, parents: 0, refs: { 302: ['Цех'] } });
c.addImportTotals({ created: 3, updated: 0, unchanged: 1, deleted: 1, skipped: 0, parents: 0, refs: { 302: ['<b>Склад</b>'] } });
c.showImportTotals();
const total = c.html['#progress'];
assert(total.includes('создано: <b>4</b>') && total.includes('обновлено: <b>2</b>') && total.includes('удалено: <b>1</b>'), total);
assert(total.includes('Отдел: Цех, &lt;b&gt;Склад&lt;/b&gt;'), 'имена значений экранированы: ' + total);

console.log('PASS — upload-import-key-dryrun-5673');
