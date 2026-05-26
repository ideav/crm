<?php
# Regression guard for issue #2823.
# A generated password copied from the user creation form remains in t20 and is
# saved by _m_new together with the new user's main value (t18). The backend must
# hash that first password with the submitted object value available in $val, not
# with a missing/saved record field.

function assertTest($condition, $message){
    if(!$condition){
        fwrite(STDERR, "FAIL: ".$message."\n");
        exit(1);
    }
    fwrite(STDOUT, "OK:   ".$message."\n");
}

$indexSource = file_get_contents(__DIR__."/../index.php");
if($indexSource === false){
    fwrite(STDERR, "Cannot read index.php\n");
    exit(1);
}

$start = strpos($indexSource, 'case "_m_new":');
$end = strpos($indexSource, '# Type editor commands', $start);
assertTest($start !== false && $end !== false, "_m_new case is present in index.php");

$newCase = substr($indexSource, $start, $end - $start);
assertTest(
    strpos($newCase, '$i = Insert($up, $ord, $id, $val, "Add Object");') !== false,
    "_m_new inserts the object before inserting submitted requisites"
);
assertTest(
    strpos($newCase, 'if($key != "t$id")') !== false,
    "_m_new skips the main object value while processing requisites"
);
assertTest(
    preg_match('/elseif\(\$t == PASSWORD\)\s*Insert\(\$i,\s*1,\s*\$t,\s*hash\("sha512",\s*Salt\(\$val,\s*\$v\)\),\s*"Insert a first time password"\);/s', $newCase) === 1,
    "_m_new hashes the first submitted password with the new user's main value"
);

fwrite(STDOUT, "\nissue #2823 password create-save backend checks passed\n");
