/* Каркас макетов Фазы 2 atex — этикетка/высечка (ideav/crm#4974).
   Макеты статичные: страница ничего не запрашивает у сервера и ничего не пишет.
   Здесь — единый список макетов (он же навигация), шапка, вкладки и тост-заглушка
   на кнопки. Перечень рабочих мест, которые показывают макеты, —
   docs/atex_phase2_solution_composition.md §4.
   Файл грузится и браузером, и тестом experiments/atex-phase2-4974-mockups.test.js:
   работа с DOM начинается только после DOMContentLoaded, вне браузера код молчит.
   Страницы макетов лежат рядом с этим файлом (download/atex/js), стиль — в
   download/atex/css: маппинги деплоя перечислены в конфиге на сервере рядом с
   update.php и из репозитория не обновляются, поэтому макеты едут в уже
   выкладываемых каталогах (issue #4974). Вход — phase2-mockups.html. */

var PHASE2_PAGES = [
    { group: 'Обзор',        file: 'phase2-mockups.html',           title: 'Состав решения',              role: 'навигатор макетов' },
    { group: 'Заказ',        file: 'phase2-label-orders.html',      title: 'Заказы этикетки',             role: 'Менеджер' },
    { group: 'Заказ',        file: 'phase2-label-import.html',      title: 'Импорт из 1С',                role: 'Администратор, Диспетчер' },
    { group: 'Справочники',  file: 'phase2-dies.html',              title: 'Ножи и валы',                 role: 'Технолог, Диспетчер' },
    { group: 'Планирование', file: 'phase2-die-planning.html',      title: 'Планирование высечки',        role: 'Диспетчер' },
    { group: 'Планирование', file: 'phase2-jumbo-cutting.html',     title: 'Раскрой джамбо',              role: 'Диспетчер' },
    { group: 'Планирование', file: 'phase2-master-rolls.html',      title: 'Склад мастер-рулонов',        role: 'Кладовщик' },
    { group: 'Цех',          file: 'phase2-die-cutter-pult.html',   title: 'Пульт высечки',               role: 'Оператор, планшет' },
    { group: 'Цех',          file: 'phase2-jumbo-pult.html',        title: 'Пульт большого слиттера',     role: 'Оператор, планшет' },
    { group: 'Цех',          file: 'phase2-job-print.html',         title: 'Задание на производство',     role: 'печатная форма' }
];

/* Шапка + боковая навигация рисуются из PHASE2_PAGES: новый макет добавляется
   одной строкой списка и сам появляется во всех остальных макетах. */
function phase2RenderChrome(doc, currentFile) {
    var top = doc.createElement('div');
    top.className = 'mk-top';
    top.innerHTML = '<span class="mk-top-logo">АТЕХ</span>'
        + '<span class="mk-top-title">Фаза 2 — этикетка, высечка</span>'
        + '<span class="mk-top-flag">макет · данные зашиты в страницу</span>';

    var nav = doc.createElement('nav');
    nav.className = 'mk-nav';
    var group = '';
    PHASE2_PAGES.forEach(function (page) {
        if (page.group !== group) {
            group = page.group;
            var cap = doc.createElement('div');
            cap.className = 'mk-nav-group';
            cap.textContent = group;
            nav.appendChild(cap);
        }
        var a = doc.createElement('a');
        a.href = page.file;
        if (page.file === currentFile) { a.className = 'is-current'; }
        a.innerHTML = page.title + '<span class="mk-nav-role">' + page.role + '</span>';
        nav.appendChild(a);
    });

    var body = doc.createElement('div');
    body.className = 'mk-body';
    var main = doc.createElement('main');
    main.className = 'mk-main';
    while (doc.body.firstChild) { main.appendChild(doc.body.firstChild); }
    body.appendChild(nav);
    body.appendChild(main);
    doc.body.appendChild(top);
    doc.body.appendChild(body);
}

/* Любая кнопка макета отвечает тостом, а не действием: макет показывает состав
   экрана, а не работает. Кнопки вкладок — исключение, они переключают вид. */
function phase2Toast(doc, text) {
    var old = doc.querySelector('.mk-toast');
    if (old) { old.parentNode.removeChild(old); }
    var toast = doc.createElement('div');
    toast.className = 'mk-toast';
    toast.textContent = text;
    doc.body.appendChild(toast);
    setTimeout(function () {
        if (toast.parentNode) { toast.parentNode.removeChild(toast); }
    }, 2200);
}

function phase2BindTabs(doc) {
    var tabs = doc.querySelectorAll('.mk-tab');
    Array.prototype.forEach.call(tabs, function (tab) {
        tab.addEventListener('click', function () {
            var scope = tab.parentNode;
            Array.prototype.forEach.call(scope.querySelectorAll('.mk-tab'), function (t) {
                t.classList.remove('is-on');
            });
            tab.classList.add('is-on');
            var name = tab.getAttribute('data-tab');
            Array.prototype.forEach.call(doc.querySelectorAll('[data-tab-body]'), function (box) {
                box.style.display = (box.getAttribute('data-tab-body') === name) ? '' : 'none';
            });
        });
    });
}

function phase2Init(doc) {
    var path = (doc.location && doc.location.pathname) || '';
    var current = path.split('/').pop() || PHASE2_PAGES[0].file;
    phase2RenderChrome(doc, current);
    phase2BindTabs(doc);
    doc.addEventListener('click', function (event) {
        var btn = event.target.closest ? event.target.closest('.mk-btn') : null;
        if (!btn) { return; }
        phase2Toast(doc, 'Это макет: «' + btn.textContent.trim() + '» ничего не сохраняет');
    });
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function () { phase2Init(document); });
}
