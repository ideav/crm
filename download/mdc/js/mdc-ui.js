/* MDC: общие компоненты экранов (бейджи, таймер реакции, карточка инцидента, имитация шлюза). */
(function () {
    'use strict';
    var P = window.Mdc, C = P.core;
    P.SEV_KIND = { 'Авария': 'crit', 'Предупреждение': 'warn', 'Информация': 'info' };
    P.INC_KIND = { 'Новый': 'crit', 'Принят': 'warn', 'В работе': 'info', 'Закрыт': 'mute' };
    P.REP_KIND = { 'Новая': 'crit', 'В работе': 'info', 'Ожидает запчасть': 'warn', 'Выполнена': 'ok' };
    P.EQ_CLS = { 'Работает': 'work', 'Плановый простой': 'plan', 'Простой': 'idle', 'Авария': 'crash' };
    P.short = function (fio) { var p = String(fio || '').split(' '); return p.length >= 3 ? p[0] + ' ' + p[1][0] + '. ' + p[2][0] + '.' : (fio || ''); };
    P.when = function (i) { return (i.date === P.TODAY ? '' : C.toShort(i.date) + ' ') + i.time; };
    P.ruleOf = function (M, i) { return M.ruleBy[i.rule] || { react: 15, escalate: 0, name: i.rule }; };
    /* Ячейка «реакция»: таймер для открытых, время реакции для принятых. */
    P.reactHtml = function (M, i) {
        var r = C.reaction(i, P.ruleOf(M, i), P.NOW), sec = M.secBy[i.section] || {};
        if (r.state === 'overdue') return '<span class="mdc-timer mdc-t-overdue">просрочено ' + C.durText(-r.left) + '</span>' + (r.escalated ? '<span class="mdc-esc">эскалация: мастер ' + P.esc(P.short(sec.master)) + '</span>' : '');
        if (r.state === 'soon' || r.state === 'ok') return '<span class="mdc-timer mdc-t-' + r.state + '">осталось ' + C.durText(r.left) + '</span>';
        if (r.took === null) return '<span class="mdc-muted">-</span>';
        return '<span class="mdc-timer mdc-t-' + r.state + '">' + (r.state === 'late' ? 'принят поздно, ' : 'принят за ') + C.durText(r.took) + '</span>';
    };
    P.incRowCls = function (M, i) { var r = C.reaction(i, P.ruleOf(M, i), P.NOW); return r.state === 'overdue' ? 'mdc-row-bad' : r.state === 'soon' ? 'mdc-row-warn' : ''; };
    P.incCols = function (M, extra) {
        return [
            { t: 'Инцидент', html: function (i) { return '<b>' + P.esc(i.code) + '</b><br>' + P.badge(i.severity, P.SEV_KIND[i.severity]); } },
            { t: 'Начало', k: 'when', html: function (i) { return P.esc(P.when(i)); } },
            { t: 'Оборудование', html: function (i) { var e = M.eqBy[i.eq] || {}; return '<b>' + P.esc(i.eq) + '</b> <span class="mdc-muted">' + P.esc(e.title || '') + '</span>'; } },
            { t: 'Правило', html: function (i) { var ru = M.ruleBy[i.rule] || {}; return P.esc(i.rule) + (i.peak !== '' && ru.unit && ru.unit !== 'сигнал' ? ' <span class="mdc-muted">пик ' + P.val(i.peak) + ' ' + P.esc(ru.unit) + '</span>' : ''); } },
            { t: 'Ответственный', html: function (i) { return P.esc(P.short(i.resp)); } },
            { t: 'Реакция', html: function (i) { return P.reactHtml(M, i); } },
            { t: 'Статус', html: function (i) { return P.badge(i.status, P.INC_KIND[i.status]); } },
            { t: 'Причина', html: function (i) { return i.cause ? P.esc(i.cause) : (C.isOpen(i) ? '<span class="mdc-t-overdue">нет кода причины</span>' : ''); } }
        ].concat(extra || []);
    };

    function kv(k, v) { return P.el('div', { 'class': 'mdc-kv' }, [P.el('span', { text: k }), P.el('span', { html: v })]); }
    /* После записи экран сразу показывает изменение (patch), затем модель перечитывается из базы. */
    function done(msg, m, patch) { P.toast(msg); if (m) m.close(); if (patch && P.cur) { patch(); if (P.rerender) P.rerender(P.cur); } P.refresh(); }
    var INC_KEYS = { 'Ответственный': 'resp', 'Комментарий диспетчера': 'comment', 'Причина простоя': 'cause', 'Время принятия': 'acceptTime', 'Статус инцидента': 'status', 'Дата закрытия': 'closeDate', 'Время закрытия': 'closeTime' };
    function patchInc(i, f) { return function () { Object.keys(f).forEach(function (k) { if (INC_KEYS[k]) i[INC_KEYS[k]] = f[k]; }); }; }
    function fail(er) { P.toast(er.message || String(er), true); }
    P.incFields = function (o) {
        var f = { 'Инцидент': o.code, 'Оборудование': o.eq, 'Участок': o.section, 'Правило тревоги': o.rule, 'Важность': o.severity, 'Дата начала': o.date, 'Время начала': o.time, 'Пиковое значение': o.peak, 'Статус инцидента': o.status || 'Новый' };
        if (o.resp) f['Ответственный'] = o.resp;
        return f;
    };
    P.repFields = function (p) {
        var f = { 'Заявка на ремонт': p.code, 'Инцидент': p.incident, 'Оборудование': p.eq, 'Участок': p.section, 'Важность': p.severity, 'Дата заявки': p.date, 'Статус заявки': p.status || 'Новая', 'Описание неисправности': p.text };
        if (p.worker) f['Исполнитель'] = p.worker;
        return f;
    };
    /* Карточка инцидента: принять, назначить, указать причину из справочника, закрыть, создать заявку. */
    P.incidentCard = function (M, i) {
        var ru = P.ruleOf(M, i), eq = M.eqBy[i.eq] || {}, rep = M.repairByInc[i.code], r = C.reaction(i, ru, P.NOW);
        var can = P.canWrite('Инцидент') && C.isOpen(i);
        var duty = C.onDuty(M.duties, i.section, i.date, i.time);
        var resp = P.select([['', 'не назначен']].concat(M.emps.map(function (e) { return [e.name, e.name + ' - ' + e.position]; })), i.resp || '');
        var cats = {}; M.causes.forEach(function (c) { (cats[c.cat] = cats[c.cat] || []).push(c); });
        var cause = P.el('select', {}, [P.el('option', { value: '', text: 'не указана' })].concat(Object.keys(cats).map(function (k) { return P.el('optgroup', { label: k }, cats[k].map(function (c) { return P.el('option', { value: c.name, text: c.name + (c.planned ? ' (плановый)' : '') }); })); })));
        cause.value = i.cause || '';
        var comment = P.el('textarea', { rows: 2 }); comment.value = i.comment || '';
        [resp, cause, comment].forEach(function (c) { c.disabled = !can; });
        var errBox = P.el('div', {});
        var info = P.el('div', {}, [
            kv('Оборудование', '<b>' + P.esc(i.eq) + '</b> ' + P.esc(eq.title || '') + ' <span class="mdc-muted">' + P.esc(i.section) + '</span>'),
            kv('Правило', P.esc(i.rule) + ' ' + P.badge(i.severity, P.SEV_KIND[i.severity])),
            kv('Условие', P.esc(ru.param + ' ' + ru.cond + ' ' + P.val(ru.threshold) + ' ' + (ru.unit === 'сигнал' ? '' : ru.unit || '') + (ru.minutes ? ' дольше ' + ru.minutes + ' мин' : ' сразу'))),
            kv('Сработало', P.esc(C.toDmy(i.date) + ' ' + i.time) + (i.peak !== '' && ru.unit !== 'сигнал' ? ', пик ' + P.val(i.peak) + ' ' + P.esc(ru.unit || '') : '')),
            kv('Срок реакции', ru.react + ' мин, до ' + C.fromStamp(r.deadline).time + (ru.escalate ? ', эскалация мастеру через ' + ru.escalate + ' мин' : '')),
            kv('Реакция', P.reactHtml(M, i)),
            kv('Заявка на ремонт', rep ? '<a href="' + P.nav('repairs', 'code=' + encodeURIComponent(rep.code)) + '">' + P.esc(rep.code) + '</a> ' + P.badge(rep.status, P.REP_KIND[rep.status]) : (ru.repair ? 'по правилу создаётся автоматически' : '<span class="mdc-muted">нет</span>'))
        ]);
        if (ru.text) info.appendChild(P.el('p', { 'class': 'mdc-muted', text: ru.text }));
        var body = P.el('div', {}, [info, P.el('div', { 'class': 'mdc-grid2', style: 'margin-top:12px' }, [P.field('Ответственный', resp, duty ? 'дежурный смены: ' + duty : null), P.field('Причина простоя', cause, 'только из справочника')]), P.field('Комментарий', comment), errBox]);
        function vals() { var f = { 'Ответственный': resp.value, 'Комментарий диспетчера': comment.value }; if (cause.value) f['Причина простоя'] = cause.value; return f; }
        var btns = [{ text: 'Закрыть окно' }];
        if (can && !i.acceptTime) btns.push({ text: 'Принять', cls: 'mdc-primary', fn: function (close) { var f = vals(); f['Время принятия'] = P.CLOCK; f['Статус инцидента'] = 'Принят'; P.update(i.id, f).then(function () { done('Инцидент ' + i.code + ' принят в ' + P.CLOCK, null, patchInc(i, f)); close(); }, fail); return false; } });
        if (can) btns.push({ text: 'Сохранить', fn: function (close) { var f = vals(); P.update(i.id, f).then(function () { done('Сохранено', null, patchInc(i, f)); close(); }, fail); return false; } });
        if (can) btns.push({ text: 'Закрыть инцидент', cls: 'mdc-danger', fn: function (close) {
            var errs = C.closeErrors({ cause: cause.value, acceptTime: i.acceptTime }, M.causeNames);
            errBox.innerHTML = ''; errs.forEach(function (t) { errBox.appendChild(P.el('div', { 'class': 'mdc-warnbox mdc-e', text: t })); });
            if (errs.length) return false;
            var f = vals(); f['Статус инцидента'] = 'Закрыт'; f['Дата закрытия'] = P.TODAY; f['Время закрытия'] = P.CLOCK;
            P.update(i.id, f).then(function () { done('Инцидент ' + i.code + ' закрыт', null, patchInc(i, f)); close(); }, fail); return false;
        } });
        if (!rep && C.isOpen(i) && P.canWrite('Заявка на ремонт')) btns.push({ text: 'Создать заявку', fn: function (close) {
            var p = C.buildRepair(Object.assign({}, i, { resp: resp.value || i.resp, peak: P.val(i.peak) }), Object.assign({}, ru, { repair: true }), (M.repairs || []).map(function (x) { return x.code; }));
            p.date = P.TODAY;
            P.create('Заявка на ремонт', P.repFields(p)).then(function () { done('Создана заявка ' + p.code); close(); }, fail); return false;
        } });
        return P.modal('Инцидент ' + i.code, body, btns, true);
    };

    /* Имитация шлюза: так шлюз клиента (MQTT-подписчик) пишет отклонение; правило решает, будет ли инцидент и заявка. */
    P.gatewayDialog = function (M) {
        var sens = P.select(M.sensors.map(function (s) { return [s.name, s.eq + ' · ' + s.param + ' (' + s.name + ')']; }), 'Д-ПК1-P');
        var peak = P.input('number', '1.8', { step: '0.1' }), mins = P.input('number', '3', { min: 0, step: 1 });
        var out = P.el('div', {});
        function dev() {
            var s = M.sensorBy[sens.value], m = Math.max(0, Math.round(C.num(mins.value)));
            var st = C.fromStamp(P.NOW - m);
            return { sensor: s.name, param: s.param, date: st.date, time: st.time, minutes: m, peak: C.num(peak.value) };
        }
        function ctx() {
            return { sensorBy: M.sensorBy, eqBy: M.eqBy, duties: M.duties, codes: M.incidents.map(function (x) { return x.code; }), repairCodes: (M.repairs || []).map(function (x) { return x.code; }) };
        }
        function preview() {
            var d = dev(), res = C.processDeviation(d, M.rules, ctx()); out.innerHTML = '';
            var u = M.unitBy[d.param] || '';
            out.appendChild(P.el('p', { 'class': 'mdc-muted', text: 'Шлюз передаст: ' + d.param + ' = ' + P.val(d.peak) + ' ' + u + ' с ' + d.time + ', ' + d.minutes + ' мин.' }));
            if (!res) { out.appendChild(P.el('div', { 'class': 'mdc-warnbox mdc-g', text: 'Ни одно правило не сработает: отклонение запишется в историю, тревоги не будет.' })); return null; }
            out.appendChild(P.el('div', { 'class': 'mdc-warnbox ' + (res.incident.severity === 'Авария' ? 'mdc-e' : 'mdc-w'), text: 'Сработает «' + res.rule.name + '»: инцидент ' + res.incident.code + ' (' + res.incident.severity + ') в ' + res.incident.time + ', ответственный ' + (res.incident.resp || 'не найден в графике дежурств') + ', срок реакции ' + res.rule.react + ' мин.' + (res.repair ? ' Заявка ' + res.repair.code + ' создастся сразу.' : ' Заявку правило не создаёт.') }));
            return res;
        }
        [sens, peak, mins].forEach(function (c) { c.addEventListener('input', preview); c.addEventListener('change', preview); });
        var body = P.el('div', {}, [
            P.el('p', { 'class': 'mdc-sub', text: 'Так работает связка со шлюзом клиента: шлюз агрегирует поток датчика и пишет в базу отклонение (начало, длительность, пик). Сырой ряд остаётся в историке клиента.' }),
            P.el('div', { 'class': 'mdc-grid2' }, [P.field('Датчик', sens), P.field('Пиковое значение', peak), P.field('Длительность, мин', mins)]), out]);
        var m = P.modal('Имитация шлюза', body, [{ text: 'Отмена' }, { text: 'Отправить как шлюз', cls: 'mdc-primary', fn: function (close) {
            var d = dev(), res = preview(), codes = (M.devs || []).map(function (x) { return x.code; });
            var chain = P.create('Отклонение параметра', { 'Отклонение параметра': C.nextCode(codes.length ? codes : ['ОТ-00380'], 'ОТ-', 5), 'Датчик': d.sensor, 'Дата отклонения': d.date, 'Время начала': d.time, 'Длительность, мин': d.minutes, 'Пиковое значение': d.peak });
            if (res) chain = chain.then(function () { return P.create('Инцидент', P.incFields(res.incident)); });
            if (res && res.repair) chain = chain.then(function () { return P.create('Заявка на ремонт', P.repFields(res.repair)); });
            chain.then(function () { P.toast(res ? 'Инцидент ' + res.incident.code + (res.repair ? ' и заявка ' + res.repair.code : '') + ' созданы правилом' : 'Отклонение записано, тревоги нет'); close(); P.refresh(); }, function (er) { P.toast(er.message, true); });
            return false;
        } }], true);
        preview();
        return m;
    };
})();
