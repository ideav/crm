// Issue #5221: вид приложения и раскладка меню по текущему пользователю.
//
// Вид (класс app-view-* на <html>):
//   guest — посетитель без входа (пользователь guest): без меню пользователя и ИИ-агента,
//           в шапке кнопка «Войти»;
//   admin — роль admin (или id ADMINROLE), владелец базы, доступ к структуре базы,
//           право писать в таблицу меню (грант 151): правка меню живёт в левом меню;
//   user  — остальные.
// Раскладка меню (класс menu-layout-* на <html>):
//   left — левое меню (по умолчанию);
//   top  — верхнее меню в шапке, подпункты второго уровня — выпадающими списками;
//   auto — выбор по меню роли: у админа левое, у прочих верхнее, пока разделов не больше
//          TOP_MENU_MAX и нет третьего уровня, иначе левое.
// Источник выбора, по старшинству: <html data-menu-layout="top|left|auto"> своего main.html →
// файл базы templates/custom/{db}/_menu_layout.html (одно слово; читается из
// <template id="app-menu-layout">) → left.
//
// Подключается в <head> main.html до отрисовки страницы, чтобы раскладка не «прыгала».
(function (w) {
    var TOP_MENU_MAX = 7;
    var ADMINROLE = '145';

    function lower(v) {
        return String(v == null ? '' : v).toLowerCase();
    }

    function getView(ctx) {
        ctx = ctx || {};
        var user = lower(ctx.user);
        if (!user || user === 'guest') return 'guest';
        if (lower(ctx.role) === 'admin' || String(ctx.roleId || '') === ADMINROLE) return 'admin';
        if (ctx.db && user === lower(ctx.db)) return 'admin';
        var grants = ctx.grants;
        if (grants && !Array.isArray(grants) && (grants['0'] === 'READ' || grants['0'] === 'WRITE')) return 'admin';
        if (grants && !Array.isArray(grants) && grants['151'] === 'WRITE') return 'admin';
        return 'user';
    }

    var MODES = { top: true, left: true, auto: true };

    function mode(v) {
        v = lower(v).trim();
        return MODES[v] ? v : '';
    }

    // Файл базы подставляется шаблонизатором внутрь <template>; без файла там info.html —
    // такое содержимое (и всё, кроме одного из слов top/left/auto) выбором не считается.
    function readLayoutConfig(el) {
        return el ? mode(el.innerHTML) : '';
    }

    // Глубина и число разделов меню — по тем же правилам, что buildMenu в main-app.js:
    // пункт, чей родитель не входит в меню роли, считается разделом верхнего уровня.
    function menuShape(items) {
        var byId = {};
        (items || []).forEach(function (it) { if (it && it.menu_id) byId[it.menu_id] = it; });
        var top = 0, depth = 0;
        Object.keys(byId).forEach(function (id) {
            var level = 1, it = byId[id], seen = {};
            while (it.menu_up && byId[it.menu_up] && !seen[it.menu_up]) {
                seen[it.menu_up] = true;
                it = byId[it.menu_up];
                level++;
            }
            if (level === 1) top++;
            if (level > depth) depth = level;
        });
        return { top: top, depth: depth };
    }

    function getMenuLayout(view, items, override) {
        if (override === 'top' || override === 'left') return override;
        if (view === 'admin') return 'left';
        var shape = menuShape(items);
        return (shape.top <= TOP_MENU_MAX && shape.depth <= 2) ? 'top' : 'left';
    }

    function apply(root, ctx, items, configured) {
        var view = getView(ctx);
        var chosen = mode(root.getAttribute('data-menu-layout')) || mode(configured) || 'left';
        var layout = getMenuLayout(view, items, chosen);
        ['guest', 'user', 'admin'].forEach(function (v) { root.classList.remove('app-view-' + v); });
        ['top', 'left'].forEach(function (l) { root.classList.remove('menu-layout-' + l); });
        root.classList.add('app-view-' + view);
        root.classList.add('menu-layout-' + layout);
        return { view: view, layout: layout };
    }

    w.AppView = {
        TOP_MENU_MAX: TOP_MENU_MAX,
        getView: getView,
        getMenuLayout: getMenuLayout,
        readLayoutConfig: readLayoutConfig,
        apply: apply
    };
})(window);
