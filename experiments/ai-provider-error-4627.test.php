<?php
# Мерка к issue #4627: по тексту ошибки видно, КТО отказал.
#
# Запуск:
#   docker run --rm -v "$PWD":/app -w /app php:8.2-cli php experiments/ai-provider-error-4627.test.php
#
# В открытой базе (issue #4620) чат отвечал «ИИ-сервис вернул ошибку HTTP 403: Доступ только
# владельцу базы». Отказ выносил ВНЕШНИЙ сервис агента, а искать причину начинали в ядре: текст
# один в один похож на проверку CRM. Теперь сообщение называет хост сервиса и на 403 говорит,
# что доступ CRM уже разрешила.
#
# Сети и БД тут нет: проверяется чистая сборка сообщения — блок # <ai-provider-error-4627>
# из ядра плюс его единственная зависимость extractAiProviderError().

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

function core_block($file){
    $src = file_get_contents($file);
    if(!preg_match('~# <ai-provider-error-4627>(.*)# </ai-provider-error-4627>~s', $src, $m))
        die("В $file не найден блок # <ai-provider-error-4627> … # </ai-provider-error-4627>\n");
    return str_replace("\r\n", "\n", $m[1]);
}

# Границу функции-зависимости ищем токенайзером: в теле есть строки с фигурными скобками.
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
    die("В ядре не найдена функция $name — мерка потеряла предмет\n");
}

# Ядро зовёт t9n() для сообщений; здесь достаточно русской половины.
function t9n($msg){
    if(preg_match('~\[RU\](.*?)\[EN\]~s', $msg, $m))
        return $m[1];
    return $msg;
}

$core = __DIR__."/../index.php";
$src  = file_get_contents($core);
eval(core_function($src, "extractAiProviderError").core_block($core));

$agent = "https://agent.example.com/integram/agent";

echo "1. 403 из сервиса: видно хост, текст сервиса и чья это проверка\n";
$msg = aiProviderErrorMessage(403, '{"error":"Доступ только владельцу базы"}', $agent);
ok(strpos($msg, "agent.example.com") !== FALSE, "назван хост ИИ-сервиса", $msg);
ok(strpos($msg, "HTTP 403") !== FALSE, "код ответа на месте");
ok(strpos($msg, "Доступ только владельцу базы") !== FALSE, "текст сервиса сохранён как есть");
ok(strpos($msg, "доступ к базе CRM уже проверила и разрешила") !== FALSE,
   "сказано, что отказ не от CRM", $msg);
ok(strpos($msg, "на его стороне") !== FALSE, "сказано, где править правило");

echo "\n2. Другие коды: подсказку про доступ не подмешиваем\n";
foreach(array(400, 402, 429, 500, 502, 503) as $code){
    $m = aiProviderErrorMessage($code, '{"error":"boom"}', $agent);
    ok(strpos($m, "CRM уже проверила") === FALSE, "HTTP $code — без подсказки про доступ");
    ok(strpos($m, "HTTP $code") !== FALSE, "HTTP $code — код в сообщении");
}

echo "\n3. Текст ошибки достаётся из всех форм тела\n";
ok(strpos(aiProviderErrorMessage(500, '{"error":{"message":"внутренняя"}}', $agent), "внутренняя") !== FALSE,
   "{error:{message}}");
ok(strpos(aiProviderErrorMessage(500, '{"message":"коротко"}', $agent), "коротко") !== FALSE,
   "{message}");
ok(strpos(aiProviderErrorMessage(500, "просто текст", $agent), "просто текст") !== FALSE,
   "plain-text тело");
ok(strpos(aiProviderErrorMessage(500, "<b>тег</b>", $agent), "тег") !== FALSE, "теги вычищаются");

echo "\n4. Крайние случаи\n";
$noHost = aiProviderErrorMessage(403, '{"error":"нет"}', "");
ok(strpos($noHost, "(") === FALSE, "endpoint не задан — скобок с хостом нет", $noHost);
ok(strpos($noHost, "HTTP 403") !== FALSE, "и код всё равно на месте");
$empty = aiProviderErrorMessage(403, "", $agent);
ok(strpos($empty, "HTTP 403") !== FALSE, "пустое тело — сообщение всё равно осмысленно", $empty);
ok(strpos(aiProviderErrorMessage("403", '{"error":"x"}', $agent), "CRM уже проверила") !== FALSE,
   "код строкой распознаётся как 403");
$long = aiProviderErrorMessage(500, json_encode(array("error" => str_repeat("я", 900))), $agent);
ok(mb_strpos($long, str_repeat("я", 500)) !== FALSE && mb_strpos($long, str_repeat("я", 501)) === FALSE,
   "текст сервиса обрезан до 500 символов");

echo "\n5. Ядро зовёт именно эту сборку и посылает агенту open_db\n";
ok(strpos($src, "throw new Exception(aiProviderErrorMessage(\$httpCode, \$raw, \$endpoint), 502);") !== FALSE,
   "aiChatPostJson отдаёт сообщение через aiProviderErrorMessage");
ok(preg_match('~"open_db"\s*=>\s*aiAgentIsOpenDb\(\$db\)~', $src) === 1,
   "в запрос агенту кладётся open_db (issue #4620 → #4627)");
ok(strpos(file_get_contents(__DIR__."/../docs/ai-agent-endpoint.md"), '"open_db"') !== FALSE,
   "поле описано в контракте docs/ai-agent-endpoint.md");

echo "\n";
if($failed){
    echo "FAILED: $failed\n";
    exit(1);
}
echo "ALL TESTS PASSED\n";
