<?php
# Мерка к issue #5170: конструктор запросов (/sql/) пустеет, хотя отчёт по запросу
# возвращает данные. Причина: у типа «Запрос» потерян реквизит-массив «Колонки запроса»
# (строка up=22, t=28) — parent_obj для типа 28 не определяется, и явный фильтр F_U
# молча игнорировался: листинг детей подменялся дефолтом «дети корня» (vals.up=1) и
# возвращал ноль строк. Отчёт же читает колонки напрямую (cols.up=rep.id), поэтому
# данные в панели отладки были.
#
# Правило: явно заданный F_U > 1 фильтрует по vals.up независимо от parent_obj.
# F_U без значения («»/0) и отсутствие F_U ведут себя как прежде.
#
# Движок берётся из ядра как есть (токенайзером, как в dir-admin-template-4624):
# копия сторожила бы копию. Обращений к БД нет.
#
# Запуск: php experiments/fu-filter-without-parent-obj-5170.test.php

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

# ── Движок берём ИЗ ЯДРА ───────────────────────────────────────────────────────────────────
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
        for(; $i < $n; $i++){
            $code .= is_array($tokens[$i]) ? $tokens[$i][1] : $tokens[$i];
            if($tokens[$i] === "{") $depth++;
            if($tokens[$i] === "}"){
                $depth--;
                if($depth === 0) break;
            }
        }
        return $code;
    }
    return "";
}

# Оба ядра: index.php (ideav.ru) и снапшот живого ядра integram.io (issue #5184 —
# тот же потерянный реквизит в r7ohr, а фикс #5170 был только в index.php).
$cores = array("index.php", "experiments/index_integram.io.php");

# ── Таблица «входы × ожидания» ─────────────────────────────────────────────────────────────
# [имя, $_REQUEST, parent_obj, ожидаемый $filter_cond, ожидаемый $parent_cond]
$cases = array(
    # r7ohr сегодня: реквизит-массив потерян (parent_obj NULL), F_U=169 задан конструктором
    array("F_U>1 без parent_obj — фильтр по родителю (сам фикс)",
          array("F_U" => "169"), NULL, " AND vals.up=169 ", ""),
    # штатный путь конструктора: связь на месте
    array("F_U>1 с parent_obj — как было",
          array("F_U" => "169"), "22", " AND vals.up=169 ", ""),
    # пустой F_U при живой связи — «показать всех детей»
    array("F_U пустой с parent_obj — vals.up!=0",
          array("F_U" => ""), "22", " AND vals.up!=0 ", ""),
    # F_U=1 без parent_obj — фильтра нет, дефолт «дети корня» не теряется
    array("F_U=1 без parent_obj — дефолт 'дети корня'",
          array("F_U" => "1"), NULL, "", " AND vals.up=1 "),
    # точный фильтр F_I прежнему снимает родительское условие
    array("без F_U, F_I>0 — родительское условие снято",
          array("F_I" => "5"), NULL, "", " "),
    # ни F_U, ни F_I — дети корня
    array("без F_U и F_I — дефолт 'дети корня'",
          array(), NULL, "", " AND vals.up=1 "),
    # пустой F_U без parent_obj — прежний путь (дефолт), F_U не выдумывается
    array("F_U пустой без parent_obj — дефолт 'дети корня'",
          array("F_U" => ""), NULL, "", " AND vals.up=1 "),
);

foreach($cores as $k => $core){
    echo "$core\n";
    $fn = core_function(file_get_contents(__DIR__ . "/../$core"), "Prepare_parent_filter");
    if($fn === ""){
        ok(false, "Prepare_parent_filter найдена в $core");
        continue;
    }
    # Одноимённые функции двух ядер не уживутся в одном процессе — даём каждой своё имя
    eval(str_replace("function Prepare_parent_filter", "function Prepare_parent_filter_$k", $fn));
    foreach($cases as $c){
        list($name, $req, $parent_obj, $want_filter, $want_parent) = $c;
        $_REQUEST = $req;
        $filter_cond = "";
        $parent_cond = ""; # вызывающий (case "&uni_obj_all") инициализирует его пустым
        call_user_func_array("Prepare_parent_filter_$k", array(&$filter_cond, &$parent_cond, $parent_obj));
        ok($filter_cond === $want_filter, "$name: filter_cond",
           var_export($filter_cond, true) . " != " . var_export($want_filter, true));
        ok($parent_cond === $want_parent, "$name: parent_cond",
           var_export($parent_cond, true) . " != " . var_export($want_parent, true));
    }
}

echo $failed === 0 ? "\nALL TESTS PASSED\n" : "\nFAILED: $failed\n";
exit($failed === 0 ? 0 : 1);
