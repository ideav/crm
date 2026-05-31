#!/usr/bin/env node
'use strict';

/*
 * Regression for ideav/crm#3047.
 *
 * PR #3042 replaced the Atex orders reference <select> controls with searchable
 * comboboxes. This test keeps the same expectation for the remaining Atex
 * workplaces that still edit long reference lists.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const helper = require(path.join(root, 'download/atex/js/ref-search.js'));

const refSearch = read('download/atex/js/ref-search.js');
assert(refSearch.includes('AtexRefSearch'), 'shared Atex reference search helper exists');
assert(refSearch.includes('_ref_reqs'), 'reference helper can query server-side reference search');
assert(refSearch.includes('role: \'combobox\''), 'reference helper renders combobox inputs');

assert.strictEqual(
    helper.buildRefOptionsPath('1044', 'ПЭТ 12', 50),
    '_ref_reqs/1044?JSON&LIMIT=50&q=%D0%9F%D0%AD%D0%A2%2012',
    'helper builds the same server-side reference search endpoint as orders'
);
assert.deepStrictEqual(
    helper.parseOptionsData([{ i: 7, r: ['Материал'] }, { id: '8', label: 'Партия' }]),
    [{ id: '7', label: 'Материал' }, { id: '8', label: 'Партия' }],
    'helper normalizes reference endpoint payloads'
);
assert.deepStrictEqual(
    helper.mergeOptions([{ id: '7', label: 'Старое' }], [{ id: '7', label: 'Новое' }, { id: '9', label: 'Другое' }]),
    [{ id: '7', label: 'Новое' }, { id: '9', label: 'Другое' }],
    'helper merges server results into the local option cache'
);

[
    'templates/atex/intake.html',
    'templates/atex/cut-calc.html',
    'templates/atex/production-planning.html',
    'templates/atex/slitter.html',
    'templates/atex/sleeve-cutter.html',
    'templates/atex/warehouse.html'
].forEach((template) => {
    assert(read(template).includes('/js/ref-search.js'), `${template} loads the shared reference search helper`);
});

const cases = [
    {
        file: 'download/atex/js/intake.js',
        forbidden: "el('select', { class: 'atex-in-input', id: 'atex-in-material' })",
        required: ['AtexRefSearch', 'BATCH_REQ.material']
    },
    {
        file: 'download/atex/js/cut-calc.js',
        forbidden: "el('select', { class: 'atex-cc-input', id: 'atex-cc-material' })",
        required: ['AtexRefSearch', 'CUT_REQ.material']
    },
    {
        file: 'download/atex/js/production-planning.js',
        forbidden: "var sel = el('select', { class: 'atex-pp-input' });",
        required: ['AtexRefSearch', 'CUT_REQ.slitter', 'CUT_REQ.cutType', 'CUT_REQ.materialBatch']
    },
    {
        file: 'download/atex/js/slitter.js',
        forbidden: "var sel = el('select', { class: 'atex-sl-input' });",
        required: ['AtexRefSearch', 'CONS_REQ.batch']
    },
    {
        file: 'download/atex/js/sleeve-cutter.js',
        forbidden: "var sel = el('select', { class: 'atex-sc-input' });",
        required: ['AtexRefSearch', 'TASK_REQ.cutter']
    },
    {
        file: 'download/atex/js/warehouse.js',
        required: ['AtexRefSearch', 'helper.selectHtml', 'cuttingOptionsHtml', 'batchOptionsHtml']
    },
    {
        file: 'download/atex/js/warehouse.js',
        required: ['AtexRefSearch', 'helper.selectHtml', 'data-batch-pick']
    }
];

cases.forEach(({ file, forbidden, required }) => {
    const source = read(file);
    if (forbidden) {
        assert(!source.includes(forbidden), `${file} no longer renders the reference field as a native select`);
    }
    required.forEach((needle) => assert(source.includes(needle), `${file} includes ${needle}`));
});

const brandCss = read('download/atex/css/atex-brand.css');
assert(brandCss.includes('.atex-ref-select'), 'shared Atex styles cover reference combobox wrappers');
assert(brandCss.includes('.atex-ref-clear'), 'shared Atex styles cover reference combobox clear buttons');

console.log('issue-3047 Atex reference search regression checks passed');
