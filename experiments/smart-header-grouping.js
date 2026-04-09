/**
 * Experiment: Smart header grouping algorithm (v6 - top-down, shortest non-universal prefix)
 * Run with: node experiments/smart-header-grouping.js
 *
 * Algorithm:
 * At each level, find the SHORTEST prefix (fewest words) that:
 *   (a) Is NOT universal (doesn't apply to ALL columns at this level)
 *   (b) Groups at least 2 consecutive columns that all share it
 *   (c) Has proper boundary conditions (neighbors outside group don't share it)
 *
 * Recurse into each group to find sub-groupings with more specific prefixes.
 */

function longestCommonWordPrefix(a, b) {
    const wa = a.split(' ');
    const wb = b.split(' ');
    let n = 0;
    for (let i = 0; i < Math.min(wa.length, wb.length); i++) {
        if (wa[i] === wb[i]) n = i + 1;
        else break;
    }
    return wa.slice(0, n).join(' ');
}

/**
 * Build the smart header tree top-down.
 * At each level, find groups using the shortest non-universal prefix.
 * One call may find multiple non-overlapping groups at the same prefix length.
 */
function buildSmartHeaderTree(columns) {
    if (columns.length === 0) return [];
    if (columns.length === 1) {
        return [{ type: 'leaf', col: columns[0], suffix: columns[0].name }];
    }

    // Compute pair-prefix lengths for each adjacent pair
    const pairPrefixes = [];
    for (let i = 0; i < columns.length - 1; i++) {
        const prefix = longestCommonWordPrefix(columns[i].name, columns[i + 1].name);
        pairPrefixes.push({ i, prefix, len: prefix.split(' ').filter(Boolean).length });
    }

    // Sort pairs by prefix length ASCENDING (shortest first = most general first)
    // We want the outermost grouping level
    const sortedPairs = [...pairPrefixes].sort((a, b) => a.len - b.len || a.i - b.i);

    // Find the shortest non-zero, non-universal prefix that forms a valid group
    let targetLen = -1;
    for (const pair of sortedPairs) {
        if (pair.len === 0) continue;

        const prefix = pair.prefix;

        // Find the full extent of this prefix (leftmost start, rightmost end)
        let start = pair.i;
        while (start > 0 &&
               columns[start - 1].name !== prefix &&
               columns[start - 1].name.startsWith(prefix + ' ')) {
            start--;
        }
        let end = pair.i + 1;
        while (end < columns.length &&
               columns[end].name !== prefix &&
               columns[end].name.startsWith(prefix + ' ')) {
            end++;
        }

        // Check if universal (spans ALL columns)
        if (start === 0 && end === columns.length) {
            // Universal prefix — check if this is the ONLY option
            // Skip it and look for non-universal ones
            continue;
        }

        targetLen = pair.len;
        break;
    }

    if (targetLen === -1) {
        // Only universal prefixes exist (or no prefixes at all) — return all as leaves
        return columns.map(col => ({ type: 'leaf', col, suffix: col.name }));
    }

    // Now find ALL groups at the target prefix length across the columns
    // Process left to right, forming groups wherever valid
    const result = [];
    let i = 0;

    while (i < columns.length) {
        // Check if we can start a group at position i
        let grouped = false;

        if (i + 1 < columns.length) {
            // Get the pair prefix at targetLen words
            const pairPrefix = longestCommonWordPrefix(columns[i].name, columns[i + 1].name);
            const pairLen = pairPrefix.split(' ').filter(Boolean).length;

            if (pairLen >= targetLen) {
                // Use exactly targetLen words as the group prefix
                const prefix = columns[i].name.split(' ').slice(0, targetLen).join(' ');

                // Verify col[i] starts with this prefix and has a suffix
                if (columns[i].name.startsWith(prefix + ' ') && columns[i].name !== prefix) {
                    // Left boundary: previous column must NOT start with prefix
                    const leftOk = i === 0 || !columns[i - 1].name.startsWith(prefix + ' ');

                    if (leftOk) {
                        // Extend right
                        let end = i + 1;
                        while (
                            end < columns.length &&
                            columns[end].name !== prefix &&
                            columns[end].name.startsWith(prefix + ' ')
                        ) {
                            end++;
                        }

                        // Right boundary
                        const rightOk = end >= columns.length || !columns[end].name.startsWith(prefix + ' ');

                        if (rightOk && end - i >= 2) {
                            // Form group
                            const groupCols = columns.slice(i, end);
                            const suffixCols = groupCols.map(col => ({
                                ...col,
                                name: col.name.slice(prefix.length + 1)
                            }));
                            const children = buildSmartHeaderTree(suffixCols);
                            result.push({
                                type: 'group',
                                prefix,
                                span: end - i,
                                children
                            });
                            i = end;
                            grouped = true;
                        }
                    }
                }
            }
        }

        if (!grouped) {
            result.push({ type: 'leaf', col: columns[i], suffix: columns[i].name });
            i++;
        }
    }

    return result;
}

function treeDepth(nodes) {
    return nodes.reduce((max, n) =>
        Math.max(max, n.type === 'group' ? 1 + treeDepth(n.children) : 1), 0);
}

function renderTreeRows(nodes, totalDepth) {
    const rows = Array.from({ length: totalDepth }, () => []);
    function visit(nodes, depth) {
        for (const node of nodes) {
            if (node.type === 'leaf') {
                rows[depth].push({ text: node.suffix, colspan: 1, rowspan: totalDepth - depth, col: node.col });
            } else {
                rows[depth].push({ text: node.prefix, colspan: node.span, rowspan: 1, col: null });
                visit(node.children, depth + 1);
            }
        }
    }
    visit(nodes, 0);
    return rows;
}

let allOk = true;
function assert(cond, msg) {
    if (!cond) { console.error('  FAIL:', msg); allOk = false; }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 1: Main example from issue screenshots
// ═══════════════════════════════════════════════════════════════════════════
console.log('=== TEST 1: Main example ===');
const t1cols = [
    { id: 'c1', name: 'информация №2' },
    { id: 'c2', name: 'информация №3' },
    { id: 'c3', name: 'информация №4 Критерий' },
    { id: 'c4', name: 'информация №4 Соответствие' },
    { id: 'c5', name: 'информация №4 возможность соответствовать можно' },
    { id: 'c6', name: 'информация №4 возможность соответствовать время' },
];
const tree1 = buildSmartHeaderTree(t1cols);
const depth1 = treeDepth(tree1);
const rows1 = renderTreeRows(tree1, depth1);
console.log('Depth:', depth1);
rows1.forEach((r, i) => console.log(`Row ${i}:`, r.map(c => `"${c.text}"[cs=${c.colspan},rs=${c.rowspan}]`).join(', ')));

const [r0, r1, r2] = rows1;
assert(depth1 === 3, `depth=3 got ${depth1}`);
assert(r0?.length === 3, `r0.len=3 got ${r0?.length}`);
assert(r0?.[0].text === 'информация №2' && r0[0].rowspan === 3, `r0[0]="${r0[0]?.text}" rs=${r0[0]?.rowspan}`);
assert(r0?.[1].text === 'информация №3' && r0[1].rowspan === 3, `r0[1]="${r0[1]?.text}"`);
assert(r0?.[2].text === 'информация №4' && r0[2].colspan === 4, `r0[2]="${r0[2]?.text}" cs=${r0[2]?.colspan}`);
assert(r1?.length === 3, `r1.len=3 got ${r1?.length}`);
assert(r1?.[0].text === 'Критерий' && r1[0].rowspan === 2, `r1[0]="${r1[0]?.text}"`);
assert(r1?.[1].text === 'Соответствие' && r1[1].rowspan === 2, `r1[1]="${r1[1]?.text}"`);
assert(r1?.[2].text === 'возможность соответствовать' && r1[2].colspan === 2, `r1[2]="${r1[2]?.text}"`);
assert(r2?.length === 2, `r2.len=2 got ${r2?.length}`);
assert(r2?.[0].text === 'можно', `r2[0]="${r2[0]?.text}"`);
assert(r2?.[1].text === 'время', `r2[1]="${r2[1]?.text}"`);
console.log(allOk ? '✓ Test 1 passed' : '✗ Test 1 FAILED');

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2: No grouping
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== TEST 2: No grouping ===');
allOk = true;
const t2 = buildSmartHeaderTree([{id:'a',name:'foo'},{id:'b',name:'bar'},{id:'c',name:'baz'}]);
const rows2 = renderTreeRows(t2, treeDepth(t2));
rows2.forEach((r, i) => console.log(`Row ${i}:`, r.map(c => `"${c.text}"[cs=${c.colspan},rs=${c.rowspan}]`).join(', ')));
assert(treeDepth(t2) === 1, `depth=1 got ${treeDepth(t2)}`);
assert(rows2[0].length === 3, `r0.len=3`);
console.log(allOk ? '✓ Test 2 passed' : '✗ Test 2 FAILED');

// ═══════════════════════════════════════════════════════════════════════════
// TEST 3: Universal prefix — all 3 share "foo", no non-universal group
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== TEST 3: Universal prefix, all leaves ===');
allOk = true;
const t3 = buildSmartHeaderTree([
    {id:'a', name:'foo A'},
    {id:'b', name:'foo B'},
    {id:'c', name:'foo C'},
]);
const rows3 = renderTreeRows(t3, treeDepth(t3));
console.log('Depth:', treeDepth(t3));
rows3.forEach((r, i) => console.log(`Row ${i}:`, r.map(c => `"${c.text}"[cs=${c.colspan},rs=${c.rowspan}]`).join(', ')));
assert(treeDepth(t3) === 1, `depth=1 got ${treeDepth(t3)}`);
assert(rows3[0][0].text === 'foo A', `r0[0]="${rows3[0][0]?.text}"`);
console.log(allOk ? '✓ Test 3 passed' : '✗ Test 3 FAILED');

// ═══════════════════════════════════════════════════════════════════════════
// TEST 4: Simple two-column group with non-matching neighbor
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== TEST 4: Simple two-column group ===');
allOk = true;
const t4 = buildSmartHeaderTree([
    {id:'a', name:'foo bar A'},
    {id:'b', name:'foo bar B'},
    {id:'c', name:'baz'},
]);
const rows4 = renderTreeRows(t4, treeDepth(t4));
rows4.forEach((r, i) => console.log(`Row ${i}:`, r.map(c => `"${c.text}"[cs=${c.colspan},rs=${c.rowspan}]`).join(', ')));
assert(treeDepth(t4) === 2, `depth=2 got ${treeDepth(t4)}`);
assert(rows4[0][0].text === 'foo bar' && rows4[0][0].colspan === 2, `r0[0]="${rows4[0][0]?.text}"`);
assert(rows4[0][1].text === 'baz' && rows4[0][1].rowspan === 2, `r0[1]="${rows4[0][1]?.text}"`);
assert(rows4[1][0].text === 'A' && rows4[1][1].text === 'B', `r1 fail`);
console.log(allOk ? '✓ Test 4 passed' : '✗ Test 4 FAILED');

// ═══════════════════════════════════════════════════════════════════════════
// TEST 5: Boundary condition - left neighbor shares shorter prefix
// "foo baz", "foo bar X", "foo bar Y"
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== TEST 5: Boundary condition ===');
allOk = true;
const t5 = buildSmartHeaderTree([
    {id:'a', name:'foo baz'},
    {id:'b', name:'foo bar X'},
    {id:'c', name:'foo bar Y'},
]);
const rows5 = renderTreeRows(t5, treeDepth(t5));
rows5.forEach((r, i) => console.log(`Row ${i}:`, r.map(c => `"${c.text}"[cs=${c.colspan},rs=${c.rowspan}]`).join(', ')));
assert(treeDepth(t5) === 2, `depth=2 got ${treeDepth(t5)}`);
assert(rows5[0][0].text === 'foo baz' && rows5[0][0].rowspan === 2, `r0[0]="${rows5[0][0]?.text}"`);
assert(rows5[0][1].text === 'foo bar' && rows5[0][1].colspan === 2, `r0[1]="${rows5[0][1]?.text}"`);
assert(rows5[1][0].text === 'X' && rows5[1][1].text === 'Y', `r1 fail`);
console.log(allOk ? '✓ Test 5 passed' : '✗ Test 5 FAILED');

console.log('\n=== Done ===');
