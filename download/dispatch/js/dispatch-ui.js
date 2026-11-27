/* Диспетчеризация: общие компоненты экранов (бейджи, реакция и маршрут тревоги, карточка тревоги, акт, имитация регистратора). */
(function () {
    'use strict';
    var P = window.Dsp, C = P.core;
    P.CLS_KIND = { 'Тревога': 'crit', 'Предупреждение': 'warn', 'Открытая дверь': 'info', 'Норма': 'ok' };
    P.ST_KIND = { 'Новая': 'crit', 'Принята': 'warn', 'Закрыта': 'mute' };
    P.REP_KIND = { 'Новая': 'crit', 'Передана в сервис': 'warn', 'Выполнена': 'ok' };
    P.ACT_KIND = { 'Черновик': 'warn', 'Утверждён': 'ok' };
    P.DEC_KIND = { 'Годна': 'ok', 'Карантин до оценки производителя': 'warn', 'Списание': 'crit' };
    P.OBJ_CLS = { 'Норма': 'work', 'Открытая дверь': 'work', 'Предупреждение': 'idle', 'Тревога': 'crash' };
    P.short = function (fio) { var p = String(fio || '').split(' '); return p.length >= 3 && !/[«"]/.test(fio) ? p[0] + ' ' + p[1][0] + '. ' + p[2][0] + '.' : (fio || ''); };
    P.when = function (a) { return (a.date === P.TODAY ? '' : C.toShort(a.date) + ' ') + a.time; };
    P.deg = function (v) { return v === '' || v === undefined || v === null ? '' : P.val(v) + ' °C'; };
    P.modeText = function (m) { if (!m) return ''; return (m.min <= -40 ? 'не выше ' + P.deg(m.max) : P.deg(m.min) + '…' + P.deg(m.max)) + ', дверь до ' + m.door + ' мин, тревога через ' + m.delay + ' мин'; };
    /* Реакция: открытая - кто сейчас отвечает и сколько осталось; принятая - за сколько приняли. */
    P.reactHtml = function (M, a) {
        var e = M.esc(a);
        if (e.took !== null) return '<span class="dsp-timer dsp-t-' + (e.state === 'late' ? 'late' : 'ok') + '">' + (e.state === 'late' ? 'принята поздно, ' : 'принята за ') + C.durText(e.took) + '</span>';
        if (e.noOne) return '<span class="dsp-t-overdue">нет ответственного</span>';
        var t = e.state === 'overdue' ? '<span class="dsp-timer dsp-t-overdue">просрочено ' + C.durText(-e.left) + '</span>' : '<span class="dsp-timer dsp-t-' + e.state + '">осталось ' + C.durText(e.left) + '</span>';
        return t + (e.level > 0 ? '<span class="dsp-esc">эскалация ' + e.level + ': ' + P.esc(P.short(e.who)) + '</span>' : '');
    };
    P.rowCls = function (M, a) { if (!C.isOpen(a) || a.acceptTime) return ''; var s = M.esc(a).state; return s === 'overdue' ? 'dsp-row-bad' : s === 'soon' ? 'dsp-row-warn' : ''; };
    P.alarmCols = function (M, extra) {
        return [
            { t: 'Тревога', html: function (a) { return '<b>' + P.esc(a.code) + '</b><br>' + P.badge(a.cls, P.CLS_KIND[a.cls]); } },
            { t: 'Начало', html: function (a) { return P.esc(P.when(a)); } },
            { t: 'Объект и зона', html: function (a) { var z = M.zoneBy[a.zone] || {}; return '<b>' + P.esc(a.obj) + '</b><br><span class="dsp-muted">' + P.esc(a.zone + ' ' + (z.title || '')) + '</span>'; } },
            { t: 'Пик', num: true, html: function (a) { return P.esc(P.deg(a.peak)) + '<br><span class="dsp-muted">' + a.minutes + ' мин</span>'; } },
            { t: 'Ответственный', html: function (a) { var e = M.esc(a); return P.esc(P.short(a.acceptTime ? a.resp : e.who)); } },
            { t: 'Реакция', html: function (a) { return P.reactHtml(M, a); } },
            { t: 'Статус', html: function (a) { return P.badge(a.status, P.ST_KIND[a.status]) + (a.moved ? '<br><span class="dsp-muted">товар перенесён</span>' : ''); } }
        ].concat(extra || []);
    };
    function kv(k, v) { return P.el('div', { 'class': 'dsp-kv' }, [P.el('span', { text: k }), P.el('span', { html: v })]); }
    function fail(er) { P.toast(er.message || String(er), true); }
    /* После записи экран сразу показывает изменение (patch), затем модель перечитывается из базы. */
    function done(msg, close, patch) { P.toast(msg); if (close) close(); if (patch) { patch(); if (P.rerender && P.cur) P.rerender(P.cur); } P.refresh(); }
    /* Цепочка маршрута: кто уже пропустил, у кого сейчас, кто принял. */
    P.chainHtml = function (M, a) {
        var ch = M.chainOf(a), e = M.esc(a);
        if (!ch.length) return '<span class="dsp-t-overdue">в графике дежурств никого нет</span>';
        return '<div class="dsp-chain">' + ch.map(function (c, k) {
            var cls = e.took !== null ? (c.who === a.resp ? 'dsp-acc' : k < e.level ? 'dsp-past' : '') : (k < e.level ? 'dsp-past' : k === e.level ? 'dsp-now' : '');
            return '<span class="' + cls + '" title="' + P.esc(c.role) + '">' + P.esc(P.short(c.who)) + ' <small>' + P.esc(c.role) + '</small></span>';
        }).join('<span class="dsp-muted">→</span>') + '</div>';
    };
    /* Акт из тревоги: шапка и партии, лежавшие в зоне в момент отклонения. */
    P.makeAct = function (M, a) {
        var codes = (M.acts || []).map(function (x) { return x.code; }), code = C.nextCode(codes, 'АО-', 3);
        var bs = C.batchesAt(M.batches, a.zone, a.date, a.time);
        return P.create('Акт отклонения', { 'Акт отклонения': code, 'Тревога': a.code, 'Объект мониторинга': a.obj, 'Дата акта': P.TODAY, 'Статус акта': 'Черновик' }).then(function (j) {
            var id = P.newId(j);
            return bs.reduce(function (p, b) { return p.then(function () { return P.create('Партия в акте', { 'Партия в акте': b.name, 'Партия': b.name }, id); }); }, Promise.resolve()).then(function () { return code; });
        });
    };
    P.makeRepair = function (M, a, text) {
        var code = C.nextCode((M.repairs || []).map(function (x) { return x.code; }), 'ЗР-', 3);
        return P.create('Заявка на ремонт', { 'Заявка на ремонт': code, 'Тревога': a.code, 'Объект мониторинга': a.obj, 'Зона': a.zone, 'Дата заявки': P.TODAY, 'Описание неисправности': text, 'Сервисная организация': 'ООО «ХолодСервис-Владимир»', 'Статус заявки': 'Передана в сервис' }).then(function () { return code; });
    };
    /* Карточка тревоги: маршрут и эскалация, шаги «что делать», партии в зоне, кнопки принять / товар перенесён / заявка / акт / закрыть. */
    P.alarmCard = function (M, a) {
        var mode = M.modeOfZone(a.zone) || {}, z = M.zoneBy[a.zone] || {}, o = M.objBy[a.obj] || {}, e = M.esc(a);
        var act = M.actByAlarm[a.code], rep = M.repairByAlarm[a.code], can = P.canWrite('Тревога') && C.isOpen(a);
        var bs = C.batchesAt(M.batches, a.zone, a.date, a.time);
        var doneTa = P.el('textarea', { rows: 2, placeholder: 'Что сделано' }); doneTa.value = a.done || ''; doneTa.disabled = !can;
        var errBox = P.el('div', {});
        var info = P.el('div', {}, [
            kv('Объект', '<b>' + P.esc(a.obj) + '</b> <span class="dsp-muted">' + P.esc(o.address || '') + '</span>'),
            kv('Зона и датчик', P.esc(a.zone + ' ' + (z.title || '') + ', ' + a.sensor)),
            kv('Режим', P.esc(mode.name || '') + ' <span class="dsp-muted">' + P.esc(P.modeText(mode)) + '</span>'),
            kv('Сработала', P.esc(C.toDmy(a.date) + ' ' + a.time) + ', пик ' + P.esc(P.deg(a.peak)) + ', вне диапазона ' + a.minutes + ' мин'),
            kv('Срок реакции', (mode.react || 15) + ' мин, до ' + C.fromStamp(e.deadline).time + ', эскалация каждые ' + (mode.escalate || 15) + ' мин'),
            kv('Реакция', P.reactHtml(M, a)),
            P.el('div', { style: 'margin:6px 0', html: '<span class="dsp-muted">Маршрут по графику дежурств:</span>' + P.chainHtml(M, a) }),
            kv('Заявка в сервис', rep ? '<a href="' + P.nav('repairs', 'code=' + encodeURIComponent(rep.code)) + '">' + P.esc(rep.code) + '</a> ' + P.badge(rep.status, P.REP_KIND[rep.status]) : '<span class="dsp-muted">нет</span>'),
            kv('Акт отклонения', act ? '<a href="' + P.nav('acts', 'code=' + encodeURIComponent(act.code)) + '">' + P.esc(act.code) + '</a> ' + P.badge(act.status, P.ACT_KIND[act.status]) : (a.cls === 'Тревога' ? '<span class="dsp-t-overdue">не оформлен</span>' : '<span class="dsp-muted">не нужен</span>'))
        ]);
        var steps = String(mode.steps || '').split(/\n/).filter(Boolean);
        var body = P.el('div', {}, [info,
            steps.length ? P.el('div', { 'class': 'dsp-hint' }, [P.el('b', { text: 'Что делать' }), P.el('ul', { 'class': 'dsp-steps' }, steps.map(function (s) { return P.el('li', { text: s }); }))]) : null,
            P.el('div', { html: '<span class="dsp-muted">Партии в зоне на ' + P.esc(a.time) + ':</span> ' + (bs.length ? bs.map(function (b) { return '<span class="dsp-chip" title="' + P.esc(b.maker) + '">' + P.esc(b.name + ' ' + b.drug) + '</span>'; }).join('') : 'нет') }),
            P.field('Что сделано', doneTa), errBox]);
        var me = M.me ? M.me.name : e.who;
        var btns = [{ text: 'Закрыть окно' }];
        if (can && !a.acceptTime) btns.push({ text: 'Принять', cls: 'dsp-primary', fn: function (close) { P.update(a.id, { 'Время принятия': P.CLOCK, 'Статус тревоги': 'Принята', 'Ответственный': me, 'Что сделано': doneTa.value }).then(function () { done('Тревога ' + a.code + ' принята: ' + P.short(me) + ', ' + P.CLOCK, close, function () { a.acceptTime = P.CLOCK; a.status = 'Принята'; a.resp = me; a.done = doneTa.value; }); }, fail); return false; } });
        if (can && !a.moved && a.cls === 'Тревога') btns.push({ text: 'Товар перенесён', fn: function (close) { var txt = doneTa.value || 'Товар перенесён в резервное оборудование.'; P.update(a.id, { 'Товар перенесён': 1, 'Что сделано': txt }).then(function () { done('Отмечено: товар перенесён', close, function () { a.moved = true; a.done = txt; }); }, fail); return false; } });
        if (!rep && C.isOpen(a) && P.canWrite('Заявка на ремонт')) btns.push({ text: 'Заявка в сервис', fn: function (close) { P.makeRepair(M, a, a.zone + ' ' + (z.title || '') + ': ' + P.deg(a.peak) + ' при режиме ' + (mode.name || '') + ', тревога ' + a.code + '.').then(function (c) { done('Заявка ' + c + ' передана в сервис', close); }, fail); return false; } });
        if (!act && a.cls === 'Тревога' && P.canWrite('Акт отклонения')) btns.push({ text: 'Сформировать акт', fn: function (close) { P.makeAct(M, a).then(function (c) { close(); location.href = P.nav('acts', 'code=' + encodeURIComponent(c)); }, fail); return false; } });
        if (can) btns.push({ text: 'Закрыть тревогу', cls: 'dsp-danger', fn: function (close) {
            var errs = [];
            if (!a.acceptTime) errs.push('Сначала примите тревогу: время реакции попадёт в журнал.');
            if (!String(doneTa.value).trim()) errs.push('Опишите, что сделано.');
            if (a.cls === 'Тревога' && !act) errs.push('По тревоге нужен акт отклонения: сформируйте его, партии зоны подставятся сами.');
            errBox.innerHTML = ''; errs.forEach(function (t) { errBox.appendChild(P.el('div', { 'class': 'dsp-warnbox dsp-e', text: t })); });
            if (errs.length) return false;
            P.update(a.id, { 'Статус тревоги': 'Закрыта', 'Что сделано': doneTa.value, 'Дата закрытия': P.TODAY, 'Время закрытия': P.CLOCK }).then(function () { done('Тревога ' + a.code + ' закрыта', close, function () { a.status = 'Закрыта'; a.done = doneTa.value; a.closeDate = P.TODAY; a.closeTime = P.CLOCK; }); }, fail); return false;
        } });
        return P.modal('Тревога ' + a.code + ' · ' + a.cls, body, btns, true);
    };
    /* Имитация регистратора: так приёмник данных клиента пишет отклонение; режим зоны решает, будет ли тревога и кому она уйдёт. */
    P.gatewayDialog = function (M) {
        var sens = P.select(M.sensors.map(function (s) { return [s.name, (M.zoneBy[s.zone] || {}).obj + ' · ' + s.zone + ' (' + s.name + ')']; }), 'Т-А7-Х');
        var peak = P.input('number', '9.4', { step: '0.1' }), mins = P.input('number', '7', { min: 0, step: 1 });
        var door = P.el('input', { type: 'checkbox' }); door.checked = true;
        var out = P.el('div', {});
        function dev() { var s = M.sensorBy[sens.value], m = Math.max(0, Math.round(C.num(mins.value))), st = C.fromStamp(P.NOW - m); return { sensor: s.name, zone: s.zone, date: st.date, time: st.time, minutes: m, peak: C.num(peak.value), door: door.checked }; }
        function ctx() { return { modeOfZone: M.modeOfZone, objOfZone: M.objOfZone, duties: M.duties, head: M.head, codes: M.alarms.map(function (x) { return x.code; }) }; }
        function preview() {
            var d = dev(), res = C.processDeviation(d, ctx()); out.innerHTML = '';
            if (!res) return null;
            if (!res.alarm) { out.appendChild(P.el('div', { 'class': 'dsp-warnbox dsp-g', text: res.cls === 'Открытая дверь' ? 'Дверь открыта ' + d.minutes + ' мин при допуске ' + res.mode.door + ' мин: запись в журнал, тревоги нет.' : 'В пределах режима: тревоги нет.' })); return res; }
            out.appendChild(P.el('div', { 'class': 'dsp-warnbox ' + (res.cls === 'Тревога' ? 'dsp-e' : 'dsp-w'), text: res.cls + ' ' + res.alarm.code + ' в ' + res.alarm.time + ', маршрут: ' + (res.chain.map(function (c) { return P.short(c.who); }).join(' → ') || 'никого нет в графике').replace(/\.$/, '') + '.' }));
            return res;
        }
        [sens, peak, mins, door].forEach(function (c) { c.addEventListener('input', preview); c.addEventListener('change', preview); });
        var body = P.el('div', {}, [P.el('p', { 'class': 'dsp-sub', text: 'Так работает связка с датчиками клиента: регистратор или облако датчиков передаёт отклонение (начало, длительность, пик, дверь). Ряд показаний остаётся у источника.' }),
            P.el('div', { 'class': 'dsp-grid2' }, [P.field('Датчик', sens), P.field('Пик, °C', peak), P.field('Длительность, мин', mins), P.el('label', { 'class': 'dsp-check' }, [door, 'Дверь открыта'])]), out]);
        var m = P.modal('Имитация регистратора', body, [{ text: 'Отмена' }, { text: 'Передать отклонение', cls: 'dsp-primary', fn: function (close) {
            var d = dev(), res = preview(), codes = (M.devs || []).map(function (x) { return x.code; });
            var chain = P.create('Отклонение датчика', { 'Отклонение датчика': C.nextCode(codes, 'ОТ-', 5), 'Датчик': d.sensor, 'Дата отклонения': d.date, 'Время начала': d.time, 'Длительность, мин': d.minutes, 'Пиковое значение, °C': d.peak, 'Дверь открыта': d.door ? 1 : '' });
            if (res && res.alarm) { var x = res.alarm; chain = chain.then(function () { return P.create('Тревога', { 'Тревога': x.code, 'Объект мониторинга': x.obj, 'Зона': x.zone, 'Датчик': x.sensor, 'Класс события': x.cls, 'Дата начала': x.date, 'Время начала': x.time, 'Длительность, мин': x.minutes, 'Пиковое значение, °C': x.peak, 'Статус тревоги': 'Новая', 'Ответственный': x.resp }); }); }
            chain.then(function () { done(res && res.alarm ? res.alarm.cls + ' ' + res.alarm.code + ' создана режимом' : 'Отклонение записано, тревоги нет', close); }, fail);
            return false;
        } }], true);
        preview();
        return m;
    };
})();
