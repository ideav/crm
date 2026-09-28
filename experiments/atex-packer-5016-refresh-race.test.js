// ideav/crm#5016 — дефекты упаковщика, найденные на ревью PR #5004 (авто-обновление).
//
//  (1) ГОНКА. `packScopeNow` не смотрел на `busy`, а #5004 добавил фоновый `refresh()`
//      раз в 5 минут и по возврату фокуса. Фоновая загрузка подменяла `this.items`
//      новыми объектами и снимала `busy`, поставленный записью, — цепочка дописывала
//      уже отвязанные позиции, экран показывал их неупакованными, повторный тап давал
//      ДВОЙНУЮ запись «Упаковано шт» и дубли событий «Упаковка».
//      Фикс: `writing`/`loading` — раздельно (`busy` производное), запись не стартует
//      поверх занятости и не пропадает молча, фоновое обновление во время записи
//      откладывается до её конца (один догоняющий), записанное кладётся в позицию
//      того же id в АКТУАЛЬНОМ списке и держится, пока отчёт не подтвердит.
//  (2) СБОЙ СЕТИ. Ветка ошибки `refresh()` делала `self.items = []` и открывала
//      модалку — по таймеру, на планшете, за которым никто не следит.
//      Фикс: список не очищается никогда, фоновый сбой молчит, штамп свежести
//      уходит в «данные на ЧЧ:ММ · нет связи».
//  (3) ЛОЖНЫЕ ЧАСЫ (#5009). Сравнивалось текущее время устройства со СТАРЫМ снимком
//      серверного — планшет без связи 15 минут получал «часы не совпадают».
//      Фикс: рядом с `serverTimeMs` помнится `clientTimeAtFetch` того же ответа.
//  (4) УСТАРЕВШЕЕ ПРИМЕЧАНИЕ (#5002). `applySizesQty` меняла примечание только при
//      непустом новом тексте — возврат количества к подсказке оставлял «1 шт в брак»
//      и навсегда блокировал авто-обновление через `hasUnsavedEdits`.
//
// Run with: node experiments/atex-packer-5016-refresh-race.test.js

// ── Минимальный DOM-стаб (как в atex-packer-5011-per-position-pack.test.js) ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = []; this.attributes = {}; this.dataset = {}; this.style = {};
    this._className = ''; this._text = ''; this._listeners = {}; this.value = ''; this.disabled = false;
    var self = this;
    this.classList = {
        add: function(c) { if (self._classes().indexOf(c) === -1) self._className = (self._className + ' ' + c).trim(); },
        remove: function(c) { self._className = self._classes().filter(function(x) { return x !== c; }).join(' '); },
        contains: function(c) { return self._classes().indexOf(c) !== -1; },
        toggle: function(c, force) {
            var has = self._classes().indexOf(c) !== -1;
            var want = force == null ? !has : !!force;
            if (want && !has) this.add(c);
            if (!want && has) this.remove(c);
            return want;
        }
    };
}
StubNode.prototype._classes = function() { return this._className.split(/\s+/).filter(Boolean); };
Object.defineProperty(StubNode.prototype, 'className', { get: function() { return this._className; }, set: function(v) { this._className = String(v || ''); } });
Object.defineProperty(StubNode.prototype, 'textContent', {
    get: function() { if (this.childNodes.length) return this.childNodes.map(function(c) { return c.textContent; }).join(''); return this._text; },
    set: function(v) { this._text = String(v == null ? '' : v); this.childNodes = []; } });
Object.defineProperty(StubNode.prototype, 'innerHTML', { get: function() { return ''; }, set: function(v) { if (v === '') { this.childNodes = []; this._text = ''; } } });
StubNode.prototype.appendChild = function(n) { this.childNodes.push(n); n.parentNode = this; return n; };
StubNode.prototype.removeChild = function(n) { this.childNodes = this.childNodes.filter(function(c) { return c !== n; }); return n; };
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); if (k === 'value') this.value = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype.addEventListener = function(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); };
StubNode.prototype.dispatch = function(ev, e) { (this._listeners[ev] || []).forEach(function(fn) { fn(e || {}); }); };
StubNode.prototype.click = function() { this.dispatch('click', { target: this }); };
StubNode.prototype.focus = function() {};
StubNode.prototype._all = function(acc) { this.childNodes.forEach(function(c) { if (c instanceof StubNode) { acc.push(c); c._all(acc); } }); return acc; };
StubNode.prototype.querySelectorAll = function(sel) {
    var tag = /^[A-Za-z]/.test(sel) ? sel.toUpperCase() : '';
    var classes = sel.replace(/^[A-Za-z]*/, '').split('.').filter(Boolean);
    return this._all([]).filter(function(n) {
        if (tag && n.tagName !== tag) return false;
        return classes.every(function(c) { return n.classList.contains(c); });
    });
};
StubNode.prototype.querySelector = function(sel) { return this.querySelectorAll(sel)[0] || null; };

global.document = {
    createElement: function(tag) { return new StubNode(tag); },
    createTextNode: function(t) { var n = new StubNode('#text'); n._text = String(t == null ? '' : t); return n; },
    body: new StubNode('body'), readyState: 'loading', visibilityState: 'visible',
    getElementById: function() { return null; }, addEventListener: function() {}
};
global.window = { db: 'testdb' };

var mod = require('../download/atex/js/packer.js');
var core = mod.core;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (ожидалось ' + JSON.stringify(expected) + ', получено ' + JSON.stringify(actual) + ')'));
    if (ok) passed++; else process.exitCode = 1;
}
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

// ── Данные ──

function row(over) {
    var base = {
        task: '1786078800', task_id: '666355', gp_id: '666392',
        order_no: '4615', order: '',
        material: 'MWR113L', cut_width: '110.00', cut_length: '600.00',
        wind_direction: 'IN', sleeve: 'втулка пластик серая для Videojet', add_sleeve: '',
        qty: '5', qty_fact: '5', packed: '', notes: '', events: '1'
    };
    Object.keys(over || {}).forEach(function(k) { base[k] = over[k]; });
    return base;
}
function item(over) { return core.itemFromReportRow(row(over)); }

// Заказ из двух размеров — слитая плашка (#4918), запись идёт цепочкой (#5011).
function twoSizes(over) {
    var o = over || {};
    return [
        item({ gp_id: 'a', task_id: '1', cut_width: '110.00', qty: '2', qty_fact: '2', packed: o.packedA || '' }),
        item({ gp_id: 'b', task_id: '2', cut_width: '64.00', qty: '12', qty_fact: '12', packed: o.packedB || '' })
    ];
}

function makeCtl(items) {
    var inst = Object.create(mod.Controller.prototype);
    inst.root = new StubNode('div');
    inst.headEl = new StubNode('header');
    inst.listEl = new StubNode('section');
    inst.items = items;
    inst.nextItems = []; inst.sizes = []; inst.jumbos = {}; inst.jumboStats = {};
    inst.place = { id: '1', label: '1' };
    inst.showPacked = false;
    inst.busy = false; inst.loading = false; inst.writing = false;
    inst.refreshQueued = false; inst.offline = false; inst.written = {};
    inst.loadedAt = null; inst.serverTimeMs = 0; inst.clientTimeAtFetch = 0;
    inst.storeShowPacked = function() {};
    inst.said = [];
    inst.notify = function(message, kind) { inst.said.push({ message: message, kind: kind }); };
    return inst;
}

// Кнопка «Упаковано» карточки заказа (#4918) — она пишет ВСЕ неупакованные позиции.
function cardPackButton(inst) {
    var card = inst.listEl.querySelectorAll('.atex-pk-card')[0];
    var side = card && card.querySelector('.atex-pk-side');
    return (side ? side.querySelectorAll('button') : []).filter(function(b) {
        return b.textContent === 'Упаковано';
    })[0] || null;
}

function tick() { return new Promise(function(res) { setImmediate(res); }); }

// ── (0) Чистые функции ──

assertEqual(core.writeGuard({}).ok, true, '#5016 writeGuard: свободно → писать можно');
assertEqual(core.writeGuard({ writing: true }).ok, false, '#5016 writeGuard: идёт запись → нельзя');
assertEqual(core.writeGuard({ loading: true }).ok, false, '#5016 writeGuard: идёт загрузка → нельзя');
assert(core.writeGuard({ loading: true }).message.length > 0,
    '#5016 writeGuard: у отказа есть текст — тап не пропадает молча');
assert(core.writeGuard({ writing: true }).message !== core.writeGuard({ loading: true }).message,
    '#5016 writeGuard: запись и загрузка объясняются по-разному');

assertEqual(core.freshnessLabel(new Date(2026, 8, 26, 14, 3).getTime(), false), 'данные на 14:03',
    '#5016 freshnessLabel: связь есть — прежний штамп');
assertEqual(core.freshnessLabel(new Date(2026, 8, 26, 14, 3).getTime(), true), 'данные на 14:03 · нет связи',
    '#5016 freshnessLabel: связи нет — к штампу добавлено «нет связи»');
assertEqual(core.freshnessLabel(0, true), 'нет связи',
    '#5016 freshnessLabel: ни одной удачной загрузки — только «нет связи»');
assertEqual(core.freshnessLabel(0, false), '',
    '#5016 freshnessLabel: нечего сказать — пусто');

// ── (г) Возврат количества к подсказке снимает примечание и блок авто-обновления ──

(function() {
    var group = core.groupByOrder(twoSizes())[0];
    assertEqual(core.applySizesQty(group, ['1', ''], '1 шт в брак'), 1,
        '#5016 (г): подготовка — количество первой позиции поправлено');
    assertEqual(group.items[0].editedNote, '1 шт в брак',
        '#5016 (г): подготовка — примечание записано');
    assertEqual(core.hasUnsavedEdits(group.items), true,
        '#5016 (г): подготовка — правка блокирует авто-обновление (#5003)');

    assertEqual(core.applySizesQty(group, ['2', ''], ''), 1,
        '#5016 (г): возврат количества к подсказке — это изменение');
    assertEqual(group.items[0].editedNote, '',
        '#5016 (г): вернули количество к подсказке без нового примечания — старое снято');
    assertEqual(core.currentQty(group.items[0]), 2,
        '#5016 (г): в карточке снова подсказка отчёта');
    assertEqual(core.hasUnsavedEdits(group.items), false,
        '#5016 (г): блок авто-обновления снят');
    assertEqual(core.canAutoRefresh({
        visible: true, busy: false, modalOpen: false,
        unsavedEdits: core.hasUnsavedEdits(group.items),
        lastLoadMs: 1000, nowMs: 1000 + 5 * 60 * 1000, minGapMs: 30 * 1000
    }), true, '#5016 (г): авто-обновление снова разрешено');
})();

(function() {
    var group = core.groupByOrder(twoSizes())[0];
    core.applySizesQty(group, ['1', ''], '1 шт в брак');
    core.applySizesQty(group, ['1', '10'], '');
    assertEqual(group.items[0].editedNote, '1 шт в брак',
        '#5016 (г): у расходящейся позиции примечание не трогают — пустой текст не стирает');
    assertEqual(core.hasUnsavedEdits(group.items), true,
        '#5016 (г): расхождение осталось — авто-обновление по-прежнему ждёт');
})();

// ── (в) 15 минут без связи не выдают ложного «часы не совпадают» ──

(function() {
    var inst = makeCtl([]);
    var answered = new Date().getTime() - 15 * 60 * 1000;
    inst.loadedAt = new Date(answered);
    inst.offline = true;
    // В момент ответа часы совпадали; с тех пор прошло 15 минут без связи.
    inst.serverTimeMs = answered;
    inst.clientTimeAtFetch = answered;
    inst.renderHead();
    assertEqual(inst.headEl.querySelectorAll('.atex-pk-clock-warn').length, 0,
        '#5016 (в): 15 минут без связи — ложного предупреждения о часах нет');

    // Настоящее расхождение: устройство спешило на 20 минут уже в момент ответа.
    inst.clientTimeAtFetch = answered + 20 * 60 * 1000;
    inst.renderHead();
    assertEqual(inst.headEl.querySelectorAll('.atex-pk-clock-warn').length, 1,
        '#5016 (в): настоящее расхождение часов по-прежнему видно (#5007)');

    // Ни одного ответа ещё не было — сравнивать не с чем.
    inst.serverTimeMs = 0; inst.clientTimeAtFetch = 0;
    inst.renderHead();
    assertEqual(inst.headEl.querySelectorAll('.atex-pk-clock-warn').length, 0,
        '#5016 (в): без серверного времени предупреждения нет');
})();

// ── Запись поверх занятости: тап не теряется молча ──

(function() {
    var inst = makeCtl(twoSizes());
    var written = [];
    inst._writePack = function(pos, qty, note) { written.push({ gpId: pos.gpId, qty: qty, note: note }); return Promise.resolve(); };
    inst.renderList();
    var btn = cardPackButton(inst);
    assert(!!btn, '#5016: карточная кнопка «Упаковано» на месте');
    inst.setLoading(true);
    btn.click();
    assertEqual(written, [], '#5016: во время фоновой загрузки запись не стартует');
    assertEqual(inst.said.length, 1, '#5016: тап во время загрузки не теряется молча');
    assertEqual(inst.busy, true, '#5016: busy — производное от loading');
    inst.setLoading(false);
    assertEqual(inst.busy, false, '#5016: загрузка кончилась — занятости нет');
})();

// ── Загрузка не снимает занятость, поставленную записью ──

(function() {
    var inst = makeCtl(twoSizes());
    inst.setWriting(true);
    assertEqual(inst.busy, true, '#5016: идёт запись → занято');
    inst.setLoading(true);
    inst.setLoading(false);
    assertEqual(inst.busy, true, '#5016: загрузка не снимает чужой busy — запись ещё идёт');
    inst.setWriting(false);
    assertEqual(inst.busy, false, '#5016: запись кончилась — занятости нет');
})();

// ── Записанное держится, пока отчёт его не подтвердит ──

(function() {
    var inst = makeCtl(twoSizes());
    inst.applyWritten(inst.items[0], 2, '');
    assertEqual(Object.keys(inst.written), ['a'], '#5016: запись запомнена до подтверждения отчётом');

    // Отчёт ещё отдаёт старое «Упаковано шт» (read-after-write).
    inst.items = twoSizes();
    inst.applyPendingWrites();
    assertEqual(core.isPacked(inst.items[0]), true,
        '#5016: отставший отчёт не возвращает позицию в «неупакованные»');
    assertEqual(core.isPacked(inst.items[1]), false, '#5016: соседняя позиция не тронута');

    // Отчёт догнал — помнить больше нечего.
    inst.items = twoSizes({ packedA: '2' });
    inst.applyPendingWrites();
    assertEqual(Object.keys(inst.written), [], '#5016: отчёт подтвердил запись — память очищена');
})();

// ── (а) и (б): асинхронные сценарии ──

var steps = [];

// (а) Фоновое обновление, подошедшее во время цепочки записей, не даёт повторной записи.
steps.push(function() {
    var inst = makeCtl(twoSizes());
    var written = [], gates = [], loads = 0;
    inst._writePack = function(pos, qty, note) {
        written.push({ gpId: pos.gpId, qty: qty, note: note });
        return new Promise(function(res) { gates.push(res); });
    };
    // Стабится только транспорт: loadItems работает
    // настоящий — они и подменяют позиции НОВЫМИ объектами, в чём была гонка.
    inst.getJson = function(path) {
        if (path.indexOf('report/packers?') === 0) { loads++; return Promise.resolve([row({ gp_id: 'a', task_id: '1', cut_width: '110.00', qty: '2', qty_fact: '2' }), row({ gp_id: 'b', task_id: '2', cut_width: '64.00', qty: '12', qty_fact: '12' })]); }
        return Promise.resolve([]);
    };

    inst.renderList();
    cardPackButton(inst).click();

    return tick().then(function() {
        assertEqual(written.length, 1, '#5016 (а): цепочка записей пошла с первой позиции');
        assertEqual(inst.writing, true, '#5016 (а): пульт знает, что идёт запись');

        // Подошёл срок фонового обновления — ровно посреди цепочки.
        inst.autoRefreshTick();
        assertEqual(loads, 0, '#5016 (а): фоновое обновление не стартовало поверх записи');
        assertEqual(inst.refreshQueued, true, '#5016 (а): обновление отложено, а не потеряно');

        // Упаковщик тапает ещё раз (экран ведь «не отреагировал»).
        cardPackButton(inst).click();
        return tick();
    }).then(function() {
        assertEqual(written.length, 1, '#5016 (а): повторный тап во время записи не пишет второй раз');
        assertEqual(inst.said.length, 1, '#5016 (а): упаковщику сказано, почему отметки пока нет');
        gates[0]();
        return tick();
    }).then(function() {
        assertEqual(written.length, 2, '#5016 (а): цепочка дошла до второй позиции');
        gates[1]();
        return tick();
    }).then(function() {
        assertEqual(written.length, 2, '#5016 (а): записей ровно по числу позиций — дублей нет');
        assertEqual(loads, 1, '#5016 (а): после записи выполнен ОДИН догоняющий refresh');
        assertEqual(inst.refreshQueued, false, '#5016 (а): отложенное обновление отработало');
        assertEqual(inst.items.map(core.isPacked), [true, true],
            '#5016 (а): после догоняющего обновления позиции остались упакованными');
        assertEqual(inst.writing, false, '#5016 (а): запись завершена');
    });
});

// (а) Позиции подменили посреди цепочки записей — записанное должно лечь в объект
// того же id в АКТУАЛЬНОМ списке, иначе экран покажет упакованное неупакованным.
steps.push(function() {
    var inst = makeCtl(twoSizes());
    var gates = [];
    inst._writePack = function() { return new Promise(function(res) { gates.push(res); }); };
    inst.renderList();
    cardPackButton(inst).click();
    return tick().then(function() {
        inst.items = twoSizes();   // снимок сменился под уже идущей цепочкой
        gates[0]();
        return tick();
    }).then(function() {
        gates[1]();
        return tick();
    }).then(function() {
        assertEqual(inst.items.map(core.isPacked), [true, true],
            '#5016 (а): записанное легло в позиции актуального списка — по id, а не по ссылке');
        assertEqual(inst.items.map(function(it) { return core.toNumber(it.packedQty); }), [2, 12],
            '#5016 (а): каждая позиция получила своё количество');
    });
});

// (б) Сбой сети при фоновом обновлении не стирает список и не открывает модалку.
steps.push(function() {
    var inst = makeCtl(twoSizes());
    inst.loadJumbos = function() { return Promise.resolve(); };
    inst.loadNextItems = function() { return Promise.resolve(); };
    inst.loadItems = function() { return Promise.reject(new Error('Failed to fetch')); };
    inst.loadedAt = new Date(2026, 8, 26, 14, 3);

    return inst.refresh({ background: true }).then(function() {
        assertEqual(inst.items.length, 2, '#5016 (б): сбой фонового обновления не стирает список');
        assertEqual(inst.said, [], '#5016 (б): фоновый сбой не открывает модалку');
        assertEqual(inst.offline, true, '#5016 (б): пульт помнит, что связи не было');
        var stamp = inst.headEl.querySelector('.atex-pk-stamp');
        assertEqual(stamp && stamp.textContent, 'данные на 14:03 · нет связи',
            '#5016 (б): штамп свежести говорит и время данных, и что связи нет');
        assert(!!stamp && stamp.classList.contains('is-stale'),
            '#5016 (б): штамп подсвечен предупреждающим цветом');

        // Ручное «Обновить» — сообщение есть, но список по-прежнему цел.
        return inst.refresh();
    }).then(function() {
        assertEqual(inst.items.length, 2, '#5016 (б): даже ручное обновление не очищает список');
        assertEqual(inst.said.length, 1, '#5016 (б): о ручной неудаче сказано');
        assertEqual(inst.said[0].kind, 'error', '#5016 (б): ручная неудача — обычная ошибка');

        // Связь вернулась — штамп снова обычный.
        inst.loadItems = function() { inst.items = twoSizes(); return Promise.resolve(); };
        return inst.refresh({ background: true });
    }).then(function() {
        assertEqual(inst.offline, false, '#5016 (б): связь вернулась — отметка «нет связи» снята');
        var stamp = inst.headEl.querySelector('.atex-pk-stamp');
        assert(!!stamp && stamp.textContent.indexOf('нет связи') === -1,
            '#5016 (б): штамп снова обычный');
    });
});

steps.reduce(function(chain, step) {
    return chain.then(step);
}, Promise.resolve()).then(function() {
    console.log('\n' + passed + '/' + total + ' assertions passed');
    if (process.exitCode) process.exit(process.exitCode);
}).catch(function(err) {
    console.log('FAIL — сценарий упал: ' + err.stack);
    process.exit(1);
});
