// Восстановление файлов базы из архива .code.zip в рабочем месте dir_admin (issue #5168).
//
// Значок «Восстановить файлы» у файла backups/*.code.zip открывает окно: состав архива (то, что
// отдаёт GET /{db}/code_restore/?backup_file=…), предупреждение и подтверждение вводом имени базы.
// После подтверждения — POST туда же: сервер проверяет пути архива, снимает страховочный архив
// текущих файлов, затем перезаписывает шаблоны в корне templates/custom/{db} и файлы download/{db}
// содержимым архива. Залить архив может владелец базы или администратор сервера — проверяет сервер.
(function (root) {
    'use strict';

    var PREVIEW_CHARS = 20000;  // больше в окно не выводим: файлов в базе бывает много

    // Ответ GET code_restore — состав архива: маркер, пути с размерами, TOTAL; иначе текст ошибки
    function isListing(text) {
        text = String(text || '');
        return /^CODE BACKUP \S+\.code\.zip/.test(text) && /TOTAL \d+\s*$/.test(text);
    }

    function confirmMatches(typed, db) {
        return String(typed || '').trim().toLowerCase() === String(db || '').toLowerCase() && !!db;
    }

    function previewText(list) {
        list = String(list || '');
        if (list.length <= PREVIEW_CHARS) return list;
        return list.slice(0, PREVIEW_CHARS) + '\n… показано ' + PREVIEW_CHARS + ' из ' + list.length + ' символов';
    }

    // Текст итога по ответу POST code_restore (JSON сервера или сырой текст ошибки)
    function resultMessage(text) {
        var res = null;
        try { res = JSON.parse(text); } catch (e) { res = null; }
        if (Array.isArray(res)) res = res[0];
        if (res && res.result === 'ok')
            return { ok: true, text: 'Файлы восстановлены: ' + res.files + '. Прежние файлы сохранены в backups/' + res.backup + '.' };
        if (res && res.error)
            return { ok: false, text: 'Ошибка: ' + res.error
                + (res.backup ? ' Прежние файлы сохранены в backups/' + res.backup + '.' : '') };
        return { ok: false, text: 'Ошибка: ' + (String(text || '').trim() || 'пустой ответ сервера') };
    }

    function el(tag, style, text) {
        var node = document.createElement(tag);
        if (style) node.style.cssText = style;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function openDialog(opts, href, fileName) {
        var overlay = el('div', 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10000;'
            + 'display:flex;align-items:center;justify-content:center;padding:16px;');
        var box = el('div', 'background:#fff;max-width:900px;width:100%;max-height:90vh;display:flex;'
            + 'flex-direction:column;gap:10px;padding:16px;border-radius:6px;box-shadow:0 4px 24px rgba(0,0,0,.3);');
        box.appendChild(el('h4', 'margin:0;', 'Восстановление файлов из архива ' + fileName));
        var pre = el('pre', 'flex:1;min-height:120px;overflow:auto;margin:0;font-size:12px;white-space:pre-wrap;'
            + 'word-break:break-all;', 'Загружаю состав архива…');
        box.appendChild(pre);
        box.appendChild(el('p', 'margin:0;color:#a94442;font-weight:bold;',
            'Шаблоны в корне templates и файлы в download будут перезаписаны содержимым архива. Файлы вне архива не удаляются.'));
        box.appendChild(el('p', 'margin:0;',
            'Перед записью сервер сохранит текущие файлы в backups — из этого архива их можно вернуть. '
            + 'Восстановить может владелец базы (' + opts.db + ') или администратор сервера.'));
        var label = el('label', 'margin:0;font-weight:normal;', 'Для подтверждения введите имя базы: ');
        var input = el('input', 'margin-left:6px;');
        input.type = 'text';
        input.autocomplete = 'off';
        label.appendChild(input);
        box.appendChild(label);
        var status = el('p', 'margin:0;');
        box.appendChild(status);
        var buttons = el('div', 'display:flex;gap:8px;justify-content:flex-end;');
        var cancel = el('button', '', 'Отмена');
        cancel.type = 'button';
        cancel.className = 'btn btn-default';
        var apply = el('button', '', 'Восстановить файлы');
        apply.type = 'button';
        apply.className = 'btn btn-danger';
        apply.disabled = true;
        buttons.appendChild(cancel);
        buttons.appendChild(apply);
        box.appendChild(buttons);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        var loaded = false, busy = false, done = false;
        function refresh() { apply.disabled = busy || done || !loaded || !confirmMatches(input.value, opts.db); }
        function close() { if (!busy) overlay.remove(); }
        input.addEventListener('input', refresh);
        cancel.addEventListener('click', function () { done ? location.reload() : close(); });
        overlay.addEventListener('click', function (e) { if (e.target === overlay && !done) close(); });

        fetch(href, { credentials: 'same-origin' })
            .then(function (r) { return r.text(); })
            .then(function (text) {
                pre.textContent = previewText(text);
                loaded = isDump(text);
                if (!loaded) status.textContent = 'Архив не прочитан — восстановление недоступно.';
                refresh();
            })
            .catch(function (e) { pre.textContent = 'Не удалось получить состав архива: ' + (e && e.message ? e.message : e); });

        apply.addEventListener('click', function () {
            if (apply.disabled) return;
            busy = true;
            refresh();
            status.textContent = 'Восстанавливаю файлы… Не закрывайте страницу.';
            var fd = new FormData();
            fd.append('_xsrf', opts.xsrf);
            fetch(href, { method: 'POST', credentials: 'same-origin', body: fd })
                .then(function (r) { return r.text(); })
                .catch(function (e) { return 'Сеть: ' + (e && e.message ? e.message : e); })
                .then(function (text) {
                    var res = resultMessage(text);
                    busy = false;
                    done = res.ok;
                    status.textContent = res.text;
                    status.style.color = res.ok ? '#3c763d' : '#a94442';
                    if (done) {
                        cancel.textContent = 'Обновить страницу';
                        apply.style.display = 'none';
                    }
                    refresh();
                });
        });
    }

    function init(opts) {
        document.addEventListener('click', function (e) {
            var link = e.target && e.target.closest ? e.target.closest('a.code-restore') : null;
            if (!link) return;
            e.preventDefault();
            openDialog(opts, link.getAttribute('href'), link.getAttribute('name') || '');
        });
    }

    var api = { init: init, isListing: isListing, confirmMatches: confirmMatches, previewText: previewText,
                resultMessage: resultMessage };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.CodeRestore = api;
})(this);
