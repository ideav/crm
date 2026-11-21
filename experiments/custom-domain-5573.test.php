<?php
# Test #5573: свой домен базы — include/custom_domain.php.
# Groups: A разбор пути, B ссылки в HTML, C Location, D расчёт оплаты, E имя домена,
# F проверка DNS, G заголовок приёмника, H Cd_route (проверка Caddy и перевод адреса) — отдельными процессами.
# Run: php experiments/custom-domain-5573.test.php

$mod = __DIR__."/../include/custom_domain.php";
if(isset($argv[1]) && $argv[1] === "route"){
    # Подпроцесс группы H: окружение задаёт родитель через переменные среды.
    define("USER_DB_MASK", "/^[a-z]\w{2,14}$/i");
    $_SERVER["REQUEST_URI"] = getenv("T_URI");
    $_SERVER["REQUEST_METHOD"] = getenv("T_METHOD") ?: "GET";
    $_SERVER["SERVER_NAME"] = "ideav.ru";
    if(getenv("T_HOST")) $_SERVER["HTTP_X_INTEGRAM_DOMAIN"] = getenv("T_HOST");
    if(getenv("T_NAV")) $_SERVER["HTTP_SEC_FETCH_MODE"] = "navigate";
    if(getenv("T_ASK")) $_GET["domain"] = getenv("T_ASK");
    require $mod;
    $r = Cd_route();
    while(ob_get_level()) ob_end_clean();
    echo "URI=".$_SERVER["REQUEST_URI"]." DB=".($r ? $r["db"] : "-");
    exit;
}
if(!is_file($mod)){
    echo "FAIL: include/custom_domain.php not found\n";
    exit(1);
}
define("USER_DB_MASK", "/^[a-z]\w{2,14}$/i");
require $mod;

$fail = 0; $n = 0;
function eq($name, $got, $want){
    global $fail, $n;
    $n++;
    if($got === $want){ echo "PASS: $name\n"; return; }
    $fail++;
    echo "FAIL: $name\n   got:  ".var_export($got, true)."\n   want: ".var_export($want, true)."\n";
}

# A: путь своего домена → внутренний /<база>/…
eq("A1 root", Cd_route_path("/", "crm"), array("uri" => "/crm"));
eq("A2 root with query", Cd_route_path("/?x=1", "crm"), array("uri" => "/crm?x=1"));
eq("A3 caddy root marker", Cd_route_path("/_root", "crm"), array("uri" => "/crm"));
eq("A4 clean path", Cd_route_path("/table/42?F_U=1", "crm"), array("uri" => "/crm/table/42?F_U=1"));
eq("A5 prefixed xhr kept", Cd_route_path("/crm/_m_save/5", "crm", "POST", false), array("uri" => "/crm/_m_save/5"));
eq("A6 prefixed POST navigate kept", Cd_route_path("/crm/auth", "crm", "POST", true), array("uri" => "/crm/auth"));
eq("A7 prefixed GET navigate → clean", Cd_route_path("/crm/table/42?a=b", "crm", "GET", true), array("redirect" => "/table/42?a=b"));
eq("A8 bare prefix navigate → /", Cd_route_path("/crm", "crm", "GET", true), array("redirect" => "/"));
eq("A9 path starting like db is clean", Cd_route_path("/crmx/1", "crm"), array("uri" => "/crm/crmx/1"));

# B: ссылки в HTML
eq("B1 href", Cd_rewrite_html('<a href="/crm/table/1">', "crm"), '<a href="/table/1">');
eq("B2 single quotes src", Cd_rewrite_html("<script src='/crm/js/x.js'>", "crm"), "<script src='/js/x.js'>");
eq("B3 bare db", Cd_rewrite_html('<a href="/crm">', "crm"), '<a href="/">');
eq("B4 form action query", Cd_rewrite_html('<form action="/crm?x=1">', "crm"), '<form action="/?x=1">');
eq("B5 other db untouched", Cd_rewrite_html('<a href="/crmx/1">', "crm"), '<a href="/crmx/1">');
eq("B6 static untouched", Cd_rewrite_html('<link href="/css/a.css">', "crm"), '<link href="/css/a.css">');
eq("B7 text untouched", Cd_rewrite_html('see /crm/table/1', "crm"), 'see /crm/table/1');
# ЛК (база my) на своём домене недоступен: ссылки на него ведут на основной хост (меню «Личный кабинет»).
eq("B8 LK link to main host", Cd_rewrite_html('<a href="/my" target="my">', "crm", "ideav.ru"), '<a href="https://ideav.ru/my" target="my">');
eq("B9 LK subpath and query", Cd_rewrite_html("<a href='/my/info?x=1'>", "crm", "ideav.ru"), "<a href='https://ideav.ru/my/info?x=1'>");
eq("B10 not LK prefix", Cd_rewrite_html('<a href="/mylist">', "crm", "ideav.ru"), '<a href="/mylist">');

# C: Location
eq("C1 relative", Cd_rewrite_location("/crm/table/1", "crm", "crm.co.ru", "ideav.ru"), "/table/1");
eq("C2 bare", Cd_rewrite_location("/crm", "crm", "crm.co.ru", "ideav.ru"), "/");
eq("C3 absolute main host", Cd_rewrite_location("https://ideav.ru/crm/x?y=1", "crm", "crm.co.ru", "ideav.ru"), "https://crm.co.ru/x?y=1");
eq("C4 start page untouched", Cd_rewrite_location("/start.html?db=crm", "crm", "crm.co.ru", "ideav.ru"), "/start.html?db=crm");
eq("C5 other db untouched", Cd_rewrite_location("https://ideav.ru/other/x", "crm", "crm.co.ru", "ideav.ru"), "https://ideav.ru/other/x");

# D: расчёт оплаты
$t = 1800000000;
$doms = array(array("host" => "b.ru", "id" => 20), array("host" => "a.ru", "id" => 10));
eq("D1 no payments", Cd_compute_until($doms, array(), 1147), array("a.ru" => 0, "b.ru" => 0));
eq("D2 scale plan: first by id included", Cd_compute_until($doms, array(), CD_PLAN_SCALE), array("a.ru" => CD_FOREVER, "b.ru" => 0));
eq("D3 scale + month for second", Cd_compute_until($doms, array(array("amount" => 490, "paid" => $t)), CD_PLAN_SCALE),
    array("a.ru" => CD_FOREVER, "b.ru" => $t + CD_MONTH));
eq("D4 longest slot to first domain", Cd_compute_until($doms, array(array("amount" => 490, "paid" => $t), array("amount" => 4900, "paid" => $t)), 1147),
    array("a.ru" => $t + CD_YEAR, "b.ru" => $t + CD_MONTH));
eq("D5 wrong amount ignored", Cd_compute_until($doms, array(array("amount" => 500, "paid" => $t)), 1147), array("a.ru" => 0, "b.ru" => 0));
eq("D6 grace live", Cd_entry_live(array("db" => "x", "until" => $t), $t + CD_GRACE - 1), true);
eq("D7 after grace dead", Cd_entry_live(array("db" => "x", "until" => $t), $t + CD_GRACE), false);
eq("D8 unpaid dead", Cd_entry_live(array("db" => "x", "until" => 0), $t), false);

# E: имя домена
eq("E1 normalize url", Cd_normalize_host(" HTTPS://Crm.Company.RU:443/path?x "), "crm.company.ru");
eq("E2 trailing dot", Cd_normalize_host("crm.company.ru."), "crm.company.ru");
eq("E3 ip rejected", Cd_normalize_host("1.2.3.4"), "");
eq("E4 underscore rejected", Cd_normalize_host("bad_host.ru"), "");
eq("E5 single label rejected", Cd_normalize_host("localhost"), "");
eq("E6 reserved subdomain", Cd_is_reserved("x.ideav.ru"), true);
eq("E7 reserved exact", Cd_is_reserved("integram.io"), true);
eq("E8 lookalike not reserved", Cd_is_reserved("myideav.ru"), false);
eq("E9 apex", Cd_is_apex("company.ru"), true);
eq("E10 apex in com.ru", Cd_is_apex("company.com.ru"), true);
eq("E11 subdomain", Cd_is_apex("crm.company.ru"), false);

# F: проверка DNS (подмена резолвера)
$GLOBALS["CD_DNS"] = function($host, $type){
    $zone = array(
        "crm.co.ru" => array(DNS_CNAME => array(array("target" => "crm.domains.ideav.ru."))),
        "evil.co.ru" => array(DNS_CNAME => array(array("target" => "other.domains.ideav.ru"))),
        "co.ru" => array(DNS_A => array(array("ip" => "203.0.113.7"))),
        "_integram.co.ru" => array(DNS_TXT => array(array("txt" => Cd_txt_token("crm", "co.ru")))),
        "nt.ru" => array(DNS_A => array(array("ip" => "203.0.113.7"))),
    );
    return isset($zone[$host][$type]) ? $zone[$host][$type] : array();
};
eq("F1 cname ok", Cd_dns_ok("crm.co.ru", "crm"), true);
eq("F2 cname to other db", Cd_dns_ok("evil.co.ru", "crm"), false);
putenv("INTEGRAM_DOMAIN_EDGE_IP=203.0.113.7");
eq("F3 apex A+TXT", Cd_dns_ok("co.ru", "crm"), true);
eq("F4 apex token of other db", Cd_dns_ok("co.ru", "other"), false);
eq("F5 apex without TXT", Cd_dns_ok("nt.ru", "crm"), false);

# G: заголовок приёмника
$_SERVER["HTTP_X_INTEGRAM_DOMAIN"] = "CRM.co.ru";
eq("G1 header", Cd_request_host(), "crm.co.ru");
putenv("INTEGRAM_EDGE_SECRET=s3cret");
eq("G2 secret required", Cd_request_host(), "");
$_SERVER["HTTP_X_INTEGRAM_EDGE"] = "s3cret";
eq("G3 secret ok", Cd_request_host(), "crm.co.ru");
putenv("INTEGRAM_EDGE_SECRET");
$_SERVER["HTTP_X_INTEGRAM_DOMAIN"] = "ideav.ru";
eq("G4 main host is not custom", Cd_request_host(), "");

# H: Cd_route в отдельных процессах
$reg = tempnam(sys_get_temp_dir(), "cd5573");
file_put_contents($reg, json_encode(array(
    "crm.co.ru" => array("db" => "crm", "user" => 1, "until" => CD_FOREVER, "verified" => 1),
    "old.co.ru" => array("db" => "old", "user" => 1, "until" => 1000, "verified" => 1),
)));
function route($env){
    global $reg;
    $env["INTEGRAM_DOMAIN_REGISTRY"] = $reg;
    $pre = "";
    foreach($env as $k => $v) $pre .= "$k=".escapeshellarg($v)." ";
    $cmd = (stripos(PHP_OS, "WIN") === 0 ? "set " : "env ").$pre.escapeshellarg(PHP_BINARY)." ".escapeshellarg(__FILE__)." route 2>&1";
    return trim((string)shell_exec($cmd));
}
eq("H1 ask known", route(array("T_URI" => "/my/_domain_ok?domain=crm.co.ru", "T_ASK" => "crm.co.ru")), "ok");
eq("H2 ask unknown", route(array("T_URI" => "/my/_domain_ok?domain=x.co.ru", "T_ASK" => "x.co.ru")), "unknown");
eq("H3 ask expired", route(array("T_URI" => "/my/_domain_ok?domain=old.co.ru", "T_ASK" => "old.co.ru")), "unknown");
eq("H4 main host untouched", route(array("T_URI" => "/crm/table/1")), "URI=/crm/table/1 DB=-");
eq("H5 custom host clean path", route(array("T_URI" => "/table/1", "T_HOST" => "crm.co.ru")), "URI=/crm/table/1 DB=crm");
eq("H6 unknown host 404 page", strpos(route(array("T_URI" => "/", "T_HOST" => "x.co.ru")), "Домен не подключён") !== false, true);
eq("H7 expired host 402 page", strpos(route(array("T_URI" => "/", "T_HOST" => "old.co.ru")), "Домен не оплачен") !== false, true);

# I: ответ SmartCaptcha /validate (#5607). У капчи отключена проверка домена (иначе ключ не работает
# на своих доменах) — сервер сам сверяет поле host: платформа, свой хост сервера или живой свой домен.
putenv("INTEGRAM_DOMAIN_REGISTRY=$reg");
$_SERVER["SERVER_NAME"] = "ideav.ru";
$_SERVER["HTTP_HOST"] = "ideav.ru";
$ok = function($host){ return json_encode(array("status" => "ok", "message" => "", "host" => $host)); };
eq("I1 main host", Cd_captcha_response_ok($ok("ideav.ru")), true);
eq("I2 platform subdomain", Cd_captcha_response_ok($ok("agent.ideav.ru")), true);
eq("I3 live custom domain", Cd_captcha_response_ok($ok("crm.co.ru")), true);
eq("I4 custom domain with port", Cd_captcha_response_ok($ok("CRM.co.ru:8443")), true);
eq("I5 foreign site rejected", Cd_captcha_response_ok($ok("evil.example.com")), false);
eq("I6 expired custom domain rejected", Cd_captcha_response_ok($ok("old.co.ru")), false);
eq("I7 empty host trusted (service failure, docs)", Cd_captcha_response_ok($ok("")), true);
eq("I8 failed status", Cd_captcha_response_ok('{"status":"failed","message":""}'), false);
eq("I9 garbage", Cd_captcha_response_ok("<html>"), false);
$_SERVER["SERVER_NAME"] = $_SERVER["HTTP_HOST"] = "stand.example.org";
eq("I10 own server name", Cd_captcha_response_ok($ok("stand.example.org")), true);
putenv("INTEGRAM_DOMAIN_REGISTRY");
@unlink($reg);

echo $fail ? "$fail of $n FAILED\n" : "All $n passed\n";
exit($fail ? 1 : 0);
