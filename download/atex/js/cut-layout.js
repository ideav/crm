(function(){
  // ───────────────────────────── Чистое ядро ─────────────────────────────
  // F1: раскладка ножей («Полосы») для резки. Чистые функции (вход не мутируют,
  // детерминированы). DOM/сеть — в F3. ES5-only.

  function toNumber(v){
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var text = String(v == null ? '' : v).replace(/\s+/g, '').replace(',', '.');
    var n = parseFloat(text);
    return isFinite(n) ? n : 0;
  }

  // Округление до 3 знаков, чтобы убрать артефакты float-арифметики.
  function round3(v){ return Math.round(toNumber(v) * 1000) / 1000; }

  // dayDiff: |дни| между двумя ключами ГГГГММДД (нечисло/Infinity → Infinity).
  function dayDiff(a, b){
    if(!isFinite(a) || !isFinite(b)) return Infinity;
    function toDate(k){ k = Math.floor(k); var y = Math.floor(k/10000), m = Math.floor(k/100)%100, d = k%100; return Date.UTC(y, m-1, d); }
    return Math.round(Math.abs(toDate(a) - toDate(b)) / 86400000);
  }

  // dueWindowGroups: объединить позиции одного сырья в кластеры по «Сроку изготовления».
  // positions: [{id, width, qty, dueKey}]; dueKey — ГГГГММДД (пустой срок → Infinity).
  // Датированные сортируются по dueKey (затем по id); жадно набираем кластер, пока
  // dayDiff(pos.dueKey, cluster[0].dueKey) <= windowDays. Бездатные → отдельный
  // последний кластер. windowDays по умолчанию 3. Вход не мутирует, детерминировано.
  function dueWindowGroups(positions, windowDays){
    if (windowDays == null) windowDays = 3;
    var list = (positions || []).slice();
    var dated = [], undated = [];
    list.forEach(function(p){ if (isFinite(p.dueKey)) dated.push(p); else undated.push(p); });
    dated.sort(function(a, b){
      if (a.dueKey !== b.dueKey) return a.dueKey - b.dueKey;
      return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0);
    });
    var groups = [];
    var cur = null;
    dated.forEach(function(p){
      if (cur && dayDiff(p.dueKey, cur[0].dueKey) <= windowDays) {
        cur.push(p);
      } else {
        cur = [p];
        groups.push(cur);
      }
    });
    if (undated.length) groups.push(undated);
    return groups;
  }

  var layout = { toNumber: toNumber, round3: round3, dayDiff: dayDiff, dueWindowGroups: dueWindowGroups };

  if (typeof module !== 'undefined' && module.exports) module.exports = { layout: layout };
  if (typeof window !== 'undefined') window.AtexCutLayout = { layout: layout };
})();
