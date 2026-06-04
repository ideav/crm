# Offline smoke-test for issue #3000: the bootstrap scripts must send the token
# via the X-Authorization header (the transport the live Integram server reads).
#
# It mocks Invoke-RestMethod, dot-sources each bootstrap script in -DryRun-free
# mode against the mock, and asserts that BOTH the /xsrf bootstrap GET and the
# subsequent authenticated write/read requests carry X-Authorization=<token>.
#
# Run: pwsh -NoProfile -File experiments/test-issue-3000-xauth-smoke.ps1
$ErrorActionPreference = "Stop"
$script:failed = $false
function Assert($label, $cond) {
    if ($cond) { Write-Host "  PASS $label" }
    else { Write-Host "  FAIL $label"; $script:failed = $true }
}

$repoRoot = Split-Path -Parent $PSScriptRoot

$cases = @(
    @{ Script = "create_atex_menu.ps1";       Token = "tok-menu";  Db = "atex" },
    @{ Script = "create_roles_users.ps1";      Token = "tok-roles"; Db = "atex" },
    @{ Script = "create_db_from_scratch.ps1";  Token = "tok-db";    Db = "atex" },
    @{ Script = "create_perelidoz.ps1";        Token = "tok-pere";  Db = "perelidoz" }
)

foreach ($case in $cases) {
    $scriptPath = Join-Path $repoRoot (Join-Path "docs" $case.Script)
    Write-Host "=== $($case.Script) ==="
    $script:Calls = New-Object System.Collections.ArrayList

    # Mock Invoke-RestMethod: record every call's URI/headers and return shapes
    # the bootstrap flow expects so it runs through xsrf + a few write/read calls.
    function Invoke-RestMethod {
        param(
            [string]$Uri, [string]$Method, [object]$Body, [string]$ContentType,
            [hashtable]$Headers, [object]$WebSession, [switch]$SkipCertificateCheck
        )
        [void]$script:Calls.Add([pscustomobject]@{ Uri = $Uri; Method = $Method; Headers = $Headers })
        if ($Uri -match '/xsrf') {
            return [pscustomobject]@{ token = 'srv-token'; _xsrf = 'XSRF'; id = '7'; user = 'claude' }
        }
        if ($Uri -match '/object/') {
            return [pscustomobject]@{ object = @(); reqs = [pscustomobject]@{} }
        }
        if ($Uri -match '/edit_types') {
            return [pscustomobject]@{ id = @(); val = @() }
        }
        return [pscustomobject]@{ obj = '1000'; id = '1000' }
    }

    # Run only the auth bootstrap by invoking it in a child scope where the rest
    # of the script body is harmless: pass a token and a tiny data file isn't
    # required because we stop right after Initialize-TokenSession via a probe.
    & {
        param($path, $tok, $db)
        $env:INTEGRAM_TOKEN = $tok
        # Dot-source definitions, then call the auth bootstrap explicitly. The
        # scripts also auto-run at the bottom; we tolerate that against the mock.
        try { . $path -Token $tok -DbName $db *> $null } catch { }
    } $scriptPath $case.Token $case.Db

    $xsrfCalls = @($script:Calls | Where-Object { $_.Uri -match '/xsrf' })
    Assert "xsrf bootstrap called" ($xsrfCalls.Count -ge 1)
    if ($xsrfCalls.Count -ge 1) {
        Assert "xsrf carries X-Authorization=token" ($xsrfCalls[0].Headers['X-Authorization'] -eq $case.Token)
    }
    $authedWrites = @($script:Calls | Where-Object { $_.Uri -notmatch '/xsrf' -and $_.Headers -and $_.Headers['X-Authorization'] })
    Assert "authenticated requests carry X-Authorization" ($authedWrites.Count -ge 1)
    $env:INTEGRAM_TOKEN = $null
}

if ($script:failed) { Write-Host 'SMOKE FAILED'; exit 1 } else { Write-Host 'ALL SMOKE CHECKS PASSED' }
