/**
 * Reproduces issue #2302: /table/{name} should resolve the table id from
 * global metadata before loading object/{id}/?JSON_OBJ.
 *
 * Run: node experiments/test-issue-2302-table-name-resolution.js
 */

const assert = require('assert');

global.window = {
    location: {
        hostname: 'example.test',
        pathname: '/crm/table/%D0%A1%D1%82%D1%80%D0%BE%D0%BA%D0%B0',
        search: '?F_U=1943'
    }
};

global.document = {
    querySelectorAll: () => []
};

const IntegramTable = require('../js/integram-table.js');

const metadata = [
    {
        id: '988',
        up: '0',
        type: '3',
        val: 'Строка',
        unique: '0',
        granted: 'WRITE',
        export: '1',
        delete: '1',
        reqs: []
    },
    {
        id: '986',
        up: '0',
        type: '8',
        val: 'Панель',
        granted: 'WRITE',
        export: '1',
        reqs: [
            {
                num: 1,
                id: '1036',
                val: 'Строка',
                orig: '997',
                type: '8',
                arr_id: '997'
            }
        ]
    },
    {
        id: '997',
        up: '0',
        type: '8',
        val: 'Строка',
        unique: '0',
        granted: 'WRITE',
        export: '1',
        delete: '1',
        reqs: [
            { num: 1, id: '8019', val: 'Примечание', orig: '35', type: '12' },
            { num: 2, id: '999', val: 'Уровень', orig: '998', type: '13' }
        ]
    }
];

function jsonResponse(body) {
    return {
        ok: true,
        statusText: 'OK',
        json: async () => body,
        text: async () => JSON.stringify(body)
    };
}

async function run() {
    const calls = [];
    global.fetch = async function(url) {
        calls.push(String(url));

        if (url === '/crm/metadata') {
            return jsonResponse(metadata);
        }

        if (url === '/crm/object/997/?JSON_OBJ&LIMIT=0,21&F_U=1943') {
            return jsonResponse([{ i: 2001, u: 1943, o: 0, r: ['A', 'note', '1'] }]);
        }

        throw new Error('Unexpected fetch URL: ' + url);
    };

    const table = Object.create(IntegramTable.prototype);
    Object.assign(table, {
        options: {
            apiUrl: '/crm/metadata/%D0%A1%D1%82%D1%80%D0%BE%D0%BA%D0%B0',
            tableTypeId: null,
            pageSize: 20,
            parentId: '1943',
            recordId: null
        },
        columns: [],
        loadedRecords: 0,
        groupingEnabled: false,
        groupingColumns: [],
        filters: {},
        sortColumn: null,
        sortDirection: null,
        objectTableId: null,
        tableGranted: null,
        globalMetadata: null,
        globalMetadataPromise: null,
        metadataCache: {},
        metadataFetchPromises: {}
    });

    table.globalMetadataPromise = table.loadGlobalMetadata();
    const result = await table.loadDataFromTable(false);

    assert.strictEqual(table.options.tableTypeId, '997');
    assert.strictEqual(table.objectTableId, '997');
    assert.deepStrictEqual(
        calls,
        [
            '/crm/metadata',
            '/crm/object/997/?JSON_OBJ&LIMIT=0,21&F_U=1943'
        ]
    );
    assert.deepStrictEqual(result.rows, [['A', 'note', '1']]);
    assert.strictEqual(result.columns[0].id, '997');

    console.log('Issue #2302 table name resolution test passed');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
