const fs = require('fs');

const source = fs.readFileSync('templates/forms.html', 'utf8');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function scriptIndex(src) {
    const marker = '<script src="' + src + '"';
    const index = source.indexOf(marker);
    assert(index !== -1, 'Missing script dependency: ' + src);
    return index;
}

const jqueryIndex = scriptIndex('https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js');
const jqueryUiIndex = scriptIndex('/js/jquery-ui1.12.1.min.js');
const pivotIndex = scriptIndex('/js/pivot.min.js');
const plotlyRenderersIndex = scriptIndex('/js/plotly_renderers.min.js');

assert(jqueryIndex < jqueryUiIndex, 'jQuery UI must load after jQuery');
assert(jqueryUiIndex < pivotIndex, 'PivotTable UI requires jQuery UI sortable before pivot.min.js');
assert(pivotIndex < plotlyRenderersIndex, 'Plotly pivot renderers must load after pivot.min.js');

console.log('issue-2172 pivot dependency order: ok');
