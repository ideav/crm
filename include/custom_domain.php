<?php
# Свой домен для базы (#5573).
#
# Владелец базы вводит в ЛК домен (crm.company.ru), прописывает у себя CNAME на
# <база>.domains.ideav.ru (или A-запись приёмника + TXT для корневого домена), ЛК проверяет DNS,
# и база открывается по https://crm.company.ru/ с адресами без префикса /<база>.
#
# Схема:
#   браузер → Caddy (80/443, on-demand TLS) → Apache (Host: ideav.ru) → index.php
# Caddy для чужих доменов ставит заголовок X-Integram-Domain: <хост> (и, если задан
# INTEGRAM_EDGE_SECRET, X-Integram-Edge: <секрет>). Перед выпуском сертификата Caddy спрашивает
# /my/_domain_ok?domain=<хост> — отвечает реестр, без БД.
#
# Реестр logs/custom_domains.json — производный кэш: собирается из базы my (реквизит «Domain» записи
# базы + платежи bal2dom + тариф) функцией Cd_registry_rebuild() при каждом действии ЛК с доменом
# и при оплате. Маршрутизация запроса читает только его — ядро ещё не подключено к БД.

define("CD_GRACE", 7 * 86400);            # после окончания оплаты домен работает ещё столько
define("CD_PRICE_MONTH", 490);            # ₽ за домен на месяц
define("CD_PRICE_YEAR", 4900);            # ₽ за домен на год
define("CD_MONTH", 31 * 86400);
define("CD_YEAR", 366 * 86400);
define("CD_FOREVER", 4102444800);         # 01.01.2100: домен, входящий в тариф
define("CD_PLAN_SCALE", 1148);            # «Масштабируемый»: один домен входит в тариф
define("CD_PAY_TYPE", "bal2dom");         # тип платежа (реквизит 1085 записи Payment 957)

# Настройки: константа из include/custom_domain.local.php (вне git; PHP под suexec не видит
# переменных SetEnv), иначе переменная окружения, иначе значение по умолчанию.
if(is_file(__DIR__."/custom_domain.local.php"))
    include_once __DIR__."/custom_domain.local.php";
function Cd_env($name, $default=""){
    if(defined($name) && (string)constant($name) !== "")
        return (string)constant($name);
    $v = getenv($name);
    return ($v === false || $v === "") ? $default : $v;
}
function Cd_suffix(){
    return strtolower(Cd_env("INTEGRAM_DOMAIN_CNAME_SUFFIX", "domains.ideav.ru"));
}
function Cd_registry_file(){
    return Cd_env("INTEGRAM_DOMAIN_REGISTRY", dirname(__DIR__)."/logs/custom_domains.json");
}
# Домены платформы: их нельзя привязать к базе клиента.
function Cd_reserved(){
    $list = Cd_env("INTEGRAM_DOMAIN_RESERVED", "ideav.ru,ideav.online,ideav.pro,integram.io,integram-ai.online,ai2o.ru,ai2o.online");
    return array_values(array_filter(array_map("trim", explode(",", strtolower($list)))));
}

# Приводит ввод пользователя к имени хоста: нижний регистр, без схемы, пути, порта и точки в конце;
# кириллица — в punycode. Возвращает "" для недопустимого имени.
function Cd_normalize_host($raw){
    $h = strtolower(trim((string)$raw));
    $h = preg_replace('#^[a-z][a-z0-9+.-]*://#', "", $h);
    $h = preg_replace('#[/?\#].*$#', "", $h);
    $h = preg_replace('#:\d+$#', "", $h);
    $h = rtrim($h, ".");
    if($h !== "" && preg_match('/[^\x00-\x7f]/', $h)){
        if(!function_exists("idn_to_ascii"))
            return "";
        $a = idn_to_ascii($h, 0, defined("INTL_IDNA_VARIANT_UTS46") ? INTL_IDNA_VARIANT_UTS46 : 0);
        $h = $a === false ? "" : strtolower($a);
    }
    if(strlen($h) > 253 || substr_count($h, ".") < 1)
        return "";
    foreach(explode(".", $h) as $label)
        if(!preg_match('/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/', $label))
            return "";
    if(preg_match('/^[0-9.]+$/', $h))  # IP-адрес — не домен
        return "";
    return $h;
}
function Cd_is_reserved($host){
    foreach(Cd_reserved() as $r)
        if($host === $r || substr($host, -strlen($r) - 1) === ".".$r)
            return true;
    return false;
}
# Корневой домен (company.ru) — CNAME на нём запрещён стандартом DNS, нужна A-запись + TXT.
# Эвристика по числу меток с учётом двухуровневых зон вида com.ru / msk.ru / co.uk.
function Cd_is_apex($host){
    $parts = explode(".", $host);
    $n = count($parts);
    if($n <= 2)
        return true;
    $sld = $parts[$n - 2].".".$parts[$n - 1];
    $two = array("com.ru","net.ru","org.ru","pp.ru","msk.ru","spb.ru","co.uk","org.uk","com.ua","com.kz","co.il","com.br");
    return $n === 3 && in_array($sld, $two, true);
}
function Cd_cname_target($db){
    return strtolower($db).".".Cd_suffix();
}
# Значение TXT _integram.<хост> для корневого домена. Ключ — SALT ядра.
function Cd_txt_token($db, $host){
    $key = defined("SALT") ? SALT : "integram";
    return "integram-".substr(hash_hmac("sha256", strtolower($db)."|".$host, $key), 0, 24);
}

# --- реестр ------------------------------------------------------------------------------------
# {"crm.company.ru": {"db":"crm","user":123,"until":1790000000,"verified":1790000000}, ...}
function Cd_registry_load(){
    $f = Cd_registry_file();
    $raw = is_readable($f) ? @file_get_contents($f) : false;
    $data = $raw ? json_decode($raw, true) : null;
    return is_array($data) ? $data : array();
}
function Cd_registry_save($data){
    $f = Cd_registry_file();
    $tmp = $f.".tmp".getmypid();
    if(@file_put_contents($tmp, json_encode($data, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT)) === false)
        return false;
    return @rename($tmp, $f);
}
# Работает ли домен сейчас: оплачен, либо идёт льготный срок.
function Cd_entry_live($entry, $now=null){
    $now = $now === null ? time() : $now;
    return is_array($entry) && isset($entry["db"], $entry["until"]) && ((int)$entry["until"] + CD_GRACE > $now);
}

# --- оплата: чистый расчёт --------------------------------------------------------------------
# $domains — домены пользователя [["host"=>…, "id"=>id записи базы], …];
# $payments — его платежи bal2dom [["amount"=>490|4900, "paid"=>unix], …]; $plan — id тарифа.
# Возвращает host => until (0 — не оплачен). Первый по id записи базы домен на «Масштабируемом»
# входит в тариф; остальным раздаются оплаченные периоды, самые длинные — первым доменам.
function Cd_compute_until($domains, $payments, $plan){
    usort($domains, function($a, $b){ return (int)$a["id"] - (int)$b["id"]; });
    $slots = array();
    foreach($payments as $p){
        $amount = (float)$p["amount"];
        $dur = abs($amount - CD_PRICE_YEAR) < 0.01 ? CD_YEAR : (abs($amount - CD_PRICE_MONTH) < 0.01 ? CD_MONTH : 0);
        if($dur && (int)$p["paid"] > 0)
            $slots[] = (int)$p["paid"] + $dur;
    }
    rsort($slots);
    $out = array();
    $included = ((int)$plan === CD_PLAN_SCALE) ? 1 : 0;
    $i = 0;
    foreach($domains as $d){
        if($included > 0){
            $out[$d["host"]] = CD_FOREVER;
            $included--;
            continue;
        }
        $out[$d["host"]] = isset($slots[$i]) ? $slots[$i] : 0;
        $i++;
    }
    return $out;
}

# --- маршрутизация: чистые функции -------------------------------------------------------------
# Путь запроса на своём домене → внутренний REQUEST_URI ядра (/<база>/…).
# Адрес с префиксом /<база> (ссылки, которые строит ядро и JS) принимается как есть; переход
# браузера по такому адресу (GET, Sec-Fetch-Mode: navigate) перенаправляется на чистый адрес.
# Возвращает ["uri" => …] или ["redirect" => …].
function Cd_route_path($uri, $db, $method="GET", $navigate=false){
    $q = strpos($uri, "?");
    $path = $q === false ? $uri : substr($uri, 0, $q);
    $query = $q === false ? "" : substr($uri, $q);
    if($path === "" || $path === "/" || $path === "/_root" || $path === "/_root/")
        return array("uri" => "/".$db.$query);
    $first = strtolower(explode("/", $path)[1]);
    if($first === strtolower($db)){
        $rest = substr($path, strlen($db) + 1);
        if($navigate && $method === "GET")
            return array("redirect" => ($rest === "" ? "/" : $rest).$query);
        return array("uri" => $uri);
    }
    return array("uri" => "/".$db.$path.$query);
}
# Ссылки в HTML-ответе: href/src/action="/<база>/…" → "/…".
function Cd_rewrite_html($html, $db){
    $d = preg_quote($db, "#");
    return preg_replace('#((?:href|src|action|formaction)\s*=\s*["\'])/'.$d.'(?=[/"\'?\#])/?#i', '$1/', $html);
}
# Заголовок Location: /<база>/… и https://<основной хост>/<база>/… → чистый адрес своего домена.
function Cd_rewrite_location($loc, $db, $host, $mainHost){
    $d = preg_quote($db, "#");
    $m = preg_quote($mainHost, "#");
    $loc = preg_replace('#^https?://'.$m.'/'.$d.'(?=[/?\#]|$)#i', "https://".$host, $loc);
    $loc = preg_replace('#^/'.$d.'(?=[/?\#]|$)#i', "", $loc);
    return $loc === "" ? "/" : $loc;
}

# --- маршрутизация: запрос ---------------------------------------------------------------------
# Хост своего домена из заголовка приёмника; "" — запрос пришёл на основной домен.
function Cd_request_host(){
    $h = isset($_SERVER["HTTP_X_INTEGRAM_DOMAIN"]) ? Cd_normalize_host($_SERVER["HTTP_X_INTEGRAM_DOMAIN"]) : "";
    if($h === "" || Cd_is_reserved($h))
        return "";
    $secret = Cd_env("INTEGRAM_EDGE_SECRET");
    if($secret !== ""){
        $got = isset($_SERVER["HTTP_X_INTEGRAM_EDGE"]) ? (string)$_SERVER["HTTP_X_INTEGRAM_EDGE"] : "";
        if(!hash_equals($secret, $got))
            return "";
    }
    return $h;
}
function Cd_page($code, $title, $text){
    http_response_code($code);
    header("Content-Type: text/html; charset=utf-8");
    $t = htmlspecialchars($title, ENT_QUOTES, "UTF-8");
    echo "<!doctype html><html lang=\"ru\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        ."<title>$t</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 16px;color:#222;background:#fff}"
        ."h1{font-size:22px}</style></head><body><h1>$t</h1><p>$text</p></body></html>";
    exit;
}
# Вызывается из index.php до разбора REQUEST_URI. Отвечает на проверку Caddy, для своего домена
# переписывает REQUEST_URI в /<база>/… и включает переписывание ссылок в ответе.
function Cd_route(){
    $path = (string)parse_url(isset($_SERVER["REQUEST_URI"]) ? $_SERVER["REQUEST_URI"] : "/", PHP_URL_PATH);
    if($path === "/my/_domain_ok"){
        $h = Cd_normalize_host(isset($_GET["domain"]) ? $_GET["domain"] : "");
        $reg = Cd_registry_load();
        $ok = $h !== "" && isset($reg[$h]) && Cd_entry_live($reg[$h]);
        http_response_code($ok ? 200 : 404);
        header("Content-Type: text/plain");
        echo $ok ? "ok" : "unknown";
        exit;
    }
    $host = Cd_request_host();
    if($host === "")
        return null;
    $reg = Cd_registry_load();
    if(!isset($reg[$host]))
        Cd_page(404, "Домен не подключён", "Домен ".htmlspecialchars($host)." не привязан ни к одной базе Интеграма."
            ." Владелец базы подключает домен в личном кабинете на ideav.ru.");
    $db = $reg[$host]["db"];
    $main = isset($_SERVER["SERVER_NAME"]) ? $_SERVER["SERVER_NAME"] : "ideav.ru";
    if(!Cd_entry_live($reg[$host]))
        Cd_page(402, "Домен не оплачен", "Подключение домена к базе закончилось. База открывается по адресу"
            ." <a href=\"https://".htmlspecialchars($main)."/".htmlspecialchars($db)."\">".htmlspecialchars($main)."/".htmlspecialchars($db)."</a>.");
    $navigate = isset($_SERVER["HTTP_SEC_FETCH_MODE"]) && $_SERVER["HTTP_SEC_FETCH_MODE"] === "navigate";
    $r = Cd_route_path($_SERVER["REQUEST_URI"], $db, $_SERVER["REQUEST_METHOD"], $navigate);
    if(isset($r["redirect"])){
        header("Location: ".$r["redirect"], true, 302);
        exit;
    }
    $_SERVER["REQUEST_URI"] = $r["uri"];
    $GLOBALS["CUSTOM_DOMAIN"] = array("host" => $host, "db" => $db);
    header_register_callback(function() use ($db, $host, $main){
        foreach(headers_list() as $line)
            if(stripos($line, "Location:") === 0)
                header("Location: ".Cd_rewrite_location(trim(substr($line, 9)), $db, $host, $main));
    });
    ob_start(function($buf) use ($db){
        foreach(headers_list() as $line)
            if(stripos($line, "Content-Type:") === 0 && stripos($line, "text/html") === false)
                return $buf;
        return Cd_rewrite_html($buf, $db);
    });
    return $GLOBALS["CUSTOM_DOMAIN"];
}

# --- база my: данные доменов -------------------------------------------------------------------
# Реквизит «Domain» типа DB (271). Создаётся при выкладке (docs/custom-domain.md), id ищется по имени.
function Cd_req_id(){
    static $id = null;
    if($id !== null)
        return $id;
    $r = Exec_sql("SELECT r.id FROM my r JOIN my ty ON ty.id=r.t AND ty.up=0 WHERE r.up=".DATABASE." AND ty.val='Domain' LIMIT 1", "Domain requisite");
    $row = mysqli_fetch_assoc($r);
    $id = $row ? (int)$row["id"] : 0;
    return $id;
}
# Все привязанные домены: host, db, id записи базы, user.
function Cd_all_domains(){
    $req = Cd_req_id();
    if(!$req)
        return array();
    $out = array();
    $r = Exec_sql("SELECT d.val host, db.val db, db.id id, db.up user FROM my d JOIN my db ON db.id=d.up AND db.t=".DATABASE
        ." WHERE d.t=$req AND d.val!=''", "Domains list");
    while($row = mysqli_fetch_assoc($r))
        $out[] = array("host" => strtolower($row["host"]), "db" => $row["db"], "id" => (int)$row["id"], "user" => (int)$row["user"]);
    return $out;
}
function Cd_user_plan($user){
    $r = Exec_sql("SELECT t FROM my WHERE up=".(int)$user." AND val='1143' LIMIT 1", "User plan");
    $row = mysqli_fetch_assoc($r);
    return $row ? (int)$row["t"] : 0;
}
function Cd_user_payments($user){
    $out = array();
    $r = Exec_sql("SELECT p.val amount, paid.val paid FROM my p JOIN my ty ON ty.up=p.id AND ty.t=1085 AND ty.val='".CD_PAY_TYPE."'"
        ." JOIN my paid ON paid.up=p.id AND paid.t=967 WHERE p.up=".(int)$user." AND p.t=957", "Domain payments");
    while($row = mysqli_fetch_assoc($r))
        $out[] = array("amount" => (float)$row["amount"], "paid" => (int)$row["paid"]);
    return $out;
}
# В реестр попадают только проверенные домены; отметка проверки (verified) хранится в самом реестре,
# чтобы пересборка не теряла её и не ходила в DNS за каждым доменом.
function Cd_registry_rebuild(){
    $old = Cd_registry_load();
    $byUser = array();
    foreach(Cd_all_domains() as $d)
        $byUser[$d["user"]][] = $d;
    $new = array();
    foreach($byUser as $user => $domains){
        $until = Cd_compute_until($domains, Cd_user_payments($user), Cd_user_plan($user));
        foreach($domains as $d)
            if(isset($old[$d["host"]]) && $old[$d["host"]]["db"] === $d["db"] && !empty($old[$d["host"]]["verified"]))
                $new[$d["host"]] = array("db" => $d["db"], "user" => $user, "until" => $until[$d["host"]], "verified" => $old[$d["host"]]["verified"]);
    }
    Cd_registry_save($new);
    return $new;
}
# Запись базы пользователя по имени базы — или die.
function Cd_own_db($db){
    $db = strtolower((string)$db);
    if(!preg_match(USER_DB_MASK, $db))
        my_die(t9n("[RU]Неверное имя базы[EN]Invalid DB name"));
    $r = Exec_sql("SELECT id FROM my WHERE up=".(int)$GLOBALS["GLOBAL_VARS"]["user_id"]." AND t=".DATABASE." AND val='$db' LIMIT 1", "Own DB");
    $row = mysqli_fetch_assoc($r);
    if(!$row)
        my_die(t9n("[RU]База $db не найдена среди ваших баз[EN]DB $db is not yours"));
    return array("id" => (int)$row["id"], "db" => $db);
}

# --- проверка DNS ------------------------------------------------------------------------------
function Cd_dns($host, $type){
    if(isset($GLOBALS["CD_DNS"]) && is_callable($GLOBALS["CD_DNS"]))  # подмена в тестах
        return call_user_func($GLOBALS["CD_DNS"], $host, $type);
    $rec = @dns_get_record($host, $type);
    return is_array($rec) ? $rec : array();
}
# true — DNS указывает на базу $db: CNAME на <база>.<суффикс>, либо A-запись приёмника + TXT-токен.
function Cd_dns_ok($host, $db){
    $want = Cd_cname_target($db);
    foreach(Cd_dns($host, DNS_CNAME) as $r)
        if(isset($r["target"]) && strtolower(rtrim($r["target"], ".")) === $want)
            return true;
    $edge = Cd_env("INTEGRAM_DOMAIN_EDGE_IP");
    if($edge === "")
        return false;
    $hasA = false;
    foreach(Cd_dns($host, DNS_A) as $r)
        if(isset($r["ip"]) && $r["ip"] === $edge)
            $hasA = true;
    if(!$hasA)
        return false;
    $token = Cd_txt_token($db, $host);
    foreach(Cd_dns("_integram.".$host, DNS_TXT) as $r)
        if(isset($r["txt"]) && trim($r["txt"]) === $token)
            return true;
    return false;
}

# --- действия ЛК -------------------------------------------------------------------------------
# Состояние домена базы для ЛК.
function Cd_status($db){
    $req = Cd_req_id();
    $own = Cd_own_db($db);
    $host = "";
    if($req){
        $r = Exec_sql("SELECT val FROM my WHERE up=".$own["id"]." AND t=$req LIMIT 1", "DB domain");
        $row = mysqli_fetch_assoc($r);
        $host = $row ? strtolower($row["val"]) : "";
    }
    $reg = Cd_registry_load();
    $e = ($host !== "" && isset($reg[$host])) ? $reg[$host] : null;
    $until = $e ? (int)$e["until"] : 0;
    if($host === "")
        $state = "none";
    elseif(!$e)
        $state = "dns_pending";
    elseif($until === 0)
        $state = "not_paid";
    elseif($until < time())
        $state = Cd_entry_live($e) ? "grace" : "expired";
    else
        $state = "active";
    return array("db" => $own["db"], "domain" => $host, "state" => $state, "until" => $until,
        "apex" => $host !== "" && Cd_is_apex($host),
        "cname" => Cd_cname_target($own["db"]),
        "edge_ip" => Cd_env("INTEGRAM_DOMAIN_EDGE_IP"),
        "txt_name" => $host !== "" ? "_integram.".$host : "",
        "txt" => $host !== "" ? Cd_txt_token($own["db"], $host) : "",
        "price_month" => CD_PRICE_MONTH, "price_year" => CD_PRICE_YEAR);
}
function Cd_action_set($db, $raw){
    $req = Cd_req_id();
    if(!$req)
        my_die(t9n("[RU]Привязка домена ещё не включена на сервере[EN]Custom domains are not enabled"));
    $own = Cd_own_db($db);
    $host = Cd_normalize_host($raw);
    if($host === "")
        my_die(t9n("[RU]Неверное имя домена[EN]Invalid domain name"));
    if(Cd_is_reserved($host))
        my_die(t9n("[RU]Этот домен нельзя привязать[EN]This domain can not be used"));
    $r = Exec_sql("SELECT up FROM my WHERE t=$req AND val='$host' AND up!=".$own["id"]." LIMIT 1", "Domain taken");
    if(mysqli_fetch_assoc($r))
        my_die(t9n("[RU]Домен $host уже привязан к другой базе[EN]The domain $host is linked to another DB"));
    $r = Exec_sql("SELECT id FROM my WHERE up=".$own["id"]." AND t=$req LIMIT 1", "DB domain row");
    $row = mysqli_fetch_assoc($r);
    if($row)
        Update_Val($row["id"], $host);
    else
        Insert($own["id"], 1, $req, $host, "DB domain");
    Cd_registry_rebuild();
    return Cd_check($db);
}
function Cd_action_del($db){
    $req = Cd_req_id();
    $own = Cd_own_db($db);
    if($req)
        Exec_sql("DELETE FROM my WHERE up=".$own["id"]." AND t=$req", "Unlink domain");
    Cd_registry_rebuild();
    return Cd_status($db);
}
# Проверка DNS: прошла — домен в реестре (verified), иначе статус dns_pending.
function Cd_check($db){
    $st = Cd_status($db);
    if($st["domain"] === "")
        return $st;
    $reg = Cd_registry_load();
    if(Cd_dns_ok($st["domain"], $st["db"])){
        if(!isset($reg[$st["domain"]]) || $reg[$st["domain"]]["db"] !== $st["db"]){
            $reg[$st["domain"]] = array("db" => $st["db"], "user" => (int)$GLOBALS["GLOBAL_VARS"]["user_id"], "until" => 0, "verified" => time());
            Cd_registry_save($reg);
        }
        Cd_registry_rebuild();
    }
    $st = Cd_status($db);
    $st["dns_ok"] = isset(Cd_registry_load()[$st["domain"]]);
    return $st;
}
# Оплата с баланса: списание атомарным UPDATE с условием достаточности, затем запись платежа.
function Cd_action_pay($db, $period){
    $st = Cd_status($db);
    if($st["domain"] === "")
        my_die(t9n("[RU]Сначала укажите домен[EN]Set the domain first"));
    $amount = $period === "year" ? CD_PRICE_YEAR : CD_PRICE_MONTH;
    $user = (int)$GLOBALS["GLOBAL_VARS"]["user_id"];
    Exec_sql("UPDATE my SET val=CAST(val AS DECIMAL(15,2))-$amount WHERE up=$user AND t=285 AND CAST(val AS DECIMAL(15,2))>=$amount LIMIT 1", "Domain pay debit");
    if(mysqli_affected_rows($GLOBALS["connection"]) !== 1)
        my_die(t9n("[RU]Недостаточно средств на балансе: нужно $amount ₽. Пополните баланс в разделе «Баланс».[EN]Not enough balance: $amount RUB needed"));
    $id = Insert($user, 1, 957, (string)$amount, "Domain payment");
    Insert($id, 1, 1085, CD_PAY_TYPE, "Domain payment type");
    Insert($id, 1, 967, (string)time(), "Domain payment date");
    Insert($id, 1, 1075, $st["domain"]." (".$st["db"].")", "Domain payment notes");
    Cd_registry_rebuild();
    return Cd_status($db);
}
