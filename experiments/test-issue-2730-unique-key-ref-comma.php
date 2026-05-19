<?php

/**
 * Test for issue #2730:
 * BKI plain-data import must detect existing rows by a composite key even when
 * a non-multi reference key value contains a comma.
 *
 * The failing path is UniqueKeyNormalizeRefs(): it used to split every string
 * reference value by comma. For a non-multi reference named
 * "[Маржинальная*]Маржинальная прибыль, ДДЛ" that produced two missing refs,
 * FindUniqueRecordDuplicate short-circuited, and import inserted duplicates.
 */

class Issue2730UniqueKeyRefHarness {
    public static $refsByTypeAndValue = array(
        1041 => array(
            "[Маржинальная*]Маржинальная прибыль, ДДЛ" => 445001,
            "[Маржинальная*]Маржинальная прибыль, ДДО" => 445002,
        ),
        1103 => array(
            "ФАКТ" => 59,
            "ПЛАН" => 60,
        ),
    );

    public static function resolveRefByValue($refType, $value){
        return isset(self::$refsByTypeAndValue[$refType][$value])
            ? self::$refsByTypeAndValue[$refType][$value]
            : false;
    }

    public static function hideDelimiters($v){
        return str_replace("\,", "%2C", str_replace("\;", "%3B", str_replace("\:", "%3A", str_replace("\\\\", "%5C", $v))));
    }

    public static function unHideDelimiters($v){
        return str_replace("%2C", "\,", str_replace("%3B", "\;", str_replace("%3A", "\:", str_replace("%5C", "\\\\", $v))));
    }

    public static function unMaskDelimiters($v){
        return str_replace("\;", ";", str_replace("\:", ":", str_replace("\\\\", "\\", self::unHideDelimiters($v))));
    }

    public static function unmaskRefValue($value){
        return str_replace("\,", ",", self::unMaskDelimiters((string)$value));
    }

    public static function splitRefValues($req, $value, $allowNonMultiIdList=false){
        if(is_array($value))
            return $value;
        $value = (string)$value;
        if($req["multi"])
            return self::unHideDelimiters(explode(",", self::hideDelimiters($value)));
        $value = self::unmaskRefValue($value);
        if($allowNonMultiIdList && strpos($value, ",") !== false){
            $parts = explode(",", $value);
            $allNumeric = count($parts) > 1;
            foreach($parts as $part)
                if(!is_numeric(trim($part))){
                    $allNumeric = false;
                    break;
                }
            if($allNumeric)
                return $parts;
        }
        return array($value);
    }

    public static function normalizeRefs($req, $value, $allowNonMultiIdList=false){
        $refs = self::splitRefValues($req, $value, $allowNonMultiIdList);
        $ids = array();
        $seen = array();
        $hasMissingRef = false;
        foreach($refs as $ref){
            $ref = trim(self::unmaskRefValue($ref));
            if($ref === "")
                continue;
            if(is_numeric($ref)){
                $ref = (int)$ref;
                if($ref > 0 && !isset($seen[$ref])){
                    $ids[] = $ref;
                    $seen[$ref] = true;
                }
                continue;
            }
            if((int)$req["ref_id"] === 1){
                $hasMissingRef = true;
                continue;
            }
            $resolved = self::resolveRefByValue((int)$req["ref_id"], $ref);
            if($resolved !== false){
                $ref = (int)$resolved;
                if(!isset($seen[$ref])){
                    $ids[] = $ref;
                    $seen[$ref] = true;
                }
            }
            else
                $hasMissingRef = true;
        }
        if(!$req["multi"] && count($ids) > 1)
            $ids = array($ids[0]);
        elseif($req["multi"])
            sort($ids);
        return array(
            "kind" => "ref",
            "ref_id" => (int)$req["ref_id"],
            "values" => $ids,
            "multi" => $req["multi"],
            "has_missing_ref" => $hasMissingRef
        );
    }
}

function assertSameIssue2730($expected, $actual, $message){
    if($expected !== $actual){
        fwrite(STDERR, "FAIL: $message\nExpected: " . var_export($expected, true) . "\nActual:   " . var_export($actual, true) . "\n");
        exit(1);
    }
    echo "OK: $message\n";
}

$budgetRowReq = array("ref_id" => 1041, "multi" => false);
$groupColumnReq = array("ref_id" => 1103, "multi" => false);
$multiGroupReq = array("ref_id" => 1103, "multi" => true);

$normalized = Issue2730UniqueKeyRefHarness::normalizeRefs(
    $budgetRowReq,
    "[Маржинальная*]Маржинальная прибыль, ДДЛ"
);
assertSameIssue2730(array(445001), $normalized["values"],
    "non-multi reference key value containing comma resolves as one ref");
assertSameIssue2730(false, $normalized["has_missing_ref"],
    "non-multi reference key value containing comma must not mark refs missing");

$normalized = Issue2730UniqueKeyRefHarness::normalizeRefs($groupColumnReq, "ФАКТ");
assertSameIssue2730(array(59), $normalized["values"],
    "plain non-multi reference value still resolves");

$normalized = Issue2730UniqueKeyRefHarness::normalizeRefs($multiGroupReq, "ФАКТ,ПЛАН");
assertSameIssue2730(array(59, 60), $normalized["values"],
    "multi reference values still split on comma");

$normalized = Issue2730UniqueKeyRefHarness::normalizeRefs(
    $budgetRowReq,
    "[Маржинальная*]Маржинальная прибыль\\, ДДЛ"
);
assertSameIssue2730(array(445001), $normalized["values"],
    "escaped comma in non-multi reference value is accepted for old BKI files");

$normalized = Issue2730UniqueKeyRefHarness::normalizeRefs($groupColumnReq, "59,60", true);
assertSameIssue2730(array(59), $normalized["values"],
    "request-mode non-multi numeric ID lists still keep the first id");

echo "\nAll tests passed for issue-2730.\n";
