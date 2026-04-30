const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('index.php', 'utf8');

const checkcodeMatch = source.match(/case "checkcode":([\s\S]*?)\n\tcase "/);
assert(checkcodeMatch, 'checkcode case should exist in index.php');

const checkcode = checkcodeMatch[1];

assert(
    source.includes('define("CHECKCODE_RETRIES_LIMIT", 2);'),
    'email code login should have a two-attempt retry limit'
);

assert(
    /SELECT[\s\S]*retries\.id retries_id[\s\S]*retries\.val retries/.test(checkcode),
    'checkcode should load the current user retries row'
);

assert(
    checkcode.includes('CHECKCODE_RETRIES_LIMIT'),
    'checkcode should stop accepting codes after the code retry limit is reached'
);

assert(
    checkcode.includes('incrementRetries($row["id"], $row["retries_id"], $row["retries"], "Increment code retries count")'),
    'checkcode should increment retries when the submitted code is wrong'
);

assert(
    /JOIN \$z u ON email\.up=u\.id AND u\.t=/.test(checkcode) &&
        /WHERE email\.t=.*EMAIL.*email\.val='\$u'/.test(checkcode),
    'checkcode should find the user by submitted email before checking the code'
);

assert(
    !/WHERE u\.t=.*USER.*tok\.val LIKE '\$c%'/s.test(checkcode),
    'checkcode must not authenticate by token prefix without requiring the submitted email'
);

console.log('issue-2254 checkcode retries regression test passed');
