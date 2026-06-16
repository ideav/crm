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

  // bestFill: DFS-добор остатка rem ширинами preferred (как bestFill в B).
  // preferred: [{width, popularity}] по убыванию популярности. tolerance — допустимый |отход|.
  // Возврат: {strips:[{width,qty}], leftover, popSum} с мин. leftover (затем макс. popSum).
  function bestFill(rem, preferred, tolerance){
    var tol = toNumber(tolerance);
    var cands = (preferred || []).map(function(c){ return { width: toNumber(c.width), popularity: toNumber(c.popularity) }; });
    cands = cands.filter(function(c){ return c.width > 0 && c.width <= rem + Math.abs(tol); });
    var best = { strips: [], leftover: round3(rem), popSum: 0 };
    var dfsCalls = 0;
    var DFS_LIMIT = 50000;
    (function dfs(i, left, acc, popSum){
      if (++dfsCalls > DFS_LIMIT) return;
      var leftR = round3(left);
      if (leftR < best.leftover || (leftR === best.leftover && popSum > best.popSum)) {
        best = { strips: acc.slice(), leftover: leftR, popSum: popSum };
      }
      if (leftR <= Math.abs(tol)) return;
      for (var k = i; k < cands.length; k++) {
        var c = cands[k];
        if (c.width > leftR) continue;
        var maxQ = Math.floor(leftR / c.width);
        if (maxQ > 20) maxQ = 20;
        for (var q = maxQ; q >= 1; q--) {
          acc.push({ width: c.width, qty: q });
          dfs(k + 1, round3(leftR - c.width * q), acc, popSum + c.popularity * q);
          acc.pop();
        }
      }
    })(0, rem, [], 0);
    if (dfsCalls > DFS_LIMIT) console.warn('[cut-layout] bestFill: DFS limit reached, rem=' + round3(rem) + ' cands=' + cands.length);
    return best;
  }

  // composeLayout: раскладка одного кластера в ширину джамбо.
  // demands: [{width, qty, positionId}]; preferred: [{width, popularity}]; tolerance — |отход|.
  // Возврат: {strips:[{width, qty, purpose:'Заказ'|'Склад', positionIds:[]}], used, remainder,
  //           withinTolerance, overflow:[demands]}. Вход не мутирует, детерминировано.
  function composeLayout(jumboWidth, demands, preferred, tolerance){
    var W = toNumber(jumboWidth), tol = toNumber(tolerance);
    // (a) агрегировать demands по ширине (Σ qty, собрать positionIds); ширины > джамбо → overflow.
    var byWidth = {}; var order = []; var overflow = [];
    (demands || []).forEach(function(dem){
      var w = toNumber(dem.width);
      // ширина вне (0, джамбо] не укладывается (в т.ч. вырожденная ≤0) → overflow
      if (w <= 0 || w > W) { overflow.push({ width: dem.width, qty: dem.qty, positionId: dem.positionId, stockable: dem.stockable }); return; }
      var key = String(w);
      if (!byWidth[key]) { byWidth[key] = { width: w, qty: 0, positionIds: [], stockable: true }; order.push(key); }
      byWidth[key].qty += toNumber(dem.qty);
      // ширина считается запасной только если ВСЕ её позиции запасные (есть в «Максимальном
      // запасе»); без флага — незапасная (режем под заказ, #3423).
      if (!dem.stockable) byWidth[key].stockable = false;
      if (dem.positionId != null && byWidth[key].positionIds.indexOf(dem.positionId) < 0) {
        byWidth[key].positionIds.push(dem.positionId);
      }
    });
    var widths = order.map(function(k){ return byWidth[k]; });
    // (b) базовая укладка: по 1 полосе на каждую ширину (по убыванию ширины). Что не влезло → overflow.
    widths.sort(function(a, b){ return b.width - a.width; });
    var strips = []; // [{width, qty, purpose, positionIds, demandQty}]
    var used = 0;
    widths.forEach(function(g){
      if (round3(used + g.width) <= W) {
        strips.push({ width: g.width, qty: 1, purpose: 'Заказ', positionIds: g.positionIds.slice(), demandQty: g.qty, stockable: g.stockable });
        used = round3(used + g.width);
      } else {
        overflow.push({ width: g.width, qty: g.qty, positionId: g.positionIds[0], stockable: g.stockable });
      }
    });
    // (c) дозаполнение по спросу. Поведение зависит от «Максимального запаса» (#3423):
    //   • есть НЕзапасная ширина (нет в таблице) → «резать под заказ». Число рулонов ширины
    //     = полосы × прогоны, прогоны у раскладки ОБЩИЕ (= худшая ширина: max ⌈спрос/полос⌉).
    //     Полный материал = ширина_джамбо × прогоны × длина, полезный выход (заказы)
    //     фиксирован → минимум отхода ≡ МИНИМУМ ПРОГОНОВ. Берём наименьшее R, при котором по
    //     ⌈спрос/R⌉ полос каждой ширины влезают в джамбо: каждая ширина даёт ≈ свой заказ
    //     (перепроизводство < R), без раздувания одной ширины другой (60 заказ → 60, не 210).
    //   • ВСЕ ширины запасные → прежняя жадная набивка джамбо по непокрытому спросу: излишек
    //     уходит в запас (для комбинаций из «Максимального запаса» это допустимо).
    // База (b) уже дала по 1 полосе на ширину.
    var orderStrips = strips.filter(function(s){ return s.purpose === 'Заказ'; });
    var anyNonStock = orderStrips.some(function(s){ return !s.stockable; });
    if (orderStrips.length && anyNonStock) {
      var maxDemand = 0;
      orderStrips.forEach(function(s){ if (s.demandQty > maxDemand) maxDemand = s.demandQty; });
      if (maxDemand < 1) maxDemand = 1;
      // R от 1 вверх: при R = maxDemand получаем по 1 полосе/ширину (= база, которая уже
      // влезла), поэтому цикл гарантированно находит решение.
      for (var R = 1; R <= maxDemand; R++) {
        var sumW = 0;
        orderStrips.forEach(function(s){ sumW = round3(sumW + Math.max(1, Math.ceil(s.demandQty / R)) * s.width); });
        if (sumW <= W) {
          orderStrips.forEach(function(s){ s.qty = Math.max(1, Math.ceil(s.demandQty / R)); });
          break;
        }
      }
      used = round3(strips.reduce(function(a, s){ return a + s.width * s.qty; }, 0));
    } else if (orderStrips.length) {
      // все ширины запасные: пока остаток вмещает любую заказанную ширину, добавлять полосу
      // ширины с макс. непокрытым спросом (при равенстве — бóльшая ширина, затем меньший id).
      var guard = 0;
      while (guard++ < 100000) {
        var rem = round3(W - used);
        var pick = null;
        strips.forEach(function(s){
          if (s.purpose !== 'Заказ') return;
          if (s.width > rem) return;
          if (s.demandQty - s.qty <= 0) return;
          if (pick === null) { pick = s; return; }
          var u = s.demandQty - s.qty, pu = pick.demandQty - pick.qty;
          if (u > pu) { pick = s; return; }
          if (u === pu) {
            if (s.width > pick.width) { pick = s; return; }
            if (s.width === pick.width) {
              var sid = String(s.positionIds[0]), pid = String(pick.positionIds[0]);
              if (sid < pid) pick = s;
            }
          }
        });
        if (!pick) break;
        pick.qty += 1;
        used = round3(used + pick.width);
      }
    }
    // (d) добор остатка ходовыми → полосы purpose:'Склад'.
    var rem2 = round3(W - used);
    var fill = bestFill(rem2, preferred, tol);
    fill.strips.forEach(function(s){
      strips.push({ width: s.width, qty: s.qty, purpose: 'Склад', positionIds: [], demandQty: 0 });
      used = round3(used + s.width * s.qty);
    });
    // объединить одинаковые ширины+purpose (positionIds объединяются)
    var merged = []; var idx = {};
    strips.forEach(function(s){
      var key = s.purpose + '|' + round3(s.width);
      if (idx[key] == null) {
        idx[key] = merged.length;
        merged.push({ width: s.width, qty: s.qty, purpose: s.purpose, positionIds: s.positionIds.slice() });
      } else {
        var m = merged[idx[key]];
        m.qty += s.qty;
        s.positionIds.forEach(function(pid){ if (m.positionIds.indexOf(pid) < 0) m.positionIds.push(pid); });
      }
    });
    // (e) used / remainder / withinTolerance
    var usedFinal = round3(merged.reduce(function(a, s){ return a + s.width * s.qty; }, 0));
    var remainderOut = round3(W - usedFinal);
    return {
      strips: merged,
      used: usedFinal,
      remainder: remainderOut,
      withinTolerance: Math.abs(remainderOut) <= Math.abs(tol),
      overflow: overflow
    };
  }

  // combinationSignature: канонический ключ комбинации (как в B) — сырьё + отсортированный
  // мультинабор ширина×кол-во. Детерминировано, не зависит от порядка полос.
  function combinationSignature(materialId, strips){
    var parts = (strips || []).map(function(s){ return round3(toNumber(s.width)) + 'x' + toNumber(s.qty); }).sort();
    return String(materialId == null ? '' : materialId) + '|' + parts.join('+');
  }

  // planLayouts: оркестратор раскладки. input = {jumboWidth, positions, preferred, options:{windowDays=3, tolerance}}.
  // Группирует позиции по окну срока, для каждого кластера composeLayout; пока overflow непустой
  // и есть прогресс — повторный composeLayout на overflow → доп. раскладка. Позиции шире джамбо
  // (overflow без прогресса) → skipped 'шире джамбо'. Вход не мутирует, детерминировано.
  function planLayouts(input){
    input = input || {};
    var W = toNumber(input.jumboWidth);
    var preferred = (input.preferred || []).slice();
    var opts = input.options || {};
    var windowDays = (opts.windowDays == null) ? 3 : opts.windowDays;
    var tolerance = toNumber(opts.tolerance);
    var positions = (input.positions || []).map(function(p){
      return { id: p.id, width: toNumber(p.width), qty: toNumber(p.qty),
               dueKey: isFinite(p.dueKey) ? p.dueKey : Infinity, stockable: !!p.stockable };
    });

    var groups = dueWindowGroups(positions, windowDays);
    var layouts = [];
    var skipped = [];

    groups.forEach(function(cluster){
      var clusterDueKey = Infinity;
      cluster.forEach(function(p){ if (p.dueKey < clusterDueKey) clusterDueKey = p.dueKey; });

      var pending = cluster.map(function(p){ return { width: p.width, qty: p.qty, positionId: p.id, stockable: p.stockable }; });
      var guard = 0;
      while (pending.length && guard++ < 100000) {
        var result = composeLayout(W, pending, preferred, tolerance);
        var ordered = [];
        result.strips.forEach(function(s){
          if (s.purpose === 'Заказ') {
            s.positionIds.forEach(function(pid){ if (ordered.indexOf(pid) < 0) ordered.push(pid); });
          }
        });
        // прогресс: хотя бы одна заказанная полоса уложена
        var madeProgress = ordered.length > 0;
        if (madeProgress) {
          layouts.push({
            positionsCovered: ordered,
            strips: result.strips,
            used: result.used,
            remainder: result.remainder,
            withinTolerance: result.withinTolerance,
            dueKey: clusterDueKey
          });
        }
        if (!result.overflow.length) break;
        if (!madeProgress) {
          // ничего не уложилось → остаток overflow не лезет (шире джамбо)
          result.overflow.forEach(function(o){ skipped.push({ positionId: o.positionId, reason: 'шире джамбо' }); });
          break;
        }
        pending = result.overflow.map(function(o){ return { width: o.width, qty: o.qty, positionId: o.positionId, stockable: o.stockable }; });
      }
    });

    return { layouts: layouts, skipped: skipped };
  }

  var layout = { toNumber: toNumber, round3: round3, dayDiff: dayDiff, dueWindowGroups: dueWindowGroups,
                 bestFill: bestFill, composeLayout: composeLayout,
                 combinationSignature: combinationSignature, planLayouts: planLayouts };

  if (typeof module !== 'undefined' && module.exports) module.exports = { layout: layout };
  if (typeof window !== 'undefined') window.AtexCutLayout = { layout: layout };
})();
