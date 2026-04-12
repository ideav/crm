// Test URL parsing logic from the auto-detection code

function testUrlParsing(pathname, search) {
    var pathParts = pathname.split('/').filter(function(p) { return p !== ''; });
    var kanbanIdx = -1;
    for (var i = 0; i < pathParts.length; i++) {
        if (pathParts[i] === 'kanban') { kanbanIdx = i; break; }
    }
    
    if (kanbanIdx === -1 || kanbanIdx + 1 >= pathParts.length) {
        return { detected: false, reason: 'no kanban segment or no id after it' };
    }
    var rawId = pathParts[kanbanIdx + 1];
    if (!/^\d+$/.test(rawId)) {
        return { detected: false, reason: 'id is not a number: ' + rawId };
    }
    var recordId = rawId;
    var urlSearch = search;
    var urlParams = urlSearch ? urlSearch.slice(1) : '';
    
    return { detected: true, recordId: recordId, urlParams: urlParams };
}

function buildEndpoint(base, params) {
    if (!params) return base;
    var sep = base.indexOf('?') !== -1 ? '&' : '?';
    return base + sep + params;
}

// Test cases
var tests = [
    { pathname: '/mydb/kanban/1144', search: '' },
    { pathname: '/mydb/kanban/447', search: '?F_U=5&filter=active' },
    { pathname: '/mydb/kanban/123', search: '?param1=value1' },
    { pathname: '/mydb/kanban/notanumber', search: '' },
    { pathname: '/mydb/object/291', search: '' },
    { pathname: '/mydb/kanban', search: '' },
    { pathname: '/mydb/kanban/', search: '' },
];

tests.forEach(function(t) {
    var result = testUrlParsing(t.pathname, t.search);
    console.log('Path:', t.pathname, 'Search:', t.search);
    if (result.detected) {
        console.log('  -> Detected! recordId:', result.recordId, 'urlParams:', result.urlParams || '(none)');
        console.log('  -> get_record URL suffix: /get_record/' + result.recordId + (result.urlParams ? '?' + result.urlParams : ''));
        
        // Simulate report type (obj="22")
        var reportEndpoint = buildEndpoint('report/' + result.recordId + '?JSON', result.urlParams);
        console.log('  -> Report endpoint:', reportEndpoint);
        
        // Simulate object type (obj="18")
        var objectEndpoint = buildEndpoint('object/18?JSON_OBJ', result.urlParams);
        console.log('  -> Object endpoint:', objectEndpoint);
    } else {
        console.log('  -> Not detected:', result.reason);
    }
    console.log();
});
