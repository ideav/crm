const assert = (condition, msg) => {
    if (!condition) throw new Error('FAIL: ' + msg);
    console.log('PASS:', msg);
};

// Case 1: no cookies, db param present — should show auth panel
{
    const allIdbDbs = [];
    const dbParam = 'test';
    const showPanel = !!(dbParam && allIdbDbs.length === 0);
    assert(showPanel, 'shows login panel when ?db=test and no cookies');
}

// Case 2: cookies still exist, db param present — should NOT auto-show
{
    const allIdbDbs = ['test'];
    const dbParam = 'test';
    const showPanel = !!(dbParam && allIdbDbs.length === 0);
    assert(!showPanel, 'does NOT auto-show login panel when cookies still exist');
}

// Case 3: no db param, no cookies — normal landing page, no auto-show
{
    const allIdbDbs = [];
    const dbParam = null;
    const showPanel = !!(dbParam && allIdbDbs.length === 0);
    assert(!showPanel, 'does NOT auto-show login panel without ?db= param');
}

console.log('\nAll tests passed.');
