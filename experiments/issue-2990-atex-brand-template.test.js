// Regression checks for ideav/crm#2990.
//
// Run with:
//   node experiments/issue-2990-atex-brand-template.test.js

var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');
var failures = 0;

function repoPath(rel) {
    return path.join(root, rel);
}

function exists(rel) {
    return fs.existsSync(repoPath(rel));
}

function read(rel) {
    return fs.readFileSync(repoPath(rel), 'utf8');
}

function assert(condition, message) {
    if (condition) {
        console.log('PASS - ' + message);
    } else {
        console.error('FAIL - ' + message);
        failures++;
    }
}

var atexMainPath = 'templates/atex/main.html';
assert(exists(atexMainPath), 'templates/atex/main.html exists as the ATEХ-specific shell');

if (exists(atexMainPath)) {
    var atexMain = read(atexMainPath);
    var mainCss = atexMain.indexOf('/css/main-app.css');
    var brandCss = atexMain.indexOf('/download/{_global_.z}/css/brand.css?0{_global_.version}');

    assert(brandCss !== -1, 'ATEХ main.html links the database brand stylesheet');
    assert(mainCss !== -1 && brandCss > mainCss, 'ATEХ brand stylesheet loads after the shared app shell CSS');
}

var sharedMain = read('templates/main.html');
assert(
    sharedMain.indexOf('/download/{_global_.z}/css/brand.css') === -1,
    'shared templates/main.html does not request a database brand stylesheet for every tenant'
);

var updateConf = read('update.conf');
assert(
    updateConf.indexOf('templates/atex/* : /var/www/www-root/data/www/ideav.ru/templates/custom/atex/') !== -1,
    'update.conf deploys templates/atex/* to templates/custom/atex/'
);

fs.readdirSync(repoPath('templates/atex'))
    .filter(function(file) { return /\.html$/.test(file) && file !== 'main.html'; })
    .sort()
    .forEach(function(file) {
        var rel = 'templates/atex/' + file;
        var text = read(rel);
        assert(text.indexOf('atex-brand-header') === -1, rel + ' has no embedded brand header');
        assert(text.indexOf('atex-brand-logo') === -1, rel + ' has no embedded brand logo');
        assert(text.indexOf('atex-brand-title') === -1, rel + ' has no embedded brand title');
    });

var atexBrandCss = read('download/atex/css/atex-brand.css');
assert(
    !/\.atex-brand-(header|logo|title)\b/.test(atexBrandCss),
    'atex-brand.css contains only shared palette/workspace styles, not header rules'
);

var workflow = read('docs/integram-app-workflow.md');
assert(
    workflow.indexOf('templates/<имя базы>/main.html') !== -1,
    'workflow documents the per-database main.html copy rule'
);
assert(
    workflow.indexOf('404 без последствий') === -1,
    'workflow no longer recommends a global optional brand.css request with 404 fallback'
);

if (failures) {
    console.error('\n' + failures + ' failure(s)');
    process.exit(1);
}

console.log('\nAll checks passed');
