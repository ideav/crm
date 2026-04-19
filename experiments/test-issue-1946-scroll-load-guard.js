/**
 * Test for issue #1946: avoid eager auto-loading when the page has not been
 * scrolled yet and the table already extends below the viewport.
 */

function shouldLoadMore({ tableBottom, viewportHeight, hasMore = true, isLoading = false }) {
    if (isLoading || !hasMore) return false;

    const belowFold = tableBottom - viewportHeight;
    const scrollThreshold = viewportHeight / 2;

    return belowFold < scrollThreshold;
}

function runTests() {
    const tests = [
        {
            name: 'loads when table fits above viewport bottom',
            input: { tableBottom: 700, viewportHeight: 800 },
            expected: true
        },
        {
            name: 'loads when table bottom exactly matches viewport bottom',
            input: { tableBottom: 800, viewportHeight: 800 },
            expected: true
        },
        {
            name: 'does not eagerly load when table extends below viewport before user scrolls',
            input: { tableBottom: 1300, viewportHeight: 800 },
            expected: false
        },
        {
            name: 'loads near table bottom even when document bottom is farther away (issue #1957)',
            input: { tableBottom: 1000, viewportHeight: 800 },
            expected: true
        },
        {
            name: 'does not load while already loading',
            input: { tableBottom: 700, viewportHeight: 800, isLoading: true },
            expected: false
        },
        {
            name: 'does not load when there are no more records',
            input: { tableBottom: 700, viewportHeight: 800, hasMore: false },
            expected: false
        }
    ];

    let failed = 0;

    tests.forEach(({ name, input, expected }) => {
        const actual = shouldLoadMore(input);
        if (actual === expected) {
            console.log(`ok - ${name}`);
        } else {
            failed++;
            console.error(`not ok - ${name}: expected ${expected}, got ${actual}`);
        }
    });

    console.log(`${tests.length - failed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests();
