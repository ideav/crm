(function () {
  'use strict';

  var data;
  var currentStep = 1;
  var selectedCandidate = null;
  var decisions = [];
  var workingRows = [];
  var matchingTimer = null;
  var previewFileKey = null;
  var hasMatched = false;
  var apiAvailable = false;
  var apiRun = null;
  var serverSummary = null;
  var activeReview = null;
  var selectedFiles = {rfp:null, sku:null};
  var apiBase = ((document.querySelector('meta[name="xcom-api-base"]') || {}).content || '').replace(/\/$/, '');

  function byId(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];
    });
  }
  function money(value) {
    return value == null ? '—' : new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
  }
  function showToast(message) {
    var toast = byId('toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(function () { toast.classList.remove('is-visible'); }, 2600);
  }
  function statusInfo(row) {
    if (row.status === 'matched') return {text:'Сопоставлено', cls:'good'};
    if (row.status === 'review') return {text:'Нужна проверка', cls:'warn'};
    return {text:'Нет пары', cls:'empty'};
  }

  function apiUrl(path) { return apiBase + path; }
  function apiRequest(path, options) {
    return fetch(apiUrl(path), options || {}).then(function (response) {
      return response.text().then(function (body) {
        var payload;
        try { payload = body ? JSON.parse(body) : {}; } catch (_) { payload = {}; }
        if (!response.ok) throw new Error(payload.error || ('API вернул HTTP ' + response.status));
        return payload;
      });
    });
  }

  function pendingReviewCount() {
    if (apiRun && serverSummary) return Number(serverSummary.review || 0);
    return workingRows.filter(function (row) { return row.status === 'review'; }).length;
  }

  function exportIsReady() {
    return hasMatched && pendingReviewCount() === 0;
  }

  function updateJourney(pageId) {
    var ready = exportIsReady();
    document.querySelectorAll('[data-flow-page]').forEach(function (button) {
      var target = button.dataset.flowPage;
      button.disabled = target === 'review' ? !hasMatched : target === 'export' ? !ready : false;
      button.classList.toggle('is-current', target === pageId);
      button.classList.toggle('is-done', target === 'mass' ? hasMatched : target === 'review' ? ready : false);
    });
  }

  function showPage(pageId) {
    document.querySelectorAll('.page').forEach(function (page) { page.classList.toggle('is-active', page.id === pageId); });
    document.querySelectorAll('.nav-link').forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.mode === (pageId === 'setup' ? 'setup' : 'workspace'));
    });
    byId('workflow-chrome').hidden = pageId === 'setup';
    updateJourney(pageId);
    history.replaceState(null, '', '#' + pageId);
    window.scrollTo({top:0, behavior:'smooth'});
  }

  function roleKey(role) {
    return {'Наименование':'name', 'Артикул':'article', 'Производитель':'brand', 'Цена':'price'}[role] || '';
  }

  function renderMappings() {
    var roleHelp = {
      'Наименование': 'Для показа и текстового поиска',
      'Артикул': 'Самый точный идентификатор товара',
      'Производитель': 'Помогает не смешивать бренды',
      'Цена': 'Проверяет ограничение бюджета'
    };
    byId('mapping-body').innerHTML = data.mappings.map(function (item) {
      function select(value, columns, fileLabel, side) {
        var options = columns.slice();
        if (options.indexOf(value) < 0) options.push(value);
        options.push('Не используется');
        return '<select data-mapping-side="' + side + '" data-mapping-role="' + roleKey(item.role) + '" aria-label="Колонка для роли ' + escapeHtml(item.role) + ' ' + fileLabel + '">' + options.map(function (option) {
          return '<option' + (option === value ? ' selected' : '') + '>' + escapeHtml(option) + '</option>';
        }).join('') + '</select>';
      }
      return '<tr><td><b>' + escapeHtml(item.role) + '</b><small class="role-help">' + escapeHtml(roleHelp[item.role]) + '</small></td><td>' + select(item.rfp, data.files.rfp.columns, 'в заявке', 'rfp') + '</td><td>' + select(item.sku, data.files.sku.columns, 'в каталоге', 'sku') +
        '</td><td><span class="confidence"><progress max="100" value="' + item.confidence + '"></progress><b>' + item.confidence + '%</b></span></td></tr>';
    }).join('');
  }

  function mappingPayload() {
    var mapping = {rfp:{}, sku:{}};
    document.querySelectorAll('[data-mapping-side]').forEach(function (select) {
      if (select.value !== 'Не используется') mapping[select.dataset.mappingSide][select.dataset.mappingRole] = select.value;
    });
    return mapping;
  }

  function renderWizard() {
    byId('step-number').textContent = currentStep;
    document.querySelectorAll('.wizard-step').forEach(function (step) {
      step.classList.toggle('is-active', Number(step.dataset.step) === currentStep);
    });
    document.querySelectorAll('.stepper li').forEach(function (item, index) {
      item.classList.toggle('is-active', index + 1 === currentStep);
      item.classList.toggle('is-done', index + 1 < currentStep);
    });
    byId('wizard-back').disabled = currentStep === 1;
    byId('wizard-next').hidden = currentStep === 4;
    byId('wizard-next').textContent = currentStep === 1 ? 'Проверить колонки' : currentStep === 2 ? 'Настроить правила' : 'Сохранить профиль';
  }

  function renderMass(rows) {
    if (!rows.length) {
      byId('result-body').innerHTML = '<tr><td colspan="4" class="empty-cell">Сопоставление ещё не запускалось</td></tr>';
      return;
    }
    byId('result-body').innerHTML = rows.map(function (row) {
      var status = statusInfo(row);
      return '<tr><td><b>' + escapeHtml(row.source) + '</b><br><small>' + escapeHtml(row.sourceId) + '</small></td>' +
        '<td>' + escapeHtml(row.target) + '</td><td><b>' + row.accuracy + '%</b></td><td><span class="tag ' + status.cls + '">' + status.text + '</span></td></tr>';
    }).join('');
  }

  function currentSummary(rows) {
    if (apiRun && serverSummary) return serverSummary;
    return (rows || []).reduce(function (summary, row) {
      summary.total += 1;
      if (row.status === 'matched') summary.matched += 1;
      else if (row.status === 'review') summary.review += 1;
      else summary.empty += 1;
      return summary;
    }, {total:0, matched:0, review:0, empty:0});
  }

  function updateStats(rows) {
    var summary = currentSummary(rows);
    byId('total-stat').textContent = summary.total;
    byId('found-stat').textContent = summary.matched;
    byId('review-stat').textContent = summary.review;
    byId('empty-stat').textContent = summary.empty;
  }

  function prepareNewRun() {
    if (matchingTimer) {
      window.clearInterval(matchingTimer);
      matchingTimer = null;
    }
    workingRows = [];
    selectedCandidate = null;
    decisions = [];
    hasMatched = false;
    apiRun = null;
    serverSummary = null;
    activeReview = null;
    byId('progress-panel').hidden = true;
    byId('match-progress').value = 0;
    byId('progress-count').textContent = '0 из 0';
    byId('start-match').disabled = Boolean(selectedFiles.rfp) !== Boolean(selectedFiles.sku);
    byId('start-match').textContent = 'Запустить сопоставление';
    byId('run-status-pill').textContent = 'Готово к запуску';
    byId('run-status-pill').classList.remove('success');
    byId('mass-status').textContent = 'После запуска результаты появятся здесь.';
    byId('mass-next').hidden = true;
    byId('decision-history').innerHTML = '<li>Решений пока нет.</li>';
    byId('ai-note').hidden = true;
    byId('ask-llm').textContent = 'Получить рекомендацию ИИ';
    renderMass([]);
    updateStats([]);
    renderCandidates();
    renderReviewState();
    renderExport();
    updateJourney('mass');
  }

  function setRunBusy(message) {
    byId('start-match').disabled = true;
    byId('run-status-pill').textContent = message || 'Обработка…';
    byId('progress-panel').hidden = false;
    byId('mass-status').textContent = 'Сервер принял файлы и выполняет сопоставление.';
    renderMass([]);
    updateStats([]);
  }

  function finishMatching(summary, shownCount, totalCount) {
    hasMatched = true;
    byId('start-match').disabled = false;
    byId('start-match').textContent = 'Запустить заново';
    byId('run-status-pill').textContent = 'Сопоставление завершено';
    byId('run-status-pill').classList.add('success');
    byId('mass-status').textContent = summary.matched + ' сопоставлено автоматически, ' + summary.review + ' ждёт решения, без пары — ' + summary.empty + '.' +
      (totalCount > shownCount ? ' В таблице показаны первые ' + shownCount + ' из ' + totalCount + '; полная выгрузка формируется сервером.' : '');
    byId('mass-next').hidden = pendingReviewCount() === 0;
    byId('mass-next-title').textContent = 'Проверьте спорные позиции: ' + summary.review;
    byId('mass-next-copy').textContent = 'Надёжные совпадения уже подтверждены автоматически, остальные решения сохраняются через API.';
    renderReviewState();
    renderExport();
    updateJourney('mass');
    showToast(apiRun ? 'Сопоставление завершено на сервере' : 'Сопоставление завершено');
  }

  function startStaticMatching() {
    prepareNewRun();
    workingRows = JSON.parse(JSON.stringify(data.results));
    var processed = 0;
    var total = workingRows.length;
    setRunBusy('Обработка макета…');
    byId('match-progress').max = total;
    matchingTimer = window.setInterval(function () {
      processed += 1;
      var visible = workingRows.slice(0, processed);
      byId('match-progress').value = processed;
      byId('progress-count').textContent = processed + ' из ' + total;
      byId('progress-label').textContent = processed === total ? 'Обработка завершена' : 'Проверяем ' + workingRows[processed - 1].sourceId;
      renderMass(visible);
      updateStats(visible);
      if (processed === total) {
        window.clearInterval(matchingTimer);
        matchingTimer = null;
        finishMatching(currentSummary(workingRows), workingRows.length, workingRows.length);
      }
    }, 360);
  }

  function uploadRunFile(runId, role, file) {
    return fetch(apiUrl('/demo/api/runs/' + runId + '/files/' + role + '?filename=' + encodeURIComponent(file.name)), {
      method: 'PUT', headers: {'Content-Type': file.type || 'application/octet-stream'}, body: file
    }).then(function (response) {
      return response.text().then(function (body) {
        var payload;
        try { payload = JSON.parse(body); } catch (_) { payload = {}; }
        if (!response.ok) throw new Error(payload.error || 'Не удалось загрузить ' + file.name);
        return payload;
      });
    });
  }

  function pollApiRun() {
    if (!apiRun) return;
    apiRequest('/demo/api/runs/' + apiRun.id).then(function (payload) {
      apiRun = payload.run;
      var progress = apiRun.progress || {processed:0, total:0};
      byId('match-progress').max = Math.max(1, progress.total || 1);
      byId('match-progress').value = progress.processed || 0;
      byId('progress-count').textContent = (progress.processed || 0) + ' из ' + (progress.total || '?');
      byId('progress-label').textContent = apiRun.phase === 'reading' ? 'Сервер читает файлы…' : apiRun.phase === 'persisting' ? 'Записываем результат в Integram…' : 'Сопоставлено строк: ' + (progress.processed || 0);
      if (apiRun.status === 'done') {
        serverSummary = apiRun.summary;
        return Promise.all([
          apiRequest('/demo/api/runs/' + apiRun.id + '/results?offset=0&limit=100'),
          apiRequest('/demo/api/runs/' + apiRun.id + '/results?status=review&limit=1')
        ]).then(function (pages) {
          workingRows = pages[0].rows;
          activeReview = pages[1].rows[0] || null;
          renderMass(workingRows);
          updateStats(workingRows);
          byId('api-result-link').href = apiUrl('/demo/api/runs/' + apiRun.id + '/results?offset=0&limit=100');
          byId('api-result-link').textContent = 'Открыть результат API';
          finishMatching(serverSummary, workingRows.length, pages[0].total);
        });
      }
      if (apiRun.status === 'error') throw new Error(apiRun.error || 'Сервер не смог обработать файлы');
      matchingTimer = window.setTimeout(pollApiRun, 450);
    }).catch(function (error) {
      matchingTimer = null;
      byId('start-match').disabled = false;
      byId('run-status-pill').textContent = 'Ошибка обработки';
      byId('mass-status').textContent = error.message;
      showToast(error.message);
    });
  }

  function startApiMatching() {
    prepareNewRun();
    setRunBusy(selectedFiles.rfp ? 'Загружаем файлы…' : 'Готовим серверную задачу…');
    apiRequest('/demo/api/runs', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({demo: !selectedFiles.rfp})
    }).then(function (payload) {
      apiRun = payload.run;
      if (!selectedFiles.rfp) return null;
      return Promise.all([uploadRunFile(apiRun.id, 'rfp', selectedFiles.rfp), uploadRunFile(apiRun.id, 'sku', selectedFiles.sku)]);
    }).then(function () {
      return apiRequest('/demo/api/runs/' + apiRun.id + '/start', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({threshold:Number(byId('threshold').value), grayZoneMin:30, mapping:mappingPayload()})
      });
    }).then(function (payload) {
      apiRun = payload.run;
      byId('run-status-pill').textContent = 'Сервер обрабатывает…';
      pollApiRun();
    }).catch(function (error) {
      apiRun = null;
      byId('start-match').disabled = false;
      byId('run-status-pill').textContent = 'Не удалось запустить';
      byId('mass-status').textContent = error.message;
      showToast(error.message);
    });
  }

  function startMatching() {
    if (matchingTimer) return;
    if (Boolean(selectedFiles.rfp) !== Boolean(selectedFiles.sku)) return showToast('Выберите оба файла: заявку и каталог');
    if (apiAvailable) startApiMatching();
    else startStaticMatching();
  }

  function activeReviewRow() {
    if (activeReview && activeReview.status === 'review') return activeReview;
    return workingRows.find(function (row) { return row.status === 'review'; }) || null;
  }

  function reviewCandidates() {
    var row = activeReviewRow();
    return row && row.candidates && row.candidates.length ? row.candidates : data.candidates;
  }

  function renderReviewSource(row) {
    byId('review-source-name').textContent = row ? row.source : 'Все позиции проверены';
    var details = row && row.sourceDetails ? Object.keys(row.sourceDetails).filter(function (key) {
      return String(row.sourceDetails[key]) !== String(row.source) && String(row.sourceDetails[key]) !== String(row.sourceId);
    }).slice(0, 6) : [];
    byId('review-source-details').innerHTML = details.length ? details.map(function (key) {
      return '<div><dt>' + escapeHtml(key) + '</dt><dd>' + escapeHtml(row.sourceDetails[key]) + '</dd></div>';
    }).join('') : (row ? '<div><dt>ID</dt><dd>' + escapeHtml(row.sourceId) + '</dd></div>' : '');
  }

  function renderCandidates() {
    var row = activeReviewRow();
    var resolved = hasMatched && pendingReviewCount() === 0;
    var candidates = row ? reviewCandidates() : [];
    byId('candidate-list').innerHTML = candidates.length ? candidates.map(function (item) {
      return '<button type="button" class="candidate' + (selectedCandidate === item.id ? ' is-selected' : '') + '" data-candidate="' + escapeHtml(item.id) + '"' + (resolved ? ' disabled' : '') + '>' +
        '<div class="candidate-head"><div><h2>' + escapeHtml(item.name) + '</h2><p>' + escapeHtml(item.details || '') + '</p></div><strong>' + item.accuracy + '%</strong></div>' +
        '<div class="candidate-meta"><span>' + escapeHtml(item.brand || '') + '</span><b>' + money(item.price) + '</b>' +
        (item.recommended ? '<span class="recommended">Лучшее совпадение</span>' : '') + '</div></button>';
    }).join('') : '<div class="panel"><p class="muted">Спорных позиций больше нет.</p></div>';
    byId('accept-candidate').disabled = resolved || !selectedCandidate;
    byId('decision-hint').textContent = resolved ? 'Все решения записаны' : selectedCandidate ? 'Выбран товар ' + selectedCandidate : 'Выберите подходящий товар';
  }

  function renderReviewState() {
    var count = pendingReviewCount();
    var resolved = hasMatched && count === 0;
    var row = activeReviewRow();
    byId('review-queue-pill').textContent = resolved ? 'Проверка завершена' : 'Осталось позиций: ' + count;
    byId('review-queue-pill').classList.toggle('success', resolved);
    byId('review-title').textContent = resolved ? 'Проверка завершена' : row ? 'Выберите товар для позиции' : 'Загружаем следующую позицию…';
    byId('review-description').textContent = resolved ? 'Все автоматические предположения проверены, итоговые статусы сохранены.' : 'Автоматического решения недостаточно. Сравните кандидатов или запросите объяснимую рекомендацию.';
    byId('review-next').hidden = !resolved;
    byId('ask-llm').disabled = resolved || !row;
    byId('reject-all').disabled = resolved || !row;
    renderReviewSource(row);
    renderCandidates();
  }

  function addDecision(text) {
    decisions.unshift(new Date().toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'}) + ' · ' + text);
    byId('decision-history').innerHTML = decisions.map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('');
  }

  function replaceWorkingRow(updated) {
    var index = workingRows.findIndex(function (row) { return String(row.sourceId) === String(updated.sourceId); });
    if (index >= 0) workingRows[index] = updated;
  }

  function loadNextReview() {
    if (!apiRun || !serverSummary || !serverSummary.review) {
      activeReview = null;
      renderReviewState();
      renderExport();
      return Promise.resolve();
    }
    return apiRequest('/demo/api/runs/' + apiRun.id + '/results?status=review&limit=1').then(function (payload) {
      activeReview = payload.rows[0] || null;
      selectedCandidate = null;
      renderReviewState();
      renderExport();
    });
  }

  function saveDecision(targetId) {
    var row = activeReviewRow();
    if (!row) return;
    var candidate = reviewCandidates().find(function (item) { return String(item.id) === String(targetId); });
    byId('accept-candidate').disabled = true;
    byId('reject-all').disabled = true;
    if (apiRun) {
      apiRequest('/demo/api/runs/' + apiRun.id + '/decisions', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({sourceId:row.sourceId, targetId:targetId || null})
      }).then(function (payload) {
        replaceWorkingRow(payload.row);
        serverSummary = payload.summary;
        addDecision(targetId ? 'подтверждён ' + targetId + ' для ' + row.sourceId : 'все кандидаты отклонены для ' + row.sourceId);
        activeReview = null;
        selectedCandidate = null;
        renderMass(workingRows);
        updateStats(workingRows);
        return loadNextReview();
      }).then(function () { showToast('Решение сохранено через API'); })
        .catch(function (error) { renderReviewState(); showToast(error.message); });
      return;
    }
    if (candidate) {
      row.targetId = candidate.id; row.target = candidate.name; row.accuracy = candidate.accuracy;
      row.status = 'matched'; row.price = candidate.price;
      addDecision('подтверждён ' + candidate.id + ' для ' + row.sourceId);
    } else {
      row.targetId = null; row.target = 'Подходящий товар не найден'; row.accuracy = 0;
      row.status = 'empty'; row.price = null;
      addDecision('все кандидаты отклонены для ' + row.sourceId);
    }
    selectedCandidate = null;
    renderReviewState(); renderMass(workingRows); updateStats(workingRows); renderExport();
    showToast('Решение сохранено в журнале');
  }

  function acceptCandidate() { if (selectedCandidate) saveDecision(selectedCandidate); }
  function rejectAll() { saveDecision(null); }

  function askLlm() {
    var button = byId('ask-llm');
    var note = byId('ai-note');
    button.disabled = true;
    button.textContent = 'Анализируем характеристики…';
    note.hidden = true;
    var candidate = reviewCandidates()[0];
    if (!candidate) return;
    window.setTimeout(function () {
      selectedCandidate = candidate.id;
      renderCandidates();
      note.innerHTML = '<b>Рекомендация: ' + escapeHtml(candidate.name) + '.</b><br>Это первый кандидат серверного шорт-листа. Перед подтверждением проверьте характеристики и ограничения заявки.';
      note.hidden = false;
      button.disabled = false;
      button.textContent = 'Обновить рекомендацию ИИ';
      showToast('Рекомендация готова');
    }, 650);
  }

  function exportRows() {
    return workingRows.map(function (row) {
      return {
        'ID заявки': row.sourceId,
        'Позиция заявки': row.source,
        'ID товара': row.targetId || '',
        'Подобранный товар': row.target,
        'Совпадение, %': row.accuracy,
        'Статус': statusInfo(row).text,
        'Цена, руб.': row.price || ''
      };
    });
  }

  function renderExport() {
    var summary = currentSummary(workingRows);
    var attention = pendingReviewCount();
    var ready = exportIsReady();
    byId('total-export').textContent = summary.total;
    byId('confirmed-export').textContent = summary.matched;
    byId('empty-export').textContent = summary.empty;
    byId('attention-export').textContent = attention;
    byId('export-body').innerHTML = workingRows.map(function (row) {
      var status = statusInfo(row);
      return '<tr><td>' + escapeHtml(row.sourceId) + '</td><td>' + escapeHtml(row.target) + '</td><td>' + row.accuracy + '%</td><td><span class="tag ' + status.cls + '">' + status.text + '</span></td></tr>';
    }).join('');
    byId('download-export').disabled = !ready;
    byId('export-blocker').hidden = ready;
    byId('completion-note').hidden = !ready;
    byId('export-status-pill').textContent = ready ? 'Готово к выгрузке' : attention ? 'Осталось решений: ' + attention : 'Сначала запустите сопоставление';
    byId('export-status-pill').classList.toggle('success', ready);
    byId('export-description').textContent = ready ? 'Проверка завершена. Сервер подготовит полный Excel или JSON, даже если предпросмотр показывает только первые строки.' : 'Выгрузка откроется после того, как все спорные позиции получат итоговый статус.';
    updateJourney(document.querySelector('.page.is-active') ? document.querySelector('.page.is-active').id : 'mass');
  }

  function downloadBlob(contents, type, filename) {
    var url = URL.createObjectURL(contents instanceof Blob ? contents : new Blob([contents], {type:type}));
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function downloadExport() {
    if (!exportIsReady()) {
      showToast('Сначала завершите проверку');
      return;
    }
    var format = byId('export-format').value;
    if (apiRun) {
      fetch(apiUrl('/demo/api/runs/' + apiRun.id + '/export?format=' + format)).then(function (response) {
        if (!response.ok) throw new Error('Сервер не подготовил выгрузку');
        return response.blob();
      }).then(function (blob) {
        downloadBlob(blob, blob.type, 'xcom-matching.' + format);
        showToast('Полная выгрузка получена от сервера');
      }).catch(function (error) { showToast(error.message); });
      return;
    }
    var rows = exportRows();
    if (format === 'json') {
      var columns = Object.keys(rows[0]);
      var payload = window.XcomExportWorkspace ?
        window.XcomExportWorkspace.buildJsonPayload(rows, columns, {database:'demo', report:'matching_export'}) :
        {meta:{database:'demo', report:'matching_export'}, rows:rows};
      downloadBlob(JSON.stringify(payload, null, 2), 'application/json;charset=utf-8', 'xcom-matching-demo.json');
      showToast('JSON подготовлен');
      return;
    }
    if (!window.XLSX) {
      showToast('Библиотека Excel не загрузилась');
      return;
    }
    var sheet = window.XLSX.utils.json_to_sheet(rows);
    var book = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(book, sheet, 'Сопоставление');
    window.XLSX.writeFile(book, 'xcom-matching-demo.xlsx');
    showToast('Excel подготовлен');
  }

  function downloadSourceFile(fileKey) {
    var file = data.files && data.files[fileKey];
    if (!file || !window.XLSX) {
      showToast('Не удалось подготовить Excel');
      return;
    }
    var sheet = window.XLSX.utils.json_to_sheet(file.rows, {header:file.columns});
    var book = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(book, sheet, file.sheet);
    window.XLSX.writeFile(book, file.filename);
    showToast('Файл «' + file.filename + '» подготовлен');
  }

  function renderFilePreview(fileKey) {
    var file = data.files && data.files[fileKey];
    var activePage = document.querySelector('.page.is-active');
    var prefix = activePage && activePage.id === 'mass' ? 'run-file-preview' : 'file-preview';
    if (!file) return;
    byId(prefix + '-title').textContent = file.filename;
    byId(prefix + '-meta').textContent = 'Лист «' + file.sheet + '», ' + file.rows.length + ' строк';
    byId(prefix + '-head').innerHTML = '<tr>' + file.columns.map(function (column) {
      return '<th>' + escapeHtml(column) + '</th>';
    }).join('') + '</tr>';
    byId(prefix + '-body').innerHTML = file.rows.map(function (row) {
      return '<tr>' + file.columns.map(function (column) {
        return '<td>' + escapeHtml(row[column]) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    previewFileKey = fileKey;
    byId(prefix).hidden = false;
    byId(prefix).scrollIntoView({behavior:'smooth', block:'nearest'});
  }

  function updateFileSelection(role, file) {
    selectedFiles[role] = file || null;
    var fallback = data.files[role];
    byId('run-' + role + '-name').textContent = file ? file.name : fallback.filename;
    byId('run-' + role + '-meta').textContent = file ? 'Свой файл · ' + Math.max(1, Math.round(file.size / 1024)) + ' КБ' : fallback.rows.length + ' позиций · лист «' + fallback.sheet + '»';
    var incomplete = Boolean(selectedFiles.rfp) !== Boolean(selectedFiles.sku);
    byId('start-match').disabled = incomplete;
    byId('run-explanation').innerHTML = incomplete ? '<b>Нужен второй файл.</b> Выберите и заявку, и каталог.' : selectedFiles.rfp ? '<b>Что произойдёт:</b> оба файла потоково отправятся в API; разбор Excel и сопоставление выполнит серверная задача.' : '<b>Что произойдёт:</b> безопасные примеры пройдут через тот же серверный API, что и пользовательские файлы.';
  }

  function setApiMode(live, detail) {
    apiAvailable = live;
    var badge = byId('execution-badge');
    var note = byId('api-mode-note');
    badge.classList.toggle('is-live', live);
    badge.classList.toggle('is-static', !live);
    note.classList.toggle('is-live', live);
    note.classList.toggle('is-static', !live);
    badge.textContent = live ? 'Серверная обработка' : 'Учебный макет';
    note.textContent = live ? 'API доступен: файлы обрабатываются отдельным серверным worker, результаты отдаются постранично.' : 'На статическом GitHub Pages доступен только учебный сценарий. Для своих файлов откройте демо через API-сервер.';
    ['run-rfp-input', 'run-sku-input'].forEach(function (id) { byId(id).disabled = !live; });
    if (!live && detail) note.title = detail;
  }

  function detectApi() {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeout = window.setTimeout(function () { if (controller) controller.abort(); }, 1800);
    return fetch(apiUrl('/demo/api/health'), {signal:controller ? controller.signal : undefined}).then(function (response) {
      if (!response.ok) throw new Error('API unavailable');
      return response.json();
    }).then(function (health) {
      window.clearTimeout(timeout);
      setApiMode(health && health.execution === 'server-worker');
      if (health && health.backend === 'integram') byId('api-mode-note').textContent = 'API доступен: файлы обрабатываются сервером и пакетно записываются в Integram.';
    }).catch(function (error) {
      window.clearTimeout(timeout);
      setApiMode(false, error.message);
    });
  }

  function bindEvents() {
    document.addEventListener('click', function (event) {
      var pageButton = event.target.closest('[data-page], [data-go]');
      if (pageButton && !pageButton.disabled) {
        if (pageButton.dataset.setupStep) {
          currentStep = Number(pageButton.dataset.setupStep);
          renderWizard();
        }
        if (pageButton.closest('#completion-note')) prepareNewRun();
        showPage(pageButton.dataset.page || pageButton.dataset.go);
      }
      var candidate = event.target.closest('[data-candidate]');
      if (candidate) {
        selectedCandidate = candidate.dataset.candidate;
        renderCandidates();
      }
      var previewButton = event.target.closest('[data-preview-file]');
      if (previewButton) renderFilePreview(previewButton.dataset.previewFile);
      var downloadButton = event.target.closest('[data-download-file]');
      if (downloadButton) downloadSourceFile(downloadButton.dataset.downloadFile);
    });
    byId('wizard-next').addEventListener('click', function () {
      if (currentStep < 4) currentStep += 1;
      renderWizard();
      if (currentStep === 4) showToast('Профиль «Офисное оборудование» сохранён');
    });
    byId('wizard-back').addEventListener('click', function () { if (currentStep > 1) currentStep -= 1; renderWizard(); });
    byId('threshold').addEventListener('input', function (event) {
      byId('threshold-value').textContent = event.target.value + '%';
      byId('saved-threshold').textContent = event.target.value + '%';
    });
    byId('run-rfp-input').addEventListener('change', function () { updateFileSelection('rfp', this.files[0]); });
    byId('run-sku-input').addEventListener('change', function () { updateFileSelection('sku', this.files[0]); });
    byId('start-match').addEventListener('click', startMatching);
    byId('ask-llm').addEventListener('click', askLlm);
    byId('accept-candidate').addEventListener('click', acceptCandidate);
    byId('reject-all').addEventListener('click', rejectAll);
    byId('download-export').addEventListener('click', downloadExport);
    byId('file-preview-download').addEventListener('click', function () { downloadSourceFile(previewFileKey); });
    byId('close-file-preview').addEventListener('click', function () { byId('file-preview').hidden = true; });
    byId('close-run-file-preview').addEventListener('click', function () { byId('run-file-preview').hidden = true; });
  }

  fetch('./demo-data.json')
    .then(function (response) { if (!response.ok) throw new Error('Данные демо недоступны'); return response.json(); })
    .then(function (payload) {
      data = payload;
      workingRows = JSON.parse(JSON.stringify(data.results));
      var initialPage = location.hash.slice(1);
      initialPage = ['setup','mass','review','export'].indexOf(initialPage) >= 0 ? initialPage : 'setup';
      if (initialPage === 'review' || initialPage === 'export') {
        hasMatched = true;
        renderMass(workingRows);
        updateStats(workingRows);
        byId('mass-status').textContent = '3 позиции сопоставлены автоматически, 1 ждёт решения, для 1 пары нет.';
        byId('mass-next').hidden = false;
        byId('run-status-pill').textContent = 'Сопоставление завершено';
        byId('run-status-pill').classList.add('success');
      }
      renderMappings();
      renderWizard();
      renderReviewState();
      renderExport();
      bindEvents();
      updateFileSelection('rfp', null);
      updateFileSelection('sku', null);
      setApiMode(false);
      detectApi();
      showPage(initialPage);
    })
    .catch(function (error) {
      document.querySelector('main').innerHTML = '<div class="panel"><h1>Демо не загрузилось</h1><p>' + escapeHtml(error.message) + '</p></div>';
    });
})();
