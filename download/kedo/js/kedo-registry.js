/* КЭДО: реестр кадровых документов со светофором «подписано, но не в ЗУП». */
(function () {
    'use strict';
    var P = window.Kedo, C = P.core;
    var LIGHTS = {
        notzup: function (d) { return d.st.notInZup; }, overdue: function (d) { return d.st.overdue; }, refused: function (d) { return d.st.refused; },
        waiting: function (d) { return d.st.waiting && !d.st.overdue; }, done: function (d) { return d.st.inZup; }, prepared: function (d) { return d.status === C.PREPARED; }
    };
    function rank(d) { return d.st.notInZup ? 0 : d.st.overdue ? 1 : d.st.refused ? 2 : d.st.waiting ? 3 : d.status === C.PREPARED ? 4 : 5; }
    P.mount(function (host, M) {
        var h = P.hash(), st = { light: h.f || '', org: '', dept: '', type: '', q: '' };
        function draw() {
            host.innerHTML = '';
            P.head('Реестр кадровых документов', 'Каждый документ группы: где он сейчас у оператора КЭДО и доехал ли подписанный файл до 1С:ЗУП и личного дела. Сегодня ' + C.toDmy(P.TODAY) + '.').forEach(function (n) { host.appendChild(n); });
            var base = P.applyFilter(M.docs, st), L = C.lights(base, P.TODAY, M.hol, M.rules);
            var tiles = [
                ['notzup', L.signedNotZup, 'подписаны, но не доехали до ЗУП', L.zupErrors ? 'из них ' + L.zupErrors + ' с ошибкой передачи' : '', L.signedNotZup ? 'bad' : 'good'],
                ['overdue', L.overdue, 'висят дольше ' + M.rules.overdueDays + ' рабочих дней', L.escalate ? L.escalate + ' пора эскалировать (> ' + M.rules.escalateDays + ' р.д.)' : '', L.overdue ? 'warn' : 'good'],
                ['refused', L.refused, 'отказы от подписания', 'нужна причина и решение', L.refused ? 'bad' : ''],
                ['waiting', L.waiting - L.overdue, 'на подписании в срок', 'среднее время до подписи ' + String(L.signDaysAvg).replace('.', ',') + ' р.д.', ''],
                ['done', L.done, 'подписаны и в ЗУП', L.donePct + '% документов дошли до учёта', 'good']];
            host.appendChild(P.el('div', { 'class': 'kedo-kpis' }, tiles.map(function (t) {
                var k = P.kpi(t[2], String(t[1]), t[3], t[4]); k.className += ' kedo-click' + (st.light === t[0] ? ' kedo-kpi-on' : '');
                k.setAttribute('role', 'button'); k.setAttribute('tabindex', '0'); k.setAttribute('data-light', t[0]);
                k.addEventListener('click', function () { st.light = st.light === t[0] ? '' : t[0]; draw(); });
                return k;
            })));
            host.appendChild(P.filterBar(M, st, function () { drawTable(); }));
            var wrap = P.el('div', {}); host.appendChild(wrap);
            host.appendChild(P.el('div', { 'class': 'kedo-border', text: P.BORDER }));
            function drawTable() {
                wrap.innerHTML = '';
                var list = P.applyFilter(M.docs, st).filter(function (d) { return !st.light || LIGHTS[st.light](d); }).sort(function (a, b) { return rank(a) - rank(b) || (a.number < b.number ? 1 : -1); });
                var bar = P.el('div', { 'class': 'kedo-bar' }, [P.el('div', { 'class': 'kedo-grow kedo-muted', text: 'Документов: ' + list.length + (st.light ? ' · фильтр светофора, клик по плитке снимает' : '') })]);
                if (st.light === 'notzup') bar.appendChild(P.btn('Выгрузить список для ЗУП (CSV)', function () {
                    P.download('kedo-ne-v-zup.csv', C.toCsv(list.map(function (d) { return { n: d.number, t: d.zupKind, e: d.emp, tab: d.tab, s: C.toDmy(d.signed), id: d.opId, f: d.file, err: d.error || '' }; }),
                        [['n', 'Номер'], ['t', 'Вид документа ЗУП'], ['e', 'Сотрудник'], ['tab', 'Таб. №'], ['s', 'Дата подписания'], ['id', 'ID у оператора'], ['f', 'Файл с подписью'], ['err', 'Ошибка передачи']]));
                }, 'kedo-small'));
                wrap.appendChild(bar);
                wrap.appendChild(P.table([
                    { k: 'number', t: 'Номер' }, { k: 'type', t: 'Документ' }, { t: 'Сотрудник', html: function (d) { return P.esc(d.emp) + '<br><small class="kedo-muted">' + P.esc(d.tab) + '</small>'; } },
                    { k: 'dept', t: 'Подразделение' }, { t: 'Отправлен', html: function (d) { return C.toDmy(d.sent) || '<span class="kedo-muted">не отправлен</span>'; } },
                    { t: 'Статус подписи', html: P.statusBadge }, { t: 'Висит, р.д.', num: true, html: P.waitText }, { t: 'Вид подписи', html: function (d) { return P.esc(d.sign || ''); } }, { t: 'В ЗУП', html: P.zupBadge }
                ], list, { onrow: function (d) { P.docCard(M, d, reload); }, rowCls: function (d) { return d.st.notInZup || d.st.refused ? 'kedo-row-bad' : d.st.overdue ? 'kedo-row-warn' : ''; }, empty: 'Под фильтр ничего не попало' }));
            }
            drawTable();
        }
        function reload() { P.model().then(function (m) { M = m; draw(); }); }
        draw();
        if (h.doc) { var d = M.docs.filter(function (x) { return x.number === h.doc; })[0]; if (d) P.docCard(M, d, reload); }
    });
})();
