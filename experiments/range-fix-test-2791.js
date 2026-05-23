// Verify the range-filter inputs (t102/t103/t105/t106) are also safe after the fix.
var templateRange = '\n<input type="text" id="t102_:id:" value="" placeholder="От" class="form-control form-control-sm save-input">\n<input type="text" id="t103_:id:" value="" placeholder="До" class="form-control form-control-sm save-input">\n';

function getReq(id, r, mockMap) {
    var k = id + ':' + r;
    if (mockMap[k] === undefined) return '';
    return mockMap[k].replace(/"/gm, '&quot;');
}

var id = 7;

// Mock filter values that contain $ patterns
var mocks = {
    '7:102': "[TODAY] $' edge",     // tricky $' near start
    '7:103': "value with $1 $&"
};

// === FIXED code path ===
var control = templateRange.replace(/:t:/g, '102').replace(/:id:/g, id);
var v102 = getReq(id, 102, mocks), v103 = getReq(id, 103, mocks);
control = control.replace('id="t102_'+id+'" value=""', function(){return 'id="t102_'+id+'" value="'+v102+'"';})
                 .replace('id="t103_'+id+'" value=""', function(){return 'id="t103_'+id+'" value="'+v103+'"';});

console.log('t102 expected:', JSON.stringify(mocks['7:102']));
console.log('t103 expected:', JSON.stringify(mocks['7:103']));

var m102 = control.match(/id="t102_7" value="([^"]*)"/);
var m103 = control.match(/id="t103_7" value="([^"]*)"/);
console.log('t102 got:     ', JSON.stringify(m102 && m102[1]));
console.log('t103 got:     ', JSON.stringify(m103 && m103[1]));

var ok102 = m102 && m102[1] === mocks['7:102'];
var ok103 = m103 && m103[1] === mocks['7:103'];
console.log('t102 match?', ok102, 't103 match?', ok103);
process.exit(ok102 && ok103 ? 0 : 1);
