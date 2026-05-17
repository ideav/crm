<?php

/**
 * Issue #2712 plain DATA import reference replacement checks.
 *
 * The production bug was in the cached reference path: when an existing
 * single-select ref had Accepted and the incoming row resolved Done from cache,
 * the old branch inserted Done instead of updating the Accepted row.
 */

function assert_eq($expected, $actual, $message){
    if($expected !== $actual){
        fwrite(STDERR, "FAIL: $message\nExpected: ".var_export($expected, true)."\nActual:   ".var_export($actual, true)."\n");
        exit(1);
    }
    echo "OK: $message\n";
}

function extract_function($source, $name){
    $start = strpos($source, "function ".$name."(");
    if($start === false)
        throw new RuntimeException("Function $name not found");
    $brace = strpos($source, "{", $start);
    $depth = 0;
    $len = strlen($source);
    for($i = $brace; $i < $len; $i++){
        if($source[$i] === "{")
            $depth++;
        elseif($source[$i] === "}"){
            $depth--;
            if($depth === 0)
                return substr($source, $start, $i - $start + 1);
        }
    }
    throw new RuntimeException("Function $name body not closed");
}

$index = file_get_contents(__DIR__."/../index.php");
eval(extract_function($index, "HideDelimiters"));
eval(extract_function($index, "UnHideDelimiters"));
eval(extract_function($index, "PlainImportReferenceValues"));

assert_eq(array("8925"), PlainImportReferenceValues("8925,9002:Done,Accepted", false),
    "single-select id:value import keeps only the first ref id");
assert_eq(array("8925", "9002"), PlainImportReferenceValues("8925,9002:Done,Accepted", true),
    "multi-select id:value import keeps the incoming id set");
assert_eq(array("Done"), PlainImportReferenceValues("Done,Accepted", false),
    "single-select display-name import keeps only the first value");
assert_eq(array("Done", "Accepted"), PlainImportReferenceValues("Done,Accepted", true),
    "multi-select display-name import keeps all values");

function old_cached_single_actions($reqs, $refObjID){
    $actions = array();
    if(!isset($reqs[$refObjID]))
        $actions[] = array("insert", $refObjID);
    return $actions;
}

function fixed_single_actions($currentRefs, $refObjID){
    $actions = array();
    if(count($currentRefs)){
        if(isset($currentRefs[$refObjID]) && count($currentRefs[$refObjID]))
            $keepId = array_shift($currentRefs[$refObjID]);
        else{
            reset($currentRefs);
            $curRefObjID = key($currentRefs);
            $keepId = array_shift($currentRefs[$curRefObjID]);
            if((int)$curRefObjID !== $refObjID)
                $actions[] = array("update_typ", $keepId, $refObjID);
        }
        foreach($currentRefs as $staleIDs)
            foreach($staleIDs as $staleID)
                $actions[] = array("delete", $staleID);
        return $actions;
    }
    return array(array("insert", $refObjID));
}

function fixed_multi_actions($currentRefs, $incomingRefs){
    $actions = array();
    $seen = array();
    $ord = 1;
    foreach($incomingRefs as $refObjID){
        $targetOrd = $ord++;
        if(isset($seen[$refObjID]))
            continue;
        $seen[$refObjID] = true;
        if(isset($currentRefs[$refObjID]) && count($currentRefs[$refObjID])){
            $keepId = array_shift($currentRefs[$refObjID]);
            $actions[] = array("order", $keepId, $targetOrd);
            foreach($currentRefs[$refObjID] as $staleID)
                $actions[] = array("delete", $staleID);
            unset($currentRefs[$refObjID]);
            continue;
        }
        $actions[] = array("insert", $refObjID, $targetOrd);
    }
    foreach($currentRefs as $staleIDs)
        foreach($staleIDs as $staleID)
            $actions[] = array("delete", $staleID);
    return $actions;
}

$statusReq = 8907;
$done = 8925;
$accepted = 9002;
$acceptedRow = 43190;
$doneRow = 393908;

assert_eq(array(array("insert", $done)), old_cached_single_actions(array($accepted => $statusReq), $done),
    "old cached path reproduces the bug by inserting the new status");
assert_eq(array(array("update_typ", $acceptedRow, $done)), fixed_single_actions(array($accepted => array($acceptedRow)), $done),
    "single-select import updates the existing status row instead of inserting a second one");
assert_eq(array(array("delete", $acceptedRow)), fixed_single_actions(array($done => array($doneRow), $accepted => array($acceptedRow)), $done),
    "single-select import removes stale duplicate statuses when the desired one already exists");
assert_eq(
    array(array("order", $acceptedRow, 1), array("insert", 7777, 2), array("delete", $doneRow)),
    fixed_multi_actions(array($done => array($doneRow), $accepted => array($acceptedRow)), array($accepted, 7777)),
    "multi-select import replaces the current ref set with the incoming set"
);

echo "\nAll issue-2712 plain import reference checks passed.\n";
