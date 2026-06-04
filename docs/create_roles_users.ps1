# ============================================================================
# Создание ролей и пользователей Интеграм по спецификации (PowerShell, Windows 10)
# ============================================================================
#
# Продолжение PR #2902: схема atex (15 таблиц) уже создаётся движком
# docs/create_db_from_scratch.ps1. Этот скрипт выполняет следующие шаги той же
# дизайн-спеки atex (раздел 4, шаги 10-11 раздела 5):
#   10. Создать роли в системной таблице 42 (Роль)
#   11. Создать пользователей в системной таблице 18 (Пользователь) — по одному
#       на роль, со ссылкой на роль (поле t115).
# Спека: https://github.com/ideav/atex/blob/main/docs/superpowers/specs/2026-05-26-atex-schema-setup-design.md
#
# Роли и пользователи — это ЗАПИСИ системных таблиц (создаются через _m_new), а
# не структура. Формат метаданных (atex_metadata.json) описывает только
# структуру, поэтому роли/пользователи вынесены в отдельный файл данных
# (atex_roles_users.json) и отдельный скрипт.
#
# Системные таблицы Интеграм создаются платформой автоматически и имеют
# фиксированные id: Роль = 42, Пользователь = 18, Меню = 151. Колонки тоже
# фиксированы (см. docs/integram-app-workflow.md, раздел 5.2):
#   Роль (42):        t42 = название, t135 = описание
#   Пользователь (18):t18 = логин, t115 = роль (ref→42), t20 = пароль, t33 = имя
#
# Идемпотентность: перед созданием скрипт читает уже существующие записи
# (GET object/42 и object/18) и пропускает роль/пользователя, если запись с
# таким именем/логином уже есть. Сервер _m_new записи НЕ дедуплицирует, поэтому
# проверка обязательна, иначе повторный прогон создал бы дубли.
#
# Пункты меню (таблица 151) создаёт отдельный скрипт create_atex_menu.ps1.
# Права роли на объекты (t117) и загрузка начальных данных (шаги 12-14 спеки)
# остаются для следующих фаз.
#
# Запуск (PowerShell 5.1+ / PowerShell 7):
#   .\create_roles_users.ps1 -BaseUrl https://ideav.ru -DbName atex `
#       -Token "***"
#
# Токен можно передать параметром -Token или переменной INTEGRAM_TOKEN
# в scope Process/User/Machine.
#
# Предварительный прогон без обращения к серверу (показывает план вызовов):
#   .\create_roles_users.ps1 -DryRun
# ============================================================================

param(
    [string]$Token,
    [string]$XsrfToken,
    [string]$BaseUrl = "https://ideav.ru",
    [string]$DbName = "atex",
    [string]$DataPath = (Join-Path $PSScriptRoot "atex_roles_users.json"),
    [string]$LogPath = "create_roles_users_log.txt",
    # Id системных таблиц и их колонок. Значения по умолчанию — стандартные id
    # Интеграм; переопределяются параметрами, если в конкретной базе иные.
    [string]$RoleTableId = "42",
    [string]$RoleDescField = "135",
    [string]$UserTableId = "18",
    [string]$UserRoleField = "115",
    [string]$UserPasswordField = "20",
    [string]$UserNameField = "33",
    # Прогон без HTTP-запросов: id'шники подставляются синтетические,
    # реальные вызовы не выполняются. Удобно для проверки плана и отладки.
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
# Один вызов API. Все POST'ы несут token и _xsrf (обязателен для _m_*).
# В режиме -DryRun возвращает синтетический ответ нужной формы.
# Значения колонок-секретов (например, пароль) в логах маскируются.
# --------------------------------------------------------------------------
function Invoke-ApiRequest {
    param(
        [Parameter(Mandatory = $true)][string]$Endpoint,
        [ValidateSet("GET", "POST")][string]$Method = "POST",
        [hashtable]$FormData = @{},
        [switch]$Anonymous,
        [string[]]$SensitiveKeys = @(),
        # Не прерывать выполнение при HTTP-ошибке: вернуть тело ответа сервера
        # для анализа вызывающим кодом.
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

# Синтетические ответы для -DryRun (форма совпадает с реальным API).
$script:DryRunSeq = 2000
function New-DryRunResponse {
    param([string]$Endpoint)
    $script:DryRunSeq++
    if ($Endpoint -eq "xsrf") {
        return [pscustomobject]@{ token = "dryrun-token"; _xsrf = "dryrun-xsrf"; id = "1" }
    }
    if ($Endpoint -like "object/*") {
        # Чистая база: записей ещё нет.
        return [pscustomobject]@{ object = @() }
    }
    # _m_new — создание записи.
    return [pscustomobject]@{ obj = "$script:DryRunSeq" }
}

# --------------------------------------------------------------------------
# Чтение уже существующих записей таблицы (GET object/{tableId}?JSON=1).
# Возвращает hashtable: нормализованное (lower-case) значение первой колонки
# (val) -> id записи. Нужна для идемпотентности: _m_new не дедуплицирует.
# --------------------------------------------------------------------------
function Get-ExistingRecords {
    param([Parameter(Mandatory = $true)][string]$TableId)

    $map = @{}
    $resp = Invoke-ApiRequest -Endpoint "object/$TableId" -Method GET -IgnoreHttpError
    if (-not $resp -or -not $resp.PSObject.Properties['object'] -or -not $resp.object) {
        return $map
    }
    foreach ($rec in $resp.object) {
        if ($null -eq $rec.val) { continue }
        $key = ([string]$rec.val).Trim().ToLowerInvariant()
        if ($key -ne "" -and -not $map.ContainsKey($key)) {
            $map[$key] = [string]$rec.id
        }
    }
    return $map
}

# _m_new/{tableId} — создать запись. Возвращает id новой записи (obj).
function New-IntegramRecord {
    param(
        [Parameter(Mandatory = $true)][string]$TableId,
        [Parameter(Mandatory = $true)][hashtable]$Fields,
        [string[]]$SensitiveKeys = @()
    )
    $form = @{ up = "1" }
    foreach ($k in $Fields.Keys) { $form[$k] = $Fields[$k] }
    $response = Invoke-ApiRequest -Endpoint "_m_new/$TableId" -FormData $form -SensitiveKeys $SensitiveKeys
    if (-not $response -or -not $response.obj) {
        throw "Не удалось создать запись в таблице '$TableId'"
    }
    return [string]$response.obj
}

# ==========================================================================
# Основной сценарий
# ==========================================================================

Remove-Item -Path $LogPath -ErrorAction SilentlyContinue

$script:AuthToken = $null
$script:XsrfToken = $null

Write-Log "============================================================"
Write-Log "Создание ролей и пользователей Интеграм"
Write-Log "База:   $BaseUrl/$DbName"
Write-Log "Данные: $DataPath"
if ($DryRun) { Write-Log "Режим:  DRY-RUN (без обращения к серверу)" }
Write-Log "============================================================"

# --- Загрузка данных ---
if (-not (Test-Path $DataPath)) {
    throw "Файл данных не найден: $DataPath"
}
$rawJson = Get-Content -Path $DataPath -Raw -Encoding UTF8
$data = $rawJson | ConvertFrom-Json
if (-not $data) { throw "Не удалось разобрать данные из $DataPath" }
$roles = @($data.roles)
$users = @($data.users)
Write-Log ""
Write-Log "Загружено ролей: $($roles.Count), пользователей: $($users.Count)"

# --- Подключение по токену ---
Write-Log ""
Initialize-TokenSession

# --- Этап 1. Роли (таблица 42) ---
Write-Log ""
Write-Log "2. Создание ролей (таблица $RoleTableId)..."
$existingRoles = Get-ExistingRecords -TableId $RoleTableId
Write-Log "   Уже существует ролей: $($existingRoles.Count)"

# name (как в данных) -> id роли в базе. Заполняется и существующими, и новыми.
$roleIdByName = @{}
foreach ($k in $existingRoles.Keys) { $roleIdByName[$k] = $existingRoles[$k] }

$rolesCreated = 0
foreach ($role in $roles) {
    $name = [string]$role.name
    $key = $name.Trim().ToLowerInvariant()
    if ($roleIdByName.ContainsKey($key)) {
        Write-Log "   .. роль '$name' уже существует (id $($roleIdByName[$key])), пропуск"
        continue
    }
    $fields = @{ "t$RoleTableId" = $name }
    if ($role.PSObject.Properties['description'] -and $role.description) {
        $fields["t$RoleDescField"] = [string]$role.description
    }
    $id = New-IntegramRecord -TableId $RoleTableId -Fields $fields
    $roleIdByName[$key] = $id
    $rolesCreated++
    Write-Log "   OK роль '$name' -> id $id"
}

# --- Этап 2. Пользователи (таблица 18) ---
Write-Log ""
Write-Log "3. Создание пользователей (таблица $UserTableId)..."
$existingUsers = Get-ExistingRecords -TableId $UserTableId
Write-Log "   Уже существует пользователей: $($existingUsers.Count)"

$usersCreated = 0
foreach ($user in $users) {
    $login = [string]$user.login
    $key = $login.Trim().ToLowerInvariant()
    if ($existingUsers.ContainsKey($key)) {
        Write-Log "   .. пользователь '$login' уже существует (id $($existingUsers[$key])), пропуск"
        continue
    }
    $roleName = [string]$user.role
    $roleKey = $roleName.Trim().ToLowerInvariant()
    if (-not $roleIdByName.ContainsKey($roleKey)) {
        throw "Пользователь '$login' ссылается на неизвестную роль '$roleName' (роль не создана и не найдена в базе)"
    }
    $roleId = $roleIdByName[$roleKey]

    $fields = @{
        "t$UserTableId"  = $login
        "t$UserRoleField" = $roleId
    }
    if ($user.PSObject.Properties['password'] -and $user.password) {
        $fields["t$UserPasswordField"] = [string]$user.password
    }
    if ($user.PSObject.Properties['name'] -and $user.name) {
        $fields["t$UserNameField"] = [string]$user.name
    }
    $id = New-IntegramRecord -TableId $UserTableId -Fields $fields -SensitiveKeys @("t$UserPasswordField")
    $existingUsers[$key] = $id
    $usersCreated++
    Write-Log "   OK пользователь '$login' (роль '$roleName' -> id $roleId) -> id $id"
}

# --- Итог ---
Write-Log ""
Write-Log "============================================================"
Write-Log "ГОТОВО"
Write-Log "Ролей создано:          $rolesCreated (всего в базе: $($roleIdByName.Count))"
Write-Log "Пользователей создано:  $usersCreated (всего проверено: $($users.Count))"
Write-Log "============================================================"
Write-Log "Лог сохранён в: $LogPath"
