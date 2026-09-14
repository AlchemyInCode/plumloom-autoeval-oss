# Cross-platform developer smoke workflow for Windows PowerShell.
#
# WARNING: This script mutates the configured backend. It creates a workspace
# and submits three evaluations, which may be billable. The workspace and its
# evaluations are intentionally retained for inspection because the public CLI
# does not provide a workspace-delete command.
#
# Prerequisites:
#   - Node.js 22 and the `autoeval` command on PATH
#   - AUTOEVAL_API_BASE_URL set to the Autoeval API origin
#   - `autoeval login`, or AUTOEVAL_API_KEY in the environment
#   - JUDGE_MODEL_ID and PRIMARY_MODEL_ID from `autoeval models`
#
# Optional: set AUTOEVAL_CLI to the path of another Autoeval executable.

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$AutoevalCli = if ([string]::IsNullOrWhiteSpace($env:AUTOEVAL_CLI)) {
    'autoeval'
} else {
    $env:AUTOEVAL_CLI
}

function Write-Heading {
    param([Parameter(Mandatory = $true)][string]$Text)
    Write-Host "`n== $Text =="
}

function Invoke-Autoeval {
    param([Parameter(Mandatory = $true)][string[]]$CommandArguments)

    & $script:AutoevalCli @CommandArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Autoeval command failed with exit code $LASTEXITCODE."
    }
}

function ConvertFrom-AutoevalJson {
    param([Parameter(Mandatory = $true)][object[]]$Output)
    return (($Output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine) |
        ConvertFrom-Json
}

Write-Heading 'Backend mutation warning'
Write-Host 'This workflow creates a workspace and runs three potentially billable evaluations.'
Write-Host 'Created resources are retained for inspection.'

Write-Heading '1. Verify authentication'
Invoke-Autoeval -CommandArguments @('whoami')

Write-Heading '2. Validate model overrides'
if ([string]::IsNullOrWhiteSpace($env:JUDGE_MODEL_ID)) {
    throw "Set JUDGE_MODEL_ID to an enabled UUID from 'autoeval models'."
}
if ([string]::IsNullOrWhiteSpace($env:PRIMARY_MODEL_ID)) {
    throw "Set PRIMARY_MODEL_ID to an enabled UUID from 'autoeval models'."
}

$Timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$WorkspaceName = "autoeval-public-smoke-$Timestamp-$PID"

Write-Heading "3. Create workspace: $WorkspaceName"
$WorkspaceOutput = @(Invoke-Autoeval -CommandArguments @(
        '--json', 'workspace', 'create', '--name', $WorkspaceName
    ))
$Workspace = ConvertFrom-AutoevalJson -Output $WorkspaceOutput
$WorkspaceId = [string]$Workspace.id
if ([string]::IsNullOrWhiteSpace($WorkspaceId)) {
    throw 'Workspace creation returned no workspace ID.'
}
Write-Host "Workspace ID: $WorkspaceId"

function Invoke-SmokeEvaluation {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$InputFile,
        [switch]$IncludePrimaryModel
    )

    $CommandArguments = @(
        '--json', 'eval', 'create-from',
        '--workspace', $script:WorkspaceId,
        '--input', $InputFile,
        '--judge-model-id', $env:JUDGE_MODEL_ID
    )
    if ($IncludePrimaryModel) {
        $CommandArguments += @('--primary-model-id', $env:PRIMARY_MODEL_ID)
    }
    $CommandArguments += '--run'

    Write-Heading $Label
    $RunOutput = @(Invoke-Autoeval -CommandArguments $CommandArguments)
    $RunResult = ConvertFrom-AutoevalJson -Output $RunOutput
    $Created = @($RunResult.created)[0]
    if ($null -eq $Created) {
        throw "$Label returned no created evaluation."
    }

    $EvaluationId = [string]$Created.evaluationId
    $RunId = [string]$Created.runId
    if ([string]::IsNullOrWhiteSpace($EvaluationId) -or [string]::IsNullOrWhiteSpace($RunId)) {
        throw "$Label returned incomplete evaluation or run identifiers."
    }

    Write-Host "Evaluation ID: $EvaluationId"
    Write-Host "Run ID: $RunId"

    Write-Heading "$Label - human-readable results"
    Invoke-Autoeval -CommandArguments @('results', $EvaluationId, $RunId)

    Write-Heading "$Label - JSON results"
    Invoke-Autoeval -CommandArguments @('--json', 'results', $EvaluationId, $RunId)
}

Invoke-SmokeEvaluation `
    -Label '4. Scenario evaluation' `
    -InputFile (Join-Path $PSScriptRoot 'fixtures/smoke-scenario.json') `
    -IncludePrimaryModel
Invoke-SmokeEvaluation `
    -Label '5. Conversation evaluation' `
    -InputFile (Join-Path $PSScriptRoot 'fixtures/smoke-conversation.json')
Invoke-SmokeEvaluation `
    -Label '6. Agent Trace evaluation' `
    -InputFile (Join-Path $PSScriptRoot 'fixtures/smoke-agent-trace.json')

Write-Heading 'Smoke workflow complete'
Write-Host "Workspace retained for inspection: $WorkspaceName ($WorkspaceId)"
