# ============================================
# Скрипт создания структуры "Перелидоз" в Интеграме
# ============================================

param(
    [string]$Login = "api",
    [string]$Password = "k6cvfvg3",
    [string]$BaseUrl = "https://ideav.ru",
    [string]$DbName = "test"
)

# Функция для логирования
function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "dd/MM/yyyy HH:mm:ss"
    $logMessage = "$timestamp $Message"
    Add-Content -Path "api_log.txt" -Value $logMessage
    Write-Host $Message
}

# Функция для выполнения запроса к API
function Invoke-ApiRequest {
    param(
        [string]$Endpoint,
        [string]$Method = "POST",
        [hashtable]$FormData = @{},
        [string]$AuthToken = $null,
        [string]$XsrfToken = $null
    )
    
    # URL: integram.io/{база}/{действие}/{id}?JSON=1
    $url = "$BaseUrl/$DbName/$Endpoint`?JSON=1"
    Write-Log "Request: $url"
    
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
    
    $bodyString = ($body.Keys | ForEach-Object { "$_=$($body[$_])" }) -join "; "
    Write-Log "Body: $bodyString"
    
    try {
        if ($Method -eq "POST") {
            $response = Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType "application/x-www-form-urlencoded"
        } else {
            $response = Invoke-RestMethod -Uri $url -Method Get
        }
        Write-Log "Response: $($response | ConvertTo-Json -Compress)"
        return $response
    } catch {
        Write-Log "ERROR: $_"
        if ($_.Exception.Response) {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $reader.BaseStream.Position = 0
            $reader.DiscardBufferedData()
            $responseBody = $reader.ReadToEnd()
            Write-Log "Response Body: $responseBody"
        }
        return $null
    }
}

Write-Log "========================================"
Write-Log "Starting Perelidoz structure creation"
Write-Log "Database: $DbName"
Write-Log "Base URL: $BaseUrl"
Write-Log "========================================"

# ========== 1. AUTH ==========
Write-Log ""
Write-Log "1. Authorization..."

$authResponse = Invoke-ApiRequest -Endpoint "auth" -FormData @{ login = $Login; pwd = $Password }

if ($authResponse -and $authResponse.token) {
    $xsrfToken = $authResponse._xsrf
    $authToken = $authResponse.token
    $userId = $authResponse.id
    
    Write-Log "   OK Authorization successful"
    Write-Log "   XSRF Token: $xsrfToken"
    Write-Log "   Auth Token: $authToken"
} else {
    Write-Log "   ERROR: Authorization failed"
    exit 1
}

# ========== 2. CREATE TABLES ==========
Write-Log ""
Write-Log "2. Creating tables..."

$tables = @(
    "Users", 
    "Projects", 
    "Clients", 
    "Payments", 
    "Tasks",
    "AudioFiles", 
    "Transcripts", 
    "Strategies", 
    "OperationalPlans",
    "Forecasts", 
    "Upsells", 
    "HealthScore", 
    "TeamBalances",
    "Payouts", 
    "Integrations", 
    "AIPrompts", 
    "SystemLogs", 
    "Competitors"
)

$tableIds = @{}

foreach ($table in $tables) {
    $response = Invoke-ApiRequest -Endpoint "_d_new" -FormData @{ t = "3"; val = $table } -AuthToken $authToken -XsrfToken $xsrfToken
    if ($response -and $response.obj) {
        $tableIds[$table] = $response.obj
        Write-Log "   OK Created table: $table (ID: $($response.obj))"
    } else {
        Write-Log "   ERROR Creating table: $table"
    }
    Start-Sleep -Milliseconds 500
}

# ========== 3. ADD COLUMNS ==========
Write-Log ""
Write-Log "3. Adding columns to Users..."

# Columns for Users
$userColumns = @(
    @{name="Login"; type="3"},
    @{name="Role"; type="3"},
    @{name="Email"; type="8"},
    @{name="Phone"; type="3"},
    @{name="FullName"; type="3"},
    @{name="Photo"; type="10"},
    @{name="RegDate"; type="9"},
    @{name="Active"; type="11"}
)

foreach ($col in $userColumns) {
    $colResponse = Invoke-ApiRequest -Endpoint "_d_new" -FormData @{ t = $col.type; val = $col.name } -AuthToken $authToken -XsrfToken $xsrfToken
    if ($colResponse -and $colResponse.obj) {
        $reqResponse = Invoke-ApiRequest -Endpoint "_d_req/$($tableIds["Users"])" -FormData @{ t = $colResponse.obj } -AuthToken $authToken -XsrfToken $xsrfToken
        Write-Log "   OK Column: $($col.name) -> Users"
    }
    Start-Sleep -Milliseconds 200
}

Write-Log ""
Write-Log "3b. Adding columns to Projects..."

# Columns for Projects
$projectColumns = @(
    @{name="ProjectName"; type="3"},
    @{name="Website"; type="3"},
    @{name="Niche"; type="3"},
    @{name="Status"; type="3"},
    @{name="CreatedDate"; type="9"},
    @{name="Budget"; type="13"}
)

foreach ($col in $projectColumns) {
    $colResponse = Invoke-ApiRequest -Endpoint "_d_new" -FormData @{ t = $col.type; val = $col.name } -AuthToken $authToken -XsrfToken $xsrfToken
    if ($colResponse -and $colResponse.obj) {
        $reqResponse = Invoke-ApiRequest -Endpoint "_d_req/$($tableIds["Projects"])" -FormData @{ t = $colResponse.obj } -AuthToken $authToken -XsrfToken $xsrfToken
        Write-Log "   OK Column: $($col.name) -> Projects"
    }
    Start-Sleep -Milliseconds 200
}

Write-Log ""
Write-Log "3c. Adding columns to Clients..."

# Columns for Clients
$clientColumns = @(
    @{name="ContactName"; type="3"},
    @{name="Telegram"; type="3"},
    @{name="Email"; type="8"},
    @{name="Phone"; type="3"},
    @{name="Position"; type="3"}
)

foreach ($col in $clientColumns) {
    $colResponse = Invoke-ApiRequest -Endpoint "_d_new" -FormData @{ t = $col.type; val = $col.name } -AuthToken $authToken -XsrfToken $xsrfToken
    if ($colResponse -and $colResponse.obj) {
        $reqResponse = Invoke-ApiRequest -Endpoint "_d_req/$($tableIds["Clients"])" -FormData @{ t = $colResponse.obj } -AuthToken $authToken -XsrfToken $xsrfToken
        Write-Log "   OK Column: $($col.name) -> Clients"
    }
    Start-Sleep -Milliseconds 200
}

Write-Log ""
Write-Log "3d. Adding columns to Payments..."

# Columns for Payments
$paymentColumns = @(
    @{name="PaymentNumber"; type="3"},
    @{name="Amount"; type="13"},
    @{name="PaymentDate"; type="9"},
    @{name="PaymentStatus"; type="3"}
)

foreach ($col in $paymentColumns) {
    $colResponse = Invoke-ApiRequest -Endpoint "_d_new" -FormData @{ t = $col.type; val = $col.name } -AuthToken $authToken -XsrfToken $xsrfToken
    if ($colResponse -and $colResponse.obj) {
        $reqResponse = Invoke-ApiRequest -Endpoint "_d_req/$($tableIds["Payments"])" -FormData @{ t = $colResponse.obj } -AuthToken $authToken -XsrfToken $xsrfToken
        Write-Log "   OK Column: $($col.name) -> Payments"
    }
    Start-Sleep -Milliseconds 200
}

Write-Log ""
Write-Log "3e. Adding columns to Tasks..."

# Columns for Tasks
$taskColumns = @(
    @{name="TaskName"; type="3"},
    @{name="TaskType"; type="3"},
    @{name="TaskStatus"; type="3"},
    @{name="Deadline"; type="9"},
    @{name="Priority"; type="3"},
    @{name="Reward"; type="13"}
)

foreach ($col in $taskColumns) {
    $colResponse = Invoke-ApiRequest -Endpoint "_d_new" -FormData @{ t = $col.type; val = $col.name } -AuthToken $authToken -XsrfToken $xsrfToken
    if ($colResponse -and $colResponse.obj) {
        $reqResponse = Invoke-ApiRequest -Endpoint "_d_req/$($tableIds["Tasks"])" -FormData @{ t = $colResponse.obj } -AuthToken $authToken -XsrfToken $xsrfToken
        Write-Log "   OK Column: $($col.name) -> Tasks"
    }
    Start-Sleep -Milliseconds 200
}

# ========== 4. CREATE LINKS ==========
Write-Log ""
Write-Log "4. Creating reference links..."

# Создаём ссылочные термины
$refs = @(
    @{name="LinkToProject"; target="Projects"},
    @{name="LinkToUser"; target="Users"},
    @{name="LinkToClient"; target="Clients"}
)

$refIds = @{}

foreach ($ref in $refs) {
    $refResponse = Invoke-ApiRequest -Endpoint "_d_ref/$($tableIds[$ref.target])" -FormData @{} -AuthToken $authToken -XsrfToken $xsrfToken
    if ($refResponse -and $refResponse.obj) {
        $refIds[$ref.name] = $refResponse.obj
        Write-Log "   OK Created link: $($ref.name) (ID: $($refResponse.obj))"
    }
    Start-Sleep -Milliseconds 200
}

# Добавляем ссылки как колонки
Write-Log ""
Write-Log "4b. Adding links as columns..."

if ($refIds["LinkToProject"]) {
    Invoke-ApiRequest -Endpoint "_d_req/$($tableIds["Clients"])" -FormData @{ t = $refIds["LinkToProject"] } -AuthToken $authToken -XsrfToken $xsrfToken
    Write-Log "   OK Link to Project -> Clients"
    
    Invoke-ApiRequest -Endpoint "_d_req/$($tableIds["Payments"])" -FormData @{ t = $refIds["LinkToProject"] } -AuthToken $authToken -XsrfToken $xsrfToken
    Write-Log "   OK Link to Project -> Payments"
    
    Invoke-ApiRequest -Endpoint "_d_req/$($tableIds["Tasks"])" -FormData @{ t = $refIds["LinkToProject"] } -AuthToken $authToken -XsrfToken $xsrfToken
    Write-Log "   OK Link to Project -> Tasks"
    
    Invoke-ApiRequest -Endpoint "_d_req/$($tableIds["Forecasts"])" -FormData @{ t = $refIds["LinkToProject"] } -AuthToken $authToken -XsrfToken $xsrfToken
    Write-Log "   OK Link to Project -> Forecasts"
    
    Invoke-ApiRequest -Endpoint "_d_req/$($tableIds["Upsells"])" -FormData @{ t = $refIds["LinkToProject"] } -AuthToken $authToken -XsrfToken $xsrfToken
    Write-Log "   OK Link to Project -> Upsells"
    
    Invoke-ApiRequest -Endpoint "_d_req/$($tableIds["HealthScore"])" -FormData @{ t = $refIds["LinkToProject"] } -AuthToken $authToken -XsrfToken $xsrfToken
    Write-Log "   OK Link to Project -> HealthScore"
    
    Invoke-ApiRequest -Endpoint "_d_req/$($tableIds["Competitors"])" -FormData @{ t = $refIds["LinkToProject"] } -AuthToken $authToken -XsrfToken $xsrfToken
    Write-Log "   OK Link to Project -> Competitors"
}

if ($refIds["LinkToUser"]) {
    Invoke-ApiRequest -Endpoint "_d_req/$($tableIds["Projects"])" -FormData @{ t = $refIds["LinkToUser"] } -AuthToken $authToken -XsrfToken $xsrfToken
    Write-Log "   OK Link to User -> Projects (Responsible)"
    
    Invoke-ApiRequest -Endpoint "_d_req/$($tableIds["Tasks"])" -FormData @{ t = $refIds["LinkToUser"] } -AuthToken $authToken -XsrfToken $xsrfToken
    Write-Log "   OK Link to User -> Tasks (Executor)"
    
    Invoke-ApiRequest -Endpoint "_d_req/$($tableIds["TeamBalances"])" -FormData @{ t = $refIds["LinkToUser"] } -AuthToken $authToken -XsrfToken $xsrfToken
    Write-Log "   OK Link to User -> TeamBalances"
    
    Invoke-ApiRequest -Endpoint "_d_req/$($tableIds["Payouts"])" -FormData @{ t = $refIds["LinkToUser"] } -AuthToken $authToken -XsrfToken $xsrfToken
    Write-Log "   OK Link to User -> Payouts"
}

if ($refIds["LinkToClient"]) {
    Invoke-ApiRequest -Endpoint "_d_req/$($tableIds["Projects"])" -FormData @{ t = $refIds["LinkToClient"] } -AuthToken $authToken -XsrfToken $xsrfToken
    Write-Log "   OK Link to Client -> Projects"
}

# ========== 5. ADD TEST DATA ==========
Write-Log ""
Write-Log "5. Adding test data..."

# Add users
$users = @(
    @{Login="victor_g"; Role="founder"; Email="victor@perelidoz.ru"; Phone="+7(999)123-45-01"; FullName="Viktor Glazkov"; RegDate="15.01.2026"; Active="1"},
    @{Login="vlad_k"; Role="founder"; Email="vlad@perelidoz.ru"; Phone="+7(999)123-45-02"; FullName="Vladislav Kuznetsov"; RegDate="15.01.2026"; Active="1"},
    @{Login="anna_m"; Role="team"; Email="anna@perelidoz.ru"; Phone="+7(999)123-45-10"; FullName="Anna Marketologova"; RegDate="01.02.2026"; Active="1"},
    @{Login="petr_t"; Role="team"; Email="petr@perelidoz.ru"; Phone="+7(999)123-45-11"; FullName="Petr Trafficov"; RegDate="10.02.2026"; Active="1"}
)

foreach ($user in $users) {
    $formData = @{ up = "1" }
    $i = 1
    foreach ($key in $user.Keys) {
        $formData["t$i"] = $user[$key]
        $i++
    }
    $response = Invoke-ApiRequest -Endpoint "_m_new/$($tableIds["Users"])" -FormData $formData -AuthToken $authToken -XsrfToken $xsrfToken
    Write-Log "   OK Added user: $($user.FullName)"
    Start-Sleep -Milliseconds 200
}

# Add projects
$projects = @(
    @{ProjectName="Romashka"; Website="romashka.ru"; Niche="B2B services"; Status="success"; CreatedDate="10.02.2026"; Budget="85000"},
    @{ProjectName="Ivanov"; Website="ivanov.store"; Niche="E-commerce"; Status="artifacts_transferred"; CreatedDate="20.02.2026"; Budget="60000"},
    @{ProjectName="TekhnoStroy"; Website="tehnostroy.ru"; Niche="Construction"; Status="needs_review"; CreatedDate="01.03.2026"; Budget="60000"}
)

foreach ($project in $projects) {
    $formData = @{ up = "1" }
    $i = 1
    foreach ($key in $project.Keys) {
        $formData["t$i"] = $project[$key]
        $i++
    }
    $response = Invoke-ApiRequest -Endpoint "_m_new/$($tableIds["Projects"])" -FormData $formData -AuthToken $authToken -XsrfToken $xsrfToken
    Write-Log "   OK Added project: $($project.ProjectName)"
    Start-Sleep -Milliseconds 200
}

# Add tasks
$tasks = @(
    @{TaskName="Collect UBT channels of competitors"; TaskType="manual"; TaskStatus="done"; Deadline="15.03.2026"; Priority="high"; Reward="500"},
    @{TaskName="Set up Telegram newsletter"; TaskType="manual"; TaskStatus="in_progress"; Deadline="20.04.2026"; Priority="medium"; Reward="300"},
    @{TaskName="Analyze Yandex Metrica"; TaskType="manual"; TaskStatus="review"; Deadline="10.04.2026"; Priority="high"; Reward="400"}
)

foreach ($task in $tasks) {
    $formData = @{ up = "1" }
    $i = 1
    foreach ($key in $task.Keys) {
        $formData["t$i"] = $task[$key]
        $i++
    }
    $response = Invoke-ApiRequest -Endpoint "_m_new/$($tableIds["Tasks"])" -FormData $formData -AuthToken $authToken -XsrfToken $xsrfToken
    Write-Log "   OK Added task: $($task.TaskName)"
    Start-Sleep -Milliseconds 200
}

# ========== 6. FINAL INFO ==========
Write-Log ""
Write-Log "========================================"
Write-Log "COMPLETE!"
Write-Log "========================================"
Write-Log "Table IDs for further use:"
foreach ($table in $tables) {
    if ($tableIds[$table]) {
        Write-Log "   $table = $($tableIds[$table])"
    }
}
Write-Log ""
Write-Log "Xsrf Token: $xsrfToken"
Write-Log "Auth Token: $authToken"
Write-Log ""
Write-Log "Log saved to: api_log.txt"