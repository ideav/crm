/* Мок автопроверки для локальной проверки (настоящая — js/checks.js, WP4). */
if (!window.LMSChecks) window.LMSChecks = { run: function (db, spec) {
  return Promise.resolve(spec.checks.map(function (c) { return { id: c.id, title: c.title, ok: /^my/.test(db), hint: c.hint }; }));
} };
