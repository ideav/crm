<?php
// Standalone simulation of the Execute UPDATEs batching logic from index.php.
// Verifies:
//  - new records without "ID needed" are sent through Insert_batch
//  - new records with "ID needed" trigger a batch flush then Insert (so mysqli_insert_id is correct)
//  - UPDATE / DELETE flush any pending batch first
//  - Calc_Order is consulted once per (up,t); subsequent rows in the batch use the cached next ord

$logged = array();
function out($s){ global $logged; $logged[] = $s; echo $s, "\n"; }

// Stubs that record the SQL the real functions would issue.
$nextId = 1000;
function Insert($up, $ord, $t, $val, $msg){
    global $nextId;
    out("Insert: ($up,$ord,$t,'$val') -- $msg");
    return $nextId++;
}
function Insert_batch($up, $ord, $t, $val, $msg){
    if($up === "" && isset($GLOBALS["SQLbatch"])){
        out("Flush: ".$GLOBALS["SQLbatch"]." -- $msg");
        unset($GLOBALS["SQLbatch"]);
        return;
    }
    $tuple = "($up,$ord,$t,'$val')";
    if(isset($GLOBALS["SQLbatch"]))
        $GLOBALS["SQLbatch"] .= ",$tuple";
    else
        $GLOBALS["SQLbatch"] = $tuple;
    if(strlen($GLOBALS["SQLbatch"]) > 31000){
        out("Auto-flush (length): ".$GLOBALS["SQLbatch"]." -- $msg");
        unset($GLOBALS["SQLbatch"]);
    }
}
function Exec_sql($sql, $msg){ out("SQL: $sql -- $msg"); }
function Delete($id){ out("Delete: id=$id"); }
function Update_Val($id, $v){ out("Update_Val: id=$id v=$v"); }
function Calc_Order($up, $t){
    static $seq = array();
    // Returns the next ord for (up,t) from the simulated DB. Without batching,
    // repeated calls inside one transaction would all see the same MAX.
    $k = "$up:$t";
    if(!isset($seq[$k])) $seq[$k] = 1;
    return $seq[$k]; // intentionally not incremented — caller would have to insert to bump it
}

// --- Re-implementation of the relevant block, in isolation ---
function exec_updates_block(array $updates){
    unset($GLOBALS["SQLbatch"]);
    $new_id_needed = array();
    foreach($updates as $u){
        if(!empty($u["needs_id"]))
            $new_id_needed[$u["new_id_key"]] = "<placeholder>";
    }

    $ordCache = array();
    foreach($updates as $u){
        if(isset($u["ord"])){
            $up = $u["up"]; $t = $u["t"]; $val = $u["val"];
            if($u["ord"] == 0){
                $ordKey = "$up:$t";
                if(!isset($ordCache[$ordKey]))
                    $ordCache[$ordKey] = Calc_Order($up, $t);
                $ordToUse = $ordCache[$ordKey]++;
            } else $ordToUse = $u["ord"];

            if(isset($new_id_needed[$u["new_id_key"] ?? ""])){
                if(isset($GLOBALS["SQLbatch"]))
                    Insert_batch("", "", "", "", "Flush before INSERT with ID");
                $new_id_needed[$u["new_id_key"]] = Insert($up, $ordToUse, $t, $val, "new rec, get ID");
            } else
                Insert_batch($up, $ordToUse, $t, $val, "new rec");
        } elseif($u["op"] === "ord_update"){
            if(isset($GLOBALS["SQLbatch"]))
                Insert_batch("", "", "", "", "Flush before UPDATE Ord");
            Exec_sql("UPDATE z SET ord={$u["val"]} WHERE id={$u["id"]}", "UPDATE Ord");
        } elseif($u["op"] === "delete"){
            if(isset($GLOBALS["SQLbatch"]))
                Insert_batch("", "", "", "", "Flush before DELETE");
            Delete($u["id"]);
        } elseif($u["op"] === "val_update"){
            if(isset($GLOBALS["SQLbatch"]))
                Insert_batch("", "", "", "", "Flush before Update_Val");
            Update_Val($u["id"], $u["val"]);
        }
    }
    if(isset($GLOBALS["SQLbatch"]))
        Insert_batch("", "", "", "", "Final flush Execute UPDATEs");
}

echo "=== Case 1: three batchable new records, same (up,t), ord=0 ===\n";
exec_updates_block(array(
    array("ord"=>0, "up"=>5, "t"=>3, "val"=>"A"),
    array("ord"=>0, "up"=>5, "t"=>3, "val"=>"B"),
    array("ord"=>0, "up"=>5, "t"=>3, "val"=>"C"),
));

echo "\n=== Case 2: batchable new rec, then update, then batchable new rec ===\n";
exec_updates_block(array(
    array("ord"=>0, "up"=>5, "t"=>3, "val"=>"A"),
    array("op"=>"val_update", "id"=>42, "val"=>"changed"),
    array("ord"=>0, "up"=>5, "t"=>3, "val"=>"B"),
));

echo "\n=== Case 3: new rec needing ID forces flush of prior batch ===\n";
exec_updates_block(array(
    array("ord"=>0, "up"=>5, "t"=>3, "val"=>"A"),
    array("ord"=>0, "up"=>5, "t"=>3, "val"=>"B", "needs_id"=>true, "new_id_key"=>"k1"),
    array("ord"=>0, "up"=>5, "t"=>3, "val"=>"C"),
));

echo "\n=== Case 4: delete before any batched insert (must not flush nothing) ===\n";
exec_updates_block(array(
    array("op"=>"delete", "id"=>100),
    array("ord"=>0, "up"=>5, "t"=>3, "val"=>"A"),
));
