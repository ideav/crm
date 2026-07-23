<?php
mb_internal_encoding("UTF-8");
define("VAL_LIM", 127);
$z = "upsound";
$GLOBALS["FLUSHED"] = array(); // collected INSERT VALUES rows across all exec_sql calls
$GLOBALS["INSERTED_DIRECT"] = array();
function exec_sql($sql, $msg){
    // parse "INSERT INTO upsound (up, ord, t, val) VALUES <rows>"
    $p = strpos($sql, "VALUES ");
    $rows = substr($sql, $p + 7);
    // split top-level tuples "),(" — vals here have no ) so simple split is safe for the test data
    foreach(explode("),(", trim($rows)) as $r){
        $r = trim($r, "()");
        $GLOBALS["FLUSHED"][] = $r;
    }
}
function Insert($up,$ord,$t,$val,$msg){ $GLOBALS["INSERTED_DIRECT"][]="$up,$ord,$t,'$val'"; return 999; }

/* ---- patched Insert_batch (extracted from work.php) ---- */
function Insert_batch($up, $ord, $t, $val, $message)
{
    if(mb_strlen($val) > VAL_LIM)
        return Insert($up, $ord, $t, $val, $message);
	global $connection, $z;
	if($up === "") // Close the batch
	{
    	if(isset($GLOBALS["SQLbatch"]))
    	{
        	exec_sql("INSERT INTO $z (up, ord, t, val) VALUES ".$GLOBALS["SQLbatch"], "Close batch: $message");
        	unset($GLOBALS["SQLbatch"]);
    	}
    	unset($GLOBALS["SQLbatchSeen"]); // issue #4327: сбросить дедуп-индекс при закрытии батча
    	return;
	}
	// issue #4327: пропускаем точный дубль (up,ord,t,val) в пределах батча — повторно
	// встреченный в файле объект находится по уникальности, но его реквизиты ещё в батче и
	// не видны SELECT'у, поэтому уходили во второй Insert_batch и двоили плоский реквизит.
	// Индекс держим до закрытия батча (НЕ сбрасываем на промежуточном флаше) — иначе дубли,
	// разнесённые флашем в большом импорте, проскочат.
	$dedupKey = $up."\0".$ord."\0".$t."\0".$val;
	if(isset($GLOBALS["SQLbatchSeen"][$dedupKey]))
		return;
	$GLOBALS["SQLbatchSeen"][$dedupKey] = true;
	if(isset($GLOBALS["SQLbatch"]))
    	$GLOBALS["SQLbatch"] .= ",($up,$ord,$t,'".addslashes($val)."')";
    else
        $GLOBALS["SQLbatch"] = "($up,$ord,$t,'".addslashes($val)."')";
#    trace("GLOBAL[SQLbatch] = ".$GLOBALS["SQLbatch"]);
	if(strlen($GLOBALS["SQLbatch"]) > 31000)
	{
    	exec_sql("INSERT INTO $z (up, ord, t, val) VALUES ".$GLOBALS["SQLbatch"], "Flush batch: $message");
    	unset($GLOBALS["SQLbatch"]);
	}
}

/* ================= TESTS ================= */
function count_row($needle){ return count(array_keys($GLOBALS["FLUSHED"], $needle)); }
$fail = 0;
function ok($cond,$name){ global $fail; echo ($cond?"PASS":"FAIL")." — $name\n"; if(!$cond)$fail++; }

/* --- T1: exact #4327 duplicates within one batch --- */
$GLOBALS["FLUSHED"]=array();
$feed = array(
  array(88690221,1,293,'4660275212865'), array(88690221,1,88690394,'10868'),
  array(88690221,1,293,'4660275212865'), array(88690221,1,88690394,'10868'),
  array(88690221,1,293,'4660275212865'), array(88690221,1,88690394,'10868'),
  array(88690221,1,293,'4660275212865'), array(88690221,1,88690394,'10868'),
  array(88690393,1,293,'4660275212865'), array(88690393,1,293,'4660275212865'),
);
foreach($feed as $r) Insert_batch($r[0],$r[1],$r[2],$r[3],"Import plain req");
Insert_batch("","","","","Import");
ok(count_row("88690221,1,293,'4660275212865'")===1, "req 293 of 88690221 inserted exactly once (was 4x)");
ok(count_row("88690221,1,88690394,'10868'")===1,    "req 88690394 of 88690221 inserted exactly once");
ok(count_row("88690393,1,293,'4660275212865'")===1, "req 293 of 88690393 inserted exactly once");
ok(count($GLOBALS["FLUSHED"])===3, "total 3 distinct rows (got ".count($GLOBALS["FLUSHED"]).")");

/* --- T2: dedup survives an intermediate 31000-char flush --- */
$GLOBALS["FLUSHED"]=array();
Insert_batch(500,1,293,'DUPVALUE',"req");             // first occurrence
for($i=0;$i<400;$i++) Insert_batch(500,1,700+$i,str_repeat("x",80),"filler"); // > 31000 chars -> forces flush(es)
Insert_batch(500,1,293,'DUPVALUE',"req");             // same tuple again, after flush boundary
Insert_batch("","","","","Import");
ok(count_row("500,1,293,'DUPVALUE'")===1, "duplicate across a flush boundary still deduped (large import)");

/* --- T3: distinct tuples preserved (multi-ref with $ord++, different reqs, different vals) --- */
$GLOBALS["FLUSHED"]=array();
Insert_batch(600,1,80,'A',"multi ref");
Insert_batch(600,2,81,'A',"multi ref");   // different ord+t -> distinct
Insert_batch(600,1,293,'val1',"req");
Insert_batch(600,1,294,'val2',"req");     // different t -> distinct
Insert_batch("","","","","Import");
ok(count($GLOBALS["FLUSHED"])===4, "4 genuinely distinct rows all kept (got ".count($GLOBALS["FLUSHED"]).")");

/* --- T4: Close batch resets seen -> a later separate batch may re-insert same tuple --- */
$GLOBALS["FLUSHED"]=array();
Insert_batch(700,1,293,'v',"req"); Insert_batch(700,1,293,'v',"req");
Insert_batch("","","","","Import");        // close #1
Insert_batch(700,1,293,'v',"req");         // new batch, same tuple should be allowed again
Insert_batch("","","","","Flush Copy");    // close #2
ok(count_row("700,1,293,'v'")===2, "seen-index reset between separate batch operations (got ".count_row("700,1,293,'v'").")");

/* --- T5: Close batch with nothing queued does not emit a garbage (,,,'') row --- */
$GLOBALS["FLUSHED"]=array();
Insert_batch("","","","","Import");
ok(count($GLOBALS["FLUSHED"])===0, "empty close emits nothing (no garbage row)");

echo ($fail? "\n$fail TEST(S) FAILED\n" : "\nALL TESTS PASSED\n");
