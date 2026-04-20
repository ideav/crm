# ============================================
# Скрипт создания структуры "Перелидоз" в Интеграме
# ============================================

param(
    [string]$Login = "api",
    [string]$Password = "",
    [string]$BaseUrl = "https://ideav.ru",
    [string]$DbName = "perelidoz",
    [string]$LogPath = "api_log.txt",
    [switch]$SkipSeedData
)

$ErrorActionPreference = "Stop"

function Write-Log {
    param([string]$Message)

    $timestamp = Get-Date -Format "dd/MM/yyyy HH:mm:ss"
    Add-Content -Path $LogPath -Value "$timestamp $Message"
    Write-Host $Message
}

function Invoke-ApiRequest {
    param(
        [Parameter(Mandatory = $true)][string]$Endpoint,
        [ValidateSet("GET", "POST")][string]$Method = "POST",
        [hashtable]$FormData = @{},
        [string]$AuthToken = $script:AuthToken,
        [string]$XsrfToken = $script:XsrfToken
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

    if ($XsrfToken) {
        $body["_xsrf"] = $XsrfToken
    }
    if ($AuthToken) {
        $body["token"] = $AuthToken
    }

    Write-Log "Request: $Method $url"
    if ($body.Count -gt 0) {
        $bodyString = ($body.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "; "
        Write-Log "Body: $bodyString"
    }

    try {
        if ($Method -eq "POST") {
            $response = Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType "application/x-www-form-urlencoded"
        } else {
            $response = Invoke-RestMethod -Uri $url -Method Get -Body $body
        }
        Write-Log "Response: $($response | ConvertTo-Json -Compress -Depth 20)"
        return $response
    } catch {
        Write-Log "ERROR: $($_.Exception.Message)"
        if ($_.Exception.Response) {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $reader.BaseStream.Position = 0
            $reader.DiscardBufferedData()
            Write-Log "Response Body: $($reader.ReadToEnd())"
        }
        throw
    }
}

function New-IntegramType {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$BaseTypeId
    )

    $response = Invoke-ApiRequest -Endpoint "_d_new" -FormData @{ t = $BaseTypeId; val = $Name }
    if (-not $response -or -not $response.obj) {
        throw "Не удалось создать тип '$Name'"
    }
    return [string]$response.obj
}

function Add-IntegramRequisite {
    param(
        [Parameter(Mandatory = $true)][string]$TableId,
        [Parameter(Mandatory = $true)][string]$TypeId,
        [string]$Alias
    )

    $response = Invoke-ApiRequest -Endpoint "_d_req/$TableId" -FormData @{ t = $TypeId }
    if (-not $response -or -not $response.id) {
        throw "Не удалось добавить реквизит '$TypeId' в таблицу '$TableId'"
    }

    $requisiteId = [string]$response.id
    if ($Alias) {
        Invoke-ApiRequest -Endpoint "_d_alias/$requisiteId" -FormData @{ val = $Alias } | Out-Null
    }
    return $requisiteId
}

function New-IntegramReferenceType {
    param(
        [Parameter(Mandatory = $true)][string]$TargetTableId
    )

    $response = Invoke-ApiRequest -Endpoint "_d_ref/$TargetTableId" -FormData @{}
    if (-not $response -or -not $response.obj) {
        throw "Не удалось создать ссылку на таблицу '$TargetTableId'"
    }
    return [string]$response.obj
}

function New-IntegramRecord {
    param(
        [Parameter(Mandatory = $true)][string]$TableKey,
        [Parameter(Mandatory = $true)][hashtable]$Values
    )

    $table = $script:Tables[$TableKey]
    $formData = @{ up = "1" }

    foreach ($columnKey in $Values.Keys) {
        $fieldId = if ($columnKey -eq $table.PrimaryKey) {
            $table.Id
        } else {
            $table.Requisites[$columnKey]
        }

        if (-not $fieldId) {
            throw "Для таблицы '$TableKey' не найден ID поля '$columnKey'"
        }

        $formData["t$fieldId"] = $Values[$columnKey]
    }

    $response = Invoke-ApiRequest -Endpoint "_m_new/$($table.Id)?full=1" -FormData $formData
    if (-not $response -or -not $response.obj) {
        throw "Не удалось создать запись в таблице '$($table.Name)'"
    }
    return [string]$response.obj
}

function Set-IntegramReference {
    param(
        [Parameter(Mandatory = $true)][string]$ObjectId,
        [Parameter(Mandatory = $true)][string]$RequisiteId,
        [Parameter(Mandatory = $true)][string]$TargetObjectId
    )

    Invoke-ApiRequest -Endpoint "_m_set/$ObjectId" -FormData @{ "t$RequisiteId" = $TargetObjectId } | Out-Null
}

Remove-Item -Path $LogPath -ErrorAction SilentlyContinue

$script:AuthToken = $null
$script:XsrfToken = $null

Write-Log "========================================"
Write-Log "Starting Perelidoz structure creation"
Write-Log "Database: $DbName"
Write-Log "Base URL: $BaseUrl"
Write-Log "========================================"

Write-Log ""
Write-Log "1. Authorization..."

$authResponse = Invoke-ApiRequest -Endpoint "auth" -FormData @{ login = $Login; pwd = $Password } -AuthToken $null -XsrfToken $null
if (-not $authResponse -or -not $authResponse.token -or -not $authResponse._xsrf) {
    throw "Authorization failed"
}

$script:XsrfToken = $authResponse._xsrf
$script:AuthToken = $authResponse.token
Write-Log "   OK Authorization successful"
Write-Log "   User ID: $($authResponse.id)"

$tableDefinitions = [ordered]@{
    Project = @{
        Name = "Проект"
        PrimaryKey = "ProjectName"
        Columns = @(
            @{ Key = "ProjectName"; Name = "Название проекта"; Type = "3" },
            @{ Key = "Website"; Name = "Сайт"; Type = "8" },
            @{ Key = "Niche"; Name = "Ниша"; Type = "3" },
            @{ Key = "Status"; Name = "Статус"; Type = "3" },
            @{ Key = "CreatedDate"; Name = "Дата создания"; Type = "9" },
            @{ Key = "Budget"; Name = "Бюджет"; Type = "13" }
        )
    }
    Client = @{
        Name = "Клиент"
        PrimaryKey = "ClientName"
        Columns = @(
            @{ Key = "ClientName"; Name = "Название клиента"; Type = "3" },
            @{ Key = "ContactName"; Name = "Контактное лицо"; Type = "3" },
            @{ Key = "Telegram"; Name = "Telegram"; Type = "3" },
            @{ Key = "Email"; Name = "Email"; Type = "8" },
            @{ Key = "Phone"; Name = "Телефон"; Type = "3" },
            @{ Key = "Position"; Name = "Должность"; Type = "3" }
        )
    }
    Payment = @{
        Name = "Платёж"
        PrimaryKey = "PaymentNumber"
        Columns = @(
            @{ Key = "PaymentNumber"; Name = "Номер платежа"; Type = "3" },
            @{ Key = "Amount"; Name = "Сумма"; Type = "13" },
            @{ Key = "PaymentDate"; Name = "Дата оплаты"; Type = "9" },
            @{ Key = "PaymentStatus"; Name = "Статус платежа"; Type = "3" }
        )
    }
    Task = @{
        Name = "Задача"
        PrimaryKey = "TaskName"
        Columns = @(
            @{ Key = "TaskName"; Name = "Название задачи"; Type = "12" },
            @{ Key = "TaskType"; Name = "Тип задачи"; Type = "3" },
            @{ Key = "TaskStatus"; Name = "Статус"; Type = "3" },
            @{ Key = "Deadline"; Name = "Дедлайн"; Type = "9" },
            @{ Key = "Priority"; Name = "Приоритет"; Type = "3" },
            @{ Key = "Reward"; Name = "Награда"; Type = "13" }
        )
    }
    AudioFile = @{
        Name = "Аудиофайл"
        PrimaryKey = "FileName"
        Columns = @(
            @{ Key = "FileName"; Name = "Название файла"; Type = "3" },
            @{ Key = "MeetingType"; Name = "Тип встречи"; Type = "3" },
            @{ Key = "ProcessingStatus"; Name = "Статус обработки"; Type = "3" },
            @{ Key = "Duration"; Name = "Длительность"; Type = "13" },
            @{ Key = "File"; Name = "Файл"; Type = "10" }
        )
    }
    Transcript = @{
        Name = "Транскрипт"
        PrimaryKey = "TranscriptName"
        Columns = @(
            @{ Key = "TranscriptName"; Name = "Название транскрипта"; Type = "3" },
            @{ Key = "Text"; Name = "Текст"; Type = "12" },
            @{ Key = "CreatedDate"; Name = "Дата создания"; Type = "9" }
        )
    }
    Strategy = @{
        Name = "Стратегия"
        PrimaryKey = "StrategyVersion"
        Columns = @(
            @{ Key = "StrategyVersion"; Name = "Версия стратегии"; Type = "3" },
            @{ Key = "GoogleDocUrl"; Name = "Ссылка на Google Doc"; Type = "8" },
            @{ Key = "Status"; Name = "Статус"; Type = "3" },
            @{ Key = "GeneratedDate"; Name = "Дата генерации"; Type = "9" }
        )
    }
    OperationalPlan = @{
        Name = "Операционный план"
        PrimaryKey = "PlanVersion"
        Columns = @(
            @{ Key = "PlanVersion"; Name = "Версия плана"; Type = "3" },
            @{ Key = "Period"; Name = "Период"; Type = "3" },
            @{ Key = "Status"; Name = "Статус"; Type = "3" },
            @{ Key = "CreatedDate"; Name = "Дата создания"; Type = "9" }
        )
    }
    Forecast = @{
        Name = "Прогноз"
        PrimaryKey = "ForecastName"
        Columns = @(
            @{ Key = "ForecastName"; Name = "Название прогноза"; Type = "3" },
            @{ Key = "Period"; Name = "Период"; Type = "3" },
            @{ Key = "Revenue"; Name = "Выручка"; Type = "13" },
            @{ Key = "Probability"; Name = "Вероятность"; Type = "14" }
        )
    }
    Upsell = @{
        Name = "Допродажа"
        PrimaryKey = "UpsellNumber"
        Columns = @(
            @{ Key = "UpsellNumber"; Name = "Номер допродажи"; Type = "3" },
            @{ Key = "Amount"; Name = "Сумма"; Type = "13" },
            @{ Key = "Status"; Name = "Статус"; Type = "3" },
            @{ Key = "Date"; Name = "Дата"; Type = "9" }
        )
    }
    HealthScore = @{
        Name = "Health Score"
        PrimaryKey = "ScoreKey"
        Columns = @(
            @{ Key = "ScoreKey"; Name = "Проект + Дата оценки"; Type = "3" },
            @{ Key = "ScoreDate"; Name = "Дата оценки"; Type = "9" },
            @{ Key = "Score"; Name = "Score"; Type = "13" },
            @{ Key = "OverdueTasks"; Name = "Просроченных задач"; Type = "13" },
            @{ Key = "Comment"; Name = "Комментарий"; Type = "12" }
        )
    }
    TeamBalance = @{
        Name = "Баланс сотрудника"
        PrimaryKey = "EmployeeMonth"
        Columns = @(
            @{ Key = "EmployeeMonth"; Name = "Сотрудник + Месяц"; Type = "3" },
            @{ Key = "Month"; Name = "Месяц"; Type = "3" },
            @{ Key = "CoinBalance"; Name = "Баланс монеток"; Type = "13" },
            @{ Key = "PaidRubles"; Name = "Выплачено рублей"; Type = "13" }
        )
    }
    Payout = @{
        Name = "Выплата"
        PrimaryKey = "PayoutNumber"
        Columns = @(
            @{ Key = "PayoutNumber"; Name = "Номер выплаты"; Type = "3" },
            @{ Key = "Amount"; Name = "Сумма"; Type = "13" },
            @{ Key = "PayoutDate"; Name = "Дата выплаты"; Type = "9" },
            @{ Key = "Status"; Name = "Статус"; Type = "3" }
        )
    }
    Integration = @{
        Name = "Интеграция"
        PrimaryKey = "IntegrationName"
        Columns = @(
            @{ Key = "IntegrationName"; Name = "Название интеграции"; Type = "3" },
            @{ Key = "Service"; Name = "Сервис"; Type = "3" },
            @{ Key = "Status"; Name = "Статус"; Type = "3" },
            @{ Key = "ApiKey"; Name = "API ключ"; Type = "6" }
        )
    }
    AIPrompt = @{
        Name = "AI промпт"
        PrimaryKey = "PromptName"
        Columns = @(
            @{ Key = "PromptName"; Name = "Название промпта"; Type = "3" },
            @{ Key = "PromptText"; Name = "Текст промпта"; Type = "12" },
            @{ Key = "Purpose"; Name = "Назначение"; Type = "3" },
            @{ Key = "Active"; Name = "Активен"; Type = "11" }
        )
    }
    SystemLog = @{
        Name = "Системный лог"
        PrimaryKey = "EventName"
        Columns = @(
            @{ Key = "EventName"; Name = "Событие"; Type = "3" },
            @{ Key = "EventDate"; Name = "Дата и время"; Type = "4" },
            @{ Key = "Level"; Name = "Уровень"; Type = "3" },
            @{ Key = "Message"; Name = "Сообщение"; Type = "12" }
        )
    }
    Competitor = @{
        Name = "Конкурент"
        PrimaryKey = "CompetitorName"
        Columns = @(
            @{ Key = "CompetitorName"; Name = "Название конкурента"; Type = "3" },
            @{ Key = "Website"; Name = "Сайт"; Type = "8" },
            @{ Key = "Weaknesses"; Name = "Слабые места"; Type = "12" },
            @{ Key = "DiscoveryDate"; Name = "Дата обнаружения"; Type = "9" }
        )
    }
}

$referenceDefinitions = @(
    @{ Source = "Project"; Target = "Client"; Key = "Client"; Alias = "Клиент" },
    @{ Source = "Project"; Target = "User"; Key = "Responsible"; Alias = "Ответственный" },
    @{ Source = "Client"; Target = "Project"; Key = "Project"; Alias = "Проект" },
    @{ Source = "Payment"; Target = "Project"; Key = "Project"; Alias = "Проект" },
    @{ Source = "Task"; Target = "Project"; Key = "Project"; Alias = "Проект" },
    @{ Source = "Task"; Target = "User"; Key = "Executor"; Alias = "Исполнитель" },
    @{ Source = "AudioFile"; Target = "Project"; Key = "Project"; Alias = "Проект" },
    @{ Source = "Transcript"; Target = "AudioFile"; Key = "AudioFile"; Alias = "Аудиофайл" },
    @{ Source = "Strategy"; Target = "Project"; Key = "Project"; Alias = "Проект" },
    @{ Source = "OperationalPlan"; Target = "Project"; Key = "Project"; Alias = "Проект" },
    @{ Source = "Forecast"; Target = "Project"; Key = "Project"; Alias = "Проект" },
    @{ Source = "Upsell"; Target = "Project"; Key = "Project"; Alias = "Проект" },
    @{ Source = "HealthScore"; Target = "Project"; Key = "Project"; Alias = "Проект" },
    @{ Source = "TeamBalance"; Target = "User"; Key = "Employee"; Alias = "Сотрудник" },
    @{ Source = "Payout"; Target = "User"; Key = "Employee"; Alias = "Сотрудник" },
    @{ Source = "SystemLog"; Target = "User"; Key = "User"; Alias = "Пользователь" },
    @{ Source = "Competitor"; Target = "Project"; Key = "Project"; Alias = "Проект" }
)

$script:Tables = @{}

Write-Log ""
Write-Log "2. Creating tables and columns..."

foreach ($tableKey in $tableDefinitions.Keys) {
    $definition = $tableDefinitions[$tableKey]
    $tableId = New-IntegramType -Name $definition.Name -BaseTypeId "3"
    $script:Tables[$tableKey] = @{
        Id = $tableId
        Name = $definition.Name
        PrimaryKey = $definition.PrimaryKey
        Requisites = @{}
    }

    Write-Log "   OK Created table: $($definition.Name) (ID: $tableId)"

    foreach ($column in $definition.Columns) {
        if ($column.Key -eq $definition.PrimaryKey) {
            Write-Log "      First column: $($column.Name) uses table ID $tableId"
            continue
        }

        $columnTypeId = New-IntegramType -Name $column.Name -BaseTypeId $column.Type
        $requisiteId = Add-IntegramRequisite -TableId $tableId -TypeId $columnTypeId
        $script:Tables[$tableKey].Requisites[$column.Key] = $requisiteId
        Write-Log "      OK Column: $($column.Name) (type $($column.Type), req ID: $requisiteId)"
    }
}

$script:Tables["User"] = @{
    Id = "18"
    Name = "Пользователь"
    PrimaryKey = "Login"
    Requisites = @{}
}

Write-Log ""
Write-Log "3. Creating reference links..."

foreach ($ref in $referenceDefinitions) {
    if (-not $script:Tables.ContainsKey($ref.Source)) {
        throw "Не найдена таблица-источник '$($ref.Source)' для ссылки '$($ref.Alias)'"
    }
    if (-not $script:Tables.ContainsKey($ref.Target)) {
        throw "Не найдена целевая таблица '$($ref.Target)' для ссылки '$($ref.Alias)'"
    }

    $refTypeId = New-IntegramReferenceType -TargetTableId $script:Tables[$ref.Target].Id
    $reqId = Add-IntegramRequisite -TableId $script:Tables[$ref.Source].Id -TypeId $refTypeId -Alias $ref.Alias
    $script:Tables[$ref.Source].Requisites[$ref.Key] = $reqId
    Write-Log "   OK Link: $($script:Tables[$ref.Source].Name).$($ref.Alias) -> $($script:Tables[$ref.Target].Name) (req ID: $reqId)"
}

if (-not $SkipSeedData) {
    Write-Log ""
    Write-Log "4. Adding test data..."

    $projectIds = @{}
    $projectRows = @(
        @{ ProjectName = "Альфа"; Website = "alfa.ru"; Niche = "B2B услуги"; Status = "active"; CreatedDate = "2026-01-10"; Budget = "1000000" },
        @{ ProjectName = "Бета"; Website = "beta.store"; Niche = "E-commerce"; Status = "active"; CreatedDate = "2026-02-15"; Budget = "500000" },
        @{ ProjectName = "ТехноСтрой"; Website = "tehnostroy.ru"; Niche = "Строительство"; Status = "needs_review"; CreatedDate = "2026-03-01"; Budget = "600000" }
    )

    foreach ($project in $projectRows) {
        $projectIds[$project.ProjectName] = New-IntegramRecord -TableKey "Project" -Values $project
        Write-Log "   OK Project: $($project.ProjectName)"
    }

    $clientIds = @{}
    $clientRows = @(
        @{ ClientName = "ООО Альфа"; ContactName = "Иван Иванов"; Telegram = "@ivan_alpha"; Email = "ivan@alfa.ru"; Phone = "+7(999)111-22-33"; Position = "CEO"; ProjectName = "Альфа" },
        @{ ClientName = "ИП Бета"; ContactName = "Анна Петрова"; Telegram = "@anna_beta"; Email = "anna@beta.store"; Phone = "+7(999)444-55-66"; Position = "Founder"; ProjectName = "Бета" }
    )

    foreach ($client in $clientRows) {
        $projectName = $client.ProjectName
        $values = @{
            ClientName = $client.ClientName
            ContactName = $client.ContactName
            Telegram = $client.Telegram
            Email = $client.Email
            Phone = $client.Phone
            Position = $client.Position
        }
        $clientId = New-IntegramRecord -TableKey "Client" -Values $values
        $clientIds[$client.ClientName] = $clientId
        Set-IntegramReference -ObjectId $clientId -RequisiteId $script:Tables["Client"].Requisites["Project"] -TargetObjectId $projectIds[$projectName]
        Write-Log "   OK Client: $($client.ClientName)"
    }

    $payments = @(
        @{ PaymentNumber = "ПЛ-2026-001"; Amount = "50000"; PaymentDate = "2026-01-12"; PaymentStatus = "completed"; ProjectName = "Альфа" },
        @{ PaymentNumber = "ПЛ-2026-002"; Amount = "100000"; PaymentDate = "2026-02-01"; PaymentStatus = "completed"; ProjectName = "Альфа" },
        @{ PaymentNumber = "ПЛ-2026-003"; Amount = "30000"; PaymentDate = "2026-02-20"; PaymentStatus = "pending"; ProjectName = "Бета" }
    )

    foreach ($payment in $payments) {
        $projectName = $payment.ProjectName
        $values = @{
            PaymentNumber = $payment.PaymentNumber
            Amount = $payment.Amount
            PaymentDate = $payment.PaymentDate
            PaymentStatus = $payment.PaymentStatus
        }
        $paymentId = New-IntegramRecord -TableKey "Payment" -Values $values
        Set-IntegramReference -ObjectId $paymentId -RequisiteId $script:Tables["Payment"].Requisites["Project"] -TargetObjectId $projectIds[$projectName]
        Write-Log "   OK Payment: $($payment.PaymentNumber)"
    }

    $tasks = @(
        @{ TaskName = "Настроить рекламу в Яндекс"; TaskType = "manual"; TaskStatus = "done"; Deadline = "2026-01-15"; Priority = "high"; Reward = "500"; ProjectName = "Альфа" },
        @{ TaskName = "Собрать семантическое ядро"; TaskType = "manual"; TaskStatus = "in_progress"; Deadline = "2026-01-25"; Priority = "medium"; Reward = "300"; ProjectName = "Альфа" },
        @{ TaskName = "Подготовить отчёт"; TaskType = "manual"; TaskStatus = "open"; Deadline = "2026-03-01"; Priority = "low"; Reward = "400"; ProjectName = "Бета" }
    )

    foreach ($task in $tasks) {
        $projectName = $task.ProjectName
        $values = @{
            TaskName = $task.TaskName
            TaskType = $task.TaskType
            TaskStatus = $task.TaskStatus
            Deadline = $task.Deadline
            Priority = $task.Priority
            Reward = $task.Reward
        }
        $taskId = New-IntegramRecord -TableKey "Task" -Values $values
        Set-IntegramReference -ObjectId $taskId -RequisiteId $script:Tables["Task"].Requisites["Project"] -TargetObjectId $projectIds[$projectName]
        Write-Log "   OK Task: $($task.TaskName)"
    }

    $strategies = @(
        @{ StrategyVersion = "v1.0 Альфа"; GoogleDocUrl = "https://docs.google.com/document/d/example-alpha-v1"; Status = "approved"; GeneratedDate = "2026-01-20"; ProjectName = "Альфа" },
        @{ StrategyVersion = "v2.0 Альфа"; GoogleDocUrl = "https://docs.google.com/document/d/example-alpha-v2"; Status = "draft"; GeneratedDate = "2026-03-15"; ProjectName = "Альфа" },
        @{ StrategyVersion = "v1.0 Бета"; GoogleDocUrl = "https://docs.google.com/document/d/example-beta-v1"; Status = "approved"; GeneratedDate = "2026-02-25"; ProjectName = "Бета" }
    )

    foreach ($strategy in $strategies) {
        $projectName = $strategy.ProjectName
        $values = @{
            StrategyVersion = $strategy.StrategyVersion
            GoogleDocUrl = $strategy.GoogleDocUrl
            Status = $strategy.Status
            GeneratedDate = $strategy.GeneratedDate
        }
        $strategyId = New-IntegramRecord -TableKey "Strategy" -Values $values
        Set-IntegramReference -ObjectId $strategyId -RequisiteId $script:Tables["Strategy"].Requisites["Project"] -TargetObjectId $projectIds[$projectName]
        Write-Log "   OK Strategy: $($strategy.StrategyVersion)"
    }

    $scores = @(
        @{ ScoreKey = "Альфа - 2026-04-14"; ScoreDate = "2026-04-14"; Score = "85"; OverdueTasks = "1"; Comment = "Хорошая динамика"; ProjectName = "Альфа" },
        @{ ScoreKey = "Альфа - 2026-04-13"; ScoreDate = "2026-04-13"; Score = "90"; OverdueTasks = "0"; Comment = "Отлично"; ProjectName = "Альфа" },
        @{ ScoreKey = "Бета - 2026-04-14"; ScoreDate = "2026-04-14"; Score = "50"; OverdueTasks = "2"; Comment = "Требует внимания"; ProjectName = "Бета" }
    )

    foreach ($score in $scores) {
        $projectName = $score.ProjectName
        $values = @{
            ScoreKey = $score.ScoreKey
            ScoreDate = $score.ScoreDate
            Score = $score.Score
            OverdueTasks = $score.OverdueTasks
            Comment = $score.Comment
        }
        $scoreId = New-IntegramRecord -TableKey "HealthScore" -Values $values
        Set-IntegramReference -ObjectId $scoreId -RequisiteId $script:Tables["HealthScore"].Requisites["Project"] -TargetObjectId $projectIds[$projectName]
        Write-Log "   OK Health Score: $($score.ScoreKey)"
    }

    $competitors = @(
        @{ CompetitorName = "Маркетинг Про"; Website = "marketing-pro.ru"; Weaknesses = "Нет УБТ, дорогой трафик"; DiscoveryDate = "2026-02-20"; ProjectName = "Альфа" },
        @{ CompetitorName = "Лидоген"; Website = "lider-gen.ru"; Weaknesses = "Слабые кейсы в B2B"; DiscoveryDate = "2026-02-20"; ProjectName = "Альфа" }
    )

    foreach ($competitor in $competitors) {
        $projectName = $competitor.ProjectName
        $values = @{
            CompetitorName = $competitor.CompetitorName
            Website = $competitor.Website
            Weaknesses = $competitor.Weaknesses
            DiscoveryDate = $competitor.DiscoveryDate
        }
        $competitorId = New-IntegramRecord -TableKey "Competitor" -Values $values
        Set-IntegramReference -ObjectId $competitorId -RequisiteId $script:Tables["Competitor"].Requisites["Project"] -TargetObjectId $projectIds[$projectName]
        Write-Log "   OK Competitor: $($competitor.CompetitorName)"
    }
}

Write-Log ""
Write-Log "========================================"
Write-Log "COMPLETE!"
Write-Log "========================================"
Write-Log "Table IDs:"
foreach ($tableKey in $script:Tables.Keys | Sort-Object) {
    $table = $script:Tables[$tableKey]
    Write-Log "   $($table.Name) ($tableKey) = $($table.Id)"
}

Write-Log ""
Write-Log "Requisite IDs:"
foreach ($tableKey in $script:Tables.Keys | Sort-Object) {
    $table = $script:Tables[$tableKey]
    foreach ($reqKey in $table.Requisites.Keys | Sort-Object) {
        Write-Log "   $($table.Name).$reqKey = $($table.Requisites[$reqKey])"
    }
}

Write-Log ""
Write-Log "Log saved to: $LogPath"
