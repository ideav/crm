/* Видеовстречи курса (ideav/courses#200): #/meet/<курс> — список, вход, у ведущего — код гостя и блок-лист;
   #/meet?code=XXXX-XXXX — вход гостя по коду. Ключи (JWT) выдаёт сервер: /courses-meet.php (include/courses_meet.php). */
(function () {
  'use strict';
  var A = window.LMSApp, E = A.el;
  var MSG = { login: 'Войдите в портал, чтобы попасть на встречу.', access: 'Встречи курса доступны ученикам с доступом к курсу.',
    host: 'Это может только ведущий.', banned: 'Ведущий закрыл вам вход на эту встречу.', closed: 'Встреча закончилась.',
    code: 'Код не подошёл. Проверьте его или спросите у ведущего новый.', name: 'Введите имя.', meeting: 'Встреча не найдена.',
    too_many: 'Слишком много попыток. Подождите 10 минут.', meet_off: 'Видеовстречи пока не включены.', base: 'Не удалось проверить доступ, попробуйте ещё раз.', server: 'Сервер не ответил, попробуйте ещё раз.' };
  A.MEET_MSG = MSG;

  A.meetApi = function (action, data) {
    var body = Object.assign({ action: action }, data || {});
    return fetch('/courses-meet.php', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'courses' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'server' }; }); }, function () { return { ok: false, error: 'server' }; });
  };
  function msg(r) { return MSG[r && r.error] || MSG.server; }

  var apiLoad = {};
  function loadApi(domain) {
    if (window.JitsiMeetExternalAPI) return Promise.resolve();
    if (!apiLoad[domain]) apiLoad[domain] = new Promise(function (ok, fail) {
      var s = document.createElement('script');
      s.src = 'https://' + domain + '/external_api.js';
      s.onload = ok; s.onerror = function () { delete apiLoad[domain]; fail(new Error('external_api.js')); };
      document.head.appendChild(s);
    });
    return apiLoad[domain];
  }

  // Комната Jitsi в iframe. t — ответ сервера {domain, room, jwt, moderator, name, title}; onLeave — по выходу.
  // Возвращает {api, kickByName(name)}; при уходе со страницы комната закрывается (A.cleanup).
  A.meetRoom = function (box, t, onLeave) {
    box.innerHTML = '';
    var frame = E('div', { class: 'meet-frame' });
    var status = E('p', { class: 'muted', text: 'Подключаемся…' });
    box.appendChild(E('div', { class: 'meet-room' }, [E('h2', { text: t.title || 'Встреча' }), status, frame]));
    var room = { api: null, kickByName: function () { return Promise.resolve(false); } };
    loadApi(t.domain).then(function () {
      var api = new window.JitsiMeetExternalAPI(t.domain, {
        roomName: t.room, jwt: t.jwt, parentNode: frame, width: '100%', height: 620, lang: 'ru',
        userInfo: { displayName: t.name },
        configOverwrite: { readOnlyName: true, disableDeepLinking: true, prejoinConfig: { enabled: true },
          localRecording: { disable: !t.moderator, notifyAllParticipants: true }, startWithVideoMuted: false },
        interfaceConfigOverwrite: { SHOW_JITSI_WATERMARK: false, MOBILE_APP_PROMO: false }
      });
      room.api = api;
      status.textContent = t.moderator ? 'Вы ведущий: можете выключить звук участнику, выгнать его, записать встречу на свой компьютер (меню «…» → «Запись»).' : '';
      api.addListener('readyToClose', function () { leave(); });
      room.kickByName = function (name) {
        return Promise.resolve(api.getRoomsInfo ? api.getRoomsInfo() : { rooms: [] }).then(function (info) {
          var hit = 0;
          ((info && info.rooms) || []).forEach(function (r) {
            (r.participants || []).forEach(function (p) { if (p.displayName === name && p.id) { api.executeCommand('kickParticipant', p.id); hit++; } });
          });
          return hit > 0;
        });
      };
    }, function () { status.textContent = 'Не удалось загрузить видеосвязь. Проверьте интернет и обновите страницу.'; });
    var left = false;
    function leave() {
      if (left) return; left = true;
      if (room.api) { try { room.api.dispose(); } catch (e) { /* уже закрыта */ } }
      if (onLeave) onLeave();
    }
    var prev = A.cleanup;
    A.cleanup = function () { A.cleanup = prev; if (room.api) { left = true; try { room.api.dispose(); } catch (e) { /* уже закрыта */ } } if (prev) prev(); };
    return room;
  };

  function guestLink(code) { return location.origin + location.pathname + '#/meet?code=' + encodeURIComponent(code); }

  // #/meet/<курс>
  A.views.meet = function (root, course) {
    var box = E('div'), room = null, inRoom = null;
    root.appendChild(E('p', {}, [E('a', { href: '#/map', text: '← К курсам' })]));
    root.appendChild(box);
    function err(r) { box.innerHTML = ''; box.appendChild(E('div', { class: 'card' }, [E('h2', { text: 'Встречи курса' }), E('p', { class: 'muted', text: msg(r) })])); }
    function act(action, data, after) {
      return A.meetApi(action, data).then(function (r) { if (!r.ok) { A.toast(msg(r), 4000); return r; } if (after) after(r); return r; });
    }
    function join(m) {
      act('token', { id: m.id }, function (t) {
        inRoom = m.id;
        var panel = E('div');
        box.innerHTML = '';
        var holder = E('div');
        box.appendChild(holder); box.appendChild(panel);
        room = A.meetRoom(holder, t, function () { inRoom = null; room = null; load(); });
        if (t.moderator) hostPanel(panel, m.id);
      });
    }

    // Блок ведущего: код и ссылка для гостей, кто входил, блокировка, закрытие
    function hostBlock(m, redraw) {
      var bans = m.bans || [], seen = m.seen || {};
      var people = Object.keys(seen).map(function (id) {
        var s = seen[id], banned = bans.indexOf(id) >= 0;
        return E('li', {}, [E('span', { text: s.name + (banned ? ' — заблокирован' : '') }), ' ',
          E('button', { class: 'btn btn-sm', type: 'button', text: banned ? 'Разблокировать' : 'Заблокировать', onclick: function () {
            act(banned ? 'unban' : 'ban', { id: m.id, who: id }, function (r) {
              // выгнать сразу можно только из открытой комнаты; из списка — закрыт вход, а из комнаты выгоняет кнопка Jitsi
              if (!banned && room && inRoom === m.id) room.kickByName(s.name);
              A.toast(banned ? 'Вход снова открыт' : (s.guest ? 'Гость заблокирован, код встречи сменён' : 'Участник заблокирован'));
              redraw(r.meeting);
            });
          } })]);
      });
      return E('div', { class: 'meet-host' }, [
        E('p', {}, ['Код для гостей: ', E('b', { text: m.code }), ' ',
          E('button', { class: 'btn btn-sm', type: 'button', text: 'Скопировать ссылку', onclick: function () { A.copy(guestLink(m.code)); } }), ' ',
          E('button', { class: 'btn btn-sm', type: 'button', text: 'Новый код', onclick: function () { act('code', { id: m.id }, function (r) { A.toast('Старый код больше не действует'); redraw(r.meeting); }); } })]),
        people.length ? E('div', {}, [E('p', { class: 'muted', text: 'Входили на встречу:' }), E('ul', { class: 'meet-people' }, people)]) : E('p', { class: 'muted', text: 'На встречу ещё никто не входил.' }),
        m.closed ? null : E('button', { class: 'btn', type: 'button', text: 'Закончить встречу', onclick: function () {
          act('close', { id: m.id }, function (r) { A.toast('Встреча закрыта, ключи больше не выдаются'); redraw(r.meeting); });
        } })
      ]);
    }

    function hostPanel(panel, id) {
      function draw(m) {
        panel.innerHTML = '';
        if (!m) return;
        panel.appendChild(E('div', { class: 'card' }, [E('h3', { text: 'Управление встречей' }), hostBlock(m, draw),
          E('button', { class: 'btn btn-sm', type: 'button', text: 'Обновить список', onclick: refresh })]));
      }
      function refresh() {
        A.meetApi('list', { course: course }).then(function (r) { draw(r.ok ? (r.meetings || []).filter(function (x) { return x.id === id; })[0] : null); });
      }
      refresh();
    }

    function card(m, host) {
      var slot = E('div');
      function draw(mm) {
        m = mm || m;
        slot.innerHTML = '';
        slot.appendChild(E('section', { class: 'card meet' + (m.closed ? ' locked' : '') }, [
          E('div', { class: 'course-head' }, [E('h2', { text: m.title }), E('span', { class: 'badge', text: m.closed ? 'Закончилась' : 'Идёт' })]),
          E('p', { class: 'muted', text: 'Ведущий: ' + m.host + ' · создана ' + m.created }),
          m.closed ? null : E('div', { class: 'row' }, [E('button', { class: 'btn btn-primary', type: 'button', text: 'Войти на встречу', onclick: function () { join(m); } })]),
          host ? hostBlock(m, draw) : null
        ]));
      }
      draw(m);
      return slot;
    }

    function load() {
      A.meetApi('list', { course: course }).then(function (r) {
        if (!r.ok) { err(r); return; }
        box.innerHTML = '';
        box.appendChild(E('h1', { text: 'Встречи курса' }));
        if (r.host) {
          var title = E('input', { type: 'text', class: 'input', maxlength: '60', placeholder: 'Название, например «Разбор домашних заданий»' });
          box.appendChild(E('div', { class: 'card' }, [E('h3', { text: 'Новая встреча' }), E('div', { class: 'row' }, [title,
            E('button', { class: 'btn btn-primary', type: 'button', text: 'Создать', onclick: function () {
              act('create', { course: course, title: title.value }, function () { load(); });
            } })]), E('p', { class: 'muted', text: 'Ученики курса входят из портала. Гостям — код или ссылка, которые появятся у встречи.' })]));
        }
        var list = r.meetings || [];
        if (!list.length) box.appendChild(E('p', { class: 'lms-empty', text: r.host ? 'Встреч пока нет.' : 'Ведущий ещё не назначил встречу.' }));
        list.forEach(function (m) { box.appendChild(card(m, r.host)); });
      });
    }
    load();
  };

  // #/meet?code=XXXX-XXXX — гость: код + имя, вход в портал не нужен
  A.views.meetGuest = function (root) {
    var box = E('div');
    root.appendChild(box);
    function form() {
      box.innerHTML = '';
      var code = E('input', { type: 'text', class: 'input', maxlength: '12', placeholder: 'Код встречи', autocomplete: 'off' });
      var name = E('input', { type: 'text', class: 'input', maxlength: '60', placeholder: 'Ваше имя' });
      var note = E('p', { class: 'muted' });
      code.value = (A.query && A.query.get('code')) || '';
      var btn = E('button', { class: 'btn btn-primary', type: 'button', text: 'Войти' });
      btn.addEventListener('click', function () {
        btn.disabled = true; note.textContent = '';
        A.meetApi('guest', { code: code.value, name: name.value }).then(function (t) {
          btn.disabled = false;
          if (!t.ok) { note.textContent = msg(t); return; }
          A.meetRoom(box, t, form);
        });
      });
      box.appendChild(E('div', { class: 'card' }, [E('h1', { text: 'Вход на встречу' }),
        E('p', { class: 'muted', text: 'Код встречи даёт ведущий. Имя увидят остальные участники.' }),
        E('div', { class: 'row' }, [code, name, btn]), note]));
    }
    form();
  };
})();
