const fs = require('fs');
const path = require('path');
const vm = require('vm');

const template = fs.readFileSync(path.join(__dirname, '..', 'templates', 'sql.html'), 'utf8');
const match = template.match(/function fillQueryNameFromHint\(v\)\{[\s\S]*?\n\}/);

if (!match) {
    throw new Error('fillQueryNameFromHint function was not found');
}

const input = { value: '', focused: false, focus() { this.focused = true; } };
const queries = { classList: makeClassList(['hidden']) };
const show = { classList: makeClassList([]) };
let seekValue = null;

const context = {
    document: {
        querySelector(selector) {
            return selector === 'input[name="t22"]' ? input : null;
        }
    },
    byId(id) {
        if (id === 'queries') return queries;
        if (id === 'show') return show;
        return null;
    },
    seekRep(value) {
        seekValue = value;
    },
    lastK: 'Права'
};

vm.createContext(context);
vm.runInContext(match[0], context);

const result = context.fillQueryNameFromHint('Права');

assert(result === false, 'helper should return false to prevent link navigation');
assert(input.value === 'Права', 'query input should receive the hint value');
assert(input.focused, 'query input should be focused');
assert(seekValue === 'Права', 'existing seekRep flow should run with the hint value');
assert(!queries.classList.contains('hidden'), 'query list should be visible');
assert(show.classList.contains('hidden'), 'list toggle icon should be hidden');
assert(context.lastK === null, 'lastK should reset so seekRep is not skipped');

console.log('issue 1978 sql hint query link test passed');

function makeClassList(initial) {
    const classes = new Set(initial);
    return {
        contains(name) {
            return classes.has(name);
        },
        add(name) {
            classes.add(name);
        },
        remove(name) {
            classes.delete(name);
        }
    };
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}
