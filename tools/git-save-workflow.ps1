param(
    [Parameter(Position = 0)]
    [string]$Message
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

if (-not $Message) {
    $Message = "Save ComfyUI workflows $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
}

git add -- .gitignore .gitattributes README-GIT-WORKFLOW.md .githooks tools user/default/workflows user/default/comfy.settings.json

$staged = git diff --cached --name-only
if (-not $staged) {
    Write-Host "No workflow changes to commit."
    git status --short --branch
    exit 0
}

git commit -m $Message
git status --short --branch

