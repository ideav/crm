# ============================================================================
# Создание пунктов меню atex для тестовых пользователей (PowerShell, Windows 11)
# ============================================================================
#
# Продолжение docs/create_roles_users.ps1: роли и тестовые пользователи atex
# уже созданы в системных таблицах Роль (42) и Пользователь (18). Этот скрипт
# создаёт видимые пункты меню для этих ролей в системной таблице Меню (151).
#
# Пункты меню — это дочерние записи роли: _m_new/151 с up=<role_id>.
# Системные id таблицы и колонок Интеграм:
#   Роль (42): t42 = название роли
#   Меню (151): t151 = название пункта, t153 = href, t391 = иконка, t158 = параметры
#
# Idempotency: перед созданием скрипт читает object/42 и object/151, ищет пункт
# меню по паре (parent up, name), создаёт отсутствующие пункты и обновляет href /
# icon / params у уже существующих. Повторный прогон не создаёт дубли.
#
# Запуск (PowerShell 5.1+ / PowerShell 7, Windows 11):
#   .\create_atex_menu.ps1 -BaseUrl https://ideav.ru -DbName atex `
#       -Token "***"
#
# Токен можно передать параметром -Token или переменной INTEGRAM_TOKEN
# в scope Process/User/Machine.
#
# Предварительный прогон без обращения к серверу (показывает план вызовов):
#   .\create_atex_menu.ps1 -DryRun
# ============================================================================

param(
    [string]$Token,
    [string]$XsrfToken,
    [string]$BaseUrl = "https://ideav.ru",
    [string]$DbName = "atex",
    [string]$DataPath = (Join-Path $PSScriptRoot "atex_menu.json"),
    [string]$LogPath = "create_atex_menu_log.txt",
    [string]$RoleTableId = "42",
    [string]$MenuTableId = "151",
    [string]$MenuHrefField = "153",
    [string]$MenuIconField = "391",
    [string]$MenuParamsField = "158",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Get-IntegramEnvironmentValue {
    param([Parameter(Mandatory = $true)][string]$Name)

    foreach ($target in @(
        [System.EnvironmentVariableTarget]::Process,
        [System.EnvironmentVariableTarget]::User,
        [System.EnvironmentVariableTarget]::Machine
    )) {
        try {
            $value = [Environment]::GetEnvironmentVariable($Name, $target)
        } catch {
            continue
        }
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            return $value
        }
    }
    return ""
}

if ([string]::IsNullOrWhiteSpace($Token)) {
    $Token = Get-IntegramEnvironmentValue -Name "INTEGRAM_TOKEN"
}
if ([string]::IsNullOrWhiteSpace($XsrfToken)) {
    $XsrfToken = Get-IntegramEnvironmentValue -Name "INTEGRAM_XSRF"
}

function Write-Log {
    param([string]$Message)

    $timestamp = Get-Date -Format "dd/MM/yyyy HH:mm:ss"
    Add-Content -Path $LogPath -Value "$timestamp $Message"
    Write-Host $Message
}

function Get-JsonProperty {
    param(
        $Object,
        [Parameter(Mandatory = $true)][string]$Name
    )
    if ($null -eq $Object) { return $null }
    $prop = $Object.PSObject.Properties[$Name]
    if ($prop) { return $prop.Value }
    return $null
}

function Normalize-Key {
    param([string]$Value)
    if ($null -eq $Value) { return "" }
    return $Value.Trim().ToLowerInvariant()
}

function Invoke-ApiRequest {
    param(
        [Parameter(Mandatory = $true)][string]$Endpoint,
        [ValidateSet("GET", "POST")][string]$Method = "POST",
        [hashtable]$FormData = @{},
        [switch]$Anonymous,
        [string[]]$SensitiveKeys = @(),
        [switch]$IgnoreHttpError
    )

    $url = "$BaseUrl/$DbName/$Endpoint"
    if ($url -notmatch "\?") {
        $url = "$url`?JSON=1"
    } elseif ($url -notmatch "(^|[?&])JSON=" -and $url -notmatch "(^|[?&])JSON_DATA=" -and $url -notmatch "(^|[?&])JSON_KV=" -and $url -notmatch "(^|[?&])JSON_OBJ") {
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
            Sort-Object Name | ForEach-Object {
                $v = if ($SensitiveKeys -contains $_.Key) { "***" } else { $_.Value }
                "$($_.Key)=$v"
            }) -join "; "
        Write-Log "  $Method $Endpoint  [$bodyString]"
    } else {
        Write-Log "  $Method $Endpoint"
    }

    if ($DryRun) {
        return (New-DryRunResponse -Endpoint $Endpoint)
    }

    try {
        if ($Method -eq "POST") {
            return Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType "application/x-www-form-urlencoded" -Headers $headers
        }
        return Invoke-RestMethod -Uri $url -Method Get -Body $body -Headers $headers
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
        throw "Передайте -Token или задайте INTEGRAM_TOKEN в scope Process/User/Machine. POST /auth с логином и паролем в этом сценарии не используется."
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

$script:DryRunSeq = 3000
function New-DryRunResponse {
    param([string]$Endpoint)
    $script:DryRunSeq++
    if ($Endpoint -eq "xsrf") {
        return [pscustomobject]@{ token = "dryrun-token"; _xsrf = "dryrun-xsrf"; id = "1" }
    }
    if ($Endpoint -like "object/*") {
        return [pscustomobject]@{ object = @(); reqs = [pscustomobject]@{} }
    }
    return [pscustomobject]@{ obj = "$script:DryRunSeq" }
}

function Get-ExistingRoles {
    $map = @{}
    if ($DryRun) {
        $seq = 4100
        foreach ($roleBlock in $script:MenuData.roles) {
            $seq++
            $name = [string]$roleBlock.role
            $map[(Normalize-Key $name)] = [string]$seq
        }
        return $map
    }

    $resp = Invoke-ApiRequest -Endpoint "object/$RoleTableId" -Method GET
    if (-not $resp -or -not (Get-JsonProperty -Object $resp -Name "object")) {
        return $map
    }
    foreach ($rec in @($resp.object)) {
        if ($null -eq $rec.val) { continue }
        $key = Normalize-Key ([string]$rec.val)
        if ($key -ne "" -and -not $map.ContainsKey($key)) {
            $map[$key] = [string]$rec.id
        }
    }
    return $map
}

function Get-RequisiteValue {
    param(
        $Reqs,
        [Parameter(Mandatory = $true)][string]$FieldId
    )
    $node = Get-JsonProperty -Object $Reqs -Name $FieldId
    if ($null -eq $node) { return "" }
    $value = Get-JsonProperty -Object $node -Name "value"
    if ($null -eq $value) { return "" }
    return [string]$value
}

function Add-MenuRecordToIndex {
    param(
        [Parameter(Mandatory = $true)]$Record
    )
    $parentId = [string]$Record.up
    if (-not $script:MenusByParent.ContainsKey($parentId)) {
        $script:MenusByParent[$parentId] = @()
    }
    $script:MenusByParent[$parentId] = @($script:MenusByParent[$parentId]) + $Record
}

function Load-ExistingMenus {
    $script:MenusByParent = @{}
    $resp = Invoke-ApiRequest -Endpoint "object/$MenuTableId" -Method GET
    if (-not $resp -or -not (Get-JsonProperty -Object $resp -Name "object")) {
        return
    }

    foreach ($rec in @($resp.object)) {
        $reqsForRecord = $null
        $allReqs = Get-JsonProperty -Object $resp -Name "reqs"
        if ($allReqs) {
            $reqsForRecord = Get-JsonProperty -Object $allReqs -Name ([string]$rec.id)
        }
        $record = [pscustomobject]@{
            id     = [string]$rec.id
            up     = [string]$rec.up
            name   = [string]$rec.val
            href   = Get-RequisiteValue -Reqs $reqsForRecord -FieldId $MenuHrefField
            icon   = Get-RequisiteValue -Reqs $reqsForRecord -FieldId $MenuIconField
            params = Get-RequisiteValue -Reqs $reqsForRecord -FieldId $MenuParamsField
        }
        Add-MenuRecordToIndex -Record $record
    }
}

function Find-MenuRecord {
    param(
        [Parameter(Mandatory = $true)][string]$ParentId,
        [Parameter(Mandatory = $true)][string]$Name
    )
    if (-not $script:MenusByParent.ContainsKey($ParentId)) { return $null }
    $key = Normalize-Key $Name
    foreach ($record in @($script:MenusByParent[$ParentId])) {
        if ((Normalize-Key ([string]$record.name)) -eq $key) {
            return $record
        }
    }
    return $null
}

function New-IntegramRecord {
    param(
        [Parameter(Mandatory = $true)][string]$TableId,
        [Parameter(Mandatory = $true)][string]$ParentId,
        [Parameter(Mandatory = $true)][hashtable]$Fields
    )
    $form = @{ up = $ParentId }
    foreach ($k in $Fields.Keys) { $form[$k] = $Fields[$k] }
    $response = Invoke-ApiRequest -Endpoint "_m_new/$TableId" -FormData $form
    if (-not $response -or -not $response.obj) {
        throw "Не удалось создать запись в таблице '$TableId'"
    }
    return [string]$response.obj
}

function Set-IntegramRecord {
    param(
        [Parameter(Mandatory = $true)][string]$RecordId,
        [Parameter(Mandatory = $true)][hashtable]$Fields
    )
    Invoke-ApiRequest -Endpoint "_m_set/$RecordId" -FormData $Fields | Out-Null
}

function Ensure-MenuItem {
    param(
        [Parameter(Mandatory = $true)]$Item,
        [Parameter(Mandatory = $true)][string]$ParentId
    )

    $name = [string]$Item.name
    if ([string]::IsNullOrWhiteSpace($name)) {
        throw "В $DataPath найден пункт меню без name"
    }
    $href = ""
    if ($Item.PSObject.Properties["href"]) { $href = [string]$Item.href }
    $icon = ""
    if ($Item.PSObject.Properties["icon"]) { $icon = [string]$Item.icon }
    $params = ""
    if ($Item.PSObject.Properties["params"]) { $params = [string]$Item.params }

    $fields = @{
        "t$MenuTableId"     = $name
        "t$MenuHrefField"   = $href
        "t$MenuIconField"   = $icon
        "t$MenuParamsField" = $params
    }

    $existing = Find-MenuRecord -ParentId $ParentId -Name $name
    if ($existing) {
        $needsUpdate = $false
        if ([string]$existing.href -ne $href) { $needsUpdate = $true }
        if ([string]$existing.icon -ne $icon) { $needsUpdate = $true }
        if ([string]$existing.params -ne $params) { $needsUpdate = $true }

        if ($needsUpdate) {
            Set-IntegramRecord -RecordId ([string]$existing.id) -Fields $fields
            $script:Updated++
            $existing.href = $href
            $existing.icon = $icon
            $existing.params = $params
            Write-Log "   OK обновлён пункт '$name' (id $($existing.id), up $ParentId)"
        } else {
            $script:Skipped++
            Write-Log "   .. пункт '$name' уже существует (id $($existing.id), up $ParentId), пропуск"
        }
        return [string]$existing.id
    }

    $id = New-IntegramRecord -TableId $MenuTableId -ParentId $ParentId -Fields $fields
    $record = [pscustomobject]@{
        id     = $id
        up     = $ParentId
        name   = $name
        href   = $href
        icon   = $icon
        params = $params
    }
    Add-MenuRecordToIndex -Record $record
    $script:Created++
    Write-Log "   OK пункт '$name' -> '$href' (id $id, up $ParentId)"
    return $id
}

Remove-Item -Path $LogPath -ErrorAction SilentlyContinue

$script:AuthToken = $null
$script:XsrfToken = $null
$script:MenusByParent = @{}
$script:Created = 0
$script:Updated = 0
$script:Skipped = 0

Write-Log "============================================================"
Write-Log "Создание пунктов меню atex"
Write-Log "База:   $BaseUrl/$DbName"
Write-Log "Данные: $DataPath"
if ($DryRun) { Write-Log "Режим:  DRY-RUN (без обращения к серверу)" }
Write-Log "============================================================"

if (-not (Test-Path $DataPath)) {
    throw "Файл данных не найден: $DataPath"
}
$rawJson = Get-Content -Path $DataPath -Raw -Encoding UTF8
$script:MenuData = $rawJson | ConvertFrom-Json
if (-not $script:MenuData) { throw "Не удалось разобрать данные из $DataPath" }
$roleBlocks = @($script:MenuData.roles)
if ($roleBlocks.Count -eq 0) { throw "В $DataPath нет массива roles" }
$menuCount = 0
foreach ($roleBlock in $roleBlocks) { $menuCount += @($roleBlock.menus).Count }
Write-Log ""
Write-Log "Загружено ролей: $($roleBlocks.Count), пунктов меню: $menuCount"

Write-Log ""
Initialize-TokenSession

Write-Log ""
Write-Log "2. Чтение ролей (таблица $RoleTableId)..."
$roleIdByName = Get-ExistingRoles
Write-Log "   Найдено ролей: $($roleIdByName.Count)"

Write-Log ""
Write-Log "3. Чтение существующего меню (таблица $MenuTableId)..."
Load-ExistingMenus
$existingMenuCount = 0
foreach ($parent in $script:MenusByParent.Keys) { $existingMenuCount += @($script:MenusByParent[$parent]).Count }
Write-Log "   Найдено пунктов меню: $existingMenuCount"

Write-Log ""
Write-Log "4. Создание/обновление меню по ролям..."
foreach ($roleBlock in $roleBlocks) {
    $roleName = [string]$roleBlock.role
    if ([string]::IsNullOrWhiteSpace($roleName)) {
        throw "В $DataPath найден блок роли без role"
    }
    $roleKey = Normalize-Key $roleName
    if (-not $roleIdByName.ContainsKey($roleKey)) {
        throw "Роль '$roleName' не найдена в таблице $RoleTableId. Сначала запустите docs/create_roles_users.ps1."
    }

    $roleId = $roleIdByName[$roleKey]
    $menus = @($roleBlock.menus)
    Write-Log ""
    Write-Log "   Роль '$roleName' (id $roleId), пунктов: $($menus.Count)"
    foreach ($menu in $menus) {
        Ensure-MenuItem -Item $menu -ParentId $roleId | Out-Null
    }
}

Write-Log ""
Write-Log "============================================================"
Write-Log "ГОТОВО"
Write-Log "Пунктов создано:    $script:Created"
Write-Log "Пунктов обновлено:  $script:Updated"
Write-Log "Пунктов пропущено:  $script:Skipped"
Write-Log "============================================================"
Write-Log "Лог сохранён в: $LogPath"
