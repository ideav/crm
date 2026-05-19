<?php

/**
 * Test for issue #2732:
 * Inline editing the first column of a type whose uniqueness is defined only
 * by composite-key requisites must not run the duplicate-key check when no
 * key requisite was submitted.
 */

function issue2732UniqueKeyRequestHasSubmittedKeyReq($request, $keyReqs){
	foreach($keyReqs as $reqId => $req)
		if(array_key_exists("t$reqId", $request) || array_key_exists("NEW_$reqId", $request))
			return true;
	return false;
}

function issue2732ShouldCheckUnique($unique, $request, $keyReqs){
	if($unique)
		return true;
	return issue2732UniqueKeyRequestHasSubmittedKeyReq($request, $keyReqs);
}

function issue2732OldShouldCheckUnique($unique, $request, $keyReqs){
	return $unique || count($keyReqs) > 0;
}

function issue2732AssertSame($expected, $actual, $message){
	if($expected !== $actual){
		fwrite(STDERR, "FAIL: $message\nExpected: ".var_export($expected, true)."\nActual:   ".var_export($actual, true)."\n");
		exit(1);
	}
	echo "OK: $message\n";
}

$typeId = 50;
$keyReqs = array(
	100 => array("kind" => "value"),
	101 => array("kind" => "ref")
);

$firstColumnOnly = array("t$typeId" => "New display name");
issue2732AssertSame(true, issue2732OldShouldCheckUnique(false, $firstColumnOnly, $keyReqs),
	"old _m_save guard reproduced the bug: first-column-only edit still triggered composite duplicate check");
issue2732AssertSame(false, issue2732ShouldCheckUnique(false, $firstColumnOnly, $keyReqs),
	"first-column-only edit skips composite duplicate check when first column is not unique");

$keyValueSubmitted = array("t100" => "2026-05-19");
issue2732AssertSame(true, issue2732ShouldCheckUnique(false, $keyValueSubmitted, $keyReqs),
	"submitted value key requisite triggers composite duplicate check");

$emptyKeySubmitted = array("t100" => "");
issue2732AssertSame(true, issue2732ShouldCheckUnique(false, $emptyKeySubmitted, $keyReqs),
	"clearing a key requisite still triggers composite duplicate check");

$newReferenceSubmitted = array("NEW_101" => "New reference");
issue2732AssertSame(true, issue2732ShouldCheckUnique(false, $newReferenceSubmitted, $keyReqs),
	"submitted new reference value for a key requisite triggers composite duplicate check");

issue2732AssertSame(true, issue2732ShouldCheckUnique(true, $firstColumnOnly, $keyReqs),
	"types with unique first column still validate first-column edits");

issue2732AssertSame(false, issue2732ShouldCheckUnique(false, $firstColumnOnly, array()),
	"non-unique type without composite key does not run uniqueness check");

echo "\nAll tests passed for issue-2732.\n";
