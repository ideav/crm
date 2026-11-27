/* KPI: «Выгрузка в ЗУП» - один файл на период с контрольной суммой, только согласованные суммы; сводка в мессенджер. */
(function () {
    'use strict';
    var K = window.Kpi, C = K.core;
    var st = { period: K.CUR };
    K.mount(function (host, M) {
        var pname = st.period, p = K.period(M, pname), b = M.byPeriod[pname];
        var calc = C.calcPeriod(K.calcCtx(M, pname));
        var ok = calc.rows.filter(function (r) { var x = b.prem[r.emp.name]; return x && x.status === 'Согласовано'; });
        var wait = calc.rows.filter(function (r) { return ok.indexOf(r) < 0; });
        /* в ЗУП уходит согласованная сумма из записи «Премия» */
        var outRows = ok.map(function (r) { return { emp: r.emp, total: b.prem[r.emp.name].total || r.total }; });
        var code = M.params['Вид начисления ЗУП'] || 'Премия по KPI';
        var z = C.zupCsv(outRows, p.start.slice(5, 7) + '.' + p.start.slice(0, 4), code);
        host.appendChild(K.el('div', {}, K.head('Выгрузка в ЗУП', 'Файл загрузки в 1С:ЗУП (документ «Премия» / «Данные для расчёта зарплаты»): строка на сотрудника, вид начисления «' + code + '», контрольная сумма. Уходят только согласованные суммы; несогласованные перечислены ниже.')));
        host.appendChild(K.el('div', { 'class': 'kpi-bar' }, [K.periodPicker(M, pname, function (v) { st.period = v; host.innerHTML = ''; K.render(host, M); }, function (x) { return x.status !== 'Идёт период'; })]));
        var prevFot = null, pp = K.prevPeriod(M, pname);
        if (pp) prevFot = Object.keys(M.byPeriod[pp.name].prem).reduce(function (s, k) { return s + M.byPeriod[pp.name].prem[k].total; }, 0);
        host.appendChild(K.el('div', { 'class': 'kpi-tiles' }, [K.tile('К выгрузке', z.count + ' строк', 'контрольная сумма ' + C.rub(z.sum)), K.tile('Не согласовано', String(wait.length), wait.length ? 'срок ' + C.toDmy(p.deadline) : 'все согласованы', wait.length ? 'bad' : 'good'), K.tile('Статус периода', K.esc(p.status), '')]));
        var acts = [];
        if (K.canWrite('Выгрузка ЗУП')) acts.push(K.btn('Скачать файл для ЗУП (' + z.count + ' строк)', function () {
            if (!z.count) return K.toast('Нет согласованных сумм', true);
            K.download('zup-premiya-' + p.start.slice(0, 7) + '.csv', z.text);
            var n = M.exports.filter(function (x) { return x.period === pname; }).length + 1;
            K.create('Выгрузка ЗУП', { 'Выгрузка ЗУП': 'ЗУП-' + p.start.slice(0, 7) + (n > 1 ? '-' + n : ''), 'Период премии': pname, 'Когда записи': K.now(), 'Автор записи': K.ctx.user, 'Строк выгрузки': z.count, 'Сумма выгрузки': z.sum, 'Вид начисления': code })
                .then(function () { return wait.length ? null : K.update(p.id, { 'Статус периода': 'Выгружен в ЗУП' }); })
                .then(function () { return K.log(pname + ' выгружен в ЗУП: ' + z.count + ' строк, ' + C.rub(z.sum) + (wait.length ? ' (не согласовано ' + wait.length + ' чел., выгрузятся вторым файлом)' : ''), { period: pname }); })
                .then(function () { K.toast('Файл сформирован, выгрузка записана в журнал'); K.reload(); }).catch(function (e) { K.toast(e.message, true); });
        }, 'kpi-primary'));
        var sum = C.summaryText(pname, calc, prevFot);
        acts.push(K.btn('Сводка в мессенджер', function () {
            var pre = K.el('pre', { 'class': 'kpi-pre', text: sum });
            K.modal('Сводка: ' + (M.params['Канал сводки'] || 'мессенджер'), pre, [{ text: 'Закрыть' }, { text: 'Скопировать', cls: 'kpi-primary', fn: function () { try { navigator.clipboard.writeText(sum); K.toast('Скопировано'); } catch (e) { K.toast('Выделите текст и скопируйте', true); } return false; } }]);
        }));
        host.appendChild(K.el('div', { 'class': 'kpi-bar' }, acts));
        host.appendChild(K.el('h2', { text: 'Файл: предпросмотр' }));
        var lines = z.text.split(String.fromCharCode(13, 10)).map(function (l) { return l.split(';'); });
        host.appendChild(K.table(lines[0].map(function (h, i) { return { t: h, num: i === 5, html: function (r) { return K.esc(r[i]); } }; }), lines.slice(1), { rowCls: function (r) { return r[0] === 'ИТОГО' ? 'kpi-row-warn' : ''; } }));
        if (wait.length) {
            host.appendChild(K.el('h2', { text: 'Не согласованы - в файл не попали' }));
            host.appendChild(K.table([{ t: 'Сотрудник', html: function (r) { return K.esc(r.emp.name); } }, { t: 'Подразделение', html: function (r) { return K.esc(r.emp.dept); } }, { t: 'Расчёт', num: true, html: function (r) { return C.rub(r.total); } }, { t: 'Статус', html: function (r) { var x = b.prem[r.emp.name]; return K.badge(x ? x.status : 'нет записи', 'warn'); } }], wait));
        }
        host.appendChild(K.el('h2', { text: 'История выгрузок' }));
        host.appendChild(K.table([{ t: 'Выгрузка', k: 'code' }, { t: 'Период', k: 'period' }, { t: 'Когда', k: 'when' }, { t: 'Кто', k: 'who' }, { t: 'Строк', num: true, k: 'count' }, { t: 'Сумма', num: true, html: function (x) { return C.rub(x.sum); } }], M.exports));
    });
})();
