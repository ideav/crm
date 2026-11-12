<?php
# #5494: отправка письма с вложением через SMTP-ящик клиента.
# Служебная таблица "Почта для отправки" (ленивое идемпотентное создание через Schema_apply),
# эндпоинт POST /<db>/_mail: _xsrf, право = грант на таблицу, лимит в час на базу,
# пароль приложения шифруется ключом сервера (AES-256-GCM от HMAC(ADMINHASH.SALT)).
# Диалог SMTP — Mail_smtp_session() поверх заменяемого соединения (rd/wr/tls/close),
# прод-соединение строит Mail_smtp_send().

if(!defined("MAIL_TABLE_NAME")){
define("MAIL_TABLE_NAME", "Почта для отправки");
define("MAIL_RECORD_NAME", "SMTP");
define("MAIL_REQ_HOST", "SMTP-сервер");
define("MAIL_REQ_PORT", "Порт");
define("MAIL_REQ_LOGIN", "Логин");
define("MAIL_REQ_PWD", "Пароль приложения");
define("MAIL_REQ_FROM", "От кого");
define("MAIL_REQ_LIMIT", "Лимит в час");
define("MAIL_REQ_HINT", "Подсказка");
define("MAIL_MAX_RECIPIENTS", 10);
define("MAIL_HOURLY_DEFAULT", 20);
define("MAIL_BODY_MAX", 200000);
define("MAIL_ATTACH_MAX", 10485760);
define("MAIL_HINT", "Пароль приложения (не пароль ящика): Яндекс - id.yandex.ru/security - Пароли приложений; "
    ."Mail.ru - Настройки - Пароли для внешних приложений; "
    ."Gmail - только при включённой двухэтапной проверке: myaccount.google.com/apppasswords.");
}

# --- the settings table, admin and grant gates ----------------------------------
function Mail_table_id(){
    if(isset($GLOBALS["MAIL_TABLE_ID"]))
        return (int)$GLOBALS["MAIL_TABLE_ID"];
    $term = Sj_find_table(MAIL_TABLE_NAME);
    $GLOBALS["MAIL_TABLE_ID"] = $term ? (int)$term["id"] : 0;
    return $GLOBALS["MAIL_TABLE_ID"];
}
function Mail_is_admin(){
    $gv = isset($GLOBALS["GLOBAL_VARS"]) ? $GLOBALS["GLOBAL_VARS"] : array();
    $user = isset($gv["user"]) ? (string)$gv["user"] : "";
    return ($user === "admin") || ($user === (string)$GLOBALS["z"])
        || (isset($gv["role_id"]) && ((int)$gv["role_id"] === ADMINROLE));
}
function Mail_send_allowed($tid){
    $gv = isset($GLOBALS["GLOBAL_VARS"]) ? $GLOBALS["GLOBAL_VARS"] : array();
    $user = isset($gv["user"]) ? (string)$gv["user"] : "";
    if($user === "admin" || $user === (string)$GLOBALS["z"])
        return TRUE;
    return Check_Grant(1, (int)$tid, "READ", FALSE) === TRUE;	# как ядро: грант таблицы, BARRED, доступ роли к корню
}

# --- lazy schema: table + fields + admin grant, then the settings record --------
function Mail_spec(){
    return array(
        "tables" => array(array(
            "name" => MAIL_TABLE_NAME,
            "fields" => array(
                array("name" => MAIL_REQ_HOST),
                array("name" => MAIL_REQ_PORT, "type" => "NUMBER"),
                array("name" => MAIL_REQ_LOGIN),
                array("name" => MAIL_REQ_PWD, "type" => "PWD"),
                array("name" => MAIL_REQ_FROM),
                array("name" => MAIL_REQ_LIMIT, "type" => "NUMBER"),
                array("name" => MAIL_REQ_HINT, "type" => "CHARS")))),
        "roles" => array(array(
            "name" => "Администратор", "grants" => array(
                array("table" => MAIL_TABLE_NAME, "level" => "WRITE")))));
}
function Mail_ensure_schema(){
    if(Mail_table_id()){
        Mail_ensure_record();
        return Mail_table_id();
    }
    Schema_apply(Mail_spec());
    unset($GLOBALS["MAIL_TABLE_ID"]);
    $tid = Mail_table_id();
    if($tid)
        Mail_ensure_record();
    return $tid;
}
function Mail_ensure_record(){
    global $z;
    $tid = Mail_table_id();
    if(!$tid)
        return 0;
    $row = mysqli_fetch_array(Exec_sql("SELECT id FROM $z WHERE up=1 AND t=$tid ORDER BY id LIMIT 1", "Mail: the settings record"));
    if($row)
        return (int)$row[0];
    $rec = Insert(1, 1, $tid, MAIL_RECORD_NAME, "Insert the mail settings record");
    foreach(Sj_type_reqs($tid) as $r){
        if($r["name"] === MAIL_REQ_PORT)
            Insert($rec, 1, (int)$r["id"], "465", "Default mail port");
        elseif($r["name"] === MAIL_REQ_LIMIT)
            Insert($rec, 1, (int)$r["id"], (string)MAIL_HOURLY_DEFAULT, "Default mail hourly limit");
        elseif($r["name"] === MAIL_REQ_HINT)
            Insert($rec, 1, (int)$r["id"], MAIL_HINT, "Mail app-password hint");
    }
    return $rec;
}

# --- the stars mask and the password crypto -------------------------------------
function Mail_req_base($t){
    if(isset($GLOBALS["REV_BT"][$t]))
        return $GLOBALS["REV_BT"][$t];
    global $z;
    if(!$row = mysqli_fetch_array(Exec_sql("SELECT t FROM $z WHERE id=".(int)$t, "Mail: base type")))
        return "";
    $bt = (int)$row[0];
    if(!isset($GLOBALS["REV_BT"][$bt]))
        return "";
    return $GLOBALS["REV_BT"][$bt];
}
function Skip_hidden_pwd($t, $v){
    if($v !== PASSWORDSTARS)
        return FALSE;
    if($t == TOKEN || $t == XSRF || $t == PASSWORD)
        return TRUE;
    return Mail_req_base($t) === "PWD";
}
function Mail_is_settings_pwd($objId, $t){
    if(Mail_req_base($t) !== "PWD")
        return FALSE;
    global $z;
    if(!$row = mysqli_fetch_array(Exec_sql("SELECT t FROM $z WHERE id=".(int)$objId, "Mail: settings-pwd record")))
        return FALSE;
    $tid = Mail_table_id();
    return $tid && (int)$row[0] === $tid;
}
function Mail_secret_encrypt($plain){
    if(!function_exists("openssl_encrypt"))
        return FALSE;
    $key = hash_hmac("sha256", "mailpwd:".$GLOBALS["z"], ADMINHASH.SALT, TRUE);
    $iv = random_bytes(12);
    $tag = "";
    $ct = openssl_encrypt((string)$plain, "aes-256-gcm", $key, OPENSSL_RAW_DATA, $iv, $tag);
    if($ct === FALSE)
        return FALSE;
    return base64_encode($iv).".".base64_encode($tag).".".base64_encode($ct);
}
function Mail_secret_decrypt($stored){
    $parts = explode(".", (string)$stored);
    if(count($parts) !== 3)
        return NULL;
    $iv = base64_decode($parts[0], true);
    $tag = base64_decode($parts[1], true);
    $ct = base64_decode($parts[2], true);
    if($iv === false || $tag === false || $ct === false || strlen($iv) !== 12 || strlen($tag) !== 16)
        return NULL;
    $key = hash_hmac("sha256", "mailpwd:".$GLOBALS["z"], ADMINHASH.SALT, TRUE);
    $plain = openssl_decrypt($ct, "aes-256-gcm", $key, OPENSSL_RAW_DATA, $iv, $tag);
    return $plain === false ? NULL : $plain;
}

# --- recipients and the hourly limit --------------------------------------------
# Адрес идёт в RCPT TO / MAIL FROM как есть: без скобок, кавычек, пробелов и управляющих символов.
function Mail_addr_ok($a){
    return preg_match(MAIL_MASK, $a)
        && preg_match('/^[^\s<>()\[\]",;:\\\\@\x00-\x1F\x7F]+@[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?)+$/u', $a) === 1;
}
function Mail_parse_recipients($to){
    $out = array();
    foreach(preg_split('/[,;\s]+/', trim((string)$to)) as $a){
        $a = trim((string)$a);
        if($a === "")
            continue;
        if(!Mail_addr_ok($a))
            my_die(t9n("[RU]Некорректный адрес получателя: ".htmlspecialchars($a)."[EN]invalid recipient: ".htmlspecialchars($a)), "400 Bad Request");
        $out[] = $a;
    }
    if(!count($out))
        my_die(t9n("[RU]Не заданы получатели письма[EN]no recipients given"), "400 Bad Request");
    if(count($out) > MAIL_MAX_RECIPIENTS)
        my_die(t9n("[RU]Слишком много получателей (не больше ".MAIL_MAX_RECIPIENTS.")[EN]too many recipients (max ".MAIL_MAX_RECIPIENTS.")"), "400 Bad Request");
    return $out;
}
function Mail_sent_last_hour(){
    global $z;
    $file = LOGS_DIR.$z."_mail.jsonl";
    if(!is_file($file))
        return 0;
    # Журнал читается с конца кусками, пока не встретится строка старше часа: счёт не зависит
    # ни от длины строк, ни от величины лимита.
    $h = @fopen($file, "r");
    if(!$h)
        return 0;
    clearstatcache(TRUE, $file);
    $pos = (int)filesize($file);
    $cutoff = time() - 3600;
    $n = 0;
    $rest = "";
    $done = FALSE;
    while(!$done && $pos > 0){
        $len = (int)min(65536, $pos);
        $pos -= $len;
        fseek($h, $pos);
        $lines = explode("\n", fread($h, $len).$rest);
        $rest = $pos > 0 ? array_shift($lines) : "";	# первая строка куска может быть неполной
        for($i = count($lines) - 1; $i >= 0; $i--){
            $rec = json_decode($lines[$i], true);
            if(!is_array($rec) || !isset($rec["ts"]))
                continue;
            if(strtotime((string)$rec["ts"]) < $cutoff){
                $done = TRUE;
                break;
            }
            if(!empty($rec["ok"]))
                $n++;
        }
    }
    fclose($h);
    return $n;
}
# Блокировка на базу: проверка лимита, отправка и запись в журнал идут одним шагом,
# параллельные запросы не проскакивают лимит.
function Mail_lock(){
    if(!defined("LOGS_DIR"))
        return NULL;
    $h = @fopen(LOGS_DIR.$GLOBALS["z"]."_mail.lock", "c");
    if(!$h)
        return NULL;
    if(!flock($h, LOCK_EX)){
        fclose($h);
        return NULL;
    }
    return $h;
}
function Mail_rate_gate($limit){
    $limit = (int)$limit;
    if($limit <= 0)
        my_die(t9n("[RU]Отправка писем запрещена: лимит в час равен 0[EN]mail sending is disabled (hourly limit is 0)"), "403 Forbidden");
    if(Mail_sent_last_hour() >= $limit)
        my_die(t9n("[RU]Достигнут лимит в час, попробуйте позже или увеличьте лимит в настройках почты[EN]hourly limit reached, try later or raise the limit in the mail settings"), "429 Too Many Requests");
}
function Mail_parse_from($from){
    $from = trim((string)$from);
    if(preg_match('/^(.*?)<([^<>]+)>\s*$/', $from, $m)){
        $name = trim($m[1], " \t\"'");
        return array("addr" => strtolower(trim($m[2])), "name" => $name);
    }
    return array("addr" => strtolower($from), "name" => "");
}

# --- SMTP dialog -----------------------------------------------------------------
# rd() returns one full server reply (multi-line ok), wr() sends a command or the message.
function Mail_smtp_read($conn){
    $line = $conn["rd"]();
    if($line === FALSE || $line === NULL || $line === "")
        return FALSE;
    return explode("\r\n", rtrim((string)$line, "\r\n"));
}
function Mail_smtp_session($cfg, $tos, $subject, $body, $attach, $conn){
    $helo = strpos($cfg["addr"], "@") !== false ? substr(strrchr($cfg["addr"], "@"), 1) : $cfg["host"];
    $g = Mail_smtp_read($conn);
    if($g === FALSE || (int)substr($g[0], 0, 3) !== 220)
        return array("ok" => FALSE, "error" => t9n("[RU]SMTP: сервер не поздоровался[EN]SMTP: bad greeting or connection lost"), "code" => "502 Bad Gateway");
    if(!$conn["wr"]("EHLO ".$helo))
        return array("ok" => FALSE, "error" => t9n("[RU]SMTP: соединение прервано[EN]SMTP: connection lost"), "code" => "502 Bad Gateway");
    $cap = Mail_smtp_read($conn);
    if($cap === FALSE || (int)substr($cap[0], 0, 3) !== 250)
        return array("ok" => FALSE, "error" => t9n("[RU]SMTP: EHLO не принят[EN]SMTP: EHLO rejected"), "code" => "502 Bad Gateway");
    $offer = FALSE;
    foreach($cap as $ln)
        if(preg_match('/^250[- ]STARTTLS\b/i', trim($ln)))
            $offer = TRUE;
    $port = (int)$cfg["port"];
    $loop = in_array(strtolower((string)$cfg["host"]), array("127.0.0.1", "::1", "localhost"), TRUE);
    if($port !== 465){
        if($offer){
            if(!$conn["wr"]("STARTTLS"))
                return array("ok" => FALSE, "error" => t9n("[RU]SMTP: соединение прервано[EN]SMTP: connection lost"), "code" => "502 Bad Gateway");
            $r = Mail_smtp_read($conn);
            if($r === FALSE || (int)substr($r[0], 0, 3) !== 220)
                return array("ok" => FALSE, "error" => t9n("[RU]SMTP: сервер не дал подняться до TLS[EN]SMTP: STARTTLS refused"), "code" => "502 Bad Gateway");
            if(!$conn["tls"]())
                return array("ok" => FALSE, "error" => t9n("[RU]SMTP: не удалось установить защищённое соединение[EN]SMTP: secure connection failed"), "code" => "502 Bad Gateway");
            if(!$conn["wr"]("EHLO ".$helo))
                return array("ok" => FALSE, "error" => t9n("[RU]SMTP: соединение прервано[EN]SMTP: connection lost"), "code" => "502 Bad Gateway");
            $cap2 = Mail_smtp_read($conn);
            if($cap2 === FALSE || (int)substr($cap2[0], 0, 3) !== 250)
                return array("ok" => FALSE, "error" => t9n("[RU]SMTP: EHLO после STARTTLS не принят[EN]SMTP: EHLO after STARTTLS rejected"), "code" => "502 Bad Gateway");
        }
        elseif($port === 587 || !$loop){
            return array("ok" => FALSE, "error" => t9n("[RU]SMTP: сервер не поддерживает STARTTLS, отправка без шифрования запрещена[EN]SMTP: server does not support STARTTLS, plain sending is forbidden"), "code" => "502 Bad Gateway");
        }
    }
    if(!$conn["wr"]("AUTH LOGIN"))
        return array("ok" => FALSE, "error" => t9n("[RU]SMTP: соединение прервано[EN]SMTP: connection lost"), "code" => "502 Bad Gateway");
    $r = Mail_smtp_read($conn);
    if($r === FALSE || (int)substr($r[0], 0, 3) !== 334)
        return array("ok" => FALSE, "error" => t9n("[RU]SMTP: сервер не принял начало авторизации[EN]SMTP: server refused authentication"), "code" => "502 Bad Gateway");
    if(!$conn["wr"](base64_encode($cfg["login"])))
        return array("ok" => FALSE, "error" => t9n("[RU]SMTP: соединение прервано[EN]SMTP: connection lost"), "code" => "502 Bad Gateway");
    $r = Mail_smtp_read($conn);
    if($r === FALSE || (int)substr($r[0], 0, 3) !== 334)
        return array("ok" => FALSE, "error" => t9n("[RU]SMTP: сервер не принял логин[EN]SMTP: server did not accept the login"), "code" => "502 Bad Gateway");
    if(!$conn["wr"](base64_encode($cfg["pwd"])))
        return array("ok" => FALSE, "error" => t9n("[RU]SMTP: соединение прервано[EN]SMTP: connection lost"), "code" => "502 Bad Gateway");
    $r = Mail_smtp_read($conn);
    if($r === FALSE || (int)substr($r[0], 0, 3) !== 235)
        return array("ok" => FALSE, "error" => t9n("[RU]SMTP: сервер не принял логин или пароль приложения. ".MAIL_HINT."[EN]SMTP: the server did not accept the login or app password. ".MAIL_HINT), "code" => "502 Bad Gateway");
    if(!$conn["wr"]("MAIL FROM: <".$cfg["addr"].">"))
        return array("ok" => FALSE, "error" => t9n("[RU]SMTP: соединение прервано[EN]SMTP: connection lost"), "code" => "502 Bad Gateway");
    $r = Mail_smtp_read($conn);
    if($r === FALSE || (int)substr($r[0], 0, 3) !== 250)
        return array("ok" => FALSE, "error" => t9n("[RU]SMTP: MAIL FROM не принят[EN]SMTP: MAIL FROM rejected"), "code" => "502 Bad Gateway");
    foreach($tos as $to){
        if(!$conn["wr"]("RCPT TO: <".$to.">"))
            return array("ok" => FALSE, "error" => t9n("[RU]SMTP: соединение прервано[EN]SMTP: connection lost"), "code" => "502 Bad Gateway");
        $r = Mail_smtp_read($conn);
        if($r === FALSE || ((int)substr($r[0], 0, 3) !== 250 && (int)substr($r[0], 0, 3) !== 251))
            return array("ok" => FALSE, "error" => t9n("[RU]SMTP: адресат ".htmlspecialchars($to)." отклонён сервером: ".htmlspecialchars((string)$r[0])."[EN]SMTP: recipient ".htmlspecialchars($to)." was rejected: ".htmlspecialchars((string)$r[0])), "code" => "502 Bad Gateway");
    }
    if(!$conn["wr"]("DATA"))
        return array("ok" => FALSE, "error" => t9n("[RU]SMTP: соединение прервано[EN]SMTP: connection lost"), "code" => "502 Bad Gateway");
    $r = Mail_smtp_read($conn);
    if($r === FALSE || (int)substr($r[0], 0, 3) !== 354)
        return array("ok" => FALSE, "error" => t9n("[RU]SMTP: сервер не принял DATA[EN]SMTP: DATA refused"), "code" => "502 Bad Gateway");
    $mid = "<".bin2hex(random_bytes(8))."@".$helo.">";
    $bound = "bnd_".bin2hex(random_bytes(8));
    $from_name = isset($cfg["name"]) ? (string)$cfg["name"] : "";
    $sbj = (string)$subject;
    $hdr = "Date: ".date(DATE_RFC2822)."\r\n"
          ."Message-ID: ".$mid."\r\n"
          .($sbj !== "" ? "Subject: ".mime_word($sbj)."\r\n" : "")
          ."From: ".($from_name !== "" ? mime_word($from_name)." <".$cfg["addr"].">" : $cfg["addr"])."\r\n"
          ."To: ".implode(", ", $tos)."\r\n"
          ."MIME-Version: 1.0\r\n";
    $has_att = is_array($attach) && isset($attach["name"]) && isset($attach["data"]);
    if($has_att){
        $fname = trim(preg_replace('/[\r\n"]/', "", (string)$attach["name"]));
        if($fname === "")
            $fname = "attachment";
        $hdr .= "Content-Type: multipart/mixed; boundary=\"$bound\"\r\n\r\n"
             ."--$bound\r\n"
             ."Content-Type: text/plain; charset=UTF-8\r\n"
             ."Content-Transfer-Encoding: base64\r\n\r\n"
             .chunk_split(base64_encode((string)$body), 76, "\r\n");
        $hdr .= "--$bound\r\n"
             ."Content-Type: application/octet-stream; name=\"$fname\"\r\n"
             ."Content-Disposition: attachment; filename=\"$fname\"\r\n"
             ."Content-Transfer-Encoding: base64\r\n\r\n"
             .chunk_split(base64_encode((string)$attach["data"]), 76, "\r\n")
             ."--$bound--\r\n";
    } else {
        $hdr .= "Content-Type: text/plain; charset=UTF-8\r\n"
             ."Content-Transfer-Encoding: base64\r\n\r\n"
             .chunk_split(base64_encode((string)$body), 76, "\r\n");
    }
    $msg = preg_replace('/^\./m', "..", $hdr);
    if(!$conn["wr"]($msg))
        return array("ok" => FALSE, "error" => t9n("[RU]SMTP: соединение прервано[EN]SMTP: connection lost"), "code" => "502 Bad Gateway");
    if(!$conn["wr"]("."))
        return array("ok" => FALSE, "error" => t9n("[RU]SMTP: соединение прервано[EN]SMTP: connection lost"), "code" => "502 Bad Gateway");
    $r = Mail_smtp_read($conn);
    if($r === FALSE || (int)substr($r[0], 0, 3) !== 250)
        return array("ok" => FALSE, "error" => t9n("[RU]SMTP: сервер отклонил письмо[EN]SMTP: message rejected"), "code" => "502 Bad Gateway");
    $conn["wr"]("QUIT");
    $conn["close"]();
    return array("ok" => TRUE, "message_id" => $mid);
}

# --- production connection over a real socket -------------------------------------
function Mail_smtp_send($cfg, $tos, $subject, $body, $attach, $conn = NULL){
    if(is_array($conn))
        return Mail_smtp_session($cfg, $tos, $subject, $body, $attach, $conn);
    $port = (int)$cfg["port"];
    $host = (string)$cfg["host"];
    $transport = ($port === 465) ? "ssl://".$host : $host;
    $socket = @fsockopen($transport, $port, $errno, $errstr, 12);
    if(!$socket)
        return array("ok" => FALSE, "error" => t9n("[RU]SMTP-сервер ".htmlspecialchars($host.":".$port)." недоступен[EN]SMTP server ".htmlspecialchars($host.":".$port)." is unreachable"), "code" => "502 Bad Gateway");
    stream_set_timeout($socket, 20);
    $conn = array(
        "rd" => function() use ($socket){
            $out = "";
            while(($ln = fgets($socket, 1024)) !== false){
                $out .= $ln;
                if(strlen($ln) < 4 || $ln[3] !== "-")
                    break;
            }
            $out = rtrim($out, "\r\n");
            return $out === "" ? FALSE : $out;
        },
        "wr" => function($s) use ($socket){	# fwrite в TLS-сокет может записать только часть большого письма
            $data = $s."\r\n";
            $len = strlen($data);
            for($done = 0; $done < $len; $done += $n){
                $n = fwrite($socket, substr($data, $done, 65536));
                if($n === FALSE || $n === 0)
                    return FALSE;
            }
            return $len;
        },
        "tls" => function() use ($socket){
            return stream_socket_enable_crypto($socket, TRUE, STREAM_CRYPTO_METHOD_TLS_CLIENT);
        },
        "close" => function() use ($socket){ return fclose($socket); },
    );
    return Mail_smtp_session($cfg, $tos, $subject, $body, $attach, $conn);
}

# --- attachments --------------------------------------------------------------------
function Mail_attach_upload(){
    if(!isset($_FILES["file"]) || !is_array($_FILES["file"]))
        return NULL;
    $f = $_FILES["file"];
    if(!isset($f["error"]) || (int)$f["error"] !== UPLOAD_ERR_OK || !is_uploaded_file($f["tmp_name"]))
        my_die(t9n("[RU]Не удалось принять загруженный файл[EN]uploaded file was not received"), "400 Bad Request");
    $name = basename(str_replace("\\", "/", (string)$f["name"]));
    if($name === "" || strpos($name, "..") !== false)
        my_die(t9n("[RU]Некорректное имя файла[EN]wrong file name"), "400 Bad Request");
    if((int)$f["size"] > MAIL_ATTACH_MAX)
        my_die(t9n("[RU]Файл больше 10 МБ[EN]file is larger than 10 MB"), "400 Bad Request");
    return array("name" => $name, "data" => file_get_contents($f["tmp_name"]));
}
function Mail_attach_record($rec, $req){
    global $z;
    $rec = (int)$rec; $req = (int)$req;
    if($rec <= 0 || $req <= 0)
        my_die(t9n("[RU]Неверные параметры записи или реквизита[EN]wrong record or requisite id"), "400 Bad Request");
    if(!$row = mysqli_fetch_array(Exec_sql("SELECT t FROM $z WHERE id=$rec", "Mail: the record table for attach")))
        my_die(t9n("[RU]Запись не найдена[EN]record not found"), "400 Bad Request");
    $gv = isset($GLOBALS["GLOBAL_VARS"]) ? $GLOBALS["GLOBAL_VARS"] : array();
    $user = isset($gv["user"]) ? (string)$gv["user"] : "";
    $is_super = ($user === "admin" || $user === (string)$GLOBALS["z"]);
    # Право как в ядре: грант столбца (в т.ч. BARRED), таблицы записи, родительской таблицы
    if(!$is_super && (Check_Grant($rec, $req, "READ", FALSE) !== TRUE))
        my_die(t9n("[RU]Нет права на чтение этого реквизита записи[EN]no permission to read this requisite of the record"), "403 Forbidden");
    Check_Rec_masks($rec);
    if(!$f = mysqli_fetch_array(Exec_sql("SELECT id, val FROM $z WHERE up=$rec AND t=$req ORDER BY id LIMIT 1", "Mail: the file of the record")))
        my_die(t9n("[RU]В реквизите записи нет файла[EN]no file in the record requisite"), "400 Bad Request");
    $vid = (int)$f[0];
    $name = basename(str_replace("\\", "/", (string)$f[1]));
    $ext = strtolower(substr(strrchr($name, "."), 1));
    if($ext === false || $ext === "")
        $ext = "";
    else
        $ext = ".".$ext;
    $path = GetSubdir($vid)."/".GetFilename($vid).$ext;
    if(!is_file($path))
        my_die(t9n("[RU]Файл не найден на сервере[EN]file not found on the server"), "400 Bad Request");
    if(filesize($path) > MAIL_ATTACH_MAX)
        my_die(t9n("[RU]Файл больше 10 МБ[EN]file is larger than 10 MB"), "400 Bad Request");
    return array("name" => $name, "data" => file_get_contents($path));
}

# --- the settings record ---------------------------------------------------------
function Mail_read_settings(){
    global $z;
    $tid = Mail_table_id();
    if(!$tid)
        my_die(t9n("[RU]Отправка писем не настроена: нет таблицы Почта для отправки[EN]mail sending is not configured, no mail settings table"), "400 Bad Request");
    $rid = array();
    foreach(Sj_type_reqs($tid) as $r)
        $rid[$r["name"]] = (int)$r["id"];
    $row = mysqli_fetch_array(Exec_sql("SELECT id FROM $z WHERE up=1 AND t=$tid ORDER BY id LIMIT 1", "Mail: the settings record"));
    if(!$row)
        my_die(t9n("[RU]В таблице Почта для отправки нет записи с настройками[EN]no settings record"), "400 Bad Request");
    $rec = (int)$row[0];
    $vals = array();
    $res = Exec_sql("SELECT v.t, v.val FROM $z v WHERE v.up=$rec", "Mail: the values of the record");
    while($vr = mysqli_fetch_array($res))
        $vals[(int)$vr[0]] = (string)$vr[1];
    $need = array(MAIL_REQ_HOST => "host", MAIL_REQ_PORT => "port", MAIL_REQ_LOGIN => "login",
                  MAIL_REQ_PWD => "pwd", MAIL_REQ_FROM => "from", MAIL_REQ_LIMIT => "limit");
    $cfg = array("rec_id" => $rec);
    foreach($need as $name => $key)
        $cfg[$key] = isset($rid[$name]) && isset($vals[(int)$rid[$name]]) ? trim((string)$vals[$rid[$name]]) : "";
    $hint = Mail_is_admin() ? " (settings: /".(string)$GLOBALS["z"]."/edit_obj/".$rec.")" : "";
    if($cfg["host"] === "")
        my_die(t9n("[RU]Не заполнен SMTP-сервер[EN]SMTP server is not set").$hint, "400 Bad Request");
    if((int)$cfg["port"] <= 0)
        my_die(t9n("[RU]Не заполнен порт SMTP[EN]SMTP port is not set").$hint, "400 Bad Request");
    if($cfg["login"] === "")
        my_die(t9n("[RU]Не заполнен логин SMTP[EN]SMTP login is not set").$hint, "400 Bad Request");
    if($cfg["pwd"] === "")
        my_die(t9n("[RU]Не задан пароль приложения. Подсказка: ".MAIL_HINT."[EN]app password is not set. Hint: ".MAIL_HINT).$hint, "400 Bad Request");
    $from = Mail_parse_from($cfg["from"]);
    if($from["addr"] === "" || !Mail_addr_ok($from["addr"]))
        my_die(t9n("[RU]Некорректный отправитель (От кого)[EN]wrong sender (From)"), "400 Bad Request");
    $plain = Mail_secret_decrypt($cfg["pwd"]);
    if($plain === NULL)
        my_die(t9n("[RU]Пароль приложения не читается - внесите его заново в настройках почты[EN]app password cannot be read - re-enter the app password in the mail settings").$hint, "400 Bad Request");
    $cfg["pwd"] = $plain;
    $cfg["addr"] = $from["addr"];
    $cfg["name"] = $from["name"];
    $cfg["limit"] = ($cfg["limit"] === "") ? MAIL_HOURLY_DEFAULT : (int)$cfg["limit"];
    return $cfg;
}

# --- the journal -------------------------------------------------------------------
function Mail_log($rec){
    logWrite("mail", array_merge(logHead(), $rec));
}

# --- the endpoint -------------------------------------------------------------------
function Mail_endpoint($com, $conn = NULL){
    if(!isset($_SERVER["REQUEST_METHOD"]) || $_SERVER["REQUEST_METHOD"] !== "POST")
        my_die(t9n("[RU]Отправка письма - только POST[EN]POST only"), "405 Method Not Allowed");
    check();
    $tid = Mail_table_id();
    if(!$tid){
        if(Mail_is_admin())
            $tid = Mail_ensure_schema();
        if(!$tid)
            my_die(t9n("[RU]Отправка писем не настроена: в базе нет таблицы Почта для отправки[EN]mail sending is not configured"), "400 Bad Request");
    }
    if(!Mail_send_allowed($tid))
        my_die(t9n("[RU]У вас нет права на отправку писем (нужен доступ к таблице Почта для отправки)[EN]no mail sending permission"), "403 Forbidden");
    $cfg = Mail_read_settings();
    $tos = Mail_parse_recipients(isset($_POST["to"]) ? (string)$_POST["to"] : "");
    $subject = isset($_POST["subject"]) ? (string)$_POST["subject"] : "";
    $body = isset($_POST["body"]) ? (string)$_POST["body"] : "";
    if($subject === "" && $body === "")
        my_die(t9n("[RU]Пустое письмо: задайте тему или текст[EN]empty letter: give a subject or a body"), "400 Bad Request");
    if(mb_strlen((string)$subject) > 500)
        my_die(t9n("[RU]Слишком длинная тема письма[EN]subject too long"), "400 Bad Request");
    if(strlen($body) > MAIL_BODY_MAX)
        my_die(t9n("[RU]Слишком длинное тело письма[EN]body too long"), "400 Bad Request");
    $attach = NULL;
    if(isset($_FILES["file"]))
        $attach = Mail_attach_upload();
    if($attach === NULL && isset($_POST["rec"]) && isset($_POST["req"]))
        $attach = Mail_attach_record((int)$_POST["rec"], (int)$_POST["req"]);
    $lock = Mail_lock();	# лимит, отправка и журнал - один шаг на базу (снимается и при my_die - с концом процесса)
    Mail_rate_gate($cfg["limit"]);
    $res = Mail_smtp_send($cfg, $tos, $subject, $body, $attach, $conn);
    $j = array("act" => "mail", "to" => $tos, "from" => $cfg["addr"], "subject" => mb_substr((string)$subject, 0, 300),
               "ok" => !empty($res["ok"]));
    if(!empty($res["ok"]))
        $j["message_id"] = $res["message_id"];
    else
        $j["error"] = (string)$res["error"];
    if(is_array($attach))
        $j["attach"] = (string)$attach["name"];
    Mail_log($j);
    if($lock){
        flock($lock, LOCK_UN);
        fclose($lock);
    }
    if(empty($res["ok"]))
        my_die((string)$res["error"], (string)(isset($res["code"]) ? $res["code"] : "502 Bad Gateway"));
    api_dump(json_encode(array("status" => "ok", "message_id" => $res["message_id"], "to" => count($tos)), JSON_UNESCAPED_UNICODE), "mail.json");
}