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
