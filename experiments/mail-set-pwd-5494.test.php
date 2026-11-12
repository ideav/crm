<?php
# Мерка к issue #5494: пароль приложения почты, записанный через _m_set (и op:"set" в _m_batch,
# и fields= по именам — все идут через ApplyMSet), хранится шифротекстом сервера, а маска ******
# не затирает сохранённое значение.
#
# Запуск:
#   docker run --rm -v "$PWD":/app -w /app php:8.2-cli php experiments/mail-set-pwd-5494.test.php
#
# ApplyMSet берётся ИЗ ЯДРА, Mail_* — из include/mail.php, токенайзером; БД подменена заглушками.

namespace Test5494set;

error_reporting(E_ALL & ~E_WARNING & ~E_NOTICE & ~E_DEPRECATED);
mb_internal_encoding("UTF-8");

$failed = 0;
function ok($cond, $name, $info = ""){
    global $failed;
    if($cond)
        echo "  ok   $name\n";
    else{
        echo "  FAIL $name".($info === "" ? "" : " — $info")."\n";
        $failed++;
    }
}
function shown($v){ return str_replace("\n", " ", var_export($v, TRUE)); }

function core_function($src, $name){
    $tokens = token_get_all($src);
    $n = count($tokens);
    for($i = 0; $i < $n; $i++){
        if(!is_array($tokens[$i]) || $tokens[$i][0] !== T_FUNCTION)
            continue;
        $j = $i + 1;
        while($j < $n && is_array($tokens[$j]) && in_array($tokens[$j][0], array(T_WHITESPACE, T_COMMENT, T_DOC_COMMENT)))
            $j++;
        if($j >= $n || !is_array($tokens[$j]) || $tokens[$j][0] !== T_STRING || $tokens[$j][1] !== $name)
            continue;
        $code = "";
        $depth = 0;
        $started = FALSE;
        for($k = $i; $k < $n; $k++){
            $t = $tokens[$k];
            $code .= is_array($t) ? $t[1] : $t;
            if(!is_array($t)){
                if($t === "{"){ $depth++; $started = TRUE; }
                elseif($t === "}"){
                    $depth--;
                    if($started && $depth === 0)
                        return $code."\n";
                }
            }
            elseif($t[0] === T_CURLY_OPEN || $t[0] === T_DOLLAR_OPEN_CURLY_BRACES)
                $depth++;
        }
    }
    return "";
}

define("PASSWORD", -1);
define("UPLOAD_DIR", "/tmp/nowhere");
define("PASSWORDSTARS", "******");
define("SALT", "salt-5494");
define("ADMINHASH", "adminhash-5494");
define("MAIL_TABLE_NAME", "Почта для отправки");
define("PWD_BASE", 6);
define("MAIL_TABLE", 777);       # таблица «Почта для отправки»
define("OTHER_TABLE", 888);      # другая таблица с реквизитом PWD
define("PWD_REQ", 10213);        # реквизит «Пароль приложения»

function t9n($msg){ return preg_replace('/\[RU\](.*?)\[EN\].*/s', '$1', $msg); }
function trace($msg){}

class FakeResult {
    public $rows;
    public $i = 0;
    function __construct($rows){ $this->rows = $rows; }
}
function Exec_sql($sql, $err_msg, $log = TRUE, $fatal = TRUE){
    if($err_msg === "Get Attr Type")
        return new FakeResult($GLOBALS["ATTR_ROWS"]);
    if($err_msg === "Mail: base type")
        return new FakeResult(array(array(PWD_BASE, "t" => PWD_BASE)));
    if($err_msg === "Mail: settings-pwd record")
        return new FakeResult(array(array($GLOBALS["REC_TABLE"], "t" => $GLOBALS["REC_TABLE"])));
    return new FakeResult(array());
}
function mysqli_fetch_array($res){
    if(!($res instanceof FakeResult))
        return FALSE;
    return isset($res->rows[$res->i]) ? $res->rows[$res->i++] : FALSE;
}
function Sj_find_table($name, $base = NULL){ return $name === MAIL_TABLE_NAME ? array("id" => MAIL_TABLE) : NULL; }
function Check_Grant($id, $t = 0, $grant = "WRITE", $fatal = TRUE){ return TRUE; }
function Check_Rec_masks($id, $fields = NULL, $typ = 0){}
function BuiltIn($v){ return $v; }
function Format_Val($t, $v){ return $v; }
function Pwd_hash($v){ return "hash:$v"; }
function Update_Val($id, $val){ $GLOBALS["CHANGES"][] = array("update_val", $id, $val); }
function Insert($up, $ord, $t, $val, $msg){ $GLOBALS["CHANGES"][] = array("insert", $up, $t, $val); return 555; }
function Delete($id, $root = 0){ $GLOBALS["CHANGES"][] = array("delete", $id); }
function checkDuplicatedReqs($id, $t){}
function OpFail($msg){ throw new \Exception($msg); }
function my_die($msg, $code = ""){ throw new \Exception(($code === "" ? "400 Bad Request" : $code).": $msg"); }
function RequireNumber($t, $val){ return $val; }

$coreSrc = file_get_contents(__DIR__."/../index.php");
$mailSrc = (string)@file_get_contents(__DIR__."/../include/mail.php");
$code = core_function($coreSrc, "ApplyMSet");
foreach(array("Mail_is_settings_pwd", "Mail_req_base", "Mail_table_id", "Mail_secret_encrypt", "Mail_secret_decrypt") as $fn)
    $code .= core_function($mailSrc, $fn);
eval("namespace Test5494set;\n".$code);

$GLOBALS["z"] = "testdb";
$GLOBALS["basics"] = array(PWD_BASE => "PWD");
$GLOBALS["REV_BT"] = array(PWD_BASE => "PWD");

# Строка «Get Attr Type» для реквизита PWD_REQ записи 20077; $current — текущее значение (NULL — пусто).
function scene($table, $current, $val){
    $GLOBALS["REC_TABLE"] = $table;
    $GLOBALS["ATTR_ROWS"] = array(array("ord" => 1, "id" => $current === NULL ? NULL : 20080, "ref_val" => PWD_REQ
        , "val" => $current, "t" => PWD_BASE, "attrs" => ""));
    $GLOBALS["CHANGES"] = array();
    unset($GLOBALS["MAIL_TABLE_ID"]);
    try{
        return array("ok" => TRUE, "id" => ApplyMSet(20077, array("t".PWD_REQ => $val), array()));
    }
    catch(\Throwable $e){
        return array("ok" => FALSE, "error" => $e->getMessage());
    }
}
function written(){
    foreach($GLOBALS["CHANGES"] as $c)
        if($c[0] === "insert")
            return (string)$c[3];
        elseif($c[0] === "update_val")
            return (string)$c[2];
    return NULL;
}

echo "пароль приложения в таблице почты\n";
$r = scene(MAIL_TABLE, NULL, "app-pwd-123");
$w = written();
ok($r["ok"], "_m_set в пустое поле прошёл", shown($r));
ok($w !== NULL && $w !== "app-pwd-123" && strpos($w, "app-pwd") === FALSE, "в базу лёг не открытый текст", shown($GLOBALS["CHANGES"]));
ok($w !== NULL && Mail_secret_decrypt($w) === "app-pwd-123", "записанное расшифровывается в исходный пароль", shown($w));

$old = Mail_secret_encrypt("old-pwd");
$r = scene(MAIL_TABLE, $old, "new-pwd-456");
$w = written();
ok($r["ok"] && count($GLOBALS["CHANGES"]) === 1 && $GLOBALS["CHANGES"][0][0] === "update_val", "смена пароля — обновление значения", shown(array($r, $GLOBALS["CHANGES"])));
ok($w !== NULL && Mail_secret_decrypt($w) === "new-pwd-456", "новый пароль записан шифротекстом", shown($w));

$r = scene(MAIL_TABLE, $old, PASSWORDSTARS);
ok($r["ok"] && $GLOBALS["CHANGES"] === array(), "маска ****** не затирает сохранённый пароль", shown(array($r, $GLOBALS["CHANGES"])));

echo "PWD в другой таблице — как раньше\n";
$r = scene(OTHER_TABLE, NULL, "plain-777");
ok($r["ok"] && written() === "plain-777", "значение записано без изменений", shown($GLOBALS["CHANGES"]));

echo $failed ? "\nПРОВАЛЕНО проверок: $failed\n" : "\nmail-set-pwd-5494: все проверки пройдены\n";
exit($failed ? 1 : 0);
