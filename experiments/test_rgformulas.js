// Test the RGformulas evaluation logic
function testEval(expr, cells, myIdx) {
    var e = expr.replace(/\[([^\]]+)\]/g, function(match, ref) {
        var num = parseInt(ref, 10);
        if (!isNaN(num) && String(num) === ref.trim()) {
            var targetIdx = myIdx + num;
            if (targetIdx < 0 || targetIdx >= cells.length) return '0';
            return cells[targetIdx] !== undefined ? String(cells[targetIdx]) : '0';
        }
        return '0';
    });
    return eval(e);
}

// Test: Math.round([-1]/[-2]*100)+'%' where cells are [100, 200, ?]
// cell at idx 2 has formula, [-1] = cells[1] = 200, [-2] = cells[0] = 100
var cells = [100, 200, null];
var result = testEval("Math.round([-1]/[-2]*100)+'%'", cells, 2);
console.assert(result === '200%', 'Expected 200%, got ' + result);

// Test: [-1]/[-2] where result = 200/100 = 2
var result2 = testEval("[-1]/[-2]", cells, 2);
console.assert(result2 === 2, 'Expected 2, got ' + result2);

console.log('All tests passed!');
console.log('Test 1: Math.round([-1]/[-2]*100)+"%"  =>', result);
console.log('Test 2: [-1]/[-2]  =>', result2);
