const fs = require('fs');

const templatePath = 'templates/sportzania/taskdash.html';
const source = fs.readFileSync(templatePath, 'utf8');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const templaterInsertionPointPattern = /\{([A-ZА-Я0-9\.&_ \-]*?[^ ;\r\n])\}/gmiu;
const insertionPoints = [...source.matchAll(templaterInsertionPointPattern)].map(function(match) {
    return {
        text: match[0],
        name: match[1],
        index: match.index
    };
});
const numericInsertionPoints = insertionPoints.filter(function(point) {
    return /^\d+$/.test(point.name);
});

assert(numericInsertionPoints.length === 0,
    templatePath + ' must not expose JavaScript regex quantifiers as template insertion points: ' +
    numericInsertionPoints.map(function(point) {
        return point.text + ' at ' + point.index;
    }).join(', '));

console.log('issue-2180 taskdash template placeholders: ok');
