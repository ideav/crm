
// Global registry for all IntegramTable instances
if (typeof window !== 'undefined') {
    window._integramTableInstances = window._integramTableInstances || [];
}

// ── UI-settings persistence ──────────────────────────────────────────────
// View preferences (column order/visibility/width, table settings, form-field
// visibility/order, card layout) live in localStorage, not cookies. As cookies
// they were attached to every request to the whole ideav.ru origin and grew
// without bound — one entry per table and per database ever opened — until the
// combined Cookie header passed Apache's LimitRequestFieldSize and the server
// answered HTTP 400 ("Size of a request header field exceeds server limit") to
// every page on the domain. localStorage is never sent to the server.
//
// On first read of a key, any pre-existing cookie of the same name is copied
// into localStorage and then deleted, so saved preferences carry over and the
// bloated cookies clear themselves as the user navigates.

function itStorageGet(name) {
    let legacy = null;
    if (typeof document !== 'undefined' && document.cookie) {
        const parts = document.cookie.split(';');
        for (let i = 0; i < parts.length; i++) {
            const p = parts[i].trim();
            if (p.indexOf(name + '=') === 0) { legacy = p.slice(name.length + 1); break; }
        }
    }
    try {
        if (legacy !== null) {
            if (localStorage.getItem(name) === null && legacy !== '') {
                localStorage.setItem(name, legacy);
            }
            // Drop the legacy cookie to free request-header space.
            document.cookie = name + '=; path=/; max-age=0';
        }
        return localStorage.getItem(name);
    } catch (e) {
        // localStorage unavailable (private mode/quota) — fall back to the cookie value.
        return legacy;
    }
}

function itStorageSet(name, value) {
    try {
        localStorage.setItem(name, value);
        // Remove any stale cookie of the same name so it stops inflating headers.
        if (typeof document !== 'undefined' && document.cookie.indexOf(name + '=') !== -1) {
            document.cookie = name + '=; path=/; max-age=0';
        }
    } catch (e) {
        // localStorage unavailable — last-resort cookie so the setting still persists.
        try { document.cookie = name + '=' + value + '; path=/; max-age=31536000'; } catch (e2) { /* ignore */ }
    }
}

function itStorageRemove(name) {
    try { localStorage.removeItem(name); } catch (e) { /* ignore */ }
    try { document.cookie = name + '=; path=/; max-age=0'; } catch (e) { /* ignore */ }
}

// One-time sweep on script load: move every legacy UI-settings cookie into
// localStorage and delete it, so the Cookie header shrinks on the next page
// load even for tables the user does not reopen this session. Only names that
// match the component's own patterns are touched; integram-table-font-settings
// is shared with main.html (read there as a cookie) and is left in place.
function itMigrateLegacyUiCookies() {
    if (typeof document === 'undefined' || !document.cookie) return;
    if (typeof window !== 'undefined') {
        if (window.__itUiCookiesMigrated) return;
        window.__itUiCookiesMigrated = true;
    }
    const isUiKey = function(name) {
        if (name === 'integram-table-font-settings') return false;
        return /-state$/.test(name)
            || /-settings$/.test(name)
            || /-form-fields-/.test(name)
            || /-form-order-/.test(name)
            || /-form-show-delete-/.test(name);
    };
    const parts = document.cookie.split(';');
    for (let i = 0; i < parts.length; i++) {
        const p = parts[i].trim();
        const eq = p.indexOf('=');
        if (eq <= 0) continue;
        const name = p.slice(0, eq);
        if (!isUiKey(name)) continue;
        const value = p.slice(eq + 1);
        try {
            if (localStorage.getItem(name) === null && value !== '') {
                localStorage.setItem(name, value);
            }
        } catch (e) { /* ignore */ }
        document.cookie = name + '=; path=/; max-age=0';
    }
}

itMigrateLegacyUiCookies();

function parseIntegramAttrs(attrs) {
    const result = {
        required: false,
        multi: false,
        key: false,
        alias: null,
        defaultValue: null
    };

    if (!attrs) return result;

    const parseBool = (value) => {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        if (typeof value === 'string') {
            return !['', '0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
        }
        return Boolean(value);
    };
    const raw = String(attrs).trim();
    const parseJson = (text) => {
        if (!text || text.charAt(0) !== '{') return null;
        try {
            const parsed = JSON.parse(text);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
        } catch (e) {
            return null;
        }
    };
    const jsonAttrs = parseJson(raw) || parseJson(raw.replace(/\\"/g, '"'));

    if (jsonAttrs) {
        Object.keys(jsonAttrs).forEach((key) => {
            if (!['required', 'notNull', 'not_null', 'multi', 'key', 'alias', 'default', 'defaultValue'].includes(key)) {
                result[key] = jsonAttrs[key];
            }
        });
        result.required = parseBool(jsonAttrs.required ?? jsonAttrs.notNull ?? jsonAttrs.not_null);
        result.multi = parseBool(jsonAttrs.multi);
        result.key = parseBool(jsonAttrs.key);
        result.alias = jsonAttrs.alias ? String(jsonAttrs.alias) : null;
        const defaultValue = jsonAttrs.default ?? jsonAttrs.defaultValue;
        result.defaultValue = defaultValue !== undefined && defaultValue !== null && String(defaultValue).length > 0
            ? String(defaultValue)
            : null;
        return result;
    }

    result.required = raw.includes(':!NULL:');
    result.multi = raw.includes(':MULTI:');
    result.key = raw.includes(':KEY:');

    const aliasMatch = raw.match(/:ALIAS=(.*?):/u);
    if (aliasMatch) {
        result.alias = aliasMatch[1];
    }

    const stripped = raw
        .replace(/:!NULL:/g, '')
        .replace(/:MULTI:/g, '')
        .replace(/:KEY:/g, '')
        .replace(/:ALIAS=(.*?):/gu, '')
        .trim();
    if (stripped.length > 0) {
        result.defaultValue = stripped;
    }

    return result;
}

function serializeIntegramAttrs(attrs) {
    const source = attrs || {};
    const result = {};
    Object.keys(source).forEach((key) => {
        if (!['required', 'notNull', 'not_null', 'multi', 'key', 'alias', 'default', 'defaultValue'].includes(key) && source[key] !== null) {
            result[key] = source[key];
        }
    });
    if (source.required) result.required = true;
    if (source.multi) result.multi = true;
    if (source.key) result.key = true;
    if (source.alias) result.alias = String(source.alias);
    const defaultValue = source.defaultValue ?? source.default;
    if (defaultValue !== undefined && defaultValue !== null && String(defaultValue).length > 0) {
        result.default = String(defaultValue);
    }
    return Object.keys(result).length ? JSON.stringify(result) : '';
}

function setIntegramAttrFlag(attrs, flag, enabled) {
    const parsed = parseIntegramAttrs(attrs);
    parsed[flag] = Boolean(enabled);
    return serializeIntegramAttrs(parsed);
}

function setIntegramAttrAlias(attrs, alias) {
    const parsed = parseIntegramAttrs(attrs);
    parsed.alias = alias || null;
    return serializeIntegramAttrs(parsed);
}

function buildIntegramAttrs(defaultValue = '', required = false, multi = false, alias = null, key = false) {
    return serializeIntegramAttrs({ defaultValue, required, multi, alias, key });
}

if (typeof IntegramTable !== 'undefined') {
    IntegramTable.parseAttrsValue = parseIntegramAttrs;
    IntegramTable.serializeAttrsValue = serializeIntegramAttrs;
}
if (typeof window !== 'undefined') {
    window.parseIntegramAttrs = parseIntegramAttrs;
    window.serializeIntegramAttrs = serializeIntegramAttrs;
    window.buildIntegramAttrs = buildIntegramAttrs;
}

/**
 * Global function to reload all IntegramTable instances
 * Reloads all table components with their current filter parameters
 * This function is globally accessible and can be called from anywhere on the page
 *
 * @example
 * // Reload all tables on the page
 * reloadAllIntegramTables();
 */
function reloadAllIntegramTables() {
    if (typeof window !== 'undefined' && window._integramTableInstances) {
        window._integramTableInstances.forEach(instance => {
            if (instance && typeof instance.reload === 'function') {
                instance.reload();
            }
        });
    }
}

// Make the function globally accessible
if (typeof window !== 'undefined') {
    window.reloadAllIntegramTables = reloadAllIntegramTables;
}

/**
 * Global function to open a record creation form from anywhere on the page.
 * This function can be called independently of any IntegramTable instance.
 *
 * @param {number|string} tableTypeId - Required. ID of the table in which to create the record.
 * @param {number|string} parentId - Required. Parent ID to pass in the "up" parameter when creating the record.
 * @param {Object} [fieldValues={}] - Optional. Object with field values to pre-fill on the form.
 *                                    Keys should be in format "t{fieldId}", e.g. {'t3888': 357, 't3886': 'Отказались'}.
 *
 * @example
 * // Open form to create a record in table 3596 with parent 1
 * openCreateRecordForm(3596, 1);
 *
 * @example
 * // Open form with pre-filled field values
 * openCreateRecordForm(3596, 1, {'t3888': 357, 't3886': 'Отказались'});
 */
async function openCreateRecordForm(tableTypeId, parentId, fieldValues = {}) {
    if (!tableTypeId) {
        console.error('openCreateRecordForm: tableTypeId is required');
        return;
    }
    if (!parentId && parentId !== 0) {
        console.error('openCreateRecordForm: parentId is required');
        return;
    }

    try {
        // Determine API base from current page URL
        const pathParts = window.location.pathname.split('/');
        let apiBase = '';
        if (pathParts.length >= 2 && pathParts[1]) {
            apiBase = window.location.origin + '/' + pathParts[1];
        }

        if (!apiBase) {
            console.error('openCreateRecordForm: Could not determine API base URL');
            return;
        }

        const helper = new IntegramCreateFormHelper(apiBase, tableTypeId, parentId);
        const metadata = await helper.fetchMetadataStandalone(tableTypeId);

        // Convert fieldValues to recordData format for pre-filling
        // Input: {'t3888': 357, 't3886': 'Отказались'}
        // Output: {obj: {val: ''}, reqs: {3888: {value: 357}, 3886: {value: 'Отказались'}}}
        const recordData = {
            obj: { val: '', parent: parentId },
            reqs: {}
        };

        // Check if main field (t{tableTypeId}) is in fieldValues
        const mainFieldKey = `t${tableTypeId}`;
        if (fieldValues[mainFieldKey] !== undefined) {
            recordData.obj.val = fieldValues[mainFieldKey];
        }

        // Process other field values
        for (const [key, value] of Object.entries(fieldValues)) {
            // Match t{fieldId} format
            const match = key.match(/^t(\d+)$/);
            if (match) {
                const fieldId = match[1];
                // Skip main field as it's handled separately
                if (fieldId !== String(tableTypeId)) {
                    recordData.reqs[fieldId] = { value: value };
                }
            }
        }

        // Fetch parent info if parentId is not 1 (root)
        let parentInfo = null;
        if (String(parentId) !== '1') {
            try {
                const parentUrl = `${apiBase}/edit_obj/${parentId}?JSON`;
                const parentResponse = await fetch(parentUrl);
                if (parentResponse.ok) {
                    const parentData = await parentResponse.json();
                    if (parentData && parentData.obj && parentData.obj.val) {
                        parentInfo = {
                            id: parentData.obj.id,
                            val: parentData.obj.val,
                            typ_name: parentData.obj.typ_name
                        };
                    }
                }
            } catch (parentError) {
                // Silently fail - parent info is optional, form should still work
                console.warn('openCreateRecordForm: Could not fetch parent info:', parentError);
            }
        }

        // Create the modal using a minimal helper class instance.
        // This reuses the existing form rendering logic from IntegramTable.
        helper.renderCreateFormModal(metadata, recordData, fieldValues, parentInfo);

    } catch (error) {
        console.error('openCreateRecordForm: Error opening form:', error);
        // Show error toast if available
        if (typeof showToast === 'function') {
            showToast(`Ошибка: ${error.message}`, 'error');
        } else {
            console.error(`Ошибка: ${error.message}`);
        }
    }
}

/**
 * Helper class for rendering create form modals independently of IntegramTable instances.
 * This allows openCreateRecordForm to work without requiring an existing table on the page.
 */
