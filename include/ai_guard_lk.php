<?php
# Страж данных ИИ-чата из ЛК (#5654): оплата с баланса и настройка стража базы.
#
# Страж живёт на сервисе ИИ-агента (python2node agent-chat, ключ guard в settings/<база>.json):
#   GET  <агент>/guard?db=<база>&lk=1 → {available, toggle, topics, action, settings: {enabled, topics, action, user_toggle, until}}
#   POST <агент>/guard {db, enabled, topics, action, user_toggle, until} → тот же ответ без settings
# Адрес — INTEGRAM_AGENT_ENDPOINT с заменой /chat на /guard, Bearer агента (aiAgentGuardService в index.php).
# until — конец оплаченного срока (unix): после него сервис выключает стража сам.
#
# Срок и тариф не хранятся отдельно: они вычисляются из платежей Payment 957 с Type bal2guard,
# в Notes которых записаны тариф, период, база и id её записи 271: «страж pro month (acme) r501».
# Срок привязан к записи базы: база удалена и создана заново под тем же именем — оплаты прежней
# записи новой не засчитываются. Платежи без « r<id>» (до привязки) считаются только за запись,
# созданную раньше платежа (id платежа больше id записи — id в my растут).
#
# Лимит вопросов тарифа (limit) и id записи (rec) уходят сервису; вопросы под стражем считает сервис.
# Исчерпав лимит, он покупает пакет служебным POST /my/billing/guard_pack (Gd_pack_request):
# GD_OVER_PRICE ₽ с баланса владельца базы, платёж 957 Type bal2guardx,
# Notes «страж +1000 (acme) 2026-11 #2 r501» — номер пакета в месяце; повтор номера не списывает.
#
# Стыковка периодов (Gd_compute):
#   - продление тем же тарифом во время срока — новый период начинается с конца текущего;
#   - оплата после окончания — период начинается с момента оплаты;
#   - Старт → Профи во время срока Старта действует сразу: Профи на оплаченный период с момента
#     оплаты, плюс остаток Старта, пересчитанный в дни Профи по цене месяца (1490/2990 ≈ половина);
#   - Старт во время срока Профи ЛК не продаёт (Gd_action_pay); если такой платёж всё же есть
#     (гонка двух вкладок), его время добавляется к Профи с тем же пересчётом по цене.

define("GD_PAY_TYPE", "bal2guard");   # тип платежа (реквизит 1085 записи Payment 957)
define("GD_PACK_TYPE", "bal2guardx"); # тип платежа сверхлимитного пакета
define("GD_PACK_MAX", 500);           # пакетов на базу в месяц — предохранитель от сбойного счётчика
define("GD_MONTH", 31 * 86400);
define("GD_YEAR", 366 * 86400);
define("GD_OVER_PRICE", 150);         # ₽ за GD_OVER_UNIT вопросов сверх лимита тарифа
define("GD_OVER_UNIT", 1000);

# Тарифы стража — единственное место с ценами и правилами.
# actions — разрешённые режимы, topics — можно ли выбирать отраслевые тематики (базовые виды —
# почта, телефоны, пароли и ключи — включены всегда), limit — вопросов через стража в месяц.
function Gd_plans(){
    return array(
        "start" => array("title" => "Старт", "month" => 1490, "year" => 15190,
            "actions" => array("mask", "audit"), "topics" => false, "limit" => 5000),
        "pro" => array("title" => "Профи", "month" => 2990, "year" => 30490,
            "actions" => array("mask", "block", "audit"), "topics" => true, "limit" => 20000),
    );
}
# Отраслевые тематики сервиса (guard.py TOPICS без base).
function Gd_topics(){
    return array("bank", "finance", "realtor", "hr", "medical");
}
function Gd_actions(){
    return array("mask", "block", "audit");
}

# --- чистый расчёт --------------------------------------------------------------------------------
# Notes платежа → [план, период] для базы $db или null. $rec — id записи базы (0 — без привязки),
# $payId — id платежа: платёж без « r<id>» относится к записи, только если он моложе её.
function Gd_parse_notes($notes, $db, $rec=0, $payId=0){
    if(!preg_match('/^страж (start|pro) (month|year) \(([a-z0-9_]+)\)(?: r(\d+))?$/u', trim((string)$notes), $m))
        return null;
    if(strtolower($m[3]) !== strtolower((string)$db))
        return null;
    $rec = (int)$rec;
    if($rec > 0){
        if(isset($m[4]) && $m[4] !== ""){
            if((int)$m[4] !== $rec)
                return null;
        }elseif((int)$payId <= $rec)
            return null;
    }
    return array($m[1], $m[2]);
}
# Время тарифа $from в пересчёте на время тарифа $to по цене месяца.
function Gd_convert($seconds, $from, $to){
    $p = Gd_plans();
    return (int)floor($seconds * $p[$from]["month"] / $p[$to]["month"]);
}
# $payments — [["id", "amount", "paid" => unix, "notes"], …] (bal2guard пользователя).
# Возвращает ["plan" => "start"|"pro"|"", "until" => unix|0] — тариф последнего периода и конец срока.
function Gd_compute($payments, $db, $rec=0){
    usort($payments, function($a, $b){
        $d = (int)$a["paid"] - (int)$b["paid"];
        return $d !== 0 ? $d : (int)$a["id"] - (int)$b["id"];
    });
    $plan = "";
    $until = 0;
    foreach($payments as $p){
        $pp = Gd_parse_notes($p["notes"], $db, $rec, $p["id"]);
        $t = (int)$p["paid"];
        if(!$pp || $t <= 0)
            continue;
        list($pl, $period) = $pp;
        $dur = $period === "year" ? GD_YEAR : GD_MONTH;
        if($until <= $t){
            $plan = $pl;
            $until = $t + $dur;
        }elseif($pl === $plan)
            $until += $dur;
        elseif($pl === "pro"){        # Старт → Профи: сразу, остаток Старта — в дни Профи
            $until = $t + $dur + Gd_convert($until - $t, "start", "pro");
            $plan = "pro";
        }else                         # Старт во время Профи: его время — в дни Профи
            $until += Gd_convert($dur, "start", "pro");
    }
    return array("plan" => $plan, "until" => $until);
}
# "" — выбор разрешён тарифом, иначе текст отказа.
function Gd_plan_error($plan, $topics, $action){
    $plans = Gd_plans();
    if(!isset($plans[$plan]))
        return t9n("[RU]Страж не оплачен[EN]The guard is not paid");
    $p = $plans[$plan];
    if(!in_array($action, $p["actions"], true))
        return t9n("[RU]Режим «запрещать вопрос» доступен на тарифе «Профи». На «".$p["title"]."» — маскировать или только журнал.[EN]Blocking is available on the Pro plan");
    if($topics && !$p["topics"])
        return t9n("[RU]Отраслевые тематики доступны на тарифе «Профи». На «".$p["title"]."» страж ищет почту, телефоны, пароли и ключи.[EN]Industry topics are available on the Pro plan");
    return "";
}
# Выбор, урезанный до тарифа: лишние тематики убираются, запрет заменяется маскированием.
function Gd_fit_plan($plan, $topics, $action){
    $plans = Gd_plans();
    $p = isset($plans[$plan]) ? $plans[$plan] : $plans["start"];
    $topics = $p["topics"] ? array_values(array_intersect(Gd_topics(), (array)$topics)) : array();
    if(!in_array($action, $p["actions"], true))
        $action = "mask";
    return array($topics, $action);
}

# --- база my и сервис -----------------------------------------------------------------------------
function Gd_require_user(){
    $u = isset($GLOBALS["GLOBAL_VARS"]["user_id"]) ? (int)$GLOBALS["GLOBAL_VARS"]["user_id"] : 0;
    $name = isset($GLOBALS["GLOBAL_VARS"]["user"]) ? strtolower((string)$GLOBALS["GLOBAL_VARS"]["user"]) : "";
    if($u <= 0 || $name === "" || $name === "guest")
        my_die(t9n("[RU]Войдите в личный кабинет[EN]Please log in"));
    return $u;
}
function Gd_user_payments($user, $type=GD_PAY_TYPE){
    $out = array();
    $r = Exec_sql("SELECT p.id id, p.val amount, paid.val paid, n.val notes FROM my p"
        ." JOIN my ty ON ty.up=p.id AND ty.t=1085 AND ty.val='".($type === GD_PACK_TYPE ? GD_PACK_TYPE : GD_PAY_TYPE)."'"
        ." JOIN my paid ON paid.up=p.id AND paid.t=967"
        ." JOIN my n ON n.up=p.id AND n.t=1075"
        ." WHERE p.up=".(int)$user." AND p.t=957", "Guard payments");
    while($row = mysqli_fetch_assoc($r))
        $out[] = array("id" => (int)$row["id"], "amount" => (float)$row["amount"], "paid" => (int)$row["paid"], "notes" => (string)$row["notes"]);
    return $out;
}
# Ответ GET сервиса (с выбором владельца) или null.
function Gd_service_get($db){
    $svc = aiAgentGuardService();
    if(!$svc)
        return null;
    $raw = aiAgentGuardFetch($svc["base"]."/guard?db=".rawurlencode($db)."&lk=1", $svc["headers"]);
    $in = is_string($raw) ? json_decode($raw, true) : null;
    return (is_array($in) && isset($in["available"])) ? $in : null;
}
# Настройка стража на сервисе; true — сервис принял. Кеш статуса чата сбрасывается в любом случае.
function Gd_service_set($db, $cfg){
    $svc = aiAgentGuardService();
    if(!$svc)
        return false;
    $body = array("db" => $db, "enabled" => (bool)$cfg["enabled"], "topics" => array_values($cfg["topics"]),
        "action" => $cfg["action"], "user_toggle" => (bool)$cfg["user_toggle"]);
    if((int)$cfg["until"] > 0)
        $body["until"] = (int)$cfg["until"];
    # rec — id записи базы: новый rec сервис считает другой базой и забывает срок, лимит и выбор прежней.
    if(isset($cfg["rec"]) && (int)$cfg["rec"] > 0)
        $body["rec"] = (int)$cfg["rec"];
    if(array_key_exists("limit", $cfg))
        $body["limit"] = $cfg["limit"] === null ? null : (int)$cfg["limit"];
    if(!empty($cfg["reset"]))
        $body["reset"] = true;     # забыть срок, лимит и выбор (настройка другой записи базы)
    $raw = aiAgentGuardPost($svc["base"]."/guard", $svc["headers"], json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    $cache = aiAgentGuardCacheFile($db);
    if($cache !== "")
        @unlink($cache);
    $in = is_string($raw) ? json_decode($raw, true) : null;
    return is_array($in) && isset($in["available"]);
}
# Действия ЛК над стражем базы идут по одному: расчёт срока и отправка сервису под замком базы,
# чтобы параллельная оплата или сохранение не отправили сервису устаревший until.
# Замок снимается сам с концом запроса (соединения).
function Gd_lock($db){
    $row = mysqli_fetch_assoc(Exec_sql("SELECT GET_LOCK('guard_".$db."', 20) ok", "Guard lock"));
    if(!$row || (string)$row["ok"] !== "1")
        my_die(t9n("[RU]Страж этой базы сейчас настраивается в другом окне — повторите через минуту[EN]The guard is busy, try again in a minute"));
}
function Gd_not_applied(){
    return t9n("[RU]Оплата учтена, но сервис ИИ-агента сейчас не ответил — настройка стража не применилась. Нажмите «Сохранить» ещё раз чуть позже.[EN]Saved, but the AI agent service did not respond. Press Save again later.");
}

# Сервису — «для записи $rec страж не настроен»: срок, лимит, выбор и счётчик прежней записи забыты.
function Gd_service_reset($db, $rec){
    return Gd_service_set($db, array("enabled" => false, "topics" => array(), "action" => "mask",
        "user_toggle" => true, "until" => 0, "rec" => (int)$rec, "limit" => null, "reset" => true));
}
# Новая запись базы (#5654): если под этим именем раньше оплачивали стража, у сервиса может остаться
# настройка прежней записи — сбросить сразу при создании, не дожидаясь панели стража в ЛК.
# Без таких платежей сервис не трогаем (лишний HTTP при каждой регистрации не нужен).
function Gd_db_created($db, $rec){
    if(!aiAgentGuardService())
        return false;
    $like = "страж % (".$db.")%";
    $row = mysqli_fetch_assoc(Exec_sql("SELECT 1 x FROM my WHERE t=1075 AND val LIKE '".addslashes($like)."' LIMIT 1", "Guard: paid before"));
    return $row ? Gd_service_reset($db, $rec) : false;
}

# --- действия ЛК ----------------------------------------------------------------------------------
function Gd_status($db){
    $user = Gd_require_user();
    $own = Cd_own_db($db);
    Gd_lock($own["db"]);
    $c = Gd_compute(Gd_user_payments($user), $own["db"], $own["id"]);
    $state = $c["until"] === 0 ? "none" : ($c["until"] > time() ? "active" : "expired");
    $limit = Gd_plan_limit($c);
    $agent = aiAgentGuardService() !== null;
    $svc = $agent ? Gd_service_get($own["db"]) : null;
    $settings = null;
    $usage = null;
    if($svc && isset($svc["settings"]) && is_array($svc["settings"])){
        $s = $svc["settings"];
        $settings = array("enabled" => !empty($s["enabled"]),
            "topics" => array_values(array_intersect(Gd_topics(), isset($s["topics"]) && is_array($s["topics"]) ? $s["topics"] : array())),
            "action" => isset($s["action"]) && in_array($s["action"], Gd_actions(), true) ? $s["action"] : "mask",
            "user_toggle" => !array_key_exists("user_toggle", $s) || !empty($s["user_toggle"]),
            "until" => isset($s["until"]) && is_numeric($s["until"]) ? (int)$s["until"] : null);
        $svcRec = isset($s["rec"]) && is_numeric($s["rec"]) ? (int)$s["rec"] : 0;
        $svcLimit = isset($s["limit"]) && is_numeric($s["limit"]) ? (int)$s["limit"] : null;
        # Настройка сервиса — от другой записи базы (база удалена и создана заново под тем же именем)
        # или оплаченный срок без привязки, а у этой записи платежей стража нет совсем: для этой
        # записи страж не настроен, срок и лимит прежнего владельца сбрасываются. Срок без привязки
        # при истёкшей оплате этой записи — её собственный (настроен до привязки), выбор сохраняется.
        $foreign = ($svcRec > 0 && $svcRec !== $own["id"])
            || ($svcRec === 0 && $settings["until"] !== null && $state === "none");
        if($foreign)    # выбор прежнего владельца не показывается и не переносится
            $settings = array("enabled" => $state === "active", "topics" => array(), "action" => "mask", "user_toggle" => true, "until" => null);
        if($foreign && $state !== "active"){
            Gd_service_reset($own["db"], $own["id"]);
            $svc["available"] = false;
        }elseif($state === "active" && ($settings["until"] !== $c["until"] || $svcRec !== $own["id"] || $svcLimit !== $limit)){
            # У этой записи оплачен срок, а сервис о нём не знает (оплата, когда сервис не отвечал) —
            # новый rec там же сбросит выбор прежней записи.
            # Срок, лимит или привязка на сервисе отстали от оплаченного (продление, когда сервис не
            # отвечал; настройка до привязки к записи) — дослать.
            list($t, $act) = Gd_fit_plan($c["plan"], $settings["topics"], $settings["action"]);
            if(Gd_service_set($own["db"], array("enabled" => $settings["enabled"], "topics" => $t, "action" => $act,
                    "user_toggle" => $settings["user_toggle"], "until" => $c["until"], "rec" => $own["id"], "limit" => $limit))){
                $settings["until"] = $c["until"];
                $settings["topics"] = $t;
                $settings["action"] = $act;
            }
        }
        if(!$foreign && isset($svc["usage"]) && is_array($svc["usage"]))
            $usage = $svc["usage"];
    }
    $prices = $limits = $rules = array();
    foreach(Gd_plans() as $k => $p){
        $prices[$k] = array("month" => $p["month"], "year" => $p["year"]);
        $limits[$k] = $p["limit"];
        $rules[$k] = array("title" => $p["title"], "actions" => $p["actions"], "topics" => $p["topics"]);
    }
    return array("db" => $own["db"], "state" => $state, "plan" => $c["plan"], "until" => $c["until"],
        "agent" => $agent, "available" => $svc ? $svc["available"] === true : false, "service_ok" => $svc !== null,
        "settings" => $settings, "prices" => $prices, "limits" => $limits, "plans" => $rules,
        "over_price" => GD_OVER_PRICE, "over_unit" => GD_OVER_UNIT, "topics" => Gd_topics(),
        # Вопросы под стражем за календарный месяц и купленные пакеты считает сервис агента.
        "limit" => $limit,
        "used" => $usage && isset($usage["used"]) && is_numeric($usage["used"]) ? (int)$usage["used"] : null,
        "packs" => $usage && isset($usage["packs"]) && is_numeric($usage["packs"]) ? (int)$usage["packs"] : null,
        "pack_size" => $usage && isset($usage["pack_size"]) && is_numeric($usage["pack_size"]) ? (int)$usage["pack_size"] : GD_OVER_UNIT);
}
# Лимит вопросов в месяц по оплаченному тарифу или null (срок не идёт).
function Gd_plan_limit($c){
    $plans = Gd_plans();
    return ($c["until"] > time() && isset($plans[$c["plan"]])) ? (int)$plans[$c["plan"]]["limit"] : null;
}
# $req: enabled 0|1, topics "bank,hr", action mask|block|audit, user_toggle 0|1 (по умолчанию 1).
function Gd_action_set($db, $req){
    $user = Gd_require_user();
    $own = Cd_own_db($db);
    if(!aiAgentGuardService())
        my_die(t9n("[RU]Сервис ИИ-агента не настроен[EN]The AI agent service is not configured"));
    $enabled = isset($req["enabled"]) && (string)$req["enabled"] === "1";
    $topics = array();
    foreach(explode(",", isset($req["topics"]) ? (string)$req["topics"] : "") as $t){
        $t = strtolower(trim($t));
        if($t === "")
            continue;
        if(!in_array($t, Gd_topics(), true))
            my_die(t9n("[RU]Неизвестная тематика стража[EN]Unknown guard topic"));
        if(!in_array($t, $topics, true))
            $topics[] = $t;
    }
    $action = isset($req["action"]) ? (string)$req["action"] : "mask";
    if(!in_array($action, Gd_actions(), true))
        my_die(t9n("[RU]Неизвестный режим стража[EN]Unknown guard mode"));
    $userToggle = !isset($req["user_toggle"]) || (string)$req["user_toggle"] !== "0";
    Gd_lock($own["db"]);
    $c = Gd_compute(Gd_user_payments($user), $own["db"], $own["id"]);
    $active = $c["until"] > time();
    if($enabled && !$active)
        my_die(t9n("[RU]Сначала оплатите стража данных: тариф «Старт» или «Профи»[EN]Pay for the data guard first"));
    if($active){
        $err = Gd_plan_error($c["plan"], $topics, $action);
        if($err !== "")
            my_die($err);
    }
    $applied = Gd_service_set($own["db"], array("enabled" => $enabled && $active, "topics" => $topics, "action" => $action,
        "user_toggle" => $userToggle, "until" => $c["until"], "rec" => $own["id"], "limit" => Gd_plan_limit($c)));
    $st = Gd_status($own["db"]);
    $st["applied"] = $applied;
    if(!$applied)
        $st["notice"] = t9n("[RU]Сервис ИИ-агента сейчас не ответил — настройка стража не применилась. Попробуйте сохранить ещё раз чуть позже.[EN]The AI agent service did not respond. Try again later.");
    return $st;
}
# Оплата с баланса: списание атомарным UPDATE с условием достаточности, затем запись платежа
# (как Cd_action_pay); настройка сервиса — после, её сбой оплату не отменяет.
function Gd_action_pay($db, $plan, $period){
    $user = Gd_require_user();
    $own = Cd_own_db($db);
    if(!aiAgentGuardService())
        my_die(t9n("[RU]Сервис ИИ-агента не настроен — страж данных пока недоступен[EN]The AI agent service is not configured"));
    $plans = Gd_plans();
    if(!isset($plans[$plan]))
        my_die(t9n("[RU]Неизвестный тариф стража[EN]Unknown guard plan"));
    if($period !== "month" && $period !== "year")
        my_die(t9n("[RU]Неизвестный период оплаты[EN]Unknown period"));
    Gd_lock($own["db"]);
    $c = Gd_compute(Gd_user_payments($user), $own["db"], $own["id"]);
    if($plan === "start" && $c["plan"] === "pro" && $c["until"] > time())
        my_die(t9n("[RU]Идёт оплаченный период «Профи» до ".date("d.m.Y", $c["until"])
            .". Продлите «Профи» или оплатите «Старт» после окончания периода.[EN]The Pro period is active; extend Pro or pay Start after it ends"));
    $amount = (int)$plans[$plan][$period];
    $wasActive = $c["until"] > time();
    # Списание и запись платежа — одной транзакцией: сбой посреди записи (my_die, обрыв) откатывает
    # и списание, деньги без платежа не пропадают.
    if(!mysqli_begin_transaction($GLOBALS["connection"]))
        my_die(t9n("[RU]Не удалось начать оплату, повторите[EN]Could not start the payment"));
    Exec_sql("UPDATE my SET val=CAST(val AS DECIMAL(15,2))-$amount WHERE up=$user AND t=285 AND CAST(val AS DECIMAL(15,2))>=$amount LIMIT 1", "Guard pay debit");
    if(mysqli_affected_rows($GLOBALS["connection"]) !== 1)
        my_die(t9n("[RU]Недостаточно средств на балансе: нужно $amount ₽. Пополните баланс в разделе «Баланс».[EN]Not enough balance: $amount RUB needed"));
    $id = Insert($user, 1, 957, (string)$amount, "Guard payment");
    Insert($id, 1, 1085, GD_PAY_TYPE, "Guard payment type");
    Insert($id, 1, 967, (string)time(), "Guard payment date");
    Insert($id, 1, 1075, "страж $plan $period (".$own["db"].") r".$own["id"], "Guard payment notes");
    if(!mysqli_commit($GLOBALS["connection"]))
        my_die(t9n("[RU]Оплата не прошла, деньги не списаны. Повторите.[EN]Payment failed, nothing was charged"));
    $c = Gd_compute(Gd_user_payments($user), $own["db"], $own["id"]);
    # Выбор владельца берётся с сервиса и урезается до тарифа; после оплаты страж включён.
    # Сервис не ответил на чтение — не затираем выбор владельца: настройку дошлёт «Сохранить» или
    # открытие панели (Gd_status досылает отставший срок).
    $svc = Gd_service_get($own["db"]);
    $applied = false;
    if($svc){
        $s = (isset($svc["settings"]) && is_array($svc["settings"])) ? $svc["settings"] : array();
        # Выбор другой записи базы не переносится; без привязки (настроено до неё) — только если у этой
        # записи уже шёл оплаченный срок.
        $sRec = isset($s["rec"]) && is_numeric($s["rec"]) ? (int)$s["rec"] : 0;
        # Ручная настройка администратора (ни привязки, ни срока из ЛК) переносится.
        $sUntil = isset($s["until"]) && is_numeric($s["until"]) ? (int)$s["until"] : 0;
        if($sRec !== $own["id"] && !($sRec === 0 && ($wasActive || $sUntil === 0)))
            $s = array();
        list($topics, $action) = Gd_fit_plan($c["plan"], isset($s["topics"]) && is_array($s["topics"]) ? $s["topics"] : array(),
            isset($s["action"]) ? (string)$s["action"] : "mask");
        $applied = Gd_service_set($own["db"], array("enabled" => true, "topics" => $topics, "action" => $action,
            "user_toggle" => !array_key_exists("user_toggle", $s) || !empty($s["user_toggle"]), "until" => $c["until"],
            "rec" => $own["id"], "limit" => Gd_plan_limit($c)));
    }
    $st = Gd_status($own["db"]);
    $st["paid"] = $amount;
    $st["applied"] = $applied;
    if(!$applied)
        $st["notice"] = Gd_not_applied();
    return $st;
}

# --- сверхлимитный пакет: служебный вызов сервиса агента ------------------------------------------
# POST /my/billing/guard_pack {db, month: "YYYY-MM", n, rec}, заголовок X-Billing-Token
# (BILLING_SERVICE_TOKEN, как у /{db}/billing/add). Сервис считает вопросы под стражем и, исчерпав
# лимит тарифа и купленные пакеты, просит пакет №n этого месяца. Ответ:
#   200 {"ok": true, "packs", "charged"}  — куплен (charged = цена) или уже был куплен (charged = 0);
#   200 {"ok": false, "reason": "insufficient" | "inactive"} — нет денег / страж записи не оплачен;
#   409 {"ok": false, "reason": "stale" | "order"} — rec не текущей записи базы / номер не следующий.
# Списание — с баланса владельца базы (up записи 271), атомарно и одной транзакцией с платежом,
# под замком базы: два параллельных запроса одного номера второй раз не спишут.
function Gd_db_record($db){
    $row = mysqli_fetch_assoc(Exec_sql("SELECT id, up FROM my WHERE t=".DATABASE." AND val='$db' ORDER BY id DESC LIMIT 1", "Guard pack DB"));
    return $row ? array("id" => (int)$row["id"], "user" => (int)$row["up"]) : null;
}
function Gd_pack_notes($db, $month, $n, $rec){
    return "страж +".GD_OVER_UNIT." ($db) $month #".(int)$n." r".(int)$rec;
}
# Номера пакетов, купленных за месяц для записи базы: [n => true].
function Gd_pack_numbers($user, $db, $month, $rec){
    $out = array();
    $re = '/^страж \+'.GD_OVER_UNIT.' \('.preg_quote($db, '/').'\) '.preg_quote($month, '/').' #(\d+) r'.(int)$rec.'$/u';
    foreach(Gd_user_payments($user, GD_PACK_TYPE) as $p)
        if(preg_match($re, trim($p["notes"]), $m))
            $out[(int)$m[1]] = true;
    return $out;
}
function Gd_pack_reply($code, $body){
    return array("code" => $code, "body" => $body);
}
# $headers — с ключами в нижнем регистре. Возвращает array("code" => HTTP-код, "body" => ответ).
function Gd_pack_request($method, $headers, $body){
    $secret = aiConfigValue(array("BILLING_SERVICE_TOKEN"));
    if($secret === "")
        return Gd_pack_reply(404, array("ok" => false, "reason" => "off"));
    if($method !== "POST")
        return Gd_pack_reply(405, array("ok" => false, "reason" => "method"));
    $given = isset($headers["x-billing-token"]) ? (string)$headers["x-billing-token"] : "";
    if($given === "" || !hash_equals($secret, $given))
        return Gd_pack_reply(403, array("ok" => false, "reason" => "token"));
    $in = json_decode((string)$body, true);
    $db = is_array($in) && isset($in["db"]) && is_string($in["db"]) ? strtolower($in["db"]) : "";
    $month = is_array($in) && isset($in["month"]) && is_string($in["month"]) ? $in["month"] : "";
    $n = is_array($in) && isset($in["n"]) ? $in["n"] : null;
    $rec = is_array($in) && isset($in["rec"]) ? $in["rec"] : null;
    # Месяц — текущий; на стыке месяцев часы сервиса и CRM могут разойтись — соседний тоже.
    $months = array(date("Y-m", time() - 3 * 86400), date("Y-m"), date("Y-m", time() + 3 * 86400));
    if(!preg_match(USER_DB_MASK, $db) || !in_array($month, $months, true)
            || !is_int($n) || $n < 1 || $n > GD_PACK_MAX || !is_int($rec) || $rec < 1)
        return Gd_pack_reply(400, array("ok" => false, "reason" => "bad_request"));
    $lock = mysqli_fetch_assoc(Exec_sql("SELECT GET_LOCK('guard_".$db."', 20) ok", "Guard lock"));
    if(!$lock || (string)$lock["ok"] !== "1")
        return Gd_pack_reply(503, array("ok" => false, "reason" => "busy"));
    $r = Gd_db_record($db);
    if(!$r)
        return Gd_pack_reply(404, array("ok" => false, "reason" => "no_db"));
    if($r["id"] !== $rec){
        # У сервиса настройка прежней записи (база пересоздана, панель стража ещё не открывали) —
        # сбросить её сейчас: дальше вопросы новой базы идут без чужого стража и лимита.
        Gd_service_reset($db, $r["id"]);
        return Gd_pack_reply(409, array("ok" => false, "reason" => "stale"));
    }
    $user = $r["user"];
    $c = Gd_compute(Gd_user_payments($user), $db, $rec);
    if($c["until"] <= time())
        return Gd_pack_reply(200, array("ok" => false, "reason" => "inactive"));
    $have = Gd_pack_numbers($user, $db, $month, $rec);
    if(isset($have[$n]))
        return Gd_pack_reply(200, array("ok" => true, "packs" => max(array_keys($have)), "charged" => 0));
    if($n !== count($have) + 1)     # сервис сверит число пакетов и попросит следующий номер
        return Gd_pack_reply(409, array("ok" => false, "reason" => "order", "packs" => count($have)));
    $amount = (int)GD_OVER_PRICE;
    if(!mysqli_begin_transaction($GLOBALS["connection"]))
        return Gd_pack_reply(503, array("ok" => false, "reason" => "busy"));
    # LIMIT 1 не убирать: с ним журнал (#5104) не делает SELECT между UPDATE и affected_rows,
    # и affected_rows — число списаний именно этого UPDATE.
    Exec_sql("UPDATE my SET val=CAST(val AS DECIMAL(15,2))-$amount WHERE up=$user AND t=285 AND CAST(val AS DECIMAL(15,2))>=$amount LIMIT 1", "Guard pack debit");
    if(mysqli_affected_rows($GLOBALS["connection"]) !== 1){
        mysqli_rollback($GLOBALS["connection"]);
        return Gd_pack_reply(200, array("ok" => false, "reason" => "insufficient", "price" => $amount));
    }
    $id = Insert($user, 1, 957, (string)$amount, "Guard pack payment");
    Insert($id, 1, 1085, GD_PACK_TYPE, "Guard pack payment type");
    Insert($id, 1, 967, (string)time(), "Guard pack payment date");
    Insert($id, 1, 1075, Gd_pack_notes($db, $month, $n, $rec), "Guard pack payment notes");
    if(!mysqli_commit($GLOBALS["connection"])){
        mysqli_rollback($GLOBALS["connection"]);
        return Gd_pack_reply(503, array("ok" => false, "reason" => "busy"));
    }
    return Gd_pack_reply(200, array("ok" => true, "packs" => $n, "charged" => $amount));
}
