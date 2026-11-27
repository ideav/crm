/* КЭДО: сверка «оператор ↔ ЗУП» по выгрузке оператора (сохранённой или загруженной CSV). */
(function () {
    'use strict';
    var P = window.Kedo, C = P.core;
    var GROUPS = [['signedNotInZup', 'Подписано у оператора, нет в ЗУП', 'crit'], ['statusStale', 'Статус в учёте устарел', 'warn'], ['missingAtOperator', 'Отправлено, а у оператора нет', 'crit'],
        ['notInRegistry', 'Есть у оператора, нет в учёте', 'warn'], ['unknownEmp', 'Сотрудник не сопоставлен', 'warn'], ['unknownStatus', 'Статус оператора не в справочнике', 'warn'], ['ok', 'Сошлось', 'ok']];
    var CSV_COLS = [['tab', 'Таб. №'], ['fio', 'ФИО'], ['kind', 'Вид документа'], ['opId', 'ID'], ['date', 'Дата документа'], ['opStatus', 'Статус'], ['signed', 'Дата подписания']];
    P.mount(function (host, M) {
        var st = { group: 'signedNotInZup', source: '', rows: null, exports: [] };
        host.innerHTML = '';
        P.head('Сверка «оператор ↔ ЗУП»', 'Реестр оператора КЭДО против кадрового учёта: что подписано, но не в ЗУП; что ушло, но у оператора нет; кого не удалось сопоставить. Ключ — ID оператора, без него табельный + вид + дата ± ' + M.rules.dateTolerance + ' дн.').forEach(function (n) { host.appendChild(n); });
        var bar = P.el('div', { 'class': 'kedo-bar' }), out = P.el('div', {});
        host.appendChild(bar); host.appendChild(out);
        function fromDb(x) { return { opId: x['Номер в выгрузке'], tab: x['Табельный номер'], fio: x['ФИО в выгрузке'], kind: x['Вид документа в выгрузке'], date: C.toIso(x['Дата документа']), opStatus: x['Статус у оператора'], signed: C.toIso(x['Дата подписания']) }; }
        function loadExport(id) {
            out.textContent = 'Загрузка выгрузки...';
            P.rows('Строка выгрузки', '&F_U=' + id).then(function (r) { st.rows = (r || []).filter(function (x) { return x._up === id; }).map(fromDb); st.source = (st.exports.filter(function (e) { return e._id === id; })[0] || {})['Выгрузка оператора']; draw(); }).catch(P.fail);
        }
        P.rows('Выгрузка оператора').then(function (ex) {
            st.exports = ex || [];
            var sel = P.select(st.exports.map(function (e) { return [e._id, e['Выгрузка оператора']]; }), st.exports.length ? st.exports[0]._id : '');
            sel.addEventListener('change', function () { loadExport(sel.value); });
            var file = P.input('file', undefined, { accept: '.csv,text/csv', 'aria-label': 'CSV выгрузки оператора' });
            file.addEventListener('change', function () {
                var f = file.files[0]; if (!f) return;
                var rd = new FileReader();
                rd.onload = function () {
                    var mx = C.mapExport(C.parseCsv(rd.result));
                    if (mx.missing.length) { P.toast('В файле нет колонок: ' + mx.missing.map(function (k) { return { tab: 'Таб. №', kind: 'Вид документа', opStatus: 'Статус' }[k]; }).join(', '), true); return; }
                    st.rows = mx.rows; st.source = f.name + ' (загружен, не сохранён)'; draw();
                };
                rd.readAsText(f, 'utf-8');
            });
            bar.appendChild(P.field('Сохранённая выгрузка', sel));
            bar.appendChild(P.field('или CSV из кабинета оператора', file, 'колонки: Таб. №, ФИО, Вид документа, ID, Дата документа, Статус, Дата подписания'));
            bar.appendChild(P.btn('Скачать пример CSV', function () { if (st.rows) P.download('vygruzka-operatora.csv', C.toCsv(st.rows.map(function (r) { var o = Object.assign({}, r); o.date = C.toDmy(r.date); o.signed = C.toDmy(r.signed); return o; }), CSV_COLS)); }, 'kedo-small'));
            if (st.exports.length) loadExport(st.exports[0]._id); else out.textContent = 'Выгрузок пока нет — загрузите CSV.';
        }).catch(P.fail);
        function draw() {
            out.innerHTML = '';
            var R = C.reconcile(M.docs, st.rows || [], M.statusMap, M.empTab, M.rules.dateTolerance), G = R.groups;
            out.appendChild(P.el('p', { 'class': 'kedo-muted', text: 'Источник: ' + st.source + ' · строк ' + R.rows + ' · расхождений ' + R.problems + (R.byComposite ? ' · без ID сопоставлено по составному ключу: ' + R.byComposite : '') }));
            out.appendChild(P.el('div', { 'class': 'kedo-kpis' }, GROUPS.map(function (g) {
                var k = P.kpi(g[1], String(G[g[0]].length), '', G[g[0]].length ? (g[2] === 'crit' ? 'bad' : g[2] === 'ok' ? 'good' : 'warn') : 'good');
                k.className += ' kedo-click' + (st.group === g[0] ? ' kedo-kpi-on' : ''); k.setAttribute('role', 'button'); k.setAttribute('tabindex', '0'); k.setAttribute('data-group', g[0]);
                k.addEventListener('click', function () { st.group = g[0]; draw(); });
                return k;
            })));
            var list = G[st.group].map(function (it) { var d = it.doc ? (M.docs.filter(function (x) { return x.id === it.doc.id; })[0] || it.doc) : null; return { d: d, r: it.row || {}, s: it.status || '' }; });
            var cols = [{ t: 'Документ в учёте', html: function (x) { return x.d ? '<b>' + P.esc(x.d.number) + '</b> ' + P.esc(x.d.type) + '<br><small class="kedo-muted">' + P.esc(x.d.emp) + '</small>' : '<span class="kedo-muted">нет</span>'; } },
                { t: 'Статус в учёте', html: function (x) { return x.d ? P.statusBadge(x.d) + ' ' + P.zupBadge(x.d) : ''; } },
                { t: 'Строка оператора', html: function (x) { return x.r.opStatus !== undefined ? P.esc((x.r.opId || 'без ID') + ' · ' + (x.r.fio || '') + ' (' + (x.r.tab || '') + ') · ' + (x.r.kind || '') + ' от ' + C.toDmy(x.r.date)) : '<span class="kedo-muted">нет строки</span>'; } },
                { t: 'Статус оператора', html: function (x) { return x.r.opStatus !== undefined ? P.esc(x.r.opStatus) + (x.s ? ' <small class="kedo-muted">→ ' + P.esc(x.s) + '</small>' : '') : ''; } },
                { t: 'Действие', html: function () { return ''; }, cls: function () { return 'kedo-actcell'; } }];
            var tw = P.table(cols, list, { empty: 'В этой группе пусто' });
            out.appendChild(tw);
            [].forEach.call(tw.querySelectorAll('td.kedo-actcell'), function (td, i) {
                var x = list[i]; if (!x || !x.d) return;
                if (st.group === 'signedNotInZup' && P.canWrite('Кадровый документ') && C.retryOutcome(x.d).ok) td.appendChild(P.btn('Передать в ЗУП', function () { P.retry(x.d, reload); }, 'kedo-small kedo-primary'));
                else if (st.group === 'statusStale' && P.canWrite('Кадровый документ')) td.appendChild(P.btn('Принять статус оператора', function () {
                    var f = { 'Статус подписи': x.s }; if (x.s === C.SIGNED) { f['Дата подписания'] = x.r.signed || P.TODAY; f['Статус в ЗУП'] = C.ZUP_NONE; }
                    P.post('_m_set/' + x.d.id + '?JSON', { fields: f }).then(function () { return P.addEvent(x.d, 'Статус обновлён по выгрузке оператора: ' + x.r.opStatus, 'Сверка'); }).then(function () { P.resetModel(); P.toast('Статус обновлён: ' + x.d.number); reload(); }).catch(function (e) { P.toast(e.message, true); });
                }, 'kedo-small'));
                else td.appendChild(P.btn('Открыть', function () { P.docCard(M, x.d, reload); }, 'kedo-small'));
            });
            if (st.group === 'unknownEmp' || st.group === 'unknownStatus' || st.group === 'notInRegistry') out.appendChild(P.el('p', { 'class': 'kedo-muted', text: 'Такие строки не склеиваются молча: однофамильцы и «Иванов И.И.» сопоставляются только по табельному номеру, неизвестный статус оператора добавляется в справочник соответствий.' }));
        }
        function reload() { P.model().then(function (m) { M = m; draw(); }); }
    });
})();
