/*
 * Shared searchable reference input for Atex workplaces.
 *
 * Reference fields may contain hundreds or thousands of rows, so editable
 * workspaces should not render them as plain <select> controls. This helper
 * keeps a hidden id input for form logic, shows a searchable text input, and can
 * extend the local option cache through `_ref_reqs/{reqId}?JSON&LIMIT=50&q=...`.
 */
(function(root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.AtexRefSearch = api;
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(root) {
    'use strict';

    var DEFAULT_LIST_LIMIT = 50;
    var DEFAULT_SEARCH_LIMIT = 50;
    var DEFAULT_SEARCH_DELAY = 220;
    var sharedCache = {};
    var timers = {};
    var seq = 0;

    function trimText(value) {
        return String(value == null ? '' : value).trim();
    }

    function normalizeSearchText(value) {
        return trimText(value).toLowerCase().replace(/\s+/g, ' ');
    }

    function optionLabel(option) {
        if (!option) return '';
        return trimText(option.label || option.text || option.name || option.val || option.value || option.id);
    }

    function normalizeOption(item) {
        if (item == null) return null;
        var id = '';
        var label = '';
        if (Array.isArray(item)) {
            id = item[0];
            label = item[1];
        } else if (typeof item === 'object') {
            id = item.id != null ? item.id : (item.i != null ? item.i : (item.value != null ? item.value : item.key));
            label = item.label != null ? item.label :
                (item.text != null ? item.text :
                    (item.name != null ? item.name :
                        (item.val != null ? item.val :
                            (Array.isArray(item.r) ? item.r[0] : item.value))));
        } else {
            id = item;
            label = item;
        }
        id = trimText(id);
        label = trimText(label);
        if (!id && !label) return null;
        return { id: id || label, label: label || ('#' + id) };
    }

    function parseOptionsData(data) {
        var list = data;
        if (data && !Array.isArray(data) && typeof data === 'object') {
            if (Array.isArray(data.rows)) list = data.rows;
            else if (Array.isArray(data.items)) list = data.items;
            else if (Array.isArray(data.data)) list = data.data;
            else list = Object.keys(data).map(function(key) {
                return { id: key, label: data[key] };
            });
        }
        if (!Array.isArray(list)) return [];
        return list.map(normalizeOption).filter(Boolean);
    }

    function mergeOptions(existing, incoming) {
        var out = [];
        var byId = {};
        function add(option) {
            var normalized = normalizeOption(option);
            if (!normalized) return;
            var key = String(normalized.id);
            if (byId[key]) {
                byId[key].label = normalized.label || byId[key].label;
                return;
            }
            byId[key] = normalized;
            out.push(normalized);
        }
        (existing || []).forEach(add);
        (incoming || []).forEach(add);
        return out;
    }

    function findOption(options, value) {
        var wanted = trimText(value);
        if (!wanted) return null;
        for (var i = 0; i < (options || []).length; i++) {
            if (String(options[i].id) === wanted) return options[i];
        }
        return null;
    }

    function findOptionByInput(options, value) {
        var wanted = normalizeSearchText(value);
        if (!wanted) return null;
        for (var i = 0; i < (options || []).length; i++) {
            if (normalizeSearchText(optionLabel(options[i])) === wanted || normalizeSearchText(options[i].id) === wanted) {
                return options[i];
            }
        }
        return null;
    }

    function filterOptions(options, query, limit) {
        var normalized = normalizeSearchText(query);
        var max = limit || DEFAULT_LIST_LIMIT;
        var result = [];
        for (var i = 0; i < (options || []).length; i++) {
            var option = options[i];
            var haystack = normalizeSearchText(option.id + ' ' + optionLabel(option));
            if (!normalized || haystack.indexOf(normalized) !== -1) {
                result.push(option);
                if (result.length >= max) break;
            }
        }
        return result;
    }

    function buildRefOptionsPath(refReqId, query, limit) {
        var params = ['JSON', 'LIMIT=' + encodeURIComponent(String(limit || DEFAULT_SEARCH_LIMIT))];
        var q = trimText(query);
        if (q) params.push('q=' + encodeURIComponent(q));
        return '_ref_reqs/' + encodeURIComponent(refReqId) + '?' + params.join('&');
    }

    function buildRefOptionsUrl(db, refReqId, query, limit) {
        return '/' + encodeURIComponent(db || '') + '/' + buildRefOptionsPath(refReqId, query, limit);
    }

    function classList() {
        return Array.prototype.slice.call(arguments).filter(Boolean).join(' ');
    }

    function dataAttrName(key) {
        return 'data-' + String(key).replace(/[A-Z]/g, function(ch) { return '-' + ch.toLowerCase(); });
    }

    function setAttrs(node, attrs) {
        Object.keys(attrs || {}).forEach(function(key) {
            var value = attrs[key];
            if (value == null || value === false) return;
            if (key === 'class') node.className = value;
            else if (key === 'text') node.textContent = value;
            else if (key === 'dataset') {
                Object.keys(value || {}).forEach(function(dataKey) {
                    node.setAttribute(dataAttrName(dataKey), value[dataKey]);
                });
            } else {
                node.setAttribute(key, value === true ? '' : String(value));
            }
        });
    }

    function el(doc, tag, attrs, children) {
        var node = doc.createElement(tag);
        setAttrs(node, attrs || {});
        (children || []).forEach(function(child) {
            if (child == null) return;
            node.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
        });
        return node;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function attrsToHtml(attrs) {
        var parts = [];
        Object.keys(attrs || {}).forEach(function(key) {
            var value = attrs[key];
            if (value == null || value === false) return;
            if (key === 'dataset') {
                Object.keys(value || {}).forEach(function(dataKey) {
                    parts.push(dataAttrName(dataKey) + '="' + escapeHtml(value[dataKey]) + '"');
                });
                return;
            }
            parts.push(key + '="' + escapeHtml(value === true ? '' : value) + '"');
        });
        return parts.length ? ' ' + parts.join(' ') : '';
    }

    function optionNodesHtml(options) {
        return (options || []).map(function(option) {
            return '<option value="' + escapeHtml(optionLabel(option)) +
                '" data-ref-id="' + escapeHtml(option.id) + '"></option>';
        }).join('');
    }

    function getCache(cache, key, options, replace) {
        var target = cache || sharedCache;
        target[key] = replace
            ? parseOptionsData(options || [])
            : mergeOptions(target[key] || [], options || []);
        return target[key];
    }

    function setCache(cache, key, options) {
        var target = cache || sharedCache;
        target[key] = options || [];
    }

    function createSelect(opts) {
        opts = opts || {};
        var doc = opts.document || (root && root.document);
        if (!doc) throw new Error('AtexRefSearch.createSelect requires document');

        var prefix = opts.classPrefix || 'atex';
        var reqId = trimText(opts.reqId);
        var hiddenId = trimText((opts.hiddenAttrs && opts.hiddenAttrs.id) || opts.id || (prefix + '-ref-' + (++seq)));
        var listId = hiddenId + '-list';
        var inputId = hiddenId + '-search';
        var key = trimText(opts.cacheKey || reqId || hiddenId);
        var cache = opts.cache || sharedCache;
        var options = getCache(cache, key, opts.options, opts.replaceCache);
        var selected = findOption(options, opts.value);
        var selectedValue = trimText(opts.value);
        var lastNotified = selectedValue;
        var loadSeq = 0;
        var timer = null;

        var hiddenAttrs = Object.assign({}, opts.hiddenAttrs || {}, {
            type: 'hidden',
            id: hiddenId,
            value: selectedValue
        });
        var hidden = el(doc, 'input', hiddenAttrs);
        hidden.value = selectedValue;

        var input = el(doc, 'input', {
            id: inputId,
            class: classList(opts.inputClass, 'atex-ref-search', prefix + '-ref-search'),
            type: 'text',
            list: listId,
            role: 'combobox',
            autocomplete: 'off',
            placeholder: opts.placeholder || '',
            'aria-autocomplete': 'list',
            'aria-controls': listId
        });
        input.value = selected ? optionLabel(selected) : (opts.label || '');

        var datalist = el(doc, 'datalist', { id: listId });
        var clear = el(doc, 'button', {
            class: classList('atex-ref-clear', prefix + '-ref-clear'),
            type: 'button',
            title: opts.clearLabel || 'Очистить значение',
            'aria-label': opts.clearLabel || 'Очистить значение',
            text: '×'
        });
        var control = el(doc, 'div', { class: classList('atex-ref-control', prefix + '-ref-control') }, [input, clear]);
        var wrapper = el(doc, 'div', { class: classList('atex-ref-select', prefix + '-ref-select') }, [hidden, control, datalist]);

        function render(list) {
            datalist.innerHTML = '';
            filterOptions(list || options, input.value, opts.listLimit || DEFAULT_LIST_LIMIT).forEach(function(option) {
                datalist.appendChild(el(doc, 'option', {
                    value: optionLabel(option),
                    dataset: { refId: option.id }
                }));
            });
        }

        function notify(value) {
            value = trimText(value);
            if (value === lastNotified) return;
            lastNotified = value;
            if (typeof opts.onChange === 'function') opts.onChange(value);
        }

        function setHidden(value, shouldNotify) {
            hidden.value = trimText(value);
            if (shouldNotify) notify(hidden.value);
        }

        function syncFromInput() {
            var match = findOptionByInput(options, input.value);
            if (match) {
                setHidden(match.id, true);
            } else if (opts.clearOnInput !== false) {
                setHidden('', true);
            }
        }

        function scheduleLoad() {
            var query = trimText(input.value);
            if (!reqId || query.length < (opts.minSearchLength || 2) || typeof opts.loadOptions !== 'function') return;
            if (timer) (root.clearTimeout || clearTimeout)(timer);
            timer = (root.setTimeout || setTimeout)(function() {
                var ticket = ++loadSeq;
                opts.loadOptions(reqId, query, opts.searchLimit || DEFAULT_SEARCH_LIMIT).then(function(payload) {
                    if (ticket !== loadSeq) return;
                    options = mergeOptions(options, parseOptionsData(payload));
                    setCache(cache, key, options);
                    render(options);
                    syncFromInput();
                }).catch(function() {
                    // Search is an enhancement; keep local options if the endpoint is unavailable.
                });
            }, opts.searchDelay || DEFAULT_SEARCH_DELAY);
        }

        input.addEventListener('input', function() {
            syncFromInput();
            render(options);
            scheduleLoad();
        });
        input.addEventListener('change', syncFromInput);
        clear.addEventListener('click', function(event) {
            event.preventDefault();
            input.value = '';
            setHidden('', true);
            render(options);
            input.focus();
        });

        render(options);
        return wrapper;
    }

    function selectHtml(opts) {
        opts = opts || {};
        var prefix = opts.classPrefix || 'atex';
        var reqId = trimText(opts.reqId);
        var hiddenId = trimText((opts.hiddenAttrs && opts.hiddenAttrs.id) || opts.id || (prefix + '-ref-' + (++seq)));
        var listId = hiddenId + '-list';
        var key = trimText(opts.cacheKey || reqId || hiddenId);
        var cache = opts.cache || sharedCache;
        var options = getCache(cache, key, opts.options, opts.replaceCache);
        var selected = findOption(options, opts.value);
        var hiddenAttrs = Object.assign({}, opts.hiddenAttrs || {}, {
            type: 'hidden',
            id: hiddenId,
            value: trimText(opts.value)
        });
        var inputAttrs = {
            id: hiddenId + '-search',
            class: classList(opts.inputClass, 'atex-ref-search', prefix + '-ref-search'),
            type: 'text',
            list: listId,
            role: 'combobox',
            autocomplete: 'off',
            placeholder: opts.placeholder || '',
            value: selected ? optionLabel(selected) : (opts.label || ''),
            'aria-autocomplete': 'list',
            'aria-controls': listId,
            'data-atex-ref-search': hiddenId,
            'data-ref-key': key,
            'data-ref-req-id': reqId,
            'data-ref-clear-on-input': opts.clearOnInput === false ? '0' : '1'
        };
        return '<div class="' + escapeHtml(classList('atex-ref-select', prefix + '-ref-select')) + '">' +
            '<input' + attrsToHtml(hiddenAttrs) + '>' +
            '<div class="' + escapeHtml(classList('atex-ref-control', prefix + '-ref-control')) + '">' +
            '<input' + attrsToHtml(inputAttrs) + '>' +
            '<button class="' + escapeHtml(classList('atex-ref-clear', prefix + '-ref-clear')) +
            '" type="button" title="' + escapeHtml(opts.clearLabel || 'Очистить значение') +
            '" aria-label="' + escapeHtml(opts.clearLabel || 'Очистить значение') +
            '" data-atex-ref-clear="' + escapeHtml(hiddenId) + '">×</button>' +
            '</div><datalist id="' + escapeHtml(listId) + '">' +
            optionNodesHtml(filterOptions(options, '', opts.listLimit || DEFAULT_LIST_LIMIT)) +
            '</datalist></div>';
    }

    function dispatchChange(node) {
        if (!node) return;
        var doc = node.ownerDocument || (root && root.document);
        var event;
        if (typeof Event === 'function') {
            event = new Event('change', { bubbles: true });
        } else if (doc && doc.createEvent) {
            event = doc.createEvent('Event');
            event.initEvent('change', true, true);
        }
        if (event) node.dispatchEvent(event);
    }

    function renderHtmlOptions(input, options, limit) {
        var doc = input.ownerDocument;
        var datalist = doc.getElementById(input.getAttribute('list'));
        if (!datalist) return;
        datalist.innerHTML = optionNodesHtml(filterOptions(options, input.value, limit || DEFAULT_LIST_LIMIT));
    }

    function defaultLoadOptions(db, reqId, query, limit) {
        var currentFetch = root && root.fetch;
        if (typeof currentFetch !== 'function') return Promise.resolve([]);
        return currentFetch(buildRefOptionsUrl(typeof db === 'function' ? db() : db, reqId, query, limit), {
            credentials: 'same-origin'
        }).then(function(response) {
            return response.text().then(function(text) {
                return text ? JSON.parse(text) : [];
            });
        });
    }

    function syncHtmlInput(input, config) {
        var doc = input.ownerDocument;
        var hidden = doc.getElementById(input.getAttribute('data-atex-ref-search'));
        if (!hidden) return;
        var cache = config.cache || sharedCache;
        var key = input.getAttribute('data-ref-key') || hidden.id;
        var options = cache[key] || [];
        var match = findOptionByInput(options, input.value);
        var nextValue = match ? String(match.id) : '';
        var clearOnInput = input.getAttribute('data-ref-clear-on-input') !== '0';
        if (!match && !clearOnInput) {
            renderHtmlOptions(input, options, config.listLimit);
            return;
        }
        if (String(hidden.value || '') !== nextValue) {
            hidden.value = nextValue;
            dispatchChange(hidden);
        }
        renderHtmlOptions(input, options, config.listLimit);
    }

    function scheduleHtmlLoad(input, config) {
        var query = trimText(input.value);
        var reqId = input.getAttribute('data-ref-req-id') || '';
        if (!reqId || query.length < (config.minSearchLength || 2)) return;
        var hiddenId = input.getAttribute('data-atex-ref-search');
        if (timers[hiddenId]) (root.clearTimeout || clearTimeout)(timers[hiddenId]);
        timers[hiddenId] = (root.setTimeout || setTimeout)(function() {
            var cache = config.cache || sharedCache;
            var key = input.getAttribute('data-ref-key') || hiddenId;
            var loader = config.loadOptions || function(id, q, limit) {
                return defaultLoadOptions(config.db, id, q, limit);
            };
            Promise.resolve(loader(reqId, query, config.searchLimit || DEFAULT_SEARCH_LIMIT)).then(function(payload) {
                cache[key] = mergeOptions(cache[key] || [], parseOptionsData(payload));
                renderHtmlOptions(input, cache[key], config.listLimit);
                syncHtmlInput(input, config);
            }).catch(function() {
                // Search is an enhancement; keep the already rendered options.
            });
        }, config.searchDelay || DEFAULT_SEARCH_DELAY);
    }

    function attach(rootEl, config) {
        if (!rootEl) return;
        rootEl._atexRefSearchConfig = Object.assign({}, rootEl._atexRefSearchConfig || {}, config || {});
        if (rootEl._atexRefSearchAttached) return;
        rootEl._atexRefSearchAttached = true;

        rootEl.addEventListener('input', function(event) {
            var input = event.target && event.target.closest ? event.target.closest('[data-atex-ref-search]') : null;
            if (!input || !rootEl.contains(input)) return;
            var cfg = rootEl._atexRefSearchConfig || {};
            syncHtmlInput(input, cfg);
            scheduleHtmlLoad(input, cfg);
        });

        rootEl.addEventListener('change', function(event) {
            var input = event.target && event.target.closest ? event.target.closest('[data-atex-ref-search]') : null;
            if (!input || !rootEl.contains(input)) return;
            syncHtmlInput(input, rootEl._atexRefSearchConfig || {});
        });

        rootEl.addEventListener('click', function(event) {
            var button = event.target && event.target.closest ? event.target.closest('[data-atex-ref-clear]') : null;
            if (!button || !rootEl.contains(button)) return;
            event.preventDefault();
            var doc = button.ownerDocument;
            var hidden = doc.getElementById(button.getAttribute('data-atex-ref-clear'));
            if (!hidden) return;
            var input = doc.querySelector('[data-atex-ref-search="' + hidden.id.replace(/"/g, '\\"') + '"]');
            if (input) {
                input.value = '';
                renderHtmlOptions(input, (rootEl._atexRefSearchConfig.cache || sharedCache)[input.getAttribute('data-ref-key')] || [],
                    rootEl._atexRefSearchConfig.listLimit);
                input.focus();
            }
            if (hidden.value) {
                hidden.value = '';
                dispatchChange(hidden);
            }
        });
    }

    // Форматирование значения DATETIME (type 4): unix-штамп (секунды) →
    // «ДД.ММ.ГГГГ ЧЧ:ММ» в локальном времени. Пустое → ''. Не-числовое
    // (уже дата-строка) → возвращается как есть.
    function formatDateTime(value) {
        if (value == null || value === '') return '';
        var s = String(value).trim();
        if (!/^\d+$/.test(s)) return s;
        var d = new Date(Number(s) * 1000);
        if (isNaN(d.getTime())) return s;
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() +
            ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    return {
        cache: sharedCache,
        formatDateTime: formatDateTime,
        trimText: trimText,
        normalizeSearchText: normalizeSearchText,
        parseOptionsData: parseOptionsData,
        mergeOptions: mergeOptions,
        findOption: findOption,
        filterOptions: filterOptions,
        buildRefOptionsPath: buildRefOptionsPath,
        buildRefOptionsUrl: buildRefOptionsUrl,
        createSelect: createSelect,
        selectHtml: selectHtml,
        attach: attach
    };
});
