// #5207: ядро integram.io выдаёт токен сессии из CSPRNG (secureToken, 64 hex), а не md5(microtime).
// updateTokens выводит xsrf и cookie из уже присвоенного токена — и для нового, и для старого.
// Функции вырезаются из integram.io/index.php и исполняются в php с заглушками
// Insert/Update_Val/setcookie: подключить ядро целиком без БД нельзя.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
const skip = probe.error ? 'php не найден в PATH' : false;

// Тело функции PHP по имени: от «function name(» до парной закрывающей скобки.
function phpFunction(core, name) {
    const start = core.search(new RegExp('\\nfunction ' + name + '\\s*\\('));
    if (start < 0) return '';
    let i = core.indexOf('{', start), depth = 0;
    for (; i < core.length; i++) {
        if (core[i] === '{') depth++;
        else if (core[i] === '}' && --depth === 0) break;
    }
    return core.slice(start + 1, i + 1);
}

const core = fs.readFileSync(path.join(root, 'integram.io', 'index.php'), 'utf8');
// С python2node#1043 updateTokens выдаёт браузеру сессию (Session_new), а ключ API остаётся в строке «Токен».
const funcs = ['secureToken', 'xsrf', 'Salt', 'updateTokens',
    'Token_parse', 'Token_stored_val', 'Session_new', 'Session_cookie_exp', 'Auth_cookie_opts', 'Auth_cookie']
    .map((n) => phpFunction(core, n)).join('\n')
    .replace(/\bsetcookie\(/g, 'test_setcookie(');

const KEY_RE = /^[0-9a-f]{64}$/;
const SESSION_RE = /^s\.\d+\.[0-9a-f]{64}$/;

// Прогоняет updateTokens на строке $row и возвращает, что ядро записало и отдало.
function run(row) {
    const code = 'define("SALT","s");define("TOKEN",125);define("XSRF",40);define("ACTIVITY",124);'
        + 'define("SESSION_IDLE",30*86400);define("SESSION_LIFETIME",365*86400);'
        + 'define("AUTH_COOKIE_SAMESITE","Lax");define("AUTH_COOKIE_HTTPONLY",TRUE);'
        + '$z="db";$GLOBALS["GLOBAL_VARS"]=[];$log=[];'
        + 'function Insert($up,$ord,$t,$val,$m){global $log;$log[]=["ins",$t,(string)$val];return 1;}'
        + 'function Update_Val($id,$val,$nt=FALSE){global $log;$log[]=["upd",$id,(string)$val];}'
        + 'function test_setcookie($n,$v,$o=[]){global $log;$log[]=["cookie",$n,$v];return true;}'
        + 'function Session_prune($uid){}function Is_https(){return TRUE;}'
        + funcs.replace(/^<\?php/, '')
        + '$row=json_decode(' + JSON.stringify(JSON.stringify(row)) + ',true);'
        + 'if(!function_exists("secureToken")){ function secureToken(){ return "нет secureToken"; } }'
        + 'updateTokens($row);'
        + 'echo json_encode(["vars"=>$GLOBALS["GLOBAL_VARS"],"log"=>$log,"expectXsrf"=>xsrf($GLOBALS["GLOBAL_VARS"]["token"],$z)]);';
    const r = spawnSync('php', ['-d', 'display_errors=stderr', '-r', code], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
}

test('#5207 secureToken в ядре integram.io', { skip }, () => {
    const r = spawnSync('php', ['-r', phpFunction(core, 'secureToken')
        + 'echo json_encode([secureToken(), secureToken()]);'], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, 'secureToken не определена или падает: ' + r.stderr);
    const [a, b] = JSON.parse(r.stdout);
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.notStrictEqual(a, b);
});

test('#5207 updateTokens: новый пользователь получает случайный токен', { skip }, () => {
    const out = run({ uid: 7, tok: null, xsrf: null, act: null });
    const keys = out.log.filter((e) => e[0] === 'ins' && e[1] === 125 && KEY_RE.test(e[2]));
    assert.strictEqual(keys.length, 1, 'ключ API (64 hex) не сохранён');
    const token = out.vars.token;
    assert.match(token, SESSION_RE, 'браузеру выдана не сессия: ' + token);
    assert.strictEqual(out.vars.xsrf, out.expectXsrf, 'xsrf выведен не из выданного токена');
    assert.deepStrictEqual(out.log.find((e) => e[0] === 'cookie'), ['cookie', 'db', token]);
    const again = run({ uid: 7, tok: null, xsrf: null, act: null });
    assert.notStrictEqual(again.vars.token, token);
    assert.notStrictEqual(again.log.find((e) => e[0] === 'ins' && e[1] === 125 && KEY_RE.test(e[2]))[2], keys[0][2]);
});

test('#5207 updateTokens: существующий ключ сохраняется, xsrf и cookie — от выданной сессии', { skip }, () => {
    const old = 'a'.repeat(32);
    const out = run({ uid: 7, tok: 11, token: old, xsrf: 12, act: 13 });
    assert.match(out.vars.token, SESSION_RE, 'браузеру выдана не сессия: ' + out.vars.token);
    assert.strictEqual(out.vars.xsrf, out.expectXsrf, 'xsrf выведен не из токена пользователя');
    assert.deepStrictEqual(out.log.find((e) => e[0] === 'cookie'), ['cookie', 'db', out.vars.token]);
    assert.ok(!out.log.some((e) => e[0] === 'upd' && e[1] === 11), 'ключ API перевыпущен без нужды');
    assert.ok(!out.log.some((e) => e[0] === 'ins' && e[1] === 125 && KEY_RE.test(e[2])), 'ключ API перевыпущен без нужды');
});

// Выдача токена в Google-входе и в checkcode — внутри веток обработчика запроса, исполнить их
// без БД нельзя; поэтому правило «токен не из часов» для обоих ядер проверяется по тексту.
test('#5207 ни одно ядро не выдаёт токен из md5(microtime)', () => {
    for (const f of ['index.php', 'integram.io/index.php']) {
        const text = fs.readFileSync(path.join(root, f), 'utf8');
        const hits = text.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /md5\(\s*microtime/.test(l));
        assert.deepStrictEqual(hits, [], f + ': токен из md5(microtime) в строках ' + hits.map((h) => h[0]).join(', '));
    }
});
