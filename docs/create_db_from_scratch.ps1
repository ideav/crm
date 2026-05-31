# ============================================================================
# Наполнение базы Интеграм «с нуля» по метаданным (PowerShell, Windows 10)
# ============================================================================
#
# Скрипт читает файл метаданных (по умолчанию metadata_all.json рядом со
# скриптом) и воссоздаёт описанную в нём структуру в чистой базе Интеграм:
# таблицы, типы колонок, ссылки (ref), подчинённые/массивные таблицы (arr),
# свободные связи и атрибуты колонок (обязательность, мультивыбор, значение
# по умолчанию, псевдоним).
#
# Исходные данные по умолчанию — atex_metadata.json: схема проекta atex
# (производство термопринтерных рулонов, 15 таблиц + системная Пользователь)
# по дизайн-спеке
# https://github.com/ideav/atex/blob/main/docs/superpowers/specs/2026-05-26-atex-schema-setup-design.md
# Прежний metadata_all.json был выгрузкой сторонней базы (системные таблицы
# Интеграм) — неверные исходные данные, см. issue #2901.
#
# «Нуль» — чистая база. Часть таблиц уже может существовать (неполная) — это
# не ломает работу, скрипт идемпотентен и дозаполняет недостающее:
#   * _d_new дедуплицирует типы по паре (имя, базовый тип);
#   * _d_ref дедуплицирует ссылочный тип по целевой таблице;
#   * _d_req дедуплицирует обычные и подчинённые реквизиты по (таблица, тип);
#   * ссылочные колонки сервер НЕ дедуплицирует, поэтому перед их добавлением
#     скрипт читает текущую структуру (endpoint metadata) и пропускает уже
#     заведённые;
#   * повторное добавление свободной связи сервер считает ошибкой — скрипт
#     перехватывает её и продолжает.
#
# Образец и API-паттерны: docs/create_perelidoz.ps1 и
# docs/integram-app-workflow.md (разделы 3.2–3.6).
#
# Запуск (PowerShell 5.1+ / PowerShell 7):
#   .\create_db_from_scratch.ps1 -BaseUrl https://ideav.ru -DbName myapp `
#       -Token "***"
#
# Предварительный прогон без обращения к серверу (показывает план вызовов):
#   .\create_db_from_scratch.ps1 -DryRun
# ============================================================================

param(
    [string]$Token = $env:INTEGRAM_TOKEN,
    [string]$XsrfToken = $env:INTEGRAM_XSRF,
    [string]$BaseUrl = "https://ideav.ru",
    [string]$DbName = "atex",
    [string]$MetadataPath = (Join-Path $PSScriptRoot "atex_metadata.json"),
    [string]$LogPath = "create_db_from_scratch_log.txt",
    # Применять числовые значения по умолчанию на ссылочных колонках. По
    # умолчанию выключено: такие значения — это id записей исходной базы
    # (например :!NULL:164 — роль №164), которых в чистой базе ещё нет.
    [switch]$PreserveRecordDefaults,
    # Прогон без HTTP-запросов: id'шники подставляются синтетические,
    # реальные вызовы не выполняются. Удобно для проверки плана и отладки.
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# Базовые типы Интеграм (см. docs/integram-app-workflow.md, раздел 2.2).
# Используются только для подписи в логах.
$script:BaseTypeNames = @{
    "1"  = "FREE_LINK"; "3"  = "SHORT";    "4"  = "DATETIME"; "5"  = "GRANT"
    "6"  = "PWD";       "7"  = "HTML";      "8"  = "CHARS";    "9"  = "DATE"
    "10" = "FILE";      "11" = "BOOLEAN";   "12" = "MEMO";     "13" = "NUMBER"
    "14" = "SIGNED";    "15" = "CALC";      "16" = "REPORT_COLUMN"; "17" = "PATH"
}

# --------------------------------------------------------------------------
# Логирование. Пишем и в файл, и в консоль.
# --------------------------------------------------------------------------
function Write-Log {
    param([string]$Message)

    $timestamp = Get-Date -Format "dd/MM/yyyy HH:mm:ss"
    Add-Content -Path $LogPath -Value "$timestamp $Message"
    Write-Host $Message
}

# --------------------------------------------------------------------------
# Один вызов API. Все POST'ы несут token и _xsrf (обязателен для _m_*/_d_*).
# В режиме -DryRun возвращает синтетический ответ нужной формы.
# --------------------------------------------------------------------------
function Invoke-ApiRequest {
    param(
        [Parameter(Mandatory = $true)][string]$Endpoint,
        [ValidateSet("GET", "POST")][string]$Method = "POST",
        [hashtable]$FormData = @{},
        [switch]$Anonymous,
        # Не прерывать выполнение при HTTP-ошибке: вернуть тело ответа сервера
        # (например, текст «реквизит уже существует») для анализа вызывающим кодом.
        [switch]$IgnoreHttpError
    )

    $url = "$BaseUrl/$DbName/$Endpoint"
    if ($url -notmatch "\?") {
        $url = "$url`?JSON=1"
    } elseif ($url -notmatch "(^|[?&])JSON=" -and $url -notmatch "(^|[?&])JSON_DATA=" -and $url -notmatch "(^|[?&])JSON_KV=") {
        $url = "$url&JSON=1"
    }

    $body = @{}
    foreach ($key in $FormData.Keys) {
        $body[$key] = $FormData[$key]
    }
    $headers = @{}
    if (-not $Anonymous) {
        if ($script:XsrfToken) { $body["_xsrf"] = $script:XsrfToken }
        if ($script:AuthToken) {
            $body["token"] = $script:AuthToken
            # issue #3000: токен доходит до сервера только заголовком X-Authorization.
            # Живой Integram игнорирует cookie, заданный вручную через -Headers, и
            # строку запроса ?token= (см. atex#44), поэтому без этого заголовка
            # сервер отвечает 401 "No authorization token provided".
            $headers["X-Authorization"] = $script:AuthToken
        }
    }

    if ($body.Count -gt 0) {
        $bodyString = ($body.GetEnumerator() | Where-Object { $_.Key -ne "token" -and $_.Key -ne "_xsrf" } |
            Sort-Object Name | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "; "
        Write-Log "  $Method $Endpoint  [$bodyString]"
    } else {
        Write-Log "  $Method $Endpoint"
    }

    if ($DryRun) {
        return (New-DryRunResponse -Endpoint $Endpoint -FormData $FormData)
    }

    try {
        if ($Method -eq "POST") {
            $response = Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType "application/x-www-form-urlencoded" -Headers $headers
        } else {
            $response = Invoke-RestMethod -Uri $url -Method Get -Body $body -Headers $headers
        }
        return $response
    } catch {
        $bodyText = Get-HttpErrorBody -ErrorRecord $_
        Write-Log "  ERROR: $($_.Exception.Message)"
        if ($bodyText) { Write-Log "  Response Body: $bodyText" }
        if ($IgnoreHttpError) {
            return [pscustomobject]@{ error = $bodyText; exception = $_.Exception.Message }
        }
        throw
    }
}

# Извлекает тело ответа сервера из ошибки HTTP. Работает и в PowerShell 7
# (HttpResponseException -> ErrorDetails.Message), и в Windows PowerShell 5.1
# (WebException -> Response.GetResponseStream()).
function Get-HttpErrorBody {
    param($ErrorRecord)
    if ($ErrorRecord.ErrorDetails -and $ErrorRecord.ErrorDetails.Message) {
        return [string]$ErrorRecord.ErrorDetails.Message
    }
    $resp = $ErrorRecord.Exception.Response
    if ($resp -and $resp.PSObject.Methods.Name -contains "GetResponseStream") {
        try {
            $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
            $reader.BaseStream.Position = 0
            $reader.DiscardBufferedData()
            return $reader.ReadToEnd()
        } catch { return $null }
    }
    return $null
}

function Get-XsrfByToken {
    param([Parameter(Mandatory = $true)][string]$TokenValue)

    $url = "$BaseUrl/$DbName/xsrf"
    if ($url -notmatch "\?") {
        $url = "$url`?JSON=1"
    } elseif ($url -notmatch "(^|[?&])JSON=") {
        $url = "$url&JSON=1"
    }

    Write-Log "  GET xsrf  [X-Authorization ***; cookie idb_$DbName=***]"
    try {
        # issue #3000: токен в заголовке X-Authorization — транспорт, который
        # сервер реально читает; cookie дублируем для совместимости.
        return Invoke-RestMethod -Uri $url -Method Get -Headers @{ "X-Authorization" = $TokenValue; Cookie = "idb_$DbName=$TokenValue" }
    } catch {
        $bodyText = Get-HttpErrorBody -ErrorRecord $_
        Write-Log "  ERROR: $($_.Exception.Message)"
        if ($bodyText) { Write-Log "  Response Body: $bodyText" }
        throw
    }
}

function Initialize-TokenSession {
    Write-Log "1. Подключение по токену..."

    if ($DryRun) {
        $script:AuthToken = "dryrun-token"
        $script:XsrfToken = "dryrun-xsrf"
        Write-Log "   DRY-RUN: token/_xsrf заданы синтетически"
        return
    }

    if ([string]::IsNullOrWhiteSpace($Token)) {
        throw "Передайте -Token или задайте INTEGRAM_TOKEN. POST /auth с логином и паролем в этом сценарии не используется."
    }

    $script:AuthToken = $Token
    if (-not [string]::IsNullOrWhiteSpace($XsrfToken)) {
        $script:XsrfToken = $XsrfToken
        Write-Log "   OK, _xsrf взят из параметра/INTEGRAM_XSRF"
        return
    }

    $xsrfResponse = Get-XsrfByToken -TokenValue $Token
    if (-not $xsrfResponse -or -not $xsrfResponse._xsrf) {
        throw "Не удалось получить _xsrf по токену через $BaseUrl/$DbName/xsrf"
    }
    $script:XsrfToken = $xsrfResponse._xsrf
    if ($xsrfResponse.token) { $script:AuthToken = $xsrfResponse.token }
    Write-Log "   OK, user id: $($xsrfResponse.id)"
}

# Синтетические ответы для -DryRun (форма совпадает с реальным API).
$script:DryRunSeq = 1000
function New-DryRunResponse {
    param([string]$Endpoint, [hashtable]$FormData)
    $script:DryRunSeq++
    if ($Endpoint -eq "xsrf") {
        return [pscustomobject]@{ token = "dryrun-token"; _xsrf = "dryrun-xsrf"; id = "1" }
    }
    if ($Endpoint -like "_d_req/*") {
        return [pscustomobject]@{ id = "$script:DryRunSeq"; obj = ($Endpoint -replace "_d_req/", "") }
    }
    if ($Endpoint -like "_d_ref/*" -or $Endpoint -eq "_d_new") {
        return [pscustomobject]@{ id = ""; obj = "$script:DryRunSeq" }
    }
    return [pscustomobject]@{ obj = "$script:DryRunSeq" }
}

# --------------------------------------------------------------------------
# Обёртки над командами редактора структуры.
# --------------------------------------------------------------------------

# _d_new — создать тип (таблицу или тип колонки). Дедуплицируется по (имя,
# базовый тип): повторный вызов вернёт существующий obj с предупреждением.
function New-IntegramType {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$BaseType,
        [string]$Unique
    )
    $form = @{ t = $BaseType; val = $Name }
    if ($Unique -eq "1") { $form["unique"] = "1" }
    $response = Invoke-ApiRequest -Endpoint "_d_new" -FormData $form
    if (-not $response -or -not $response.obj) {
        throw "Не удалось создать тип '$Name' (базовый тип $BaseType)"
    }
    return [string]$response.obj
}

# _d_ref/{target} — создать (или переиспользовать) ссылочный тип на таблицу.
function New-IntegramRef {
    param([Parameter(Mandatory = $true)][string]$TargetTableId)
    $response = Invoke-ApiRequest -Endpoint "_d_ref/$TargetTableId" -FormData @{}
    if (-not $response -or -not $response.obj) {
        throw "Не удалось создать ссылку на таблицу '$TargetTableId'"
    }
    return [string]$response.obj
}

# _d_req/{table} t={type} — добавить тип реквизитом в таблицу. Идемпотентно
# по паре (таблица, тип): повторный вызов вернёт существующий reqId.
function Add-IntegramRequisite {
    param(
        [Parameter(Mandatory = $true)][string]$TableId,
        [Parameter(Mandatory = $true)][string]$TypeId
    )
    $response = Invoke-ApiRequest -Endpoint "_d_req/$TableId" -FormData @{ t = $TypeId }
    if (-not $response -or -not $response.id) {
        throw "Не удалось добавить реквизит (тип $TypeId) в таблицу '$TableId'"
    }
    return [string]$response.id
}

# _d_req/{table} t=1 val=... — добавить «свободную связь» (тип 1).
# В отличие от обычных реквизитов, повторное добавление свободной связи сервер
# считает ошибкой («реквизит уже существует»). Для идемпотентности такая ошибка
# не прерывает работу: связь уже есть, возвращаем $null (id не нужен —
# атрибуты на свободные связи не выставляются).
function Add-IntegramFreeLink {
    param(
        [Parameter(Mandatory = $true)][string]$TableId,
        [Parameter(Mandatory = $true)][string]$Name
    )
    $response = Invoke-ApiRequest -Endpoint "_d_req/$TableId" -FormData @{ t = "1"; val = $Name } -IgnoreHttpError
    if ($response -and $response.id) {
        return [string]$response.id
    }
    $detail = ""
    if ($response) { $detail = "$($response.error) $($response.exception)" }
    if ($detail -match "(?i)уже\s+сущ|already\s+exist") {
        Write-Log "      .. свободная связь '$Name' уже существует, пропуск"
        return $null
    }
    throw "Не удалось добавить свободную связь '$Name' в таблицу '$TableId': $detail"
}

# Считывает уже существующую структуру базы (endpoint metadata) и возвращает
# множество уже заведённых ссылочных колонок в виде ключей «таблицаколонка».
# Нужно для идемпотентности: сервер дедуплицирует _d_new/_d_ref и обычные
# реквизиты, но НЕ дедуплицирует ссылочные реквизиты (_d_req с типом-ссылкой) —
# без этой проверки повторный прогон добавил бы дубли ссылочных колонок.
function Get-ExistingRefColumns {
    $existing = @{}
    if ($DryRun) { return $existing }
    $resp = Invoke-ApiRequest -Endpoint "metadata" -Method GET -IgnoreHttpError
    # Пустая база возвращает [] (или ничего), ошибка — объект {error:...}.
    # В обоих случаях считаем, что ссылочных колонок ещё нет.
    if (-not $resp -or -not ($resp -is [System.Array])) {
        Write-Log "   (существующая структура пуста или недоступна — считаем базу чистой)"
        return $existing
    }
    $nameById = @{}
    foreach ($tb in $resp) { $nameById[[string]$tb.id] = [string]$tb.val }
    foreach ($tb in $resp) {
        if (-not $tb.reqs) { continue }
        foreach ($r in $tb.reqs) {
            if ($r.PSObject.Properties['ref']) {
                $existing["$($tb.val)`u{1}$($r.val)"] = $true
            }
        }
    }
    Write-Log "   Прочитано существующих ссылочных колонок: $($existing.Count)"
    return $existing
}

# _d_attrs/{reqId} — установить атрибуты реквизита одним вызовом
# (обязательность, мультивыбор, ключ, значение по умолчанию, псевдоним).
function Set-IntegramReqAttrs {
    param(
        [Parameter(Mandatory = $true)][string]$ReqId,
        [bool]$Required = $false,
        [bool]$Multi = $false,
        [bool]$Key = $false,
        [string]$Default = "",
        [string]$Alias = ""
    )
    $form = @{ val = $Default }
    if ($Required) { $form["set_null"] = "1" }
    if ($Multi)    { $form["multi"]    = "1" }
    if ($Key)      { $form["key"]      = "1" }
    if ($Alias -ne "") { $form["alias"] = $Alias }
    Invoke-ApiRequest -Endpoint "_d_attrs/$ReqId" -FormData $form | Out-Null
}

# --------------------------------------------------------------------------
# Разбор строки атрибутов из метаданных (порт FieldAttrsParse из
# include/field_attrs.php). Поддерживает legacy-маски и JSON-форму.
# --------------------------------------------------------------------------
function Convert-FieldAttrs {
    param([string]$Attrs)

    $result = @{ required = $false; multi = $false; key = $false; alias = $null; default = "" }
    if ([string]::IsNullOrEmpty($Attrs)) { return $result }
    $trimmed = $Attrs.Trim()
    if ($trimmed -eq "") { return $result }

    if ($trimmed.StartsWith("{")) {
        try {
            $json = $trimmed | ConvertFrom-Json
            foreach ($p in $json.PSObject.Properties) {
                switch ($p.Name) {
                    { $_ -in @("required", "notNull", "not_null") } { $result.required = [bool]$p.Value }
                    "multi"   { $result.multi = [bool]$p.Value }
                    "key"     { $result.key = [bool]$p.Value }
                    "alias"   { $result.alias = [string]$p.Value }
                    { $_ -in @("default", "defaultValue") } { $result.default = [string]$p.Value }
                }
            }
            return $result
        } catch {
            # не JSON — разбираем как legacy-строку ниже
        }
    }

    $result.required = $Attrs.Contains(":!NULL:")
    $result.multi    = $Attrs.Contains(":MULTI:")
    $result.key      = $Attrs.Contains(":KEY:")
    $aliasMatch = [regex]::Match($Attrs, ":ALIAS=(.*?):")
    if ($aliasMatch.Success) { $result.alias = $aliasMatch.Groups[1].Value }
    $default = $Attrs -replace ":ALIAS=(.*?):", "" -replace ":KEY:", "" -replace ":MULTI:", "" -replace ":!NULL:", ""
    $result.default = $default
    return $result
}

# ==========================================================================
# Основной сценарий
# ==========================================================================

Remove-Item -Path $LogPath -ErrorAction SilentlyContinue

$script:AuthToken = $null
$script:XsrfToken = $null

Write-Log "============================================================"
Write-Log "Наполнение базы Интеграм по метаданным"
Write-Log "База:       $BaseUrl/$DbName"
Write-Log "Метаданные: $MetadataPath"
if ($DryRun) { Write-Log "Режим:      DRY-RUN (без обращения к серверу)" }
Write-Log "============================================================"

# --- Загрузка метаданных ---
if (-not (Test-Path $MetadataPath)) {
    throw "Файл метаданных не найден: $MetadataPath"
}
$rawJson = Get-Content -Path $MetadataPath -Raw -Encoding UTF8
$metadata = $rawJson | ConvertFrom-Json
if (-not $metadata) { throw "Не удалось разобрать метаданные из $MetadataPath" }
Write-Log ""
Write-Log "Загружено таблиц в метаданных: $($metadata.Count)"

# --- Подключение по токену ---
Write-Log ""
Initialize-TokenSession

# Карты соответствия id из метаданных -> id в целевой базе
$tableMap = @{}   # id таблицы из метаданных -> новый id таблицы
$typeMap  = @{}   # orig (id простого типа) -> новый id типа
$refMap   = @{}   # id целевой таблицы -> новый id ссылочного типа
$tableName = @{}  # id таблицы из метаданных -> имя (для псевдонимов)
foreach ($t in $metadata) { $tableName[[string]$t.id] = [string]$t.val }

# Уже существующие ссылочные колонки (для идемпотентности повторных прогонов).
Write-Log ""
Write-Log "1.1. Чтение существующей структуры..."
$existingRefs = Get-ExistingRefColumns

# --- Этап 1. Создание всех таблиц ---
Write-Log ""
Write-Log "2. Создание таблиц..."
foreach ($t in $metadata) {
    $baseName = $script:BaseTypeNames[[string]$t.type]
    $newId = New-IntegramType -Name ([string]$t.val) -BaseType ([string]$t.type) -Unique ([string]$t.unique)
    $tableMap[[string]$t.id] = $newId
    Write-Log "   OK таблица '$($t.val)' [$baseName] -> id $newId"
}

# --- Этап 2. Колонки, ссылки, подчинённые таблицы, атрибуты ---
Write-Log ""
Write-Log "3. Колонки и связи..."
foreach ($t in $metadata) {
    if (-not $t.reqs) { continue }
    $tableId = $tableMap[[string]$t.id]
    Write-Log "   Таблица '$($t.val)' (id $tableId):"

    # порядок колонок — по num
    $reqs = @($t.reqs | Sort-Object { [int]$_.num })
    foreach ($r in $reqs) {
        $val   = [string]$r.val
        $type  = [string]$r.type
        $orig  = [string]$r.orig
        $ref   = if ($r.PSObject.Properties['ref'])    { [string]$r.ref }    else { $null }
        $arrId = if ($r.PSObject.Properties['arr_id']) { [string]$r.arr_id } else { $null }
        $attrs = if ($r.PSObject.Properties['attrs'])  { [string]$r.attrs }  else { "" }

        $reqId = $null
        $canonicalName = $val   # имя, под которым колонка отобразится без псевдонима
        $isFreeLink = $false

        if ($type -eq "1") {
            # Свободная связь — имя передаётся прямо в _d_req.
            $reqId = Add-IntegramFreeLink -TableId $tableId -Name $val
            $isFreeLink = $true
            if ($reqId) { Write-Log "      OK свободная связь '$val' -> req $reqId" }
        }
        elseif ($ref) {
            # Ссылка на таблицу (ref). Двухшаговый паттерн: _d_ref + _d_req.
            if (-not $tableMap.ContainsKey($ref)) {
                throw "Колонка '$val' таблицы '$($t.val)' ссылается на неизвестную таблицу $ref"
            }
            # Сервер не дедуплицирует ссылочные реквизиты — пропускаем, если
            # такая ссылочная колонка уже заведена (по имени таблицы и колонки).
            if ($existingRefs.ContainsKey("$($t.val)`u{1}$val")) {
                Write-Log "      .. ссылка '$val' -> $($tableName[$ref]) уже существует, пропуск"
                continue
            }
            $targetId = $tableMap[$ref]
            if (-not $refMap.ContainsKey($ref)) {
                $refMap[$ref] = New-IntegramRef -TargetTableId $targetId
            }
            $reqId = Add-IntegramRequisite -TableId $tableId -TypeId $refMap[$ref]
            $canonicalName = $tableName[$ref]
            $existingRefs["$($t.val)`u{1}$val"] = $true
            Write-Log "      OK ссылка '$val' -> $($tableName[$ref]) (req $reqId)"
        }
        elseif ($arrId) {
            # Подчинённая/массивная таблица: тип дочерней таблицы как реквизит.
            if (-not $tableMap.ContainsKey($arrId)) {
                throw "Колонка '$val' таблицы '$($t.val)' ссылается на неизвестную дочернюю таблицу $arrId"
            }
            $reqId = Add-IntegramRequisite -TableId $tableId -TypeId $tableMap[$arrId]
            $canonicalName = $tableName[$arrId]
            Write-Log "      OK подчинённая таблица '$val' -> $($tableName[$arrId]) (req $reqId)"
        }
        else {
            # Простой тип колонки. Тип создаётся один раз и переиспользуется.
            if (-not $typeMap.ContainsKey($orig)) {
                $typeMap[$orig] = New-IntegramType -Name $val -BaseType $type
            }
            $reqId = Add-IntegramRequisite -TableId $tableId -TypeId $typeMap[$orig]
            $canonicalName = $val   # тип создан с этим же именем
            $baseName = $script:BaseTypeNames[$type]
            Write-Log "      OK колонка '$val' [$baseName] (req $reqId)"
        }

        # --- Атрибуты колонки ---
        if (-not $isFreeLink) {
            $parsed = Convert-FieldAttrs -Attrs $attrs
            # Псевдоним нужен только если отображаемое имя отличается от
            # канонического имени типа/таблицы.
            $alias = ""
            if ($parsed.alias) { $alias = $parsed.alias }
            elseif ($val -ne $canonicalName) { $alias = $val }

            # Числовые значения по умолчанию на ссылках — это id записей
            # исходной базы; в чистой базе их нет. Пропускаем, если не задан
            # -PreserveRecordDefaults.
            $default = $parsed.default
            if ($default -ne "" -and $ref -and ($default -match '^\d+$') -and -not $PreserveRecordDefaults) {
                Write-Log "      .. пропущено значение по умолчанию '$default' (id записи исходной базы)"
                $default = ""
            }

            if ($parsed.required -or $parsed.multi -or $parsed.key -or $default -ne "" -or $alias -ne "") {
                Set-IntegramReqAttrs -ReqId $reqId -Required $parsed.required -Multi $parsed.multi `
                    -Key $parsed.key -Default $default -Alias $alias
                $flags = @()
                if ($parsed.required) { $flags += "NOT NULL" }
                if ($parsed.multi)    { $flags += "MULTI" }
                if ($parsed.key)      { $flags += "KEY" }
                if ($default -ne "")  { $flags += "default='$default'" }
                if ($alias -ne "")    { $flags += "alias='$alias'" }
                Write-Log "         атрибуты: $($flags -join ', ')"
            }
        }
    }
}

# --- Итог ---
Write-Log ""
Write-Log "============================================================"
Write-Log "ГОТОВО"
Write-Log "Создано/проверено таблиц: $($tableMap.Count)"
Write-Log "Простых типов колонок:    $($typeMap.Count)"
Write-Log "Ссылочных типов:          $($refMap.Count)"
Write-Log "============================================================"
Write-Log "Соответствие id таблиц (метаданные -> база):"
foreach ($k in ($tableMap.Keys | Sort-Object { [int]$_ })) {
    Write-Log "   $k ($($tableName[$k])) -> $($tableMap[$k])"
}
Write-Log ""
Write-Log "Лог сохранён в: $LogPath"
