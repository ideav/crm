/**
 * Issue #2146: form reference labels returned as HTML entities should be
 * displayed and selected as decoded text inside .edit-form-modal.
 */
const assert = require('assert');

global.window = {
    location: { pathname: '/crm/table/100', search: '', origin: 'https://example.test' },
    _integramTableInstances: []
};

global.document = {
    readyState: 'loading',
    addEventListener() {},
    querySelectorAll() { return []; }
};

const IntegramTable = require('../js/integram-table.js');

const table = Object.create(IntegramTable.prototype);
const encoded = '17&ndash;19 апреля 2026 &laquo;Новая Истра&raquo;';
const decoded = '17\u201319 апреля 2026 \u00abНовая Истра\u00bb';

global.document.createElement = (tagName) => {
    if (tagName === 'textarea') {
        const textarea = { value: '' };
        Object.defineProperty(textarea, 'innerHTML', {
            set(value) {
                textarea.value = String(value)
                    .replace(/&ndash;/g, '\u2013')
                    .replace(/&laquo;/g, '\u00ab')
                    .replace(/&raquo;/g, '\u00bb');
            }
        });
        return textarea;
    }

    return {
        className: '',
        dataset: {},
        style: {},
        tabIndex: 0,
        textContent: ''
    };
};

(async () => {
    assert.strictEqual(
        table.decodeHtmlEntities(encoded),
        decoded,
        'decodeHtmlEntities should decode ndash and Russian quotes'
    );

    table.getApiBase = () => '/crm';
    table.refFetchCache = {};
    table.getServerError = () => null;
    global.fetch = async () => ({
        ok: true,
        text: async () => `{"42":"${encoded}"}`
    });

    const fetchedOptions = await table.fetchReferenceOptions('500');
    assert.deepStrictEqual(fetchedOptions, [['42', decoded]], 'fetchReferenceOptions should cache decoded labels');

    const dropdown = {
        innerHTML: '',
        children: [],
        appendChild(child) {
            this.children.push(child);
        }
    };

    table.renderFormReferenceOptions(dropdown, [['42', encoded]], { value: '42' }, {});

    assert.strictEqual(dropdown.children.length, 1, 'one reference option should be rendered');
    assert.strictEqual(dropdown.children[0].textContent, decoded, 'option text should be decoded');
    assert.strictEqual(dropdown.children[0].dataset.text, decoded, 'selected dataset text should be decoded');
    assert(!dropdown.children[0].textContent.includes('&ndash;'), 'encoded dash entity should not be visible');
    assert(!dropdown.children[0].textContent.includes('&laquo;'), 'encoded quote entity should not be visible');

    console.log('Issue #2146 reference entity decoding test passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
