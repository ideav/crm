/**
 * Test for issue #2783 — client-side dedup of duplicate `i` entries in the
 * JSON_OBJ response.
 *
 * The server-side fix in index.php is the primary correction. This test
 * covers the defense-in-depth in
 * js/integram-table/02-format-helpers.js -> dedupeJsonDataArrayById(), which
 * guards against a mid-rollout server still emitting the legacy split-row
 * response. The function must:
 *
 *   - leave non-duplicated input untouched (same reference, no copy);
 *   - collapse duplicate ids to the entry with the longest `r` cell array;
 *   - preserve original ordering for non-duplicates;
 *   - not crash on empty / malformed input.
 *
 * Run with: node experiments/test-issue-2783-client-dedup.js
 */

const { strict: assert } = require("node:assert");

// Inline the function under test verbatim from
// js/integram-table/02-format-helpers.js. Kept in sync with the source file.
function dedupeJsonDataArrayById(dataArray) {
    if (!Array.isArray(dataArray) || dataArray.length < 2) {
        return dataArray;
    }
    const seenIndexById = new Map();
    const keep = new Set();
    let hasDuplicates = false;
    for (let i = 0; i < dataArray.length; i++) {
        const item = dataArray[i];
        if (!item || item.i === undefined) {
            keep.add(i);
            continue;
        }
        const prevIndex = seenIndexById.get(item.i);
        if (prevIndex === undefined) {
            seenIndexById.set(item.i, i);
            keep.add(i);
            continue;
        }
        hasDuplicates = true;
        const prevLen = Array.isArray(dataArray[prevIndex].r) ? dataArray[prevIndex].r.length : 0;
        const curLen = Array.isArray(item.r) ? item.r.length : 0;
        if (curLen > prevLen) {
            keep.delete(prevIndex);
            seenIndexById.set(item.i, i);
            keep.add(i);
        }
    }
    if (!hasDuplicates) {
        return dataArray;
    }
    return dataArray.filter((_, idx) => keep.has(idx));
}

function describe(label, fn) {
    console.log(label);
    fn();
}
function it(label, fn) {
    try {
        fn();
        console.log("  OK  " + label);
    } catch (e) {
        console.log("  FAIL  " + label);
        throw e;
    }
}

// --------------------------------------------------------------------------
// The exact symptom from the issue: id 3893632 split + doubled.
const fromIssue = [
    { i: 3893632, u: 1, o: 0, r: ["00-00627661"] },
    {
        i: 3893632,
        u: 1,
        o: 0,
        r: [
            "00-00627661",
            "R-2406758:foo",
            "R-2406759:bar",
            "R-2406760:%5180%",
            "R-2406761:baz",
            "R-2406762:qux",
            "R-2406758:foo",
            "R-2406759:bar",
            "R-2406760:%5180%",
            "R-2406761:baz",
            "R-2406762:qux",
        ],
    },
];

describe("Issue #2783 client-side dedup", () => {
    it("collapses the broken pair to the entry with the most cells", () => {
        const deduped = dedupeJsonDataArrayById(fromIssue);
        assert.equal(deduped.length, 1);
        // Keep the longer entry (the one carrying the reqs) so column
        // alignment matches metadata.length.
        assert.equal(deduped[0].r.length, 11);
        assert.equal(deduped[0].i, 3893632);
    });

    it("returns the original array reference when no duplicates exist", () => {
        const input = [
            { i: 1, r: ["a", "b"] },
            { i: 2, r: ["c", "d"] },
            { i: 3, r: ["e", "f"] },
        ];
        const deduped = dedupeJsonDataArrayById(input);
        assert.equal(deduped, input);
    });

    it("keeps the first occurrence when duplicates have equal r length", () => {
        const input = [
            { i: 7, r: ["first"] },
            { i: 7, r: ["second"] },
        ];
        const deduped = dedupeJsonDataArrayById(input);
        assert.equal(deduped.length, 1);
        assert.equal(deduped[0].r[0], "first");
    });

    it("preserves order across non-duplicate ids", () => {
        const input = [
            { i: 10, r: ["a"] },
            { i: 11, r: ["b", "x"] },
            { i: 10, r: ["a", "y", "z"] }, // longer wins for id 10
            { i: 12, r: ["c"] },
        ];
        const deduped = dedupeJsonDataArrayById(input);
        assert.deepEqual(deduped.map(d => d.i), [11, 10, 12]);
        assert.equal(deduped.find(d => d.i === 10).r.length, 3);
    });

    it("handles three duplicates of the same id by keeping the longest", () => {
        const input = [
            { i: 9, r: ["only-main"] },
            { i: 9, r: ["only-main", "req1"] },
            { i: 9, r: ["only-main", "req1", "req2", "req3"] },
        ];
        const deduped = dedupeJsonDataArrayById(input);
        assert.equal(deduped.length, 1);
        assert.equal(deduped[0].r.length, 4);
    });

    it("returns the input untouched for trivial cases", () => {
        assert.deepEqual(dedupeJsonDataArrayById([]), []);
        const single = [{ i: 1, r: ["x"] }];
        assert.equal(dedupeJsonDataArrayById(single), single);
        assert.equal(dedupeJsonDataArrayById(null), null);
        assert.equal(dedupeJsonDataArrayById(undefined), undefined);
    });

    it("skips entries missing the i field rather than crashing", () => {
        const input = [
            { r: ["a"] },                // no i
            { i: 5, r: ["b"] },
            { i: 5, r: ["b", "c"] },
        ];
        const deduped = dedupeJsonDataArrayById(input);
        // Entry without i is preserved (no dedup signal); duplicate of i=5
        // collapses to the longer one.
        assert.equal(deduped.length, 2);
        assert.equal(deduped.find(d => d.i === 5).r.length, 2);
    });
});

console.log("\nAll client-side dedup tests passed for issue #2783.");
