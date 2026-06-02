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

  var layout = { toNumber: toNumber, round3: round3, dayDiff: dayDiff };

  if (typeof module !== 'undefined' && module.exports) module.exports = { layout: layout };
  if (typeof window !== 'undefined') window.AtexCutLayout = { layout: layout };
})();
