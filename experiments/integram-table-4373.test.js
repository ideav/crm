// Unit-тесты для ideav/crm#4373 — выбрал оператор в .filter-type-menu, а фокус остался в никуда:
// чтобы ввести значение фильтра, приходилось отдельно целиться мышью в поле.
//
// Проверяем, что после выбора пункта меню каретка уходит в поле фильтра ЭТОЙ колонки — на всех
// путях обработчика: без перерисовки, с перерисовкой (смена формы поля: дата ↔ текст ↔ диапазон,
// текст ↔ выпадающий список у REF) и с немедленной перезагрузкой («пустое»/«не пустое»).
// Плюс: перерисовка не должна ронять фокус с REF-триггера (кнопка, а не input).
//
// Run with: node experiments/integram-table-4373.test.js

process.env.TZ = 'Europe/Moscow';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

// ── Загрузка собранного бандла в песочницу ───────────────────────────────────
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'integram-table.js'), 'utf8');
const sandbox = {
    console,
    URLSearchParams,
    location: { pathname: '/ateh/table/1078', search: '' },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

// Меню живёт в document.body: createElement + appendChild + разбор .filter-type-option из innerHTML.
const menus = [];
function MenuNode() {
    this.style = {};
    this.className = '';
    this._options = [];
    this._removed = false;
}
Object.defineProperty(MenuNode.prototype, 'innerHTML', {
    get() { return this._html || ''; },
    set(html) {
        this._html = html;
        // Пункты меню — по data-symbol; каждому нужен dataset и регистрация click-обработчика.
        this._options = (html.match(/data-symbol="([^"]*)"/g) || []).map(m => {
            const symbol = m.replace(/^data-symbol="/, '').replace(/"$/, '');
            return { dataset: { symbol }, _click: null,
                     addEventListener(type, fn) { if (type === 'click') this._click = fn; } };
        });
    }
});
MenuNode.prototype.querySelectorAll = function() { return this._options; };
MenuNode.prototype.remove = function() { this._removed = true; };
MenuNode.prototype.contains = function() { return false; };

sandbox.document = {
    createElement() { const m = new MenuNode(); menus.push(m); return m; },
    getElementById: () => null,
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    body: { appendChild: () => {} },
    readyState: 'complete'
};
sandbox.setTimeout = () => 0;   // отложенный «клик мимо меню» в тесте не нужен

vm.createContext(sandbox);
const { IntegramTable } = vm.runInContext(
    source + '\n;({ IntegramTable });', sandbox, { filename: 'integram-table.js' }
);

// ── Экземпляр таблицы с подменённым контейнером ──────────────────────────────
// container.querySelector отдаёт «контрол» колонки: класс контрола решает, попадёт ли он под
// селектор, а сам селектор строит рабочий код.
function makeControl(cls, over) {
    return Object.assign({
        cls, type: cls === '.filter-ref-trigger' ? undefined : 'text', value: '',
        focused: false, preventScroll: null, caret: null,
        focus(opts) { this.focused = true; this.preventScroll = opts && opts.preventScroll; },
        setSelectionRange(a, b) { this.caret = [a, b]; }
    }, over || {});
}

function makeTable(controlsByColumn, columns) {
    const noop = IntegramTable.prototype.init;
    IntegramTable.prototype.init = () => {};
    const t = new IntegramTable('tbl', { instanceName: 'tbl' });
    IntegramTable.prototype.init = noop;

    t.columns = columns;
    t.columnOrder = columns.map(c => c.id);
    t.visibleColumns = columns.map(c => c.id);
    t.controls = controlsByColumn;
    t.renders = 0;
    t.loads = 0;
    t.container = {
        querySelector(selector) {
            const colId = (selector.match(/data-column-id="([^"]+)"/) || [])[1];
            const control = colId && t.controls[colId];
            if (!control) return null;
            // Селектор перечисляет классы через запятую — контрол подходит, если его класс назван.
            return selector.indexOf(control.cls) >= 0 ? control : null;
        },
        querySelectorAll: () => []
    };
    t.render = () => { t.renders++; };
    t.loadData = () => { t.loads++; };
    t.handleFilterOverride = () => {};
    t.updateRefFilterTriggerDisplay = () => {};
    t.closeRefFilterDropdown = () => {};
    t.saveColumnState = () => {};
    return t;
}

// Открыть меню оператора и кликнуть по пункту `symbol`
function pick(t, columnId, symbol) {
    const target = { textContent: '', getBoundingClientRect: () => ({ bottom: 0, left: 0 }) };
    t.showFilterTypeMenu(target, columnId);
    const menu = menus[menus.length - 1];
    const option = menu._options.find(o => o.dataset.symbol === symbol);
    if (!option) throw new Error(`нет пункта «${ symbol }» в меню: ${ menu._options.map(o => o.dataset.symbol).join(' ') }`);
    option._click();
    return { target, menu };
}

const SHORT = { id: '8493', name: 'В работе', format: 'SHORT' };
const DATE = { id: '8492', name: 'Начато', format: 'DATETIME' };
const REF = { id: '8474', name: 'Слиттер', format: 'REF' };

// ── 1. Обычная текстовая колонка: смена оператора без перерисовки ────────────
(function () {
    const input = makeControl('.filter-input-with-icon', { value: 'МВ' });
    const t = makeTable({ '8493': input }, [SHORT]);
    t.filters = { '8493': { type: '=', value: 'МВ' } };

    pick(t, '8493', '~');
    assertEqual(t.filters['8493'].type, '~', 'оператор колонки сменился на «содержит»');
    assertEqual(t.renders, 0, 'форма поля не менялась — перерисовки нет');
    assertEqual(input.focused, true, '#4373: поле фильтра получило фокус');
    assertEqual(input.preventScroll, true, '#4373: фокус без автоскролла (горизонтальная прокрутка не сбрасывается)');
    assertEqual(input.caret, [2, 2], '#4373: каретка в конце набранного — следующий символ дописывается');
})();

// ── 2. Смена формы поля (дата → диапазон): фокус после перерисовки ───────────
(function () {
    // После перерисовки ячейка диапазона несёт ДВА поля; фокус забирает «от» (первое в DOM).
    const fromInput = makeControl('.filter-input-with-icon');
    const t = makeTable({ '8492': fromInput }, [DATE]);
    t.filters = {};

    pick(t, '8492', '...');
    assertEqual(t.renders, 1, 'форма поля сменилась (дата → диапазон) → перерисовка');
    assertEqual(fromInput.focused, true, '#4373: после перерисовки фокус в поле диапазона «от»');
})();

// ── 3. «Пустое»/«не пустое»: фильтр применяется сразу, фокус всё равно в поле ─
(function () {
    const input = makeControl('.filter-input-with-icon', { value: 'МВ' });
    const t = makeTable({ '8493': input }, [SHORT]);
    t.filters = { '8493': { type: '~', value: 'МВ' } };

    pick(t, '8493', '%');
    assertEqual([t.filters['8493'].type, t.filters['8493'].value], ['%', ''], 'оператор «не пустое», значение очищено');
    assertEqual(t.loads, 1, 'фильтр применён сразу — перезагрузка');
    assertEqual(input.focused, true, '#4373: поле фильтра получило фокус и на пути с перезагрузкой');
})();

// ── 4. REF: переключение выпадающий список ↔ текст ───────────────────────────
(function () {
    // Был список («равно»), выбрали «содержит» → ячейка перерисовывается в текстовое поле.
    const textInput = makeControl('.filter-input-with-icon');
    const t = makeTable({ '8474': textInput }, [REF]);
    t.filters = { '8474': { type: '=', value: '@145' } };

    pick(t, '8474', '~');
    assertEqual(t.renders, 1, 'REF: режим сменился (список → текст) → перерисовка');
    assertEqual(textInput.focused, true, '#4373: REF в текстовом режиме — фокус в поле');

    // Остались в режиме списка: фокус забирает кнопка-триггер, у неё нет каретки.
    const trigger = makeControl('.filter-ref-trigger');
    const t2 = makeTable({ '8474': trigger }, [REF]);
    t2.filters = { '8474': { type: '=', value: '@145' } };

    pick(t2, '8474', '(,)');
    assertEqual(t2.renders, 0, 'REF: режим прежний (список) → перерисовки нет');
    assertEqual([trigger.focused, trigger.caret], [true, null],
        '#4373: REF в режиме списка — фокус на кнопке выбора, каретку не трогаем');
})();

// ── 5. focusFilterControl: нет контрола — молча ничего ───────────────────────
(function () {
    const t = makeTable({}, [SHORT]);
    t.filters = {};
    t.focusFilterControl('нет-такой');   // не должно бросать
    t.focusFilterControl(null);
    assertEqual(true, true, 'focusFilterControl без контрола не падает');
})();

// ── 6. Перерисовка не роняет фокус с REF-триггера (кнопка, не input) ─────────
(function () {
    // render() снимает состояние фокуса с document.activeElement; до #4373 он узнавал только
    // .filter-input-with-icon, поэтому асинхронная перерисовка после перезагрузки сбрасывала
    // фокус, только что отданный кнопке.
    const trigger = makeControl('.filter-ref-trigger');
    const t = makeTable({ '8474': trigger }, [REF]);
    t.filters = { '8474': { type: '=', value: '' } };
    t.data = [];
    t.render = IntegramTable.prototype.render;   // настоящий render
    // Всё, что render() навешивает на живой DOM, в стабе не нужно — важен только блок фокуса.
    ['attachEventListeners', 'attachScrollListener', 'attachPlusKeyShortcut', 'attachStickyScrollbar',
     'attachColumnResizeHandlers', 'attachScrollCounterPositioning', 'updateFilterRowStickyTop',
     'updateContainerHeight', 'attachContainerHeightObserver', 'loadRefFilterOptions',
     'restoreScrollState', 'captureScrollState'].forEach(m => { t[m] = () => {}; });

    sandbox.document.activeElement = {
        classList: { contains: cls => cls === 'filter-ref-trigger' },
        dataset: { columnId: '8474' }
    };
    // Полный render в стабе не пройдёт — важно лишь, что состояние фокуса снялось и восстановилось.
    t.render();
    sandbox.document.activeElement = null;

    assertEqual(trigger.focused, true, '#4373: перерисовка возвращает фокус на REF-триггер');
})();

console.log(`\n${ passed }/${ total } tests passed`);
