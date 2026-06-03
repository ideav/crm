# ============================================================================
#  ateh - починка очереди резок (cleanup + пере-секвенс) с надёжной сети (Windows).
#  Запуск:  powershell -ExecutionPolicy Bypass -File .\fix_queue.ps1 -Token <ТОКЕН>
#  Что делает: убирает дубли-обеспечения, удаляет резки-фантомы (без обеспечения),
#  пере-нумерует "Очерёдность" каждого станка по orderCuts (мин. переналадка).
#  Кириллица в логике собрана из кодов символов - кодировка файла не важна.
#  ВАЖНО: токен ateh передаётся аргументом -Token (или вместо xxx в значении по умолч.).
#  Чтение отчётов одним запросом (LIMIT=2000 без запятой - PowerShell калечит запятую).
# ============================================================================
param([string]$Token = "xxx")
$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$Base = "https://ideav.ru/ateh"
$H    = @{ "X-Authorization" = $Token; "Cookie" = "idb_ateh=$Token" }

# кириллица из кодов (не зависит от кодировки файла)
$PLANNED = -join ([char[]](0x417,0x430,0x43f,0x43b,0x430,0x43d,0x438,0x440,0x43e,0x432,0x430,0x43d,0x430)) # Запланирована
$FOIL    = -join ([char[]](0x444,0x43e,0x43b,0x44c,0x433))                                                 # фольг

$Wm=100; $Ww=70; $Wb=50; $Wr=40; $Wk=25; $Wwidth=10
$KNIFE_SCALE=8.0; $WIDTH_SCALE=100.0; $REMAINDER_OK_M=600.0

function GetJson($path){ Invoke-RestMethod -Uri "$Base$path" -Headers $H -TimeoutSec 120 }
function PostForm($path,[hashtable]$f){
  $f["token"]=$Token; $f["_xsrf"]=$Script:Xsrf
  Invoke-RestMethod -Method Post -Uri "$Base$path" -Headers $H -Body $f -ContentType "application/x-www-form-urlencoded" -TimeoutSec 120
}
function Num($v){ $d=0.0; [double]::TryParse(("$v").Replace(',','.'),[ref]$d) | Out-Null; $d }
function NormWind($v){ $s=("$v").Trim().ToUpper(); if($s -eq 'IN' -or $s -eq 'OUT'){$s}else{''} }
function Awkward($m){ $x=Num $m; ($x -gt 1e-6) -and ($x -lt $REMAINDER_OK_M) }
function WidthDist($a,$b){
  $ma=@{}; foreach($x in $a){$k="$([double]$x)"; if($ma.ContainsKey($k)){$ma[$k]++}else{$ma[$k]=1}}
  $mb=@{}; foreach($x in $b){$k="$([double]$x)"; if($mb.ContainsKey($k)){$mb[$k]++}else{$mb[$k]=1}}
  $keys=@{}; foreach($k in $ma.Keys){$keys[$k]=1}; foreach($k in $mb.Keys){$keys[$k]=1}
  $d=0; foreach($k in $keys.Keys){ $va=0; if($ma.ContainsKey($k)){$va=$ma[$k]}; $vb=0; if($mb.ContainsKey($k)){$vb=$mb[$k]}; $d+=[Math]::Abs($va-$vb) }
  $d
}
function Cost($p,$n){
  $c=0.0
  if("$($p.materialId)" -ne "$($n.materialId)"){$c+=$Wm}
  if((NormWind $p.winding) -ne (NormWind $n.winding)){$c+=$Ww}
  $bc = ("$($p.batchId)" -ne "$($n.batchId)")
  if($bc){$c+=$Wb}
  if($bc -and (Awkward $p.jumboRem)){$c+=$Wr}
  $kd=[Math]::Abs([int]$p.knifeCount-[int]$n.knifeCount)+(WidthDist $p.knifeWidths $n.knifeWidths)
  $c+=$Wk*[Math]::Min(1.0,$kd/$KNIFE_SCALE)
  $drop=[Math]::Max(0.0,(Num $p.rollerWidth)-(Num $n.rollerWidth))
  $c+=$Wwidth*[Math]::Min(1.0,$drop/$WIDTH_SCALE)
  $c
}
function StartKeyCmp($a,$b){
  $ra=Num $a.rollerWidth; $rb=Num $b.rollerWidth; if($ra -ne $rb){ if($ra -lt $rb){return -1}else{return 1} }
  $ka=-[int]$a.knifeCount; $kb=-[int]$b.knifeCount; if($ka -ne $kb){ if($ka -lt $kb){return -1}else{return 1} }
  if("$($a.id)" -lt "$($b.id)"){return -1}elseif("$($a.id)" -gt "$($b.id)"){return 1}else{return 0}
}
function GreedySeq($cuts){
  $pool=[System.Collections.ArrayList]@($cuts | Sort-Object @{Expression={Num $_.rollerWidth}},@{Expression={-[int]$_.knifeCount}},@{Expression={"$($_.id)"}})
  if($pool.Count -eq 0){return @()}
  $res=[System.Collections.ArrayList]@(); [void]$res.Add($pool[0]); $pool.RemoveAt(0)
  while($pool.Count -gt 0){
    $cur=$res[$res.Count-1]; $bi=0; $bc=[double]::PositiveInfinity; $bk=$null
    for($i=0;$i -lt $pool.Count;$i++){
      $cc=Cost $cur $pool[$i]
      if($cc -lt $bc -or ($cc -eq $bc -and $bk -ne $null -and (StartKeyCmp $pool[$i] $bk) -lt 0)){ $bc=$cc; $bi=$i; $bk=$pool[$i] }
    }
    [void]$res.Add($pool[$bi]); $pool.RemoveAt($bi)
  }
  $res.ToArray()
}
function OrderCuts($cuts){
  $rest=@($cuts | Where-Object { -not $_.isFoil })
  $foil=@($cuts | Where-Object { $_.isFoil })
  $seq=@(); $seq+=GreedySeq $rest; $seq+=GreedySeq $foil
  $i=1; foreach($c in $seq){ $c | Add-Member -NotePropertyName sequence -NotePropertyValue $i -Force; $i++ }
  $seq
}

# ── 0) xsrf (валидирует токен) ──
if($Token -eq "xxx"){ Write-Host "Передай токен:  -Token <ТОКЕН>"; exit 1 }
try { $Script:Xsrf = (GetJson "/xsrf?JSON=1")._xsrf } catch { Write-Host "ТОКЕН НЕ ПРИНЯТ (сеть/токен)"; exit 1 }
if(-not $Script:Xsrf){ Write-Host "ТОКЕН НЕ ПРИНЯТ - запроси свежий"; exit 1 }
Write-Host "xsrf ок: $($Script:Xsrf)"

# ── 1) cut_planning одним запросом (без запятой в LIMIT) ──
$rows = @(GetJson "/report/cut_planning?JSON_KV&LIMIT=5000")
$plan = @($rows | Where-Object { $_.cut_status -eq $PLANNED })
$uniqCuts = @($plan | ForEach-Object { $_.cut_id } | Select-Object -Unique)
Write-Host "строк cut_planning (Запланирована): $($plan.Count), резок: $($uniqCuts.Count)"

# ── 2) дубли-обеспечения: позиция с >1 supply_id → оставить первый ──
$byPos=@{}
foreach($r in $plan){ if($r.supply_position_id -and $r.supply_id){ if(-not $byPos.ContainsKey($r.supply_position_id)){$byPos[$r.supply_position_id]=@()}; $byPos[$r.supply_position_id]+=$r.supply_id } }
$removed=@{}; $ndup=0
foreach($pos in $byPos.Keys){ $ids=@($byPos[$pos] | Select-Object -Unique); if($ids.Count -gt 1){ foreach($sid in $ids[1..($ids.Count-1)]){ PostForm "/_m_del/$sid?JSON" @{} | Out-Null; $removed[$sid]=1; $ndup++ } } }
Write-Host "удалено дублей-обеспечений: $ndup"

# ── 3) дескрипторы по резкам с выжившим обеспечением ──
$ci=@{}; $cutNo=@{}
foreach($r in $plan){
  $cutNo[$r.cut_id]=$r.cut_no
  $hasLiveSup = ($r.supply_id -and -not $removed.ContainsKey($r.supply_id))
  if($hasLiveSup -and -not $ci.ContainsKey($r.cut_id)){
    $ci[$r.cut_id]=[pscustomobject]@{ id=$r.cut_id; slitterId=$r.cut_slitter_id; materialId=$r.cut_material_id;
      winding=$r.cut_winding; batchId=$r.cut_batch_id; jumboRem=(Num $r.cut_jumbo_remaining);
      rollerWidth=(Num $r.cut_roller_width); isFoil=([bool]("$($r.cut_material)" -match $FOIL)); knifeWidths=@(); knifeCount=0 }
  }
}
# ── 4) резки-фантомы (без выжившего обеспечения) → удалить ──
$norph=0
foreach($cid in @($cutNo.Keys)){ if(-not $ci.ContainsKey($cid)){ PostForm "/_m_del/$cid?JSON" @{} | Out-Null; $norph++ } }
Write-Host "удалено резок-фантомов: $norph"

# ── 5) ножи из cut_strips ──
$strips = @(GetJson "/report/cut_strips?JSON_KV&LIMIT=5000")
foreach($s in $strips){ if($ci.ContainsKey($s.cut_id) -and $s.strip_width){ $w=Num $s.strip_width; $q=[int](Num $s.strip_qty); for($i=0;$i -lt $q;$i++){ $ci[$s.cut_id].knifeWidths+=$w }; $ci[$s.cut_id].knifeCount+=$q } }

# ── 6) пере-секвенс по станкам ──
$bySl=@{}
foreach($c in $ci.Values){ $k="$($c.slitterId)"; if(-not $bySl.ContainsKey($k)){$bySl[$k]=@()}; $bySl[$k]+=$c }
$nseq=0
foreach($sl in $bySl.Keys){
  $ordered=OrderCuts $bySl[$sl]
  foreach($c in $ordered){ PostForm "/_m_set/$($c.id)?JSON" @{ "t8465" = "$($c.sequence)" } | Out-Null; $nseq++ }
}
Write-Host ""
Write-Host "ГОТОВО. Очерёдность пере-проставлена: $nseq резок по $($bySl.Count) станкам. Резок в очереди: $($ci.Count)"
