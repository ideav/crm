<?php
# Восстановление файлов базы из архива (Code_restore_apply, issue #5168) обязано пропускать
# каждое имя из архива через BlackList() — как загрузка. Иначе архив кладёт в download/<база>/ и
# templates/custom/<база>/ файлы с запрещённым расширением (php/sh-extension list), минуя загрузку.
# Настоящий Code_restore_apply и BlackList из index.php. ZipArchive настоящий (собираем настоящие
# архивы); если ext/zip в php нет — стаб класса: имена и содержимое из $GLOBALS, extractTo
# раскладывает настоящие файлы. Отказ — исключение из стаба my_die (die() вышел бы с кодом 0,
# и обёртка сочла бы мерку зелёной).

$failures = 0;
function expect($c,$n){ global $failures; echo($c?"PASS: ":"FAIL: ")."$n\n"; if(!$c)$failures++; }
function t9n($v){ return preg_match('/^\[RU\](.*?)\[EN\]/s',$v,$m) ? $m[1] : $v; }
function my_die($msg){ throw new Exception("MY_DIE: ".$msg); }
function wlog($m, $f){}
function Restore_allowed(){ return TRUE; }
function Code_backup(){ return "safety.zip"; }

if(!class_exists('ZipArchive')){
    # Стаб ZipArchive: имена — из $GLOBALS, extractTo создаёт настоящие файлы.
    class ZipArchive {
        public $numFiles = 0;
        public function open($path){ $this->numFiles = count($GLOBALS["__names"]); return TRUE; }
        public function getNameIndex($i){ return $GLOBALS["__names"][$i]; }
        public function extractTo($tmp){
            foreach($GLOBALS["__names"] as $n){
                if(!isset($GLOBALS["__entries"][$n])) continue;
                $p = $tmp."/".$n;
                @mkdir(dirname($p), 0700, TRUE);
                file_put_contents($p, $GLOBALS["__entries"][$n]);
            }
        }
        public function close(){}
    }
}
function zip_make($path, $names, $entries){
    if(method_exists('ZipArchive', 'addFromString')){
        # Настоящий ext/zip: собираем настоящий архив.
        $zip = new ZipArchive();
        if($zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== TRUE)
            throw new Exception("zip open failed: ".$path);
        foreach($names as $n) $zip->addFromString($n, $entries[$n]);
        $zip->close();
    }else{
        # Стаб-режим: тест сам задаёт имена; файл архива должен существовать (is_file в коде).
        $GLOBALS["__names"] = $names;
        $GLOBALS["__entries"] = $entries;
        file_put_contents($path, "STUB");
    }
}
function Code_rm_dir($path){
    if(!is_dir($path)) return;
    foreach(scandir($path) as $f)
        if($f != "." && $f != ".."){
            $p = $path."/".$f;
            if(is_dir($p)) Code_rm_dir($p); else @unlink($p);
        }
    @rmdir($path);
}

function extract_function_source($source, $name){
    $start = strpos($source, "function ".$name."(");
    if($start === false) throw new Exception("not found: ".$name);
    $brace = strpos($source, "{", $start);
    $depth=0; $len=strlen($source);
    for($i=$brace;$i<$len;$i++){
        if($source[$i]==="{") $depth++;
        elseif($source[$i]==="}"){ $depth--; if($depth===0) return substr($source,$start,$i-$start+1); }
    }
    throw new Exception("not closed: ".$name);
}

$source = file_get_contents(__DIR__."/../index.php");
foreach(array("BlackList","Code_restore_apply") as $fn)
    eval(extract_function_source($source, $fn));
$GLOBALS["z"] = "tb";
$GLOBALS["GLOBAL_VARS"] = array("user" => "petrov");

function sandbox(){
    $dir = sys_get_temp_dir()."/dlh_".getmypid()."_".str_replace(".", "", microtime(TRUE));
    @mkdir($dir."/templates/custom/tb/backups", 0777, TRUE);
    file_put_contents($dir."/templates/custom/tb/backups/safety.zip", "PK");
    chdir($dir);
    return $dir;
}

# case 1: good archive (html, dot-suffixed extension-less file, template) restores fine
$dir = sandbox();
$GLOBALS["__names"] = array(
    "download/000a1b2c/001d4e5f6.html",
    "download/001d4e5f6.",
    "templates/ws.html");
$GLOBALS["__entries"] = array(
    "download/000a1b2c/001d4e5f6.html" => "<p>ok</p>",
    "download/001d4e5f6." => "data",
    "templates/ws.html" => "<b>ok</b>");
zip_make("templates/custom/tb/backups/case1.zip", $GLOBALS["__names"], $GLOBALS["__entries"]);
$res = Code_restore_apply("case1.zip");
expect(isset($res["result"]) && $res["result"] === "ok" && $res["files"] === 3, "good archive restores (result ok, files=3)");
expect(is_file($dir."/download/tb/000a1b2c/001d4e5f6.html"), "html written to download");
expect(is_file($dir."/templates/custom/tb/ws.html"), "template written to templates/custom");

# case 2: archive with download/.../shell.php — must die BEFORE writing anything
$dir = sandbox();
$GLOBALS["__names"] = array(
    "download/000a1b2c/001d4e5f6.html",
    "download/shell.php");
$GLOBALS["__entries"] = array(
    "download/000a1b2c/001d4e5f6.html" => "<p>ok</p>",
    "download/shell.php" => "<?php evil();");
$thrown = ""; $res = array();
zip_make("templates/custom/tb/backups/case2.zip", $GLOBALS["__names"], $GLOBALS["__entries"]);
try{ $res = Code_restore_apply("case2.zip"); }catch(Exception $e){ $thrown = $e->getMessage(); }
expect(strpos($thrown, "MY_DIE") !== FALSE, "shell.php in download — rejected (my_die)");
expect(!is_file($dir."/download/tb/shell.php"), "shell.php not written");
expect(!is_dir($dir."/download/tb/000a1b2c"), "nothing written at all (no subdirs created)");

# case 3: templates x.php and UPPERCASE .PHP — also rejected
$dir = sandbox();
$GLOBALS["__names"] = array("templates/x.php");
$GLOBALS["__entries"] = array("templates/x.php" => "<?php evil();");
$thrown = "";
zip_make("templates/custom/tb/backups/case3.zip", $GLOBALS["__names"], $GLOBALS["__entries"]);
try{ Code_restore_apply("case3.zip"); }catch(Exception $e){ $thrown = $e->getMessage(); }
expect(strpos($thrown, "MY_DIE") !== FALSE, "x.php in templates — rejected");
$dir = sandbox();
$GLOBALS["__names"] = array("download/SHELL.PHP");
$GLOBALS["__entries"] = array("download/SHELL.PHP" => "<?php evil();");
$thrown = "";
zip_make("templates/custom/tb/backups/case4.zip", $GLOBALS["__names"], $GLOBALS["__entries"]);
try{ Code_restore_apply("case4.zip"); }catch(Exception $e){ $thrown = $e->getMessage(); }
expect(strpos($thrown, "MY_DIE") !== FALSE, "SHELL.PHP uppercase rejected");

# direct BlackList checks
$ok = TRUE;
try{ BlackList("php"); $ok = FALSE; }catch(Exception $e){}
expect($ok, "BlackList('php') rejected");
try{ BlackList("PHP"); $ok = FALSE; }catch(Exception $e){}
expect($ok, "BlackList('PHP') rejected");
try{ BlackList("html"); }catch(Exception $e){ $ok = FALSE; }
expect($ok, "BlackList('html') passes");
try{ BlackList(""); }catch(Exception $e){ $ok = FALSE; }
expect($ok, "BlackList('') passes (dot-suffixed name)");

echo $failures ? "\n$failures FAILED\n" : "\nALL PASS\n";
exit($failures ? 1 : 0);
