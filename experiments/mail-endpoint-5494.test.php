<?php
# Test #5494: client SMTP mail with attachment (POST /<db>/_mail).
# Groups: A crypto, B stars-mask, C SMTP client vs fake server, D SMTP errors,
# E recipients, F hourly limit, G settings, H grants, I endpoint, J record-file attachment.
# Run: php experiments/mail-endpoint-5494.test.php
# INDEX_PHP env var selects another core version. Each scenario runs as a separate process.

$indexPhp = getenv("INDEX_PHP") ?: __DIR__."/../index.php";
$mailPhp = __DIR__."/../include/mail.php";
if(!isset($argv[1])){
    $cases = array("A1","A2","A3","B1","B2","B3","B4","B5","C1","C2","C3","D1","D2","D3","D4","E1","E2","E3","E4","E5","F1","F2","F3","F4","G1","G2","G3","G4","H1","H2","H3","H4","H5","H6","I1","I2","I3","I4","I5","I6","J1","J2","J3","J4","J5");
    $fail = 0;
    foreach($cases as $id){
        $out = array(); $code = 0;
        exec(escapeshellarg(PHP_BINARY)." ".escapeshellarg(__FILE__)." ".$id." 2>&1", $out, $code);
        $ok = ($code === 0) && (end($out) === "OK");
        echo ($ok ? "PASS" : "FAIL").": $id".($ok ? "" : "  -> ".implode(" | ", array_slice($out, -2)))." \n";
        if(!$ok) $fail++;
    }
    echo $fail ? "$fail FAILED\n" : "All passed\n";
    exit($fail ? 1 : 0);
}

# --- one scenario -----------------------------------------------------------
$case = $argv[1];
# --- harness: defines, mocks -------------------------------------------------
$_SERVER["SERVER_NAME"] = "ideav.ru";
$_SERVER["REMOTE_ADDR"] = "1.2.3.4";
$z = "abc";
$GLOBALS["z"] = $z;
foreach(array("USER"=>18, "PASSWORD"=>20, "XSRF"=>40, "TOKEN"=>125, "SECRET"=>130,
              "ADMINROLE"=>145, "SHORT"=>3, "CHARS"=>8, "NUMBER"=>13, "PWD"=>6,
              "MAIL_MASK"=>"/.+@.+\..+/i", "PASSWORDSTARS"=>"******") as $k => $v)
    define($k, $v);
define("SALT", "salt-5494");
define("ADMINHASH", sha1($_SERVER["SERVER_NAME"].$z."master-5494"));
define("LOGS_DIR", (getenv("MAIL5494_LOGS") ?: sys_get_temp_dir()."/mail5494-".getmypid())."/");
@mkdir(LOGS_DIR, 0777, true);
class Died extends Exception {
    public $payload; public $code_http;
    function __construct($p, $http = ""){
        parent::__construct(is_string($p) ? $p : "");
        $this->payload = $p; $this->code_http = (string)$http;
    }
}
function asrt($cond, $msg){ if(!$cond){ echo "assert: $msg\n"; exit(1); } }
function t9n($v){ return $v; }
function trace($m){}
function my_die($msg, $code = ""){ throw new Died($msg, $code); }
function api_dump($json, $name = ""){ throw new Died(json_decode($json, true)); }
function isApi(){ return TRUE; }
function wlog($m, $f){}
function logHead(){ return array("ts" => date("c"), "user" => "tester"); }
# logWrite like the core: JSONL line into LOGS_DIR/<db>_<mode>.jsonl (hourly limit reads the same file)
function logWrite($mode, $rec){
    file_put_contents(LOGS_DIR.$GLOBALS["z"]."_$mode.jsonl", json_encode($rec, JSON_UNESCAPED_UNICODE)."\n", FILE_APPEND);
}
$GLOBALS["ROWS"] = array();
function Exec_sql($sql, $label){
    $r = new stdClass; $r->i = 0;
    $r->rows = isset($GLOBALS["ROWS"][$label]) ? $GLOBALS["ROWS"][$label] : array();
    # IDROWS: ответ "SELECT t ... WHERE id=N" по id (цепочка реквизит -> тип -> базовый тип)
    if(isset($GLOBALS["IDROWS"]) && preg_match('/WHERE id=(\d+)/', $sql, $m))
        $r->rows = isset($GLOBALS["IDROWS"][(int)$m[1]]) ? array(array($GLOBALS["IDROWS"][(int)$m[1]])) : array();
    return $r;
}
function fk_fetch($r){ return $r->i < count($r->rows) ? $r->rows[$r->i++] : NULL; }
function Sj_find_table($name, $base = NULL){ return isset($GLOBALS["SJ_TABLE"]) ? $GLOBALS["SJ_TABLE"] : NULL; }
function Sj_type_reqs($typeId){ return array_key_exists("SJ_REQS", $GLOBALS) ? $GLOBALS["SJ_REQS"] : array(); }
$GLOBALS["SCHEMA_APPLIED"] = NULL;
function Schema_apply($spec){ $GLOBALS["SCHEMA_APPLIED"] = $spec; return array("ok" => true); }
$GLOBALS["INSERTED"] = array();
function Insert($up, $ord, $t, $val, $m){ $GLOBALS["INSERTED"][] = array($up, $t, $val); return 9000 + count($GLOBALS["INSERTED"]); }
$GLOBALS["CHECK_RECS"] = array();
function Check_Rec_masks($id, $fields = NULL, $typ = 0){ $GLOBALS["CHECK_RECS"][] = "mask-" . $id; }
function GetSubdir($id){ return sys_get_temp_dir()."/mail5494-upload/".floor((int)$id / 1000); }
function GetFilename($id){ return substr("00$id", -3)."tsha"; }
$GLOBALS["mail_config"] = array("smtp_charset" => "UTF-8");

# --- extraction: MAIL_* constants and functions from include/mail.php, core fns from index.php ---
$mailSrc = @file_get_contents($mailPhp);
$constBlock = extract_src((string)$mailSrc, 'if(!defined("MAIL_TABLE_NAME"))');
if($constBlock !== NULL)
    eval($constBlock);
$coreSrc = file_get_contents($indexPhp);
$allSrc = $coreSrc."\n".(string)$mailSrc;
$extract = array("Skip_hidden_pwd","Mail_req_base","Mail_table_id","Mail_is_admin","Mail_send_allowed",
                 "Mail_secret_encrypt","Mail_secret_decrypt","Mail_parse_recipients","Mail_sent_last_hour",
                 "Mail_rate_gate","Mail_parse_from","Mail_smtp_read","Mail_smtp_send","Mail_smtp_session",
                 "Mail_attach_upload","Mail_attach_record","Mail_read_settings","Mail_log","Mail_endpoint",
                 "Mail_ensure_schema","Mail_ensure_record","Mail_spec","Api_always_json_mark","check","mime_word",
                 "Mail_addr_ok","Mail_lock","Check_Grant");
foreach($extract as $fn){
    $src = extract_src($allSrc, "function $fn(");
    if($src !== NULL)
        eval(str_replace(array("mysqli_fetch_array(", "mysqli_fetch_assoc("), array("fk_fetch(", "fk_fetch("), $src)."\n");
}
function extract_src($source, $start){
    $s = strpos($source, $start);
    if($s === false) return NULL;
    $depth = 0;
    for($i = strpos($source, "{", $s); $i < strlen($source); $i++){
        if($source[$i] === "{") $depth++;
        elseif($source[$i] === "}" && --$depth === 0) return substr($source, $s, $i - $s + 1);
    }
    return NULL;
}

# --- test helpers -------------------------------------------------------------
function died_of($fn){ try { $fn(); } catch(Died $d){ return $d; } return NULL; }
function mail_cfg($over = array()){
    return array_merge(array(
        "host" => "smtp.test.local", "port" => 465, "login" => "box@ya.ru", "pwd" => "app-pwd-123",
        "from" => "Sklad <box@ya.ru>", "addr" => "box@ya.ru", "name" => "Sklad", "limit" => 20, "rec_id" => 5000,
    ), $over);
}
# SMTP replay connection: rd() returns the next scripted server reply,
# wr() captures client commands. Closes over nothing external.
function smtp_conn_replay($script){
    $GLOBALS["SMTP_REPLY"] = array_values($script);
    $GLOBALS["SMTP_SENT"] = array();
    $GLOBALS["SMTP_RAW"] = "";
    $GLOBALS["smtp_i"] = 0;
    $GLOBALS["TLS_UP"] = 0;
    return array(
        "rd" => function(){
            $i = $GLOBALS["smtp_i"]++;
            if($i >= count($GLOBALS["SMTP_REPLY"]))
                return FALSE;
            return $GLOBALS["SMTP_REPLY"][$i];
        },
        "wr" => function($s){
            $GLOBALS["SMTP_SENT"][] = $s;
            $GLOBALS["SMTP_RAW"] .= (string)$s;
            return strlen((string)$s);
        },
        "tls" => function(){
            $GLOBALS["TLS_UP"]++;
            return TRUE;
        },
        "close" => function(){ return TRUE; }
    );
}
function smtp_sent($i){ return isset($GLOBALS["SMTP_SENT"][$i]) ? $GLOBALS["SMTP_SENT"][$i] : NULL; }

function sj_stub(){
    return array(
        array("id" => 101, "name" => MAIL_REQ_HOST, "kind" => "field"),
        array("id" => 102, "name" => MAIL_REQ_PORT, "kind" => "field"),
        array("id" => 103, "name" => MAIL_REQ_LOGIN, "kind" => "field"),
        array("id" => 104, "name" => MAIL_REQ_PWD, "kind" => "field"),
        array("id" => 105, "name" => MAIL_REQ_FROM, "kind" => "field"),
        array("id" => 106, "name" => MAIL_REQ_LIMIT, "kind" => "field"));
}
$EHLO_PLAIN = "250-test.local\r\n250-SIZE 35000000\r\n250 AUTH LOGIN\r\n";
$EHLO_TLS = "250-test.local\r\n250-SIZE 35000000\r\n250-STARTTLS\r\n250 AUTH LOGIN\r\n";

switch($case){
case "A1":
    $ct = Mail_secret_encrypt("secret-password-1");
    asrt(is_string($ct) && $ct !== "", "encrypt returned nothing");
    asrt($ct !== "secret-password-1", "ciphertext equals plaintext");
    asrt(strpos($ct, "secret-password") === false, "plaintext visible in ciphertext");
    asrt(Mail_secret_decrypt($ct) === "secret-password-1", "decrypt did not return original");
    break;
case "A2":
    $ct = Mail_secret_encrypt("secret-password-2");
    $GLOBALS["z"] = "other";
    asrt(Mail_secret_decrypt($ct) === NULL, "another db decrypted the password");
    break;
case "A3":
    $ct = Mail_secret_encrypt("secret-password-3");
    $parts = explode(".", $ct);
    $parts[2] = base64_encode(strrev(base64_decode($parts[2])));
    asrt(Mail_secret_decrypt(implode(".", $parts)) === NULL, "tampered ciphertext accepted");
    asrt(Mail_secret_decrypt("garbage") === NULL, "plain garbage accepted");
    break;
case "B1":
    $GLOBALS["REV_BT"][12345] = "PWD";
    asrt(Skip_hidden_pwd(12345, PASSWORDSTARS) === TRUE, "stars not hidden for PWD req");
    break;
case "B2":
    $GLOBALS["ROWS"]["Mail: base type"] = array(array(3));
    asrt(Skip_hidden_pwd(12346, PASSWORDSTARS) === FALSE, "stars hidden for SHORT req");
    break;
case "B5":
    # как в базе: значение.t = реквизит 20211, реквизит.t = тип 20210, тип.t = PWD
    $GLOBALS["REV_BT"] = array(PWD => "PWD", SHORT => "SHORT");
    $GLOBALS["IDROWS"] = array(20211 => 20210, 20210 => PWD, 20205 => 20204, 20204 => SHORT);
    asrt(Mail_req_base(20211) === "PWD", "B5 requisite -> type -> PWD not resolved: '".Mail_req_base(20211)."'");
    asrt(Skip_hidden_pwd(20211, PASSWORDSTARS) === TRUE, "B5 stars not hidden for a real PWD requisite");
    asrt(Mail_req_base(20205) === "SHORT", "B5 SHORT requisite resolved wrong");
    asrt(Skip_hidden_pwd(20205, PASSWORDSTARS) === FALSE, "B5 stars hidden for SHORT requisite");
    break;
case "B3":
    asrt(Skip_hidden_pwd(PASSWORD, PASSWORDSTARS) === TRUE, "system PASSWORD not hidden");
    asrt(Skip_hidden_pwd(XSRF, PASSWORDSTARS) === TRUE, "system XSRF not hidden");
    asrt(Skip_hidden_pwd(TOKEN, PASSWORDSTARS) === TRUE, "system TOKEN not hidden");
    break;
case "B4":
    $GLOBALS["REV_BT"][12345] = "PWD";
    asrt(Skip_hidden_pwd(12345, "real-password") === FALSE, "real value hidden");
    break;
case "C1": {
    $conn = smtp_conn_replay(array(
        "220 ok",
        $EHLO_PLAIN,
        "334 Username:",
        "334 Password:",
        "235 2.7.0 Accepted",
        "250 OK",
        "250 OK",
        "250 OK",
        "354 go",
        "250 OK"));
    $res = Mail_smtp_session(mail_cfg(array("host" => "127.0.0.1", "port" => 2525)), array("a@x.ru", "b@x.ru"),
                             "Schet 5", "Hello, invoice attached.",
                             array("name" => "invoice-5.pdf", "data" => "%PDF-1.4 test"), $conn);
    asrt($res["ok"] === TRUE, "session failed: ".(isset($res["error"]) ? $res["error"] : "?"));
    asrt(preg_match('/^<.+@.+>$/', (string)$res["message_id"]), "no message_id");
    asrt(in_array("Ym94QHlhLnJ1", $GLOBALS["SMTP_SENT"], true), "login b64 not sent");
    asrt(in_array("YXBwLXB3ZC0xMjM=", $GLOBALS["SMTP_SENT"], true), "app password b64 not sent");
    asrt(smtp_sent(0) === "EHLO ya.ru", "first command not EHLO");
    asrt(smtp_sent(4) === "MAIL FROM: <box@ya.ru>", "MAIL FROM not from settings");
    asrt(smtp_sent(5) === "RCPT TO: <a@x.ru>", "recipient 1 missing in RCPT");
    asrt(smtp_sent(6) === "RCPT TO: <b@x.ru>", "recipient 2 missing in RCPT");
    $msg = $GLOBALS["SMTP_RAW"];
    asrt(strpos($msg, "a@x.ru") !== false && strpos($msg, "b@x.ru", 0) !== false, "recipients missing in To header");
    asrt(strpos($msg, "multipart/mixed") !== false, "message not multipart/mixed");
    asrt(strpos($msg, "Subject: =?UTF-8?B?") !== false, "subject not UTF-8 encoded");
    asrt(strpos($msg, base64_encode("%PDF-1.4 test")) !== false, "attachment bytes not in message");
    asrt(strpos($msg, "invoice-5.pdf") !== false, "attachment filename not in headers");
    break; }
case "C2": {
    $conn = smtp_conn_replay(array(
        "220 ok",
        $EHLO_TLS,
        "220 go ahead",
        $EHLO_TLS,
        "334 Username:",
        "334 Password:",
        "235 2.7.0 Accepted",
        "250 OK",
        "250 OK",
        "354 go",
        "250 OK"));
    $res = Mail_smtp_session(mail_cfg(array("host" => "smtp.test.local", "port" => 2525)), array("a@x.ru"),
                             "T", "Body", NULL, $conn);
    asrt($res["ok"] === TRUE, "STARTTLS session failed: ".(isset($res["error"]) ? $res["error"] : "?"));
    asrt($GLOBALS["TLS_UP"] === 1, "STARTTLS not upgraded");
    asrt(smtp_sent(1) === "STARTTLS", "no STARTTLS command");
    asrt(smtp_sent(2) === "EHLO ya.ru", "no second EHLO after STARTTLS");
    break; }
case "C3": {
    # STARTTLS последней строкой ответа EHLO ("250 STARTTLS", без дефиса)
    $ehlo_last = "250-test.local\r\n250-AUTH LOGIN\r\n250 STARTTLS\r\n";
    $conn = smtp_conn_replay(array(
        "220 ok",
        $ehlo_last,
        "220 go ahead",
        $ehlo_last,
        "334 Username:",
        "334 Password:",
        "235 2.7.0 Accepted",
        "250 OK",
        "250 OK",
        "354 go",
        "250 OK"));
    $res = Mail_smtp_session(mail_cfg(array("host" => "smtp.test.local", "port" => 587)), array("a@x.ru"),
                             "T", "Body", NULL, $conn);
    asrt($res["ok"] === TRUE, "C3 STARTTLS on the last EHLO line not seen: ".(isset($res["error"]) ? $res["error"] : "?"));
    asrt($GLOBALS["TLS_UP"] === 1, "C3 STARTTLS not upgraded");
    break; }
case "D1": {
    $conn = smtp_conn_replay(array(
        "220 ok",
        $EHLO_PLAIN,
        "334 Username:",
        "334 Password:",
        "535 5.7.8 Authentication credentials invalid"));
    $res = Mail_smtp_session(mail_cfg(array("host" => "127.0.0.1", "port" => 2525)), array("a@x.ru"),
                             "T", "Body", NULL, $conn);
    asrt($res["ok"] === FALSE, "wrong app password accepted");
    asrt(strpos($res["error"], "app password") !== false, "no clear app-password error: ".$res["error"]);
    break; }
case "D2": {
    $conn = smtp_conn_replay(array(
        "220 ok",
        $EHLO_PLAIN));
    $res = Mail_smtp_session(mail_cfg(array("host" => "smtp.test.local", "port" => 587)), array("a@x.ru"),
                             "T", "Body", NULL, $conn);
    asrt($res["ok"] === FALSE, "587 without STARTTLS accepted");
    asrt(strpos($res["error"], "STARTTLS") !== false, "no STARTTLS error text");
    $sent = $GLOBALS["SMTP_SENT"];
    asrt(count($sent) === 1 && strpos($sent[0], "EHLO") === 0, "extra commands sent before refusal");
    break; }
case "D3": {
    $srv = @stream_socket_server("tcp://127.0.0.1:0", $en, $es);
    asrt($srv !== false, "bind failed: $es");
    $nm = stream_socket_get_name($srv, false);
    $port = (int)substr($nm, strrpos($nm, ":") + 1);
    fclose($srv);
    $res = Mail_smtp_send(mail_cfg(array("host" => "127.0.0.1", "port" => $port)), array("a@x.ru"), "T", "B", NULL);
    asrt($res["ok"] === FALSE, "closed port accepted");
    asrt(strpos($res["error"], "unreachable") !== false, "no unreachable text: ".(isset($res["error"]) ? $res["error"] : ""));
    break; }
case "D4": {
    $conn = smtp_conn_replay(array(
        "220 ok",
        $EHLO_PLAIN,
        "334 Username:",
        "334 Password:",
        "235 2.7.0 Accepted",
        "250 OK",
        "550 5.1.1 User unknown"));
    $res = Mail_smtp_session(mail_cfg(array("host" => "127.0.0.1", "port" => 2525)), array("bad@x.ru"),
                             "T", "Body", NULL, $conn);
    asrt($res["ok"] === FALSE, "rejected recipient accepted");
    asrt(strpos($res["error"], "bad@x.ru") !== false, "address missing in error");
    break; }
case "E1":
    $r = Mail_parse_recipients("a1@x.ru, a2@x.ru;a3@x.ru a4@x.ru,a5@x.ru; a6@x.ru a7@x.ru a8@x.ru a9@x.ru,a10@x.ru");
    asrt(count($r) === 10, "wrong parsed count");
    break;
case "E2":
    asrt(died_of(function(){ Mail_parse_recipients("a1@x.ru,a2@x.ru,a3@x.ru,a4@x.ru,a5@x.ru,a6@x.ru,a7@x.ru,a8@x.ru,a9@x.ru,a10@x.ru,a11@x.ru"); }) !== NULL, "11 recipients allowed");
    break;
case "E3":
    asrt(died_of(function(){ Mail_parse_recipients("bad-addr"); }) !== NULL, "invalid recipient allowed");
    break;
case "E4":
    asrt(died_of(function(){ Mail_parse_recipients(""); }) !== NULL, "empty recipients allowed");
    break;
case "E5":
    foreach(array("a@x.ru>NOTIFY=SUCCESS", "<a@x.ru>", "a\"b@x.ru", "a@x.ru(c)") as $bad)
        asrt(died_of(function() use ($bad){ Mail_parse_recipients($bad); }) !== NULL, "E5 accepted: $bad");
    asrt(count(Mail_parse_recipients("ivan.petrov+inv@почта.рф, a_b-c@sub.x-y.ru")) === 2, "E5 good addresses refused");
    break;
case "F1":
    for($i = 0; $i < 19; $i++) Mail_log(array("act" => "mail", "ok" => true));
    Mail_rate_gate(20);
    break;
case "F2":
    for($i = 0; $i < 20; $i++) Mail_log(array("act" => "mail", "ok" => true));
    $d = died_of(function(){ Mail_rate_gate(20); });
    asrt($d !== NULL && strpos((string)$d->payload, "limit") !== false, "no limit refusal");
    asrt($d !== NULL && strpos((string)$d->code_http, "429") !== false, "code not 429");
    break;
case "F3":
    asrt(died_of(function(){ Mail_rate_gate(0); }) !== NULL, "limit 0 not forbidden");
    break;
case "F4":
    # длинные строки журнала (10 адресатов, длинная тема): лимит 150 считается по всему часу
    $pad = str_repeat("Длинная тема письма ", 15);
    for($i = 0; $i < 150; $i++) Mail_log(array("act" => "mail", "ok" => true, "subject" => $pad,
        "to" => array("a1@x.ru","a2@x.ru","a3@x.ru","a4@x.ru","a5@x.ru","a6@x.ru","a7@x.ru","a8@x.ru","a9@x.ru","a10@x.ru")));
    asrt(Mail_sent_last_hour() === 150, "F4 counted ".Mail_sent_last_hour()." of 150");
    $d = died_of(function(){ Mail_rate_gate(150); });
    asrt($d !== NULL && strpos((string)$d->code_http, "429") !== false, "F4 limit 150 not enforced");
    break;
case "G1":
    $GLOBALS["SJ_TABLE"] = array("id" => 777);
    $GLOBALS["SJ_REQS"] = sj_stub();
    $GLOBALS["ROWS"]["Mail: the settings record"] = array();
    $d = died_of(function(){ Mail_read_settings(); });
    asrt($d !== NULL && strpos((string)$d->payload, "no settings record") !== false, "G1: ".(string)$d->payload);
    break;
case "G2":
    $GLOBALS["SJ_TABLE"] = array("id" => 777);
    $GLOBALS["SJ_REQS"] = sj_stub();
    $GLOBALS["ROWS"]["Mail: the settings record"] = array(array(5000, "id" => 5000));
    $GLOBALS["ROWS"]["Mail: the values of the record"] = array(
        array(101, "smtp.yandex.ru", "t" => 101, "val" => "smtp.yandex.ru"), array(102, "465", "t" => 102, "val" => "465"),
        array(103, "box@ya.ru", "t" => 103, "val" => "box@ya.ru"), array(105, "box@ya.ru", "t" => 105, "val" => "box@ya.ru"));
    $d = died_of(function(){ Mail_read_settings(); });
    asrt($d !== NULL && strpos((string)$d->payload, "app password is not set") !== false, "G2: ".(string)$d->payload);
    asrt($d !== NULL && strpos((string)$d->payload, "id.yandex.ru") !== false, "G2 no hint: ".(string)$d->payload);
    break;
case "G3":
    $GLOBALS["SJ_TABLE"] = array("id" => 777);
    $GLOBALS["SJ_REQS"] = sj_stub();
    $GLOBALS["ROWS"]["Mail: the settings record"] = array(array(5000, "id" => 5000));
    $GLOBALS["ROWS"]["Mail: the values of the record"] = array(
        array(101, "smtp.yandex.ru", "t" => 101, "val" => "smtp.yandex.ru"), array(102, "465", "t" => 102, "val" => "465"),
        array(103, "box@ya.ru", "t" => 103, "val" => "box@ya.ru"), array(104, "old-plaintext-pwd", "t" => 104, "val" => "old-plaintext-pwd"),
        array(105, "box@ya.ru", "t" => 105, "val" => "box@ya.ru"), array(106, "20", "t" => 106, "val" => "20"));
    $d = died_of(function(){ Mail_read_settings(); });
    asrt($d !== NULL && strpos((string)$d->payload, "re-enter") !== false, "G3: ".(string)$d->payload);
    break;
case "G4":
    $GLOBALS["SJ_TABLE"] = array("id" => 777);
    $GLOBALS["SJ_REQS"] = sj_stub();
    $GLOBALS["ROWS"]["Mail: the settings record"] = array(array(5000, "id" => 5000));
    $GLOBALS["ROWS"]["Mail: the values of the record"] = array(
        array(102, "465", "t" => 102, "val" => "465"), array(103, "box@ya.ru", "t" => 103, "val" => "box@ya.ru"),
        array(104, "pw-ct", "t" => 104, "val" => Mail_secret_encrypt("pw")), array(105, "box@ya.ru", "t" => 105, "val" => "box@ya.ru"));
    $d = died_of(function(){ Mail_read_settings(); });
    asrt($d !== NULL && strpos((string)$d->payload, "SMTP server") !== false, "G4: ".(string)$d->payload);
    break;
case "H1":
    $GLOBALS["GLOBAL_VARS"] = array("user" => "petrov", "z" => "abc");
    $GLOBALS["GRANTS"] = array();
    $d = died_of(function(){
        if(!Mail_send_allowed(777)) my_die(t9n("[RU]no perm[EN]no permission"), "403 Forbidden");
    });
    asrt($d !== NULL, "H1 no refusal without grant");
    break;
case "H2":
    $GLOBALS["GLOBAL_VARS"] = array("user" => "petrov", "z" => "abc");
    $GLOBALS["GRANTS"] = array(777 => "READ");
    asrt(Mail_send_allowed(777) === TRUE, "READ grant did not allow");
    break;
case "H3":
    $GLOBALS["GLOBAL_VARS"] = array("user" => "petrov", "z" => "abc");
    $GLOBALS["GRANTS"] = array(777 => "WRITE");
    asrt(Mail_send_allowed(777) === TRUE, "WRITE grant did not allow");
    break;
case "H4":
    $GLOBALS["GLOBAL_VARS"] = array("user" => "abc", "z" => "abc");
    $GLOBALS["GRANTS"] = array();
    asrt(Mail_send_allowed(777) === TRUE, "owner not allowed");
    break;
case "H5":
    # глобальный доступ роли (грант на корень) - как у Check_Grant
    $GLOBALS["GLOBAL_VARS"] = array("user" => "petrov", "z" => "abc");
    $GLOBALS["GRANTS"] = array(1 => "WRITE");
    asrt(Mail_send_allowed(777) === TRUE, "H5 root WRITE grant did not allow");
    break;
case "H6":
    $GLOBALS["GLOBAL_VARS"] = array("user" => "petrov", "z" => "abc");
    $GLOBALS["GRANTS"] = array(1 => "WRITE", 777 => "BARRED");
    asrt(Mail_send_allowed(777) !== TRUE, "H6 BARRED table allowed");
    break;
case "I1":
    $_SERVER["REQUEST_METHOD"] = "GET";
    $d = died_of(function(){ Mail_endpoint(array("abc", "_mail")); });
    asrt($d !== NULL && strpos((string)$d->code_http, "405") !== false, "I1: ".(string)($d ? $d->code_http : "none"));
    break;
case "I2":
    $_SERVER["REQUEST_METHOD"] = "POST";
    $GLOBALS["GLOBAL_VARS"] = array("user" => "abc", "z" => "abc", "xsrf" => "right-xsrf");
    $_POST = array();
    $d = died_of(function(){ Mail_endpoint(array("abc", "_mail")); });
    asrt($d !== NULL && strpos((string)$d->payload, "CSRF") !== false, "I2: ".(string)$d->payload);
    break;
case "I3": {
    $_SERVER["REQUEST_METHOD"] = "POST";
    $GLOBALS["GLOBAL_VARS"] = array("user" => "abc", "z" => "abc", "xsrf" => "right-xsrf", "user_id" => 5);
    $_POST = array("_xsrf" => "right-xsrf", "to" => "a@x.ru", "subject" => "Invoice", "body" => "Test letter");
    $GLOBALS["SJ_TABLE"] = array("id" => 777);
    $GLOBALS["SJ_REQS"] = sj_stub();
    $pwd_ct = Mail_secret_encrypt("app-pwd-123");
    $GLOBALS["ROWS"]["Mail: the settings record"] = array(array(5000, "id" => 5000));
    $GLOBALS["ROWS"]["Mail: the values of the record"] = array(
        array(101, "127.0.0.1", "t" => 101, "val" => "127.0.0.1"), array(102, "2525", "t" => 102, "val" => "2525"),
        array(103, "box@ya.ru", "t" => 103, "val" => "box@ya.ru"), array(104, $pwd_ct, "t" => 104, "val" => $pwd_ct),
        array(105, "box@ya.ru", "t" => 105, "val" => "box@ya.ru"), array(106, "20", "t" => 106, "val" => "20"));
    $conn = smtp_conn_replay(array(
        "220 ok",
        $EHLO_PLAIN,
        "334 Username:",
        "334 Password:",
        "235 ok",
        "250 ok",
        "250 ok",
        "354 go",
        "250 ok"));
    $d = died_of(function() use ($conn) { Mail_endpoint(array("abc", "_mail"), $conn); });
    asrt($d !== NULL && is_array($d->payload) && isset($d->payload["status"]) && $d->payload["status"] === "ok", "I3: ".json_encode($d ? $d->payload : NULL));
    asrt($d->payload["to"] === 1, "I3 wrong recipient count");
    $jf = rtrim(LOGS_DIR, "/")."/abc_mail.jsonl";
    asrt(is_file($jf), "I3 journal not written");
    $jl = (string)file_get_contents($jf);
    asrt(strpos($jl, "app-pwd-123") === false, "I3 app password leaked to journal");
    asrt(strpos($jl, "a@x.ru") !== false, "I3 recipient not in journal");
    break; }
case "I4":
    $pos = strpos($coreSrc, 'switch ($a)');
    $sw = $pos !== false ? substr($coreSrc, $pos, 60000) : "";
    asrt(preg_match('/case\s+"_mail":\s*Mail_endpoint\(\$com\);/s', $sw) === 1, "case _mail not wired in core switch");
    break;
case "I5":
    $GLOBALS["dumpAPI"] = 0;
    Api_always_json_mark("object");
    asrt($GLOBALS["dumpAPI"] !== 1, "object wrongly marked always-JSON");
    $GLOBALS["dumpAPI"] = 0;
    Api_always_json_mark("_mail");
    asrt($GLOBALS["dumpAPI"] === 1, "_mail not marked always-JSON");
    break;
case "I6": {
    unset($GLOBALS["MAIL_TABLE_ID"]);
    $GLOBALS["SJ_TABLE"] = NULL;
    Mail_ensure_schema();
    $spec = $GLOBALS["SCHEMA_APPLIED"];
    asrt(is_array($spec) && isset($spec["tables"]) && count($spec["tables"]) === 1, "I6 no tables in spec");
    $f = $spec["tables"][0]["fields"];
    asrt(count($f) === 7, "I6 wrong field count");
    $pwd = NULL; foreach($f as $fld) if(isset($fld["type"]) && $fld["type"] === "PWD") $pwd = $fld;
    asrt($pwd !== NULL, "I6 no PWD field in spec");
    asrt($spec["roles"][0]["grants"][0]["level"] === "WRITE", "I6 no WRITE grant in spec");
    $GLOBALS["SJ_TABLE"] = array("id" => 777);
    $GLOBALS["SJ_REQS"] = sj_stub();
    Mail_ensure_schema();
    asrt($GLOBALS["INSERTED"][0] === array(1, 777, MAIL_RECORD_NAME), "I6 settings record not created");
    $vals = array();
    foreach($GLOBALS["INSERTED"] as $k => $v) if($k > 0) $vals[] = $v[2];
    asrt(in_array("465", $vals, true) && in_array("20", $vals, true), "I6 defaults not written");
    break; }
case "J1":
    $GLOBALS["GLOBAL_VARS"] = array("user" => "petrov", "z" => "abc");
    $GLOBALS["GRANTS"] = array(555 => "READ");
    $GLOBALS["ROWS"]["Mail: the record table for attach"] = array(array(555, "t" => 555));
    $GLOBALS["ROWS"]["Get Object info by Parent&Type"] = array(array("t" => 108, "par_typ" => 555, "par_id" => 6001, "arr" => -1, "ref" => -1));
    $GLOBALS["ROWS"]["Mail: the file of the record"] = array(array(6101, "act.pdf", "id" => 6101, "val" => "act.pdf"));
    $path = GetSubdir(6101)."/".GetFilename(6101).".pdf";
    @mkdir(dirname($path), 0777, true);
    file_put_contents($path, "PDFBYTES-6101");
    $a = Mail_attach_record(6001, 108);
    asrt($a["name"] === "act.pdf", "J1 name wrong");
    asrt($a["data"] === "PDFBYTES-6101", "J1 data wrong");
    asrt(in_array("mask-6001", $GLOBALS["CHECK_RECS"], true), "J1 mask not checked");
    break;
case "J2":
    $GLOBALS["GLOBAL_VARS"] = array("user" => "petrov", "z" => "abc");
    $GLOBALS["GRANTS"] = array();
    $GLOBALS["ROWS"]["Mail: the record table for attach"] = array(array(555, "t" => 555));
    $d = died_of(function(){ Mail_attach_record(6001, 108); });
    asrt($d !== NULL && strpos((string)$d->code_http, "403") !== false, "J2 no 403");
    break;
case "J3":
    $GLOBALS["GLOBAL_VARS"] = array("user" => "petrov", "z" => "abc");
    $GLOBALS["GRANTS"] = array(555 => "READ");
    $GLOBALS["ROWS"]["Mail: the record table for attach"] = array(array(555, "t" => 555));
    $GLOBALS["ROWS"]["Get Object info by Parent&Type"] = array(array("t" => 108, "par_typ" => 555, "par_id" => 6001, "arr" => -1, "ref" => -1));
    $GLOBALS["ROWS"]["Mail: the file of the record"] = array();
    $d = died_of(function(){ Mail_attach_record(6001, 108); });
    asrt($d !== NULL && strpos((string)$d->payload, "no file") !== false, "J3: ".(string)$d->payload);
    break;
case "J4":
    # столбец закрыт (BARRED) при доступе к таблице - файл не отдаётся
    $GLOBALS["GLOBAL_VARS"] = array("user" => "petrov", "z" => "abc");
    $GLOBALS["GRANTS"] = array(555 => "READ", 108 => "BARRED");
    $GLOBALS["ROWS"]["Mail: the record table for attach"] = array(array(555, "t" => 555));
    $GLOBALS["ROWS"]["Get Object info by Parent&Type"] = array(array("t" => 108, "par_typ" => 555, "par_id" => 6001, "arr" => -1, "ref" => -1));
    $GLOBALS["ROWS"]["Mail: the file of the record"] = array(array(6101, "act.pdf", "id" => 6101, "val" => "act.pdf"));
    $d = died_of(function(){ Mail_attach_record(6001, 108); });
    asrt($d !== NULL && strpos((string)$d->code_http, "403") !== false, "J4 barred column file was attached");
    break;
case "J5":
    # подчинённая запись (таблица 556 внутри 555): грант на родительскую таблицу даёт чтение
    $GLOBALS["GLOBAL_VARS"] = array("user" => "petrov", "z" => "abc");
    $GLOBALS["GRANTS"] = array(555 => "READ");
    $GLOBALS["ROWS"]["Mail: the record table for attach"] = array(array(556, "t" => 556));
    $GLOBALS["ROWS"]["Get Object info by Parent&Type"] = array(array("t" => 108, "par_typ" => 556, "par_id" => 6001, "arr" => -1, "ref" => -1));
    $GLOBALS["ROWS"]["Get Object info by ID"] = array(array("t" => 556, "par_typ" => 555, "par_id" => 5001, "arr" => -1, "ref" => ""));
    $GLOBALS["ROWS"]["Mail: the file of the record"] = array(array(6101, "act.pdf", "id" => 6101, "val" => "act.pdf"));
    $path = GetSubdir(6101)."/".GetFilename(6101).".pdf";
    @mkdir(dirname($path), 0777, true);
    file_put_contents($path, "PDFBYTES-6101");
    $d = died_of(function(){ return Mail_attach_record(6001, 108); });
    asrt($d === NULL, "J5 subordinate record refused: ".($d ? (string)$d->payload : ""));
    break;
}
echo "OK\n";
