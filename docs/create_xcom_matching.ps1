# Установщик партнёрского шаблона «Сопоставление каталогов» (#4816/#4818).
# PowerShell 7: схема, отчёты, сид конфига, роли/гранты/меню и per-db ассеты.
[CmdletBinding()]
param(
    [string]$Token,
    [string]$XsrfToken,
    [string]$BaseUrl = "https://ideav.ru",
    [string]$DbName = "xcom",
    [string]$MetadataPath = (Join-Path $PSScriptRoot "xcom_metadata.json"),
    [string]$ReportsPath = (Join-Path $PSScriptRoot "xcom_reports.json"),
    [string]$ConfigPath = (Join-Path $PSScriptRoot "xcom_matching_config.default.json"),
    [string]$ManifestPath = (Join-Path (Split-Path $PSScriptRoot -Parent) "templates/xcom/manifest.json"),
    [string]$LogPath = "create_xcom_matching_log.txt",
    [switch]$SkipSchema,
    [switch]$SkipAssets,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$script:Sequence = 800000
$script:AuthToken = $Token
$script:Xsrf = $XsrfToken
$script:RootPath = Split-Path $PSScriptRoot -Parent
$script:PublishedDirs = [System.Collections.Generic.HashSet[string]]::new()

function Write-XcomLog {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
    Write-Host $line
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Get-XcomEnv {
    param([string]$Name)
    foreach ($target in @([EnvironmentVariableTarget]::Process, [EnvironmentVariableTarget]::User, [EnvironmentVariableTarget]::Machine)) {
        try { $value = [Environment]::GetEnvironmentVariable($Name, $target) } catch { continue }
        if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
    }
    return ""
}

function Invoke-XcomApi {
    param(
        [Parameter(Mandatory = $true)][string]$Endpoint,
        [ValidateSet("GET", "POST")][string]$Method = "POST",
        [hashtable]$Form = @{},
        [switch]$AllowFailure
    )
    if ($DryRun) {
        $script:Sequence++
        Write-XcomLog "DRY-RUN $Method /$DbName/$Endpoint $($Form | ConvertTo-Json -Compress)"
        if ($Endpoint -like "_m_new/*") { return [pscustomobject]@{ id = [string]$script:Sequence; obj = [string]$script:Sequence } }
        return @()
    }
    $uri = "$($BaseUrl.TrimEnd('/'))/$DbName/$Endpoint"
    $headers = @{ "X-Authorization" = $script:AuthToken; Cookie = "idb_$DbName=$($script:AuthToken)" }
    try {
        if ($Method -eq "GET") { return Invoke-RestMethod -Uri $uri -Method Get -Headers $headers }
        $body = @{} + $Form
        $body["token"] = $script:AuthToken
        $body["_xsrf"] = $script:Xsrf
        return Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body -ContentType "application/x-www-form-urlencoded"
    } catch {
        if ($AllowFailure) { Write-XcomLog "WARN $Method ${Endpoint}: $($_.Exception.Message)"; return $null }
        throw
    }
}

function Initialize-XcomSession {
    if ($DryRun) {
        if ([string]::IsNullOrWhiteSpace($script:AuthToken)) { $script:AuthToken = "dry-run-token" }
        if ([string]::IsNullOrWhiteSpace($script:Xsrf)) { $script:Xsrf = "dry-run-xsrf" }
        return
    }
    if ([string]::IsNullOrWhiteSpace($script:AuthToken)) { $script:AuthToken = Get-XcomEnv "INTEGRAM_TOKEN" }
    if ([string]::IsNullOrWhiteSpace($script:Xsrf)) { $script:Xsrf = Get-XcomEnv "INTEGRAM_XSRF" }
    if ([string]::IsNullOrWhiteSpace($script:AuthToken)) { throw "Передайте -Token или INTEGRAM_TOKEN" }
    if ([string]::IsNullOrWhiteSpace($script:Xsrf)) {
        $headers = @{ "X-Authorization" = $script:AuthToken; Cookie = "idb_$DbName=$($script:AuthToken)" }
        $answer = Invoke-RestMethod -Uri "$($BaseUrl.TrimEnd('/'))/$DbName/xsrf?JSON=1" -Headers $headers
        $script:Xsrf = [string]$answer._xsrf
    }
    if ([string]::IsNullOrWhiteSpace($script:Xsrf)) { throw "Не удалось получить XSRF" }
}

function Read-XcomJson {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { throw "Файл не найден: $Path" }
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Normalize-XcomName { param([object]$Value) return ([string]$Value).Trim().ToLowerInvariant() }

function Find-XcomTable {
    param([object[]]$Metadata, [string]$Name)
    $key = Normalize-XcomName $Name
    return @($Metadata | Where-Object { (Normalize-XcomName $_.val) -eq $key }) | Select-Object -First 1
}

function Find-XcomFieldId {
    param([object[]]$Metadata, [string]$TableName, [string]$FieldName)
    $table = Find-XcomTable $Metadata $TableName
    if (-not $table) { throw "Таблица '$TableName' не найдена" }
    if ($FieldName -eq '$id') { return [string]$table.id }
    $key = Normalize-XcomName $FieldName
    $req = @($table.reqs | Where-Object { (Normalize-XcomName $_.val) -eq $key }) | Select-Object -First 1
    if (-not $req) { throw "Поле '$TableName.$FieldName' не найдено" }
    return [string]$req.id
}

function Get-XcomRows {
    param([string]$TableId, [string]$Extra = "")
    if ($DryRun) { return @() }
    return @(Invoke-XcomApi -Endpoint "object/$TableId/?JSON_OBJ&LIMIT=0,10000$Extra" -Method GET)
}

function Find-XcomRecord {
    param([object[]]$Rows, [string]$MainValue)
    $key = Normalize-XcomName $MainValue
    return @($Rows | Where-Object { $_.r -and (Normalize-XcomName $_.r[0]) -eq $key }) | Select-Object -First 1
}

function Find-XcomRecordByAnyValue {
    param([object[]]$Rows, [string]$Value)
    $key = Normalize-XcomName $Value
    return @($Rows | Where-Object {
        $found = $false
        foreach ($cell in @($_.r)) { if ((Normalize-XcomName $cell) -eq $key) { $found = $true; break } }
        $found
    }) | Select-Object -First 1
}

function Ensure-XcomRecord {
    param([string]$TableId, [string]$MainValue, [hashtable]$Fields, [object[]]$ExistingRows, [switch]$UpdateExisting)
    $existing = Find-XcomRecord $ExistingRows $MainValue
    $form = @{} + $Fields
    if ($existing) {
        if ($UpdateExisting -and $form.Count -gt 0) { Invoke-XcomApi -Endpoint "_m_set/$($existing.i)?JSON=1" -Form $form | Out-Null }
        return [string]$existing.i
    }
    $form["up"] = "1"
    $form["t$TableId"] = $MainValue
    $answer = Invoke-XcomApi -Endpoint "_m_new/${TableId}?JSON=1" -Form $form
    return [string]($answer.id ?? $answer.obj)
}

function Resolve-XcomFunctionId {
    param([string]$Name)
    if ($DryRun) {
        Write-XcomLog "DRY-RUN функция '$Name' будет найдена через справочник t104"
        return "resolve:$Name"
    }
    $encoded = [Uri]::EscapeDataString($Name)
    $answer = Invoke-XcomApi -Endpoint "_ref_reqs/104?JSON&LIMIT=80&q=$encoded" -Method GET
    # Ручка отдаёт словарь {"<id>":"<имя>"}; массив объектов приходит от других ручек.
    foreach ($property in @($answer.PSObject.Properties)) {
        if ((Normalize-XcomName $property.Value) -eq (Normalize-XcomName $Name)) { return [string]$property.Name }
    }
    foreach ($option in @($answer)) {
        $id = [string]($option.i ?? $option.id ?? $option.obj)
        $labels = @($option.label, $option.val, $option.name)
        if ($option.r) { $labels += @($option.r) }
        foreach ($label in $labels) {
            if ((Normalize-XcomName $label) -eq (Normalize-XcomName $Name) -and -not [string]::IsNullOrWhiteSpace($id)) {
                return $id
            }
        }
    }
    # Справочник функций — данные базы, а не версия ядра: в базе, созданной при
    # регистрации, есть стандартные 20 функций, а нужной шаблону может не быть.
    $created = Invoke-XcomApi -Endpoint "_m_new/63?JSON=1" -Form @{ up = "1"; t63 = $Name }
    $id = [string]($created.id ?? $created.obj)
    if ([string]::IsNullOrWhiteSpace($id)) { throw "Не удалось завести функцию отчёта '$Name' в справочнике (t63)" }
    Write-XcomLog "Функция '$Name' добавлена в справочник: $id"
    return $id
}

function Get-XcomReportSpec {
    param([object]$Spec, [object[]]$AllSpecs)
    if (-not $Spec.inherits) { return $Spec }
    $base = @($AllSpecs | Where-Object { $_.name -eq $Spec.inherits }) | Select-Object -First 1
    if (-not $base) { throw "Базовый отчёт '$($Spec.inherits)' не найден" }
    return [pscustomobject]@{
        name = $Spec.name
        master = $base.master
        description = $Spec.description
        limit = $base.limit
        joins = $base.joins
        columns = $base.columns
    }
}

function Ensure-XcomReport {
    param([object]$Spec, [object[]]$AllSpecs, [object[]]$Metadata, [object[]]$ExistingQueries)
    $resolved = Get-XcomReportSpec $Spec $AllSpecs
    $query = Find-XcomRecord $ExistingQueries $resolved.name
    if ($query) { $queryId = [string]$query.i; Write-XcomLog "Отчёт '$($resolved.name)' уже есть: $queryId" }
    else {
        $answer = Invoke-XcomApi -Endpoint "_m_new/22?JSON=1" -Form @{ up = "1"; t22 = [string]$resolved.name }
        $queryId = [string]($answer.id ?? $answer.obj)
        Write-XcomLog "Создан отчёт '$($resolved.name)': $queryId"
    }
    if ($resolved.limit) { Invoke-XcomApi -Endpoint "_m_set/${queryId}?JSON=1" -Form @{ t134 = [string]$resolved.limit } | Out-Null }
    $existingColumns = Get-XcomRows "28" "&F_U=$queryId"
    foreach ($column in @($resolved.columns)) {
        $existingColumn = Find-XcomRecordByAnyValue $existingColumns ([string]$column.name)
        if ($existingColumn) { $columnId = [string]$existingColumn.i }
        else {
            # Вычисляемая колонка не привязана к реквизиту: источник — 0, всё в формуле.
            $sourceId = if ($column.computed -eq $true) { "0" } else { Find-XcomFieldId $Metadata ([string]$column.source) ([string]$column.field) }
            $form = @{ up = $queryId; t28 = $sourceId; t100 = [string]$column.name }
            $created = Invoke-XcomApi -Endpoint "_m_new/28?JSON=1" -Form $form
            $columnId = [string]($created.id ?? $created.obj)
        }
        $update = @{}
        if ($column.function) { $update["t104"] = Resolve-XcomFunctionId ([string]$column.function) }
        if ($column.formula) { $update["t101"] = [string]$column.formula }
        if ($column.sort) { $update["t109"] = [string]$column.sort }
        if ($column.hidden -eq $true) { $update["t107"] = "X" }
        if ($update.Count) { Invoke-XcomApi -Endpoint "_m_set/${columnId}?JSON=1" -Form $update | Out-Null }
    }
    if ($resolved.joins) {
        foreach ($join in @($resolved.joins)) {
            if (Find-XcomRecordByAnyValue (Get-XcomRows "44" "&F_U=$queryId") ([string]$join.alias)) { continue }
            $joinTable = Find-XcomTable $Metadata ([string]$join.table)
            if (-not $joinTable) { throw "JOIN-таблица '$($join.table)' не найдена" }
            Invoke-XcomApi -Endpoint "_m_new/44?JSON=1" -Form @{ up = $queryId; t44 = [string]$joinTable.id; t265 = [string]$join.alias; t266 = [string]$join.condition } | Out-Null
        }
    }
    return $queryId
}

function Ensure-XcomRole {
    param([string]$Name, [string]$Description, [object[]]$ExistingRoles)
    $existing = Find-XcomRecord $ExistingRoles $Name
    if ($existing) { return [string]$existing.i }
    $answer = Invoke-XcomApi -Endpoint "_m_new/42?JSON=1" -Form @{ up = "1"; t42 = $Name; t135 = $Description }
    return [string]($answer.id ?? $answer.obj)
}

function Ensure-XcomGrant {
    param([string]$RoleId, [string]$ObjectId, [string]$Level)
    $existing = Get-XcomRows "116" "&F_U=$RoleId&F_116=$ObjectId"
    if ($existing.Count -gt 0) { return }
    $levelId = if ($Level -eq "WRITE") { "54" } else { "53" }
    Invoke-XcomApi -Endpoint "_m_new/116?JSON=1" -Form @{ up = $RoleId; t116 = $ObjectId; t136 = $levelId } | Out-Null
}

function Ensure-XcomMenu {
    param([string]$RoleId, [string]$Action)
    $names = @{ wizard = "Первичная настройка"; settings = "Настройки сопоставления"; matching = "Ручное сопоставление"; mass_match = "Массовый подбор"; export = "Выгрузка результата" }
    $rows = Get-XcomRows "151" "&F_U=$RoleId"
    if (Find-XcomRecord $rows $names[$Action]) { return }
    Invoke-XcomApi -Endpoint "_m_new/151?JSON=1" -Form @{ up = $RoleId; t151 = $names[$Action]; t153 = $Action } | Out-Null
}

function Publish-XcomAsset {
    param([string]$RelativePath)
    $source = Join-Path $script:RootPath ($RelativePath -replace '/', [IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $source)) { throw "Ассет не найден: $RelativePath" }
    if ($DryRun) { Write-XcomLog "DRY-RUN upload $RelativePath"; return }
    $isTemplate = $RelativePath.StartsWith("templates/xcom/")
    $leafDir = Split-Path (Split-Path $RelativePath -Parent) -Leaf
    $addPath = if ($isTemplate) { "/" } else { "/$leafDir" }
    $headers = @{ "X-Authorization" = $script:AuthToken; Cookie = "idb_$DbName=$($script:AuthToken)" }
    $uri = "$($BaseUrl.TrimEnd('/'))/$DbName/dir_admin/"
    # Отсутствующий подкаталог файловый менеджер не создаёт: он молча кладёт файл
    # в корень, а рабочие места ссылаются на /js и /css — и грузятся без скриптов.
    if (-not $isTemplate -and -not $script:PublishedDirs.Contains($leafDir)) {
        $folder = @{ add_path = "/"; dir_name = $leafDir; mkdir = "1"; download = "1"; _xsrf = $script:Xsrf; token = $script:AuthToken }
        Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Form $folder | Out-Null
        $script:PublishedDirs.Add($leafDir) | Out-Null
    }
    $form = @{ add_path = $addPath; upload = "Загрузить"; rewrite = "1"; _xsrf = $script:Xsrf; token = $script:AuthToken; userfile = Get-Item -LiteralPath $source }
    if ($isTemplate) { $form["templates"] = "1" } else { $form["download"] = "1" }
    Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Form $form | Out-Null
}

if (Test-Path -LiteralPath $LogPath) { Clear-Content -LiteralPath $LogPath }
$metadataSource = @(Read-XcomJson $MetadataPath)
$reportSpecs = @(Read-XcomJson $ReportsPath)
$defaultConfig = Read-XcomJson $ConfigPath
$manifest = Read-XcomJson $ManifestPath

Write-XcomLog "Шаблон '$($manifest.name)' v$($manifest.version), база $DbName"
Initialize-XcomSession

if (-not $SkipSchema) {
    $schemaInstaller = Join-Path $PSScriptRoot "create_db_from_scratch.ps1"
    $schemaArgs = @{ BaseUrl = $BaseUrl; DbName = $DbName; MetadataPath = $MetadataPath; Token = $script:AuthToken; XsrfToken = $script:Xsrf; LogPath = "$LogPath.schema" }
    if ($DryRun) { $schemaArgs["DryRun"] = $true }
    & $schemaInstaller @schemaArgs
}

$metadata = if ($DryRun) { $metadataSource } else { @(Invoke-XcomApi -Endpoint "metadata?JSON=1" -Method GET) }
$queries = Get-XcomRows "22"
$queryIds = @()
foreach ($spec in $reportSpecs) { $queryIds += Ensure-XcomReport $spec $reportSpecs $metadata $queries }

$settingsTable = Find-XcomTable $metadata "Настройка сопоставления"
$settingsValue = Find-XcomFieldId $metadata "Настройка сопоставления" "Значение"
$settingsRows = Get-XcomRows ([string]$settingsTable.id)
$seedFields = @{}
$seedFields["t$settingsValue"] = $defaultConfig | ConvertTo-Json -Depth 20 -Compress
Ensure-XcomRecord ([string]$settingsTable.id) "config" $seedFields $settingsRows | Out-Null
Write-XcomLog "Сид конфига установлен"

$roles = Get-XcomRows "42"
# Только таблицы шаблона: `metadata` — это ВСЯ база, и при установке к клиенту
# роли иначе получают права на пользователей, роли, гранты и чужие данные.
$templateTables = @()
foreach ($source in @($metadataSource)) {
    $installed = Find-XcomTable $metadata ([string]$source.val)
    if ($installed) { $templateTables += [string]$installed.id }
}
$businessTables = $templateTables + @("269")
foreach ($roleSpec in @($manifest.roles)) {
    $roleId = Ensure-XcomRole ([string]$roleSpec.name) ([string]$roleSpec.description) $roles
    foreach ($objectId in @($businessTables + $queryIds)) { Ensure-XcomGrant $roleId $objectId ([string]$roleSpec.grant) }
    foreach ($action in @($roleSpec.menus)) { Ensure-XcomMenu $roleId ([string]$action) }
    Write-XcomLog "Роль '$($roleSpec.name)' настроена"
}

if (-not $SkipAssets) {
    foreach ($asset in @($manifest.assets)) { Publish-XcomAsset ([string]$asset) }
    Write-XcomLog "Ассеты опубликованы: $(@($manifest.assets).Count)"
}

Write-XcomLog "Готово. Повторный запуск идемпотентен; мастер: $BaseUrl/$DbName/wizard"
