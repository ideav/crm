// Рабочее место atex «Упаковка» (роль Упаковщик, планшет).
//
// Упаковщик указывает своё упаковочное место, видит список нарезанных позиций и
// отмечает их упакованными. Решение ideav/crm#4658. Правила разработки рабочих мест —
// docs/WORKSPACE_DEVELOPMENT_GUIDE.md, карта рабочих мест — docs/atex_workplaces.md §3.13.
//
// БОЕВАЯ СХЕМА (live ateh). Строка отчёта `packer` — это ПАРТИЯ ГП (1081) внутри
// задания («Задание в производство», 1078), с позицией заказа и заказом сбоку:
//   task/task_id — плановый старт задания (Unix) и его id;
//   gp_id        — id Партии ГП, по нему и пишется отметка;
//   order_no     — номер заказа, order — «Заказ клиента» (текст, может быть пуст);
//   material, cut_width, cut_length, wind_direction, sleeve, add_sleeve — что за ролик;
//   qty/qty_fact — «Кол-во рулонов» и «Кол-во факт» Партии ГП;
//   packed/notes — «Упаковано шт» (673786) и «Примечание» (673789) Партии ГП;
//   events       — счётчик событий смены задания.
// Отчёт отфильтрован по наличию события «Резка» у задания, поэтому упаковщик видит
// задание, как только по нему сделана первая резка, и весь его объём — независимо от
// того, сколько проходов уже отмечено. Порядок строк — как пришёл из отчёта.
//
// Отметка упаковки пишет ДВЕ записи:
//   1) `_m_set/{gp_id}` — «Упаковано шт» (и «Примечание», если количество поправили);
//      это состояние переживает перезагрузку и возвращается колонкой `packed`;
//   2) `_m_new/{Событие смены}?up=1` — событие с типом «Упаковка» (справочник «Тип
//      события», id 670935), текущим временем, оператором, ссылкой на задание и
//      количеством в «Значении». Станок НЕ указывается (упаковка вне станка).
// Событие — корневой объект (up=1), как у пульта слиттера: подчинять его заданию
// нельзя, связь держится реквизитом «Задание в производство».
//
// Крупно в карточке стоит номер заказа КЛИЕНТА (`order`) — тот же, что напечатан на
// этикетке ролика; наш внутренний `order_no` идёт мелкой строкой под ним. Клиентский
// номер есть не у каждого заказа: без него крупным остаётся внутренний (#4688).
//
// Количество по умолчанию — `qty_fact`, а если его нет — `qty`. Меняют его КЛИКОМ ПО
// САМОМУ КОЛИЧЕСТВУ в карточке: открывается модалка, где поправленное количество
// требует примечания. Кнопка «Упаковано» ничего не спрашивает — фиксирует упаковку тем
// количеством, которое видно в карточке (#4680). У неупакованной позиции правка живёт в
// модели до отметки, у упакованной уходит в базу сразу.
// Упаковочное место запоминается в localStorage: пока оно там есть, таблицу
// «Упаковочное место» (669269) не запрашиваем вовсе — только по клику на само место.
// Отчёт запрашивается с фильтром `FR_packer_no={номер места}` — упаковщик видит только
// свои позиции (#4681); без выбранного места отчёт не запрашивается вовсе. Место позиция
// берёт у станка: `Задание в производство → Слиттер → Упаковочное место`.
//
// ID таблиц и реквизитов не хардкодятся — берутся по именам из `GET /{db}/metadata`
// (WORKSPACE_DEVELOPMENT_GUIDE.md, разделы 3 и 6). Чистое ядро (разбор строк отчёта,
// подпись позиции, количество, группировка по заданию, поля записи) вынесено в объект
// `core` и экспортируется через module.exports для тестов (experiments/atex-packer.test.js).

(function(root, factory) {
    'use strict';
    var api;
    if (typeof module === 'object' && module.exports) {
        api = factory(require('./packaging-size.js'));
        module.exports = api;
    } else {
        api = factory(root.AtexPackagingSize);
    }
    if (typeof window !== 'undefined') {
        window.AtexPacker = api;
        if (typeof document !== 'undefined') {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', api.init);
            } else {
                api.init();
            }
        }
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(PackagingSize) {
    'use strict';

    // #4665: справочник «Типоразмер» — сколько роликов и в какой короб укладывать.
    var packing = (PackagingSize && PackagingSize.core) || null;

    // Имена таблиц и реквизитов схемы ateh: по ним рабочее место находит числовые id
    // в метаданных текущей сборки.
    var TABLE = { gp: 'Партия ГП', event: 'Событие смены', place: 'Упаковочное место' };
    var GP_REQ = { packed: 'Упаковано шт', notes: 'Примечание' };
    var EVENT_REQ = {
        type: 'Тип события',
        task: 'Задание в производство',
        user: 'Пользователь',
        value: 'Значение',
        notes: 'Примечания'
    };
    // Значение справочника «Тип события» (1193, запись 670935): отметка упаковки.
    var EVENT_TYPE_PACK = 'Упаковка';

    // Отчёт с заданиями упаковщика и имена его колонок. Фильтр `FR_packer_no` оставляет
    // в отчёте только позиции выбранного упаковочного места (#4681).
    var REPORT = 'packer';
    var REPORT_LIMIT = 5000;
    var REPORT_PLACE_FILTER = 'FR_packer_no';
    var COL = {
        task: 'task', taskId: 'task_id', gpId: 'gp_id',
        orderNo: 'order_no', orderClient: 'order',
        material: 'material', width: 'cut_width', length: 'cut_length',
        wind: 'wind_direction', sleeve: 'sleeve', addSleeve: 'add_sleeve',
        qty: 'qty', qtyFact: 'qty_fact', packed: 'packed', notes: 'notes', events: 'events',
        // #4665: типоразмер упаковки, проставленный планированием, и тип сырья (для фольги).
        tipo: 'tipo', tipoId: 'tipo_id', materialType: 'material_type'
    };

    var STORE_PLACE_ID = 'atex-pk-place-id';
    var STORE_PLACE_LABEL = 'atex-pk-place-label';
    var STORE_SHOW_PACKED = 'atex-pk-show-packed';

    // ───────────────────────── Чистое ядро ─────────────────────────

    // Терпимый разбор числа: принимает запятую как десятичный разделитель,
    // отбрасывает пробелы; «пусто»/мусор → 0.
    function toNumber(value) {
        if (typeof value === 'number') return isFinite(value) ? value : 0;
        var text = String(value == null ? '' : value).replace(/\s+/g, '').replace(',', '.');
        var n = parseFloat(text);
        return isFinite(n) ? n : 0;
    }

    function str(value) { return value == null ? '' : String(value); }
    function pad2(n) { var s = String(n); return s.length < 2 ? '0' + s : s; }

    // Значение поля строки отчёта: JSON_KV отдаёт либо строку, либо {val,id}.
    function kvVal(v) {
        if (v != null && typeof v === 'object') return v.val != null ? v.val : (v.id != null ? v.id : '');
        return v == null ? '' : v;
    }

    // Числа отчёта приходят как «110.00»/«12.50» — показываем их по-человечески.
    // Пусто остаётся пустым (дыру в подписи заполнять нечем).
    function formatNumber(value) {
        var raw = str(kvVal(value)).trim();
        if (!raw) return '';
        var n = toNumber(raw);
        if (!isFinite(n)) return raw;
        return String(Math.round(n * 1000) / 1000);
    }

    // ── Дата/время задания: Unix → локальные дата и время ──

    function unixToMs(value) {
        var n = toNumber(value);
        if (!n) return 0;
        return n >= 1e12 ? n : n * 1000;
    }
    function unixToLocalTime(value) {
        var ms = unixToMs(value);
        if (!ms) return '';
        var d = new Date(ms);
        return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
    function unixToLocalDate(value) {
        var ms = unixToMs(value);
        if (!ms) return '';
        var d = new Date(ms);
        return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear();
    }
    // Момент события смены в том виде, в каком его принимает главное значение
    // таблицы «Событие смены» (как в пульте слиттера).
    function eventStamp(now) {
        var d = now || new Date();
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
            pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    }

    // ── Строка отчёта → позиция к упаковке ──

    function itemFromReportRow(row) {
        var r = row || {};
        var item = {
            taskId: str(kvVal(r[COL.taskId])),
            taskUnix: toNumber(kvVal(r[COL.task])),
            gpId: str(kvVal(r[COL.gpId])),
            orderNo: str(kvVal(r[COL.orderNo])).trim(),
            orderClient: str(kvVal(r[COL.orderClient])).trim(),
            material: str(kvVal(r[COL.material])).trim(),
            width: formatNumber(r[COL.width]),
            length: formatNumber(r[COL.length]),
            wind: str(kvVal(r[COL.wind])).trim(),
            sleeve: str(kvVal(r[COL.sleeve])).trim(),
            addSleeve: str(kvVal(r[COL.addSleeve])).trim(),
            planQty: toNumber(kvVal(r[COL.qty])),
            factQty: toNumber(kvVal(r[COL.qtyFact])),
            packedQty: toNumber(kvVal(r[COL.packed])),
            notes: str(kvVal(r[COL.notes])).trim(),
            events: toNumber(kvVal(r[COL.events])),
            tipo: str(kvVal(r[COL.tipo])).trim(),
            tipoId: str(kvVal(r[COL.tipoId])),
            materialType: str(kvVal(r[COL.materialType])).trim()
        };
        return item;
    }

    // #4665: типоразмер позиции. Обычно он уже проставлен планированием — берём его по
    // id из справочника; если у партии его нет (старая запись), подбираем на месте по
    // ширине, длине, фольге и доп. втулке. Без справочника — null, карточка просто без короба.
    function sizeForItem(item, sizes) {
        if (!packing || !item) return null;
        var list = sizes || [];
        var id = str(item.tipoId);
        if (id) {
            var stored = list.filter(function(s) { return String(s.id) === id; })[0];
            if (stored) return stored;
        }
        return packing.matchSize(list, {
            width: item.width,
            length: item.length,
            foil: packing.isFoilType(item.materialType) || packing.isFoilType(item.material),
            addSleeve: item.addSleeve
        });
    }

    // Подпись упаковки для карточки: «короб №125 · по 36 шт · 3 короба».
    function packingLabel(size, qty) {
        if (!packing || !size) return '';
        var parts = [];
        if (size.box) parts.push('короб ' + size.box);
        if (size.perBox > 0) parts.push('по ' + size.perBox + ' шт');
        var boxes = packing.boxesFor(size, qty);
        if (boxes > 0) parts.push(packing.boxesLabel(boxes));
        return parts.join(' · ');
    }

    // Подпись позиции в том виде, к которому привык упаковщик:
    // «MWR113L 110 х 600 IN серая втулка пластик + доп. втулка: Приклеить».
    // Пустые поля просто выпадают, лишних разделителей не оставляя.
    function describeItem(item) {
        var it = item || {};
        var size = [it.width, it.length].filter(Boolean).join(' х ');
        var parts = [it.material, size, it.wind, it.sleeve].filter(Boolean);
        var text = parts.join(' ');
        if (it.addSleeve) text += (text ? ' ' : '') + '+ доп. втулка: ' + it.addSleeve;
        return text;
    }

    // Номера заказа для карточки (#4688). Крупно стоит номер, который упаковщик читает
    // на этикетке ролика, — «Заказ клиента»; наш внутренний номер уходит строкой ниже.
    // Клиентский номер есть не у каждого заказа: без него крупным остаётся внутренний,
    // и второй строки просто нет.
    function orderTitle(item) {
        var it = item || {};
        var client = str(it.orderClient).trim();
        var no = str(it.orderNo).trim();
        if (client) return { main: client, sub: no };
        return { main: no || '—', sub: '' };
    }

    // Сколько штук предлагает отчёт: факт, а если его нет — план.
    function packQtyFor(item) {
        var it = item || {};
        return toNumber(it.factQty) || toNumber(it.planQty);
    }

    // Позиция уже упакована? Источник истины — «Упаковано шт» Партии ГП.
    function isPacked(item) {
        return toNumber((item || {}).packedQty) > 0;
    }

    // От какого количества считается «поправил»: подсказка отчёта, а у упакованной
    // позиции — уже записанное «Упаковано шт».
    function baseQty(item) {
        var it = item || {};
        return isPacked(it) ? toNumber(it.packedQty) : packQtyFor(it);
    }

    // Что стоит в карточке и что уйдёт в отметку по кнопке «Упаковано»: правка
    // упаковщика сильнее подсказки отчёта. Правку ставят кликом по количеству и она
    // живёт до отметки (#4680) — упакованную позицию правка не касается, там уже
    // записанное значение.
    function currentQty(item) {
        var it = item || {};
        if (isPacked(it)) return toNumber(it.packedQty);
        if (it.editedQty != null && it.editedQty !== '') return toNumber(it.editedQty);
        return packQtyFor(it);
    }

    // Количество в карточке отличается от того, что предложил отчёт?
    function isEdited(item) {
        var it = item || {};
        if (isPacked(it)) return false;
        return it.editedQty != null && it.editedQty !== '' && toNumber(it.editedQty) !== packQtyFor(it);
    }

    // Количество поправили относительно предложенного?
    function noteRequired(qty, suggested) {
        return toNumber(qty) !== toNumber(suggested);
    }

    // Адрес отчёта: упаковщик видит только позиции СВОЕГО упаковочного места (#4681).
    // `{n}` фильтра — номер места, то самое главное значение таблицы «Упаковочное
    // место», которое стоит в правом верхнем углу. Места нет — фильтр не ставим.
    function itemsPath(place) {
        var path = 'report/' + REPORT + '?JSON_KV&LIMIT=0,' + REPORT_LIMIT;
        var no = str(place && place.label).trim();
        if (no) path += '&' + REPORT_PLACE_FILTER + '=' + encodeURIComponent(no);
        return path;
    }

    // Проверка формы количества: пустой текст = всё в порядке, иначе — что не так.
    // Поправил количество — обязан объяснить почему (решение заказчика по #4658).
    function validatePack(form) {
        var f = form || {};
        var qty = toNumber(f.qty);
        if (!(qty > 0)) return 'Количество должно быть больше нуля';
        if (noteRequired(qty, f.suggested) && !str(f.note).trim()) {
            return 'Количество изменено — напишите примечание';
        }
        return '';
    }

    // Группировка строк по ЗАДАНИЮ. Ключ — task_id, а не время старта: у разных
    // заданий плановый старт совпадает, и по времени чужие позиции слиплись бы в одну
    // карточку. Порядок групп и порядок строк внутри — как пришли из отчёта.
    function groupByTask(items) {
        var order = [];
        var byId = {};
        (items || []).forEach(function(item, idx) {
            var key = item.taskId || ('#' + idx);
            if (!byId[key]) {
                byId[key] = { taskId: item.taskId, taskUnix: item.taskUnix, items: [] };
                order.push(key);
            }
            byId[key].items.push(item);
        });
        return order.map(function(key) { return byId[key]; });
    }

    // Сводка: сколько позиций, сколько из них упаковано, сколько рулонов всего и упаковано.
    function summarize(items) {
        var list = items || [];
        var rolls = 0, packedRolls = 0, packed = 0;
        list.forEach(function(item) {
            rolls += currentQty(item);
            if (isPacked(item)) { packed++; packedRolls += toNumber(item.packedQty); }
        });
        return { total: list.length, packed: packed, rolls: rolls, packedRolls: packedRolls };
    }

    // Что показываем: упакованные скрыты, пока не включён переключатель. Включили —
    // встают на свои места в порядке отчёта, а не сваливаются в конец.
    function visibleItems(items, showPacked) {
        var list = items || [];
        return showPacked ? list.slice() : list.filter(function(item) { return !isPacked(item); });
    }

    function packedCount(items) {
        return (items || []).filter(isPacked).length;
    }

    // ── Поиск сущностей метаданных по имени (val/alias) ──

    function aliasOf(entry) {
        if (!entry) return '';
        if (entry.alias != null && entry.alias !== '') return String(entry.alias);
        if (entry.attrs) {
            try {
                var a = JSON.parse(entry.attrs);
                if (a && a.alias != null) return String(a.alias);
            } catch (e) { /* attrs не JSON */ }
        }
        return '';
    }
    function matchesName(entry, name) {
        if (!entry) return false;
        var target = str(name).trim().toLowerCase();
        if (!target) return false;
        if (str(entry.val).trim().toLowerCase() === target) return true;
        return aliasOf(entry).trim().toLowerCase() === target;
    }
    function tableByName(list, name) {
        var arr = Array.isArray(list) ? list : (list == null ? [] : [list]);
        var names = Array.isArray(name) ? name : [name];
        for (var i = 0; i < arr.length; i++) {
            for (var j = 0; j < names.length; j++) {
                if (matchesName(arr[i], names[j])) return arr[i];
            }
        }
        return null;
    }
    function reqIdByName(meta, name) {
        var found = (meta && meta.reqs || []).filter(function(r) { return matchesName(r, name); })[0];
        return found ? String(found.id) : null;
    }

    // ── Поля записи ──

    // Что уходит в Партию ГП: «Упаковано шт» и, если количество поправили,
    // «Примечание» — оно возвращается колонкой `notes` отчёта.
    function gpPackFields(gpMeta, data) {
        var d = data || {};
        var fields = {};
        var packedRid = reqIdByName(gpMeta, GP_REQ.packed);
        if (packedRid) fields['t' + packedRid] = toNumber(d.qty);
        var note = str(d.note).trim();
        if (note) {
            var notesRid = reqIdByName(gpMeta, GP_REQ.notes);
            if (notesRid) fields['t' + notesRid] = note;
        }
        return fields;
    }

    // Что уходит в «Событие смены»: время (главное значение), тип «Упаковка»,
    // задание, оператор, количество и примечание. «Слиттер» не пишем — упаковка идёт
    // без станка (условие #4658).
    function eventFields(eventMeta, data) {
        var d = data || {};
        var fields = {};
        fields['t' + (eventMeta && eventMeta.id)] = d.when;
        var typeRid = reqIdByName(eventMeta, EVENT_REQ.type);
        if (typeRid) fields['t' + typeRid] = EVENT_TYPE_PACK;
        var taskRid = reqIdByName(eventMeta, EVENT_REQ.task);
        if (taskRid && d.taskId) fields['t' + taskRid] = str(d.taskId);
        var userRid = reqIdByName(eventMeta, EVENT_REQ.user);
        if (userRid && d.userId) fields['t' + userRid] = str(d.userId);
        var valueRid = reqIdByName(eventMeta, EVENT_REQ.value);
        if (valueRid && toNumber(d.qty)) fields['t' + valueRid] = toNumber(d.qty);
        var note = str(d.note).trim();
        if (note) {
            var notesRid = reqIdByName(eventMeta, EVENT_REQ.notes);
            if (notesRid) fields['t' + notesRid] = note;
        }
        return fields;
    }

    var core = {
        toNumber: toNumber,
        formatNumber: formatNumber,
        unixToLocalTime: unixToLocalTime,
        unixToLocalDate: unixToLocalDate,
        eventStamp: eventStamp,
        itemFromReportRow: itemFromReportRow,
        describeItem: describeItem,
        orderTitle: orderTitle,
        packQtyFor: packQtyFor,
        baseQty: baseQty,
        currentQty: currentQty,
        isEdited: isEdited,
        isPacked: isPacked,
        noteRequired: noteRequired,
        itemsPath: itemsPath,
        validatePack: validatePack,
        groupByTask: groupByTask,
        summarize: summarize,
        visibleItems: visibleItems,
        packedCount: packedCount,
        sizeForItem: sizeForItem,
        packingLabel: packingLabel,
        aliasOf: aliasOf,
        matchesName: matchesName,
        tableByName: tableByName,
        reqIdByName: reqIdByName,
        gpPackFields: gpPackFields,
        eventFields: eventFields
    };

    // ─────────────────────────── Браузерный слой ───────────────────────────
    // Ниже — DOM-контроллер. Требует window/document/fetch; в Node не выполняется.

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function(k) {
            if (k === 'class') node.className = attrs[k];
            else if (k === 'text') node.textContent = attrs[k];
            else if (k === 'dataset') Object.keys(attrs[k]).forEach(function(d) { node.dataset[d] = attrs[k][d]; });
            else node.setAttribute(k, attrs[k]);
        });
        (children || []).forEach(function(c) {
            if (c == null) return;
            node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return node;
    }

    function AtexPacker(root) {
        this.root = root;
        this.db = window.db || root.getAttribute('data-db') || '';
        this.userId = root.getAttribute('data-user-id') || (typeof window !== 'undefined' ? window.user_id : '') || '';
        this.meta = { gp: null, event: null, place: null };
        this.places = [];          // справочник упаковочных мест (грузится только по нужде)
        this.items = [];           // позиции к упаковке (строки отчёта, порядок отчёта)
        this.sizes = [];           // #4665: справочник «Типоразмер» (отчёт pack_sizes)
        this.place = null;         // { id, label } — выбранное упаковочное место
        this.showPacked = false;
        this.busy = false;
    }

    AtexPacker.prototype.url = function(path) {
        return '/' + encodeURIComponent(this.db) + '/' + path;
    };

    // GET → JSON. Бросает Error при сетевой/JSON-ошибке.
    AtexPacker.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            return resp.text().then(function(text) {
                try { return JSON.parse(text); }
                catch (e) { throw new Error('Некорректный JSON: ' + text.slice(0, 200)); }
            });
        });
    };

    // POST команды `_m_*`. Токен XSRF подставляется обязательно (раздел 4 гайда).
    AtexPacker.prototype.post = function(path, params) {
        var body = new URLSearchParams();
        body.set('_xsrf', (typeof window !== 'undefined' && window.xsrf) || this.root.getAttribute('data-xsrf') || '');
        Object.keys(params || {}).forEach(function(k) {
            if (params[k] !== undefined && params[k] !== null) body.set(k, params[k]);
        });
        return fetch(this.url(path), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        }).then(function(resp) {
            return resp.text().then(function(text) {
                var result;
                try { result = JSON.parse(text); } catch (e) { throw new Error('Сервер вернул не JSON: ' + text.slice(0, 200)); }
                if (result && (result.error || result.err)) throw new Error(result.error || result.err);
                return result;
            });
        });
    };

    // ── Метаданные и справочники ──

    AtexPacker.prototype.loadMetadata = function() {
        var self = this;
        return this.getJson('metadata').then(function(all) {
            var list = Array.isArray(all) ? all : [all];
            self.meta.gp = core.tableByName(list, TABLE.gp);
            self.meta.event = core.tableByName(list, TABLE.event);
            self.meta.place = core.tableByName(list, TABLE.place);
            if (!self.meta.event) throw new Error('В метаданных не найдена таблица «' + TABLE.event + '»');
            if (!self.meta.gp) throw new Error('В метаданных не найдена таблица «' + TABLE.gp + '»');
        });
    };

    // Справочник упаковочных мест. Запрашивается ТОЛЬКО когда место не выбрано или
    // упаковщик сам нажал на него, чтобы поменять (условие #4658).
    AtexPacker.prototype.loadPlaces = function() {
        var self = this;
        var meta = this.meta.place;
        if (!meta) return Promise.reject(new Error('В метаданных не найдена таблица «' + TABLE.place + '»'));
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            self.places = (rows || []).map(function(r) {
                return { id: String(r.i), label: (r.r && r.r[0]) || ('#' + r.i) };
            });
        });
    };

    // ── Позиции к упаковке ──

    // #4665: справочник типоразмеров — отчётом (он идёт под правами владельца, поэтому
    // роли не нужен грант на сам справочник). Не прочитался — работаем без коробов.
    AtexPacker.prototype.loadSizes = function() {
        var self = this;
        if (!PackagingSize) { this.sizes = []; return Promise.resolve(); }
        return this.getJson('report/' + PackagingSize.REPORT + '?JSON_KV&LIMIT=0,1000').then(function(rows) {
            self.sizes = packing.sizesFromReport(rows);
        }).catch(function(err) {
            console.error('atex-packer: справочник типоразмеров не прочитан — ' + err.message);
            self.sizes = [];
        });
    };

    AtexPacker.prototype.loadItems = function() {
        var self = this;
        return this.getJson(core.itemsPath(this.place)).then(function(rows) {
            var list = Array.isArray(rows) ? rows : [];
            self.items = list.map(function(row) { return core.itemFromReportRow(row); });
        });
    };

    // ── Память о выборе (localStorage) ──

    AtexPacker.prototype.storePlace = function() {
        try {
            if (!window.localStorage) return;
            window.localStorage.setItem(STORE_PLACE_ID, (this.place && this.place.id) || '');
            window.localStorage.setItem(STORE_PLACE_LABEL, (this.place && this.place.label) || '');
        } catch (e) { /* приватный режим — просто не запоминаем */ }
    };
    AtexPacker.prototype.restorePlace = function() {
        try {
            var store = window.localStorage;
            if (!store) return;
            var id = store.getItem(STORE_PLACE_ID);
            var label = store.getItem(STORE_PLACE_LABEL);
            if (id) this.place = { id: String(id), label: String(label || id) };
        } catch (e) { /* приватный режим — считаем, что места нет */ }
        // #4789: упаковочное место планшета (таблица «Планшет») сильнее памяти браузера —
        // упаковка открывается сразу на своём месте, справочник мест для этого не нужен.
        var padPlace = this.padPlace();
        if (padPlace) { this.place = padPlace; this.storePlace(); }
    };

    // #4789: место из настройки планшета. В «Планшете» оно лежит ссылкой («id:Номер»)
    // или просто номером — берём и то, и другое: отчёт фильтруется по НОМЕРУ места.
    AtexPacker.prototype.padPlace = function() {
        var obj = window.atexPad && window.atexPad.config && window.atexPad.config.place;
        var id = str(obj && obj.id).trim();
        var label = str(obj && obj.label).trim();
        if (!id && !label) return null;
        return { id: id || label, label: label || id };
    };

    // #4789: выбранное место уходит в запись планшета — так диспетчер настраивает планшет
    // прямо из пульта. Прав на запись нет (упаковщик) — тихо ничего не пишем.
    AtexPacker.prototype.savePadPlace = function() {
        var self = this;
        var pad = window.atexPad || null;
        if (!pad || typeof pad.setObject !== 'function' || !this.place) return;
        pad.setObject('place', { id: this.place.id, label: this.place.label }).then(function(res) {
            if (res && res.saved) self.notify('Планшет настроен на упаковочное место ' + self.place.label, 'success');
        }).catch(function(err) {
            self.notify('Планшет не настроен: ' + (err && err.message ? err.message : err), 'error');
        });
    };
    // Нужен ли поход в таблицу «Упаковочное место»: место из localStorage избавляет от запроса.
    AtexPacker.prototype.needsPlacePick = function() {
        return !(this.place && this.place.id);
    };
    AtexPacker.prototype.storeShowPacked = function() {
        try { if (window.localStorage) window.localStorage.setItem(STORE_SHOW_PACKED, this.showPacked ? '1' : '0'); } catch (e) {}
    };
    AtexPacker.prototype.restoreShowPacked = function() {
        try {
            var v = window.localStorage && window.localStorage.getItem(STORE_SHOW_PACKED);
            if (v != null) this.showPacked = v === '1';
        } catch (e) {}
    };

    // ── Рендеринг ──

    AtexPacker.prototype.render = function() {
        this.renderHead();
        this.renderList();
    };

    AtexPacker.prototype.renderHead = function() {
        var self = this;
        var box = this.headEl;
        if (!box) return;
        box.innerHTML = '';
        box.appendChild(el('div', { class: 'atex-pk-title', text: 'Упаковка' }));

        var tools = el('div', { class: 'atex-pk-tools' });
        var refresh = el('button', { class: 'atex-pk-btn', type: 'button', text: 'Обновить' });
        refresh.addEventListener('click', function() { self.refresh(); });
        tools.appendChild(refresh);

        // Упаковочное место — в правом верхнем углу, кликом меняется.
        var place = el('button', { class: 'atex-pk-place', type: 'button' }, [
            el('span', { class: 'atex-pk-place-label', text: 'Упаковочное место' }),
            el('span', { class: 'atex-pk-place-value', text: (this.place && this.place.label) || '—' })
        ]);
        place.addEventListener('click', function() { self.pickPlace(); });
        tools.appendChild(place);
        box.appendChild(tools);
    };

    AtexPacker.prototype.renderList = function() {
        var self = this;
        var host = this.listEl;
        if (!host) return;
        host.innerHTML = '';

        if (this.needsPlacePick()) {
            host.appendChild(el('div', { class: 'atex-pk-placeholder', text: 'Укажите упаковочное место, чтобы увидеть задания.' }));
            return;
        }
        if (!this.items.length) {
            host.appendChild(el('div', { class: 'atex-pk-empty', text: 'Заданий для упаковки нет: по ним ещё не сделана первая резка.' }));
            return;
        }

        var s = core.summarize(this.items);
        var hidden = core.packedCount(this.items);
        host.appendChild(el('div', { class: 'atex-pk-summary' }, [
            metric('Позиций', s.total),
            metric('Упаковано', s.packed + ' / ' + s.total),
            metric('Рулонов', s.rolls),
            this.showPackedToggle(hidden)
        ]));

        var shown = core.visibleItems(this.items, this.showPacked);
        if (!shown.length) {
            host.appendChild(el('div', { class: 'atex-pk-empty', text: 'Всё упаковано — включите «Показать упакованные», чтобы их увидеть.' }));
            return;
        }

        core.groupByTask(shown).forEach(function(group) {
            var block = el('div', { class: 'atex-pk-group' });
            // Заголовок задания нужен, только когда в нём несколько позиций: иначе
            // время и так стоит в самой карточке.
            if (group.items.length > 1) {
                block.appendChild(el('div', { class: 'atex-pk-group-head', text:
                    'Задание ' + (core.unixToLocalTime(group.taskUnix) || '—') +
                    ' · ' + group.items.length + ' поз.' }));
            }
            group.items.forEach(function(item) { block.appendChild(self.renderCard(item)); });
            host.appendChild(block);
        });

        function metric(label, value) {
            return el('div', { class: 'atex-pk-metric' }, [
                el('span', { class: 'atex-pk-metric-label', text: label }),
                el('span', { class: 'atex-pk-metric-value', text: String(value) })
            ]);
        }
    };

    AtexPacker.prototype.showPackedToggle = function(hidden) {
        var self = this;
        var box = el('input', { type: 'checkbox' });
        box.checked = !!this.showPacked;
        box.addEventListener('change', function() {
            self.showPacked = !!box.checked;
            self.storeShowPacked();
            self.renderList();
        });
        return el('label', { class: 'atex-pk-toggle' }, [
            box,
            el('span', { text: 'Показать упакованные' + (hidden ? ' (' + hidden + ')' : '') })
        ]);
    };

    // Карточка позиции: слева крупно номер заказа клиента (тот же, что на этикетке
    // ролика), под ним наш внутренний номер, посередине привычная подпись
    // ролика и время задания, справа количество и кнопка отметки. Количество —
    // кнопка: клик по нему открывает правку, кнопка «Упаковано» ничего не спрашивает
    // и просто фиксирует упаковку тем количеством, которое видно (#4680).
    AtexPacker.prototype.renderCard = function(item) {
        var self = this;
        var packed = core.isPacked(item);
        var card = el('div', { class: 'atex-pk-card' + (packed ? ' is-packed' : '') });

        var title = core.orderTitle(item);
        // Клиентский номер — свободный текст: длинный набирается мельче, чтобы
        // уместиться в колонку целиком, а не рваться посередине.
        var mainClass = 'atex-pk-order-main' +
            (title.main.length > 12 ? ' is-tiny' : (title.main.length > 6 ? ' is-long' : ''));
        var order = el('div', { class: 'atex-pk-order' }, [
            el('span', { class: mainClass, text: title.main })
        ]);
        if (title.sub) order.appendChild(el('span', { class: 'atex-pk-order-sub', text: title.sub }));
        card.appendChild(order);

        var edited = core.isEdited(item);
        var meta = ['задание ' + (core.unixToLocalTime(item.taskUnix) || '—')];
        if (item.planQty) meta.push('план ' + item.planQty);
        if (item.factQty) meta.push('факт ' + item.factQty);
        var note = item.editedNote || item.notes;
        if (note) meta.push(note);
        var body = [
            el('div', { class: 'atex-pk-desc', text: core.describeItem(item) || '—' }),
            el('div', { class: 'atex-pk-meta', text: meta.join(' · ') })
        ];
        // #4665: в какой короб и по сколько штук — из справочника «Типоразмер».
        var size = core.sizeForItem(item, this.sizes);
        var packLabel = core.packingLabel(size, packed ? item.packedQty : core.packQtyFor(item));
        if (packLabel) {
            body.push(el('div', { class: 'atex-pk-pack', title: size.name, text: packLabel }));
        }
        card.appendChild(el('div', { class: 'atex-pk-body' }, body));

        var side = el('div', { class: 'atex-pk-side' });
        // Количество — кнопка: по клику по самому числу открывается правка (#4680).
        var qty = el('button', {
            class: 'atex-pk-qty' + (edited ? ' is-edited' : ''),
            type: 'button',
            title: 'Изменить количество'
        }, [
            el('span', { class: 'atex-pk-qty-value', text: String(core.currentQty(item)) }),
            el('span', { class: 'atex-pk-qty-unit', text: 'шт' })
        ]);
        qty.addEventListener('click', function() { self.openQtyDialog(item); });
        side.appendChild(qty);
        var btn = el('button', {
            class: 'atex-pk-btn ' + (packed ? 'atex-pk-btn-edit' : 'atex-pk-btn-pack'),
            type: 'button',
            text: packed ? 'Изменить' : 'Упаковано'
        });
        btn.addEventListener('click', function() {
            if (packed) { self.openQtyDialog(item); return; }
            self.packNow(item);
        });
        side.appendChild(btn);
        if (packed) side.appendChild(el('span', { class: 'atex-pk-badge', text: 'упаковано' }));
        card.appendChild(side);
        return card;
    };

    // ── Диалоги ──

    // Выбор упаковочного места: справочник читается здесь, а не при загрузке —
    // пока место лежит в localStorage, запрос к таблице не делается вовсе.
    AtexPacker.prototype.pickPlace = function() {
        var self = this;
        if (this.busy) return;
        this.setBusy(true);
        this.loadPlaces().then(function() {
            self.setBusy(false);
            self.showPlaceDialog();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Не удалось прочитать упаковочные места: ' + err.message, 'error');
        });
    };

    AtexPacker.prototype.showPlaceDialog = function() {
        var self = this;
        var list = el('div', { class: 'atex-pk-place-list' });
        (this.places || []).forEach(function(place) {
            var btn = el('button', {
                class: 'atex-pk-place-option' + (self.place && String(self.place.id) === place.id ? ' is-current' : ''),
                type: 'button', text: place.label
            });
            btn.addEventListener('click', function() {
                self.place = { id: place.id, label: place.label };
                self.storePlace();
                self.savePadPlace();   // #4789: и настраиваем сам планшет
                close();
                self.renderHead();
                self.refresh();
            });
            list.appendChild(btn);
        });
        if (!this.places.length) list.appendChild(el('div', { class: 'atex-pk-empty', text: 'Справочник упаковочных мест пуст.' }));

        var overlay = this.modal('Упаковочное место', [list], []);
        function close() { overlay.close(); }
    };

    // Правка количества — по клику на само количество в карточке (#4680). Подставляется
    // то, что в карточке и стоит; поправил — обязательно примечание. У НЕупакованной
    // позиции правка только запоминается: в базу её унесёт кнопка «Упаковано». У
    // упакованной писать некуда откладывать — отметка уже есть, правка уходит сразу.
    AtexPacker.prototype.openQtyDialog = function(item) {
        var self = this;
        if (this.busy) return;
        if (!item.gpId) {
            this.notify('В отчёте нет gp_id — отметить упаковку нечему', 'error');
            return;
        }
        var packed = core.isPacked(item);
        var suggested = core.baseQty(item);
        var qtyInput = el('input', { class: 'atex-pk-input', type: 'number', min: '0', step: '1', inputmode: 'numeric', value: String(core.currentQty(item)) });
        var noteInput = el('input', { class: 'atex-pk-input', type: 'text', value: item.editedNote || item.notes || '', placeholder: 'например: 10 шт в брак' });
        var hint = el('div', { class: 'atex-pk-hint' });
        var error = el('div', { class: 'atex-pk-error' });

        function syncHint() {
            var changed = core.noteRequired(qtyInput.value, suggested);
            hint.textContent = changed ? 'Количество изменено — примечание обязательно' : '';
            noteInput.classList.toggle('is-required', changed);
        }
        qtyInput.addEventListener('input', function() { error.textContent = ''; syncHint(); });
        noteInput.addEventListener('input', function() { error.textContent = ''; });
        syncHint();

        var save = el('button', { class: 'atex-pk-btn atex-pk-btn-pack', type: 'button', text: 'Сохранить' });
        var cancel = el('button', { class: 'atex-pk-btn', type: 'button', text: 'Отмена' });

        // В заголовке — тот же номер, что крупно стоит в карточке и на этикетке (#4688).
        var overlay = this.modal('Количество · заказ ' + core.orderTitle(item).main, [
            el('div', { class: 'atex-pk-modal-desc', text: core.describeItem(item) }),
            el('label', { class: 'atex-pk-field' }, [el('span', { text: packed ? 'Упаковано, шт' : 'Количество, шт' }), qtyInput]),
            el('label', { class: 'atex-pk-field' }, [el('span', { text: 'Примечание' }), noteInput]),
            hint, error
        ], [cancel, save]);

        cancel.addEventListener('click', function() { overlay.close(); });
        save.addEventListener('click', function() {
            var form = { qty: qtyInput.value, suggested: suggested, note: noteInput.value };
            var problem = core.validatePack(form);
            error.textContent = problem;
            // Пока висит ошибка, подсказку убираем — иначе одно и то же сказано дважды.
            if (problem) { hint.textContent = ''; return; }
            overlay.close();
            var qty = core.toNumber(form.qty);
            var note = str(form.note).trim();
            if (packed) { self.markPacked(item, qty, note); return; }
            item.editedQty = qty;
            item.editedNote = note;
            self.renderList();
        });
    };

    // Общая модалка (alert/confirm/prompt запрещены — раздел 8 гайда).
    AtexPacker.prototype.modal = function(title, body, actions) {
        var overlay = el('div', { class: 'atex-pk-modal-overlay' });
        function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
        overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
        var box = el('div', { class: 'atex-pk-modal' }, [el('div', { class: 'atex-pk-modal-title', text: title })]);
        (body || []).forEach(function(node) { box.appendChild(node); });
        if ((actions || []).length) {
            var row = el('div', { class: 'atex-pk-modal-actions' });
            actions.forEach(function(node) { row.appendChild(node); });
            box.appendChild(row);
        }
        overlay.appendChild(box);
        (this.root || document.body).appendChild(overlay);
        overlay.close = close;
        return overlay;
    };

    // ── Запись отметки ──

    // Кнопка «Упаковано»: ничего не спрашивает — фиксирует упаковку тем количеством,
    // которое стоит в карточке (#4680). Количество берётся только оттуда, поэтому
    // упаковщик пишет ровно то, что видит.
    AtexPacker.prototype.packNow = function(item) {
        var qty = core.currentQty(item);
        if (!(qty > 0)) {
            // Отчёт не дал ни плана, ни факта — сказать нечего, зовём правку количества.
            this.notify('Количество неизвестно — укажите его', 'error');
            this.openQtyDialog(item);
            return;
        }
        this.markPacked(item, qty, str(item.editedNote).trim());
    };

    // Пишем состояние в Партию ГП («Упаковано шт» + «Примечание») и событие смены
    // «Упаковка». Локальную модель обновляем записанными значениями и не перечитываем
    // отчёт: сразу после записи он может отдать ещё старое значение (read-after-write).
    AtexPacker.prototype.markPacked = function(item, qty, note) {
        var self = this;
        if (this.busy) return;
        this.setBusy(true);
        var gpFields = core.gpPackFields(this.meta.gp, { qty: qty, note: note });
        this.post('_m_set/' + item.gpId + '?JSON', gpFields).then(function() {
            return self.post('_m_new/' + self.meta.event.id + '?JSON&up=1', core.eventFields(self.meta.event, {
                when: core.eventStamp(new Date()),
                taskId: item.taskId,
                userId: self.userId,
                qty: qty,
                note: note
            }));
        }).then(function() {
            item.packedQty = qty;
            if (note) item.notes = note;
            // Правка доехала до базы — дальше карточка живёт записанным значением.
            item.editedQty = null;
            item.editedNote = '';
            self.setBusy(false);
            self.notify('Упаковано: ' + qty + ' шт', 'success');
            self.renderList();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка сохранения: ' + err.message, 'error');
        });
    };

    // ── Служебное ──

    AtexPacker.prototype.refresh = function() {
        var self = this;
        this.setBusy(true);
        return this.loadItems().then(function() {
            self.setBusy(false);
            self.render();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка загрузки заданий: ' + err.message, 'error');
            self.items = [];
            self.render();
        });
    };

    AtexPacker.prototype.setBusy = function(on) {
        this.busy = on;
        if (this.root) this.root.classList.toggle('is-busy', !!on);
    };

    AtexPacker.prototype.notify = function(message, kind) {
        if (kind === 'error' && typeof window !== 'undefined' && window.mainAppController &&
            typeof window.mainAppController.showErrorModal === 'function') {
            window.mainAppController.showErrorModal(message);
            return;
        }
        var toast = el('div', { class: 'atex-pk-toast atex-pk-toast-' + (kind || 'info'), text: message });
        (this.root || document.body).appendChild(toast);
        setTimeout(function() { toast.classList.add('is-visible'); }, 10);
        setTimeout(function() {
            toast.classList.remove('is-visible');
            setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
        }, 3500);
    };

    AtexPacker.prototype.fatal = function(message) {
        this.root.innerHTML = '';
        this.root.appendChild(el('div', { class: 'atex-pk-fatal', text: message }));
    };

    AtexPacker.prototype.start = function() {
        var self = this;
        this.root.innerHTML = '';
        var layout = el('div', { class: 'atex-pk-layout' });
        this.headEl = el('header', { class: 'atex-pk-head' });
        this.listEl = el('section', { class: 'atex-pk-main' });
        layout.appendChild(this.headEl);
        layout.appendChild(this.listEl);
        this.root.appendChild(layout);

        this.listEl.appendChild(el('div', { class: 'atex-pk-placeholder', text: 'Загрузка данных…' }));
        this.restorePlace();
        this.restoreShowPacked();

        return this.loadMetadata()
            .then(function() { return self.loadSizes(); })
            .then(function() {
                // Без упаковочного места список всё равно не показываем, а отчёт без него
                // отдал бы чужие позиции — он фильтруется по месту (#4681).
                if (self.needsPlacePick()) return null;
                return self.loadItems();
            })
            .then(function() {
                self.render();
                // Место ещё не выбрано — спрашиваем сразу, до работы со списком.
                if (self.needsPlacePick()) self.pickPlace();
            })
            .catch(function(err) { self.fatal('Ошибка инициализации: ' + err.message); });
    };

    function init() {
        if (typeof document === 'undefined') return;
        var root = document.getElementById('atex-packer');
        if (!root || root.dataset.initialized === '1') return;
        root.dataset.initialized = '1';
        var controller = new AtexPacker(root);
        root._atexPacker = controller;
        controller.start();
    }

    return { core: core, Controller: AtexPacker, init: init };
});
