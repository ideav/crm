/* LMS: экран куратора (#/curator): лента ответов, критерии, комментарии. */
(function () {
  'use strict';
  var A = window.LMSApp, E = A.el, D = A.data, L = window.LMS || {};
  A.views = A.views || {};

  function keys() { try { return JSON.parse(A.store.get('lms_keys')) || {}; } catch (e) { return {}; } }
  A.curatorKey = function (course) { return keys()[course] || D.accessKey(course) || ''; };
  A.setCuratorKey = function (course, k) { var o = keys(); o[course] = k; A.store.set('lms_keys', JSON.stringify(o)); };

  function answerText(row) {
    var a = {}; try { a = JSON.parse(row['Ответ'] || '{}'); } catch (e) { a = {}; }
    var out = [];
    Object.keys(a.tasks || {}).forEach(function (i) {
      var t = a.tasks[i];
      if (t.saved || t.text) out.push(t.text || t.draft);
      else if (t.draft) out.push('(черновик) ' + t.draft);
      if (t.score != null) out.push('Тест: ' + t.score + '%, попыток ' + (t.attempts || 1));
      if (t.db) out.push('База: ' + t.db + (t.selfConfirmed ? ' (самоподтверждение)' : ''));
    });
    return out.filter(Boolean).join('\n\n');
  }

  A.views.curator = function (root) {
    if (!A.isCurator()) { root.appendChild(E('p', { class: 'lms-empty', text: 'Раздел доступен куратору.' })); return; }
    root.appendChild(E('h1', { class: 'page-title', text: 'Куратор' }));
    var tabs = [['feed', 'Лента ответов', feed]];
    if (A.isAdmin() && A.views.admin) tabs = tabs.concat(A.views.admin);
    var nav = E('div', { class: 'tabs' }), pane = E('div', { class: 'pane' });
    tabs.forEach(function (t, i) {
      var b = E('button', { class: 'tab', type: 'button', text: t[1], onclick: function () {
        [].forEach.call(nav.children, function (x) { x.classList.remove('on'); }); b.classList.add('on');
        pane.innerHTML = ''; t[2](pane);
      } });
      nav.appendChild(b); if (!i) setTimeout(function () { b.click(); }, 0);
    });
    root.appendChild(nav); root.appendChild(pane);
  };

  function feed(pane) {
    pane.appendChild(E('p', { class: 'muted', text: 'Загружаем…' }));
    A.list('Прогресс', {}).then(function (rows) {
      pane.innerHTML = '';
      rows = rows.filter(function (r) { return answerText(r); }).sort(function (a, b) { return Number(b._id) - Number(a._id); });
      if (!rows.length) { pane.appendChild(E('p', { class: 'lms-empty', text: 'Ответов пока нет.' })); return; }
      var detail = E('div', { class: 'detail' });
      pane.appendChild(E('div', { class: 'feed' }, rows.slice(0, 200).map(function (r) {
        return E('button', { class: 'feed-row', type: 'button', onclick: function () { open(detail, r); detail.scrollIntoView({ block: 'nearest' }); } }, [
          E('b', { text: A.refText(r['Пользователь']) }), E('span', { class: 'muted', text: ' · ' + r['Курс'] + ' / ' + r['Урок'] + ' · ' + (r['Дата и время'] || '') }),
          E('div', { class: 'feed-ans', text: answerText(r).slice(0, 140) })]);
      })));
      pane.appendChild(detail);
    }, function (e) { pane.innerHTML = ''; pane.appendChild(E('p', { class: 'warn', text: 'Не удалось загрузить: ' + e.message })); });
  }

  function open(box, r) {
    box.innerHTML = '';
    var course = r['Курс'], lesson = r['Урок'];
    box.appendChild(E('h3', { text: A.refText(r['Пользователь']) + ' — ' + course + ' / ' + lesson }));
    box.appendChild(E('pre', { class: 'answer', text: answerText(r) }));
    var crit = E('div', { class: 'criteria muted', text: 'Критерии: загружаем…' });
    var key = A.curatorKey(course);
    var kin = E('input', { class: 'inp', type: 'text', placeholder: 'Ключ курса ' + course, value: key });
    function loadCrit() {
      var k = kin.value.trim(); A.setCuratorKey(course, k);
      A.getJSON(A.contentRoot + course + '-' + k + '/curator/' + lesson + '.json').then(function (j) { crit.className = 'criteria'; crit.innerHTML = '<b>Критерии</b>' + (j.criteria || ''); A.fixLinks(crit); },
        function () { crit.className = 'criteria muted'; crit.textContent = 'Критериев нет (проверьте ключ курса).'; });
    }
    kin.addEventListener('change', loadCrit);
    box.appendChild(crit); box.appendChild(E('div', { class: 'row' }, [kin])); loadCrit();
    var ta = E('textarea', { class: 'inp', rows: 4, placeholder: 'Комментарий ученику' });
    var msg = E('span', { class: 'muted' });
    var send = E('button', { class: 'btn btn-primary', type: 'button', text: 'Отправить комментарий', onclick: function () {
      if (!ta.value.trim()) { msg.textContent = 'Напишите текст'; return; }
      send.disabled = true;
      A.create('Комментарий', Date.now() + '', { 'Пользователь': A.refId(r['Пользователь']), 'Курс': course, 'Урок': lesson, 'Текст': ta.value.trim(), 'Автор': L.user || 'Куратор', 'Дата и время': A.nowStr() })
        .then(function () { msg.textContent = 'Отправлено'; ta.value = ''; send.disabled = false; }, function (e) { msg.textContent = 'Ошибка: ' + e.message; send.disabled = false; });
    } });
    box.appendChild(ta); box.appendChild(E('div', { class: 'row' }, [send, msg]));
  }
})();
