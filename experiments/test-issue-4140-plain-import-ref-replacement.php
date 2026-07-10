<?php

/**
 * Regression checks for issue #4140.
 *
 * Plain DATA import used to append a cached reference to a single-select
 * field instead of replacing its existing row. The same path also left
 * stale values behind for multi-select fields. Keep the legacy service and
 * the current service on the same tested replacement rules.
 */

function issue4140Fail($message){
    fwrite(STDERR, "FAIL: $message\n");
    exit(1);
}

function issue4140AssertSame($expected, $actual, $message){
    if($expected !== $actual){
        fwrite(STDERR, "FAIL: $message\nExpected: ".var_export($expected, true)."\nActual:   ".var_export($actual, true)."\n");
        exit(1);
    }
    echo "PASS: $message\n";
}

function issue4140ExtractFunction($source, $name){
    $start = strpos($source, "function ".$name."(");
    if($start === false)
        issue4140Fail("$name is missing");
    $brace = strpos($source, "{", $start);
    $depth = 0;
    $length = strlen($source);
    for($i = $brace; $i < $length; $i++){
        if($source[$i] === "{")
            $depth++;
        elseif($source[$i] === "}"){
            $depth--;
            if($depth === 0)
                return substr($source, $start, $i - $start + 1);
        }
    }
    issue4140Fail("$name has an unterminated body");
}

$root = dirname(__DIR__);
$sources = array(
    "current" => file_get_contents($root."/index.php"),
    "legacy" => file_get_contents(__DIR__."/index_old.php"),
);

foreach($sources as $label => $source)
    if($source === false)
        issue4140Fail("cannot read $label importer");

$functionNames = array("HideDelimiters", "UnHideDelimiters", "PlainImportReferenceValues", "PlainImportReferencePlan");
foreach($functionNames as $name){
    $currentFunction = str_replace("\r\n", "\n", issue4140ExtractFunction($sources["current"], $name));
    $legacyFunction = str_replace("\r\n", "\n", issue4140ExtractFunction($sources["legacy"], $name));
    issue4140AssertSame($currentFunction, $legacyFunction, "$name stays identical in current and legacy importers");
    eval($currentFunction);
}

foreach($sources as $label => $source){
    if(substr_count($source, "PlainImportReferenceValues(") < 2)
        issue4140Fail("$label importer does not use PlainImportReferenceValues");
    if(substr_count($source, "PlainImportReferencePlan(") < 2)
        issue4140Fail("$label importer does not use PlainImportReferencePlan");
    if(strpos($source, '"Before plain import lookup"') === false)
        issue4140Fail("$label importer does not flush pending inserts before its next lookup");
    echo "PASS: $label importer calls the tested helpers and flushes before lookups\n";
}

issue4140AssertSame(
    array("8925"),
    PlainImportReferenceValues("8925,9002:Completed,Accepted", false),
    "single-select ids:names input keeps only its first ID"
);
issue4140AssertSame(
    array("8925", "9002"),
    PlainImportReferenceValues("8925,9002:Completed,Accepted", true),
    "multi-select ids:names input keeps the complete ID set"
);
issue4140AssertSame(
    array("oldja"),
    PlainImportReferenceValues("oldja,Jamzes", false),
    "single-select display-name input keeps only its first value"
);
issue4140AssertSame(
    array("oldja", "Jamzes"),
    PlainImportReferenceValues("oldja,Jamzes", true),
    "multi-select display-name input keeps all values"
);

$emptyPlan = array("update" => array(), "order" => array(), "delete" => array(), "insert" => array());

issue4140AssertSame(
    array(
        "update" => array(array("id" => 43190, "t" => 8925)),
        "order" => array(array("id" => 43190, "ord" => 1)),
        "delete" => array(),
        "insert" => array(),
    ),
    PlainImportReferencePlan(array(9002 => array(43190)), array(8925), false),
    "cached single-select value updates the existing row instead of appending"
);

issue4140AssertSame(
    array(
        "update" => array(),
        "order" => array(array("id" => 393908, "ord" => 1)),
        "delete" => array(393910, 43190),
        "insert" => array(),
    ),
    PlainImportReferencePlan(array(8925 => array(393908, 393910), 9002 => array(43190)), array(8925), false),
    "single-select replacement removes duplicate and stale rows"
);

issue4140AssertSame(
    array(
        "update" => array(),
        "order" => array(),
        "delete" => array(),
        "insert" => array(array("t" => 8925, "ord" => 1)),
    ),
    PlainImportReferencePlan(array(), array(8925), false),
    "single-select replacement inserts when the field is empty"
);

issue4140AssertSame(
    array(
        "update" => array(),
        "order" => array(array("id" => 43190, "ord" => 1)),
        "delete" => array(393908),
        "insert" => array(array("t" => 7777, "ord" => 2)),
    ),
    PlainImportReferencePlan(array(8925 => array(393908), 9002 => array(43190)), array(9002, 7777, 9002), true),
    "multi-select replacement keeps, inserts, orders, and removes as one set"
);

issue4140AssertSame(
    $emptyPlan,
    PlainImportReferencePlan(array(), array(), false),
    "an empty resolved single-select input creates no action"
);

echo "\nAll issue #4140 plain import reference replacement checks passed.\n";
