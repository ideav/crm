// Стартовая страница рабочего места админа базы my (#5420, templates/my/info.html):
// плитки разделов из меню роли (menuData) и панель модерации шаблонов баз (js/db-templates.js).
(function (root) {
    'use strict';

    // Разделы верхнего уровня меню роли: пункты с адресом, чей родитель не входит в меню
    function sections(items) {
        var byId = {};
        (items || []).forEach(function (it) { if (it && it.menu_id) byId[it.menu_id] = it; });
        return (items || []).filter(function (it) {
            return it && it.href && String(it.href).charAt(0) !== '{' && !(it.menu_up && byId[it.menu_up]);
        });
    }

    // Иконка пункта меню — как в main-app.js: HTML PrimeIcons (<i class="pi pi-…">) или эмодзи
    function iconOf(raw) {
        var s = String(raw == null ? '' : raw).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
        var m = /\b(pi-[a-z0-9-]+)/.exec(s);
        if (m) return { pi: m[1] };
        if (s.trim() && s.indexOf('<') === -1 && s.charAt(0) !== '{') return { text: s.trim() };
        return { pi: 'pi-folder' };
    }

    function render(doc, db, items) {
        var box = doc.getElementById('my-admin-sections');
        if (!box) return;
        var list = sections(items);
        if (!list.length) return;
        box.textContent = '';
        list.forEach(function (it) {
            var a = doc.createElement('a');
            a.className = 'mc-tile';
            a.href = '/' + db + '/' + String(it.href).replace(/^\/+/, '');
            var icon = doc.createElement('i');
            var ic = iconOf(it.icon);
            if (ic.pi) icon.className = 'pi ' + ic.pi;
            else icon.textContent = ic.text;
            var name = doc.createElement('span');
            name.textContent = it.name || it.href;
            a.appendChild(icon);
            a.appendChild(name);
            box.appendChild(a);
        });
    }

    root.MyAdminHome = { sections: sections, iconOf: iconOf, render: render };

    if (root.document && root.document.getElementById('my-admin-home')) {
        render(root.document, root.db, root.menuData);
        if (root.DbTemplates)
            root.DbTemplates.initCabinet({ base: '/' + root.db, xsrf: root.xsrf, select: null,
                panel: root.document.getElementById('tpl-moderation') });
    }
})(typeof window !== 'undefined' ? window : globalThis);
