/* PSA: Настройки демо. Опции, которые администратор переключает на экране: единица планирования, пороги перегрузки, маршрут согласования, видимость. */
(function () {
    'use strict';
    var P = window.Psa, C = P.core;
    var LINKS = { unit: ['load', 'Загрузка'], limit: ['booking', 'Бронирование'], overbook: ['booking', 'Бронирование'], overbookWeeks: ['booking', 'Бронирование'], hardBan: ['booking', 'Бронирование'], route: ['booking', 'Бронирование'], pmScope: ['projects', 'Проекты'], finView: ['projects', 'Проекты и маржа'] };

    function save(host, M, d, value, label) {
        var row = M.settingRows[d.code], p = row ? P.update(row._id, { 'Значение настройки': String(value) }) : P.create('Настройка демо', { 'Настройка демо': d.code, 'Название настройки': d.title, 'Группа настройки': d.group, 'Тип настройки': d.type, 'Значение настройки': String(value) });
        return p.then(function () { P.toast('Сохранено: ' + d.title + ' - ' + label); apply(host, M, d, value); }).catch(function (er) { P.toast(er.message, true); });
    }
    /* Новое значение применяется к уже загруженной модели: чтение сразу после записи может вернуть прежнюю строку. */
    function apply(host, M, d, value) {
        var row = M.settingRows[d.code] || (M.settingRows[d.code] = {}); row['Значение настройки'] = String(value);
        var sv = {}; Object.keys(M.settingRows).forEach(function (k) { sv[k] = M.settingRows[k]['Значение настройки']; });
        M.settings = C.parseSettings(sv); M.rules = C.applySettings(M.rules, M.settings);
        var y = window.pageYOffset; render(host, M); window.scrollTo(0, y);
    }

    function control(host, M, d, can) {
        var cur = M.settings[d.code];
        if (d.type === 'choice') {
            var curCode = d.code === 'hardBan' ? (cur ? 'yes' : 'no') : cur;
            return P.el('div', { 'class': 'psa-opt-choice', role: 'radiogroup', 'aria-label': d.title }, d.options.map(function (o) {
                var id = 'psa-o-' + d.code + '-' + o[0];
                var inp = P.el('input', { type: 'radio', name: 'psa-o-' + d.code, id: id, value: o[0], checked: o[0] === curCode ? 'checked' : false, disabled: can ? false : 'disabled' });
                inp.addEventListener('change', function () { if (inp.checked) save(host, M, d, o[0], o[1]); });
                return P.el('label', { 'class': 'psa-opt-radio' + (o[0] === curCode ? ' psa-opt-on' : ''), 'for': id }, [inp, o[1]]);
            }));
        }
        var inp2 = P.input('number', cur, { min: d.min, max: d.max, step: 1, style: 'width:90px', disabled: can ? false : 'disabled', 'aria-label': d.title });
        var btn = P.btn('Применить', function () {
            var v = parseFloat(inp2.value);
            if (isNaN(v) || v < d.min || v > d.max) { P.toast('Допустимо от ' + d.min + ' до ' + d.max, true); return; }
            save(host, M, d, v, String(v));
        });
        if (!can) btn.style.display = 'none';
        return P.el('div', { 'class': 'psa-opt-num' }, [inp2, btn, P.el('span', { 'class': 'psa-muted', text: ' допустимо ' + d.min + '-' + d.max })]);
    }

    function render(host, M) {
        host.innerHTML = '';
        var can = P.canWrite('Настройка демо');
        P.head('Настройки демо', 'У каждой компании своё «нормально». Здесь выбирают, как должна работать ваша организация, и экраны сразу ведут себя по-новому: у вас так - переключили - работает так.').forEach(function (n) { host.appendChild(n); });
        host.appendChild(P.el('div', { 'class': 'psa-warnbox ' + (can ? 'psa-g' : 'psa-w'), text: can ? 'Вы можете менять настройки: изменения действуют для всех ролей сразу.' : 'Настройки видны всем, менять их может директор. Войдите директором, чтобы переключить.' }));
        var groups = [];
        C.SETTING_DEFS.forEach(function (d) { if (groups.indexOf(d.group) < 0) groups.push(d.group); });
        groups.forEach(function (g) {
            var card = P.el('div', { 'class': 'psa-card psa-opt-group' }, [P.el('h3', { text: g })]);
            C.SETTING_DEFS.filter(function (d) { return d.group === g; }).forEach(function (d) {
                var lk = LINKS[d.code];
                var extra = [];
                if (d.code === 'finView' && M.settings.finView === 'leaders') extra.push(P.el('div', { 'class': 'psa-warnbox psa-w', text: 'Чтобы руководители пулов и проектов реально видели ставки, роли должны получить права на поля «Себестоимость часа», «Выручка по договору» и таблицу «Ставка продажи» (скрипт scripts/psa-finance-grants.js, выполняет администратор базы).' }));
                if (d.code === 'pmScope' && M.settings.pmScope === 'own') extra.push(P.el('div', { 'class': 'psa-muted', text: 'Фильтр действует на экранах демо: чужие проекты, брони и запросы не показываются, чужие брони в загрузке названы «Другой проект». Строгая маска на уровне ядра включается отдельно грантом роли.' }));
                card.appendChild(P.el('div', { 'class': 'psa-opt' }, [
                    P.el('div', { 'class': 'psa-opt-title', text: d.title }),
                    P.el('div', { 'class': 'psa-muted', text: d.hint }),
                    control(host, M, d, can),
                    P.el('div', { 'class': 'psa-opt-when' }, [P.el('b', { text: 'Когда выбирают: ' }), d.when]),
                    extra.length ? P.el('div', {}, extra) : null,
                    lk ? P.el('a', { 'class': 'psa-av', href: P.nav(lk[0]), text: 'Посмотреть на экране «' + lk[1] + '»' }) : null
                ]));
            });
            host.appendChild(card);
        });
        if (can) host.appendChild(P.el('div', { 'class': 'psa-bar' }, [P.btn('Вернуть значения по умолчанию', function () {
            var ps = C.SETTING_DEFS.map(function (d) { var v = d.def, row = M.settingRows[d.code]; return row && row['Значение настройки'] !== String(v) ? P.update(row._id, { 'Значение настройки': String(v) }) : null; }).filter(Boolean);
            Promise.all(ps).then(function () { P.toast('Значения по умолчанию возвращены'); C.SETTING_DEFS.forEach(function (d) { apply(host, M, d, d.def); }); }).catch(function (er) { P.toast(er.message, true); });
        })]));
    }
    P.mount(render);
})();
