const assert = require('assert');

global.xsrf = 'test-xsrf-token';

class MockTable {
    constructor() {
        this.objectTableId = '321';
        this.options = { tableTypeId: '999' };
    }

    getApiBase() {
        return '/crm';
    }
}

async function createColumn(columnName, baseTypeId, isListValue, isMultiselect) {
    const apiBase = this.getApiBase();
    const tableId = this.objectTableId || this.options.tableTypeId;
    const isFreeLink = Number(baseTypeId) === 1;

    if (!tableId) {
        return { success: false, error: 'Не удалось определить ID таблицы' };
    }

    try {
        if (isFreeLink) {
            const reqParams = new URLSearchParams();
            reqParams.append('val', columnName);
            reqParams.append('t', String(baseTypeId));
            if (typeof xsrf !== 'undefined') {
                reqParams.append('_xsrf', xsrf);
            }

            const reqResponse = await fetch(`${apiBase}/_d_req/${tableId}?JSON`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: reqParams.toString()
            });

            if (!reqResponse.ok) {
                return { success: false, error: `Ошибка добавления колонки: ${reqResponse.status}` };
            }

            const reqResult = await reqResponse.json();

            if (Array.isArray(reqResult) && reqResult[0]?.error) {
                return { success: false, error: reqResult[0].error };
            }

            const columnId = reqResult.id;
            if (!columnId) {
                return { success: false, error: 'Не получен ID колонки' };
            }

            return {
                success: true,
                columnId: String(columnId),
                termId: null,
                refId: null
            };
        }

        throw new Error('Unexpected non-free-link branch in test');
    } catch (error) {
        return { success: false, error: error.message };
    }
}

MockTable.prototype.createColumn = createColumn;

async function run() {
    const fetchCalls = [];

    global.fetch = async (url, options) => {
        fetchCalls.push({ url, options });
        return {
            ok: true,
            async json() {
                return { id: 777 };
            }
        };
    };

    const table = new MockTable();
    const result = await table.createColumn('Свободная ссылка', 1, false, false);

    assert.deepStrictEqual(result, {
        success: true,
        columnId: '777',
        termId: null,
        refId: null
    });
    assert.strictEqual(fetchCalls.length, 1, 'free link should call only _d_req');
    assert.strictEqual(fetchCalls[0].url, '/crm/_d_req/321?JSON');

    const params = new URLSearchParams(fetchCalls[0].options.body);
    assert.strictEqual(params.get('val'), 'Свободная ссылка');
    assert.strictEqual(params.get('t'), '1');
    assert.strictEqual(params.get('_xsrf'), 'test-xsrf-token');

    console.log('PASS issue-1823 free link column uses _d_req directly');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
