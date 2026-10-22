<?php
/**
 * Сведение структуры импортируемого архива со структурой базы.
 *
 * Архив (BKI или JSON) несёт собственные идентификаторы типов и реквизитов. При загрузке
 * в другую базу они почти всегда заняты чужими записями, поэтому каждому реквизиту архива
 * ищется аналог среди реквизитов местного типа — по ПОДПИСИ:
 *
 *   обычный реквизит   "<имя>:<БАЗОВЫЙ ТИП>"       Дата:DATE
 *   ссылка             "ref:<реквизит>:<строка>"    ref:1078:9001
 *   подтаблица         "arr:<тип>"                  arr:1090
 *
 * В местной структуре ($GLOBALS["local_struct"][<тип>]) за подписью идут атрибуты, тоже
 * через двоеточие: "Дата:DATE:\:KEY\:". Поэтому совпадением считается либо равенство,
 * либо продолжение подписи двоеточием — но не любой префикс: по префиксу "Дата:DATE"
 * попадает в местную "Дата:DATETIME", и дата со временем молча приезжает в колонку даты.
 */

# Имя типа или реквизита из файла в том виде, в каком оно лежит в базе.
# В файле разделители экранированы (MaskDelimiters), а разбор строки заменяет
# экранированные последовательности маркерами (HideDelimiters) — до сравнения с базой
# нужно снять и то, и другое, иначе SELECT по имени не находит существующий тип и
# импорт заводит дубль, а в его имя попадают служебные символы.
function ImportDbName($v)
{
    return UnMaskDelimiters($v);
}

# Тип строки данных BKI — для сверки со схемой файла (imported) в фазе данных. Формы:
#
#   «ТИП:ID:значение;к1;к2;…»   — тип в первом поле;
#   «REF:СТРОКА:ЦЕЛЬ:значение»  — ссылочная запись реквизита, тип во ВТОРОМ поле
#                                 (сдвигается, как и делал разбор данных; исходное
#                                 первое поле уходит в $isref).
#
# Возвращает 0, если тип не опознаётся. В обрезанном или подменённом файле вместо
# строки данных может стоять что угодно: в кейсе #963 в хвосте выгрузки после строк
# данных ехала целая HTML-страница.
function Import_data_line_type(&$typ, &$isref)
{
    $isref = 0;
    if(count($typ) == 4)
    {
        $isref = (int)$typ[0];
        array_shift($typ);
    }
    return (int)(isset($typ[0]) ? $typ[0] : 0);
}

# Подпись реквизита архива с учётом уже подобранных замен идентификаторов.
function ImportReqSignature($typ, $subst = array())
{
    $kind = isset($typ[0]) ? $typ[0] : "";
    $first = isset($typ[1]) ? $typ[1] : "";
    $signature = $kind.":".ImportSubst($first, $subst);
    if($kind === "ref")
        $signature .= ":".ImportSubst(isset($typ[2]) ? $typ[2] : "", $subst);
    return $signature;
}

# Замена идентификатора архива на местный, если она уже найдена ($local_struct["subst"]).
function ImportSubst($i, $subst)
{
    return isset($subst[$i]) ? $subst[$i] : $i;
}

# Найти местный реквизит с такой же подписью. Возвращает его id или 0.
function ImportMatchLocalReq($signature, $entries)
{
    if(!is_array($entries) || ($signature === ""))
        return 0;
    foreach($entries as $local_type => $local_value)
    {
        if((string)$local_type === "0")	# Заголовок типа, а не реквизит
            continue;
        if($local_value === $signature)
            return $local_type;
        if(substr($local_value, 0, strlen($signature) + 1) === $signature.":")	# дальше только атрибуты
            return $local_type;
    }
    return 0;
}

# --------------------------------------------------------------------------------------------
# Термины и литералы (issue #5095: перенос запросов между инстансами)
#
# В BKI у записи «Колонки запроса» (base REPORT_COLUMN) значение - id термина (реквизита
# доменного типа) ИСХОДНОЙ базы, а у «Значение (от/до)» и WHERE - id записей-значений
# справочников. Выгрузка объявляет термины subst-строками заголовка:
#
#   subst:ТЕРМИН:ВЛАДЕЛЕЦ:Имя:БАЗА[:атрибуты]     обычный реквизит
#   subst:ТЕРМИН:ВЛАДЕЛЕЦ:ref:реквизит:строка     ссылка
#   subst:ТЕРМИН:ВЛАДЕЛЕЦ:arr:тип                 подтаблица
#
# Без свода значение колонки уезжает в целевую базу как есть: реквизит, существующий
# в ней под другим id, теряется - отчёт падает или молча считает не то.
# --------------------------------------------------------------------------------------------

# Связать термины файла с местными реквизитами: subst[<термин файла>] = местный id.
# Подпись термина дословно совпадает с одним из полей строки схемы его владельца, а свод
# структуры уже разметил владельца: local_types[<владелец файла>][<позиция>] = местный
# реквизит. Замена ОДНОКРАТНАЯ, без рекурсии: в subst кладётся готовый местный id - один
# и тот же id в другой базе может оказаться чужим реквизитом (16408: «Продукт» у Проекта
# в файле и «Занятость» у Распределения в цели). Ненайденный термин - предупреждение:
# молча висящая ссылка и была сутью #5095.
function Import_map_terms(&$terms, &$imported, &$local_types, &$local_struct, &$warning)
{
    foreach($terms as $typ)
    {
        $srcTerm = (int)$typ[1];
        $srcOwner = (int)$typ[2];
        # Подпись в терминах ФАЙЛА: поля после «subst:ТЕРМИН:ВЛАДЕЛЕЦ», экранирование снято -
        # ровно в таком виде поля строки схемы легли в $imported
        $signature = UnHideDelimiters(implode(":", array_slice($typ, 3)));
        $local = 0;
        if(isset($local_types[$srcOwner]))
            foreach($local_types[$srcOwner] as $order => $req_id)
                if(isset($imported[$srcOwner][$order]) && ($imported[$srcOwner][$order] === $signature))
                {
                    $local = $req_id;
                    break;
                }
        if($local)
            $local_struct["subst"][$srcTerm] = $local;
        else
            $warning .= t9n("[RU]Термин $signature (id $srcTerm владельца $srcOwner) не найден в структуре[EN]Term $signature (id $srcTerm of owner $srcOwner) not found in the structure")."<br>";
    }
}

# Поля-литералы: реквизиты, в значениях которых встречаются id записей справочников -
# «Значение (от)/(до)» у колонок отчёта, WHERE/HAVING у запросов. Возвращает карту
# [<тип файла>][<позиция реквизита>] = 1 в терминах id ФАЙЛА: разбор данных ключует
# реквизиты по исходному типу строки.
function Import_lit_fields(&$imported)
{
    $lit = Array();
    foreach($imported as $par => $reqs)
        foreach($reqs as $order => $req)
        {
            if($order == 0)
                continue;
            $typ = UnHideDelimiters(explode(":", HideDelimiters($req)));
            if(in_array($typ[0], array("Значение (от)", "Значение (до)", "WHERE", "HAVING")))
                $lit[$par][$order] = 1;
        }
    return $lit;
}

# Подмена id записей-значений в литералах вида IN(6406,6804). Значение, выгруженное
# в этом же файле, уже подменено фазой данных (obj_subst: совпадение по имени или перенос
# под новым id), поэтому подмена здесь - по готовой карте; id, которого нет ни в карте,
# ни в базе, остаётся как есть с предупреждением (имя такого значения файлу неизвестно).
# Имена и шаблоны (IN('Работает'), %, >5) не трогаются: цифры ищутся только внутри
# числовых списков IN(). $exists - замыкание «есть ли id в целевой базе»: модуль не знает
# базы, а вызывающий фазу данных - знает.
function Import_subst_literals($str, $subst, $exists, $count, &$warning)
{
    if(!preg_match("/IN\s*\(\s*[0-9,\s]+\s*\)/i", $str))
        return $str;
    return preg_replace_callback("/(IN\s*\(\s*)([0-9,\s]+?)(\s*\))/i"
        , function($m) use ($subst, $exists, $count, &$warning){
            $out = "";
            foreach(preg_split("/\s*,\s*/", trim($m[2])) as $id)
            {
                if($id === "")
                    continue;
                $id = (int)$id;
                $local = isset($subst[$id]) ? $subst[$id] : $id;
                if(($local == $id) && !$exists($id))
                    $warning .= t9n("[RU]Строка $count: значение $id (литерал фильтра) не найдено в базе[EN]Line $count: value $id (filter literal) not found in the DB")."<br>";
                $out .= ($out === "" ? "" : ",").$local;
            }
            return $m[1].$out.$m[3];
        }, $str);
}

# --------------------------------------------------------------------------------------------
# Ссылки существующей записи (issue #5226)
#
# Фаза данных BKI сверяет ссылки записи по реквизиту с набором из файла:
#   - ссылка, которая уже есть, не вставляется повторно; повтор внутри поля - одна ссылка;
#   - переданный набор заменяет прежний: лишние строки-ссылки удаляются, общие остаются
#     той же строкой;
#   - пустое поле не доходит до разбора ссылок - набор записи не меняется;
#   - пробел " " - пустой набор: все ссылки записи по реквизиту удаляются.
# --------------------------------------------------------------------------------------------

# План сверки. $have - ссылки записи в базе: id строки-ссылки => id цели. $incoming - id
# целей из файла (уже после подстановок obj_subst). Возвращает строки к удалению и цели к
# вставке в порядке файла. Из повторов одной цели в базе остаётся первая строка.
function Import_ref_set_plan($have, $incoming)
{
    $want = array();
    foreach($incoming as $target)
        if((int)$target > 0)
            $want[(int)$target] = TRUE;
    $delete = $kept = array();
    foreach($have as $rowId => $target)
        if(isset($want[(int)$target]) && !isset($kept[(int)$target]))
            $kept[(int)$target] = TRUE;
        else
            $delete[] = $rowId;
    $insert = array();
    foreach(array_keys($want) as $target)
        if(!isset($kept[$target]))
            $insert[] = $target;
    return array("delete" => $delete, "insert" => $insert);
}

# Применить набор целей $incoming к ссылкам реквизита $key записи $up типа $t. Ссылки
# записи, которой до этой строки файла в базе не было ($existing = FALSE), не читаются.
function Import_ref_set($up, $t, $key, $incoming, $existing, $message)
{
    global $z;
    $have = array();
    if($existing)
    {
        # Ссылки записи могут ждать в батче (та же запись раньше в файле) - сначала в базу
        Insert_batch("", "", "", "", "$message: flush before refs check");
        # Строка-ссылка: t = id цели, val = id колонки. У обычного реквизита t - колонка
        # типа записи (up = $t), поэтому значение, совпавшее с id колонки, сюда не попадает
        $data = Exec_sql("SELECT r.id, r.t FROM $z r JOIN $z o ON o.id=r.t AND o.up NOT IN (0, $t)"
                        ." WHERE r.up=$up AND r.val='$key' ORDER BY r.id", "$message: load refs");
        while($row = mysqli_fetch_array($data))
            $have[$row["id"]] = $row["t"];
    }
    $plan = Import_ref_set_plan($have, $incoming);
    foreach($plan["delete"] as $rowId)
        Delete($rowId);
    $ord = 1;
    foreach($plan["insert"] as $target)
        Insert_batch($up, $ord++, $target, $key, $message);
}
