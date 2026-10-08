param(
    [Parameter(Mandatory)][ValidateSet('a', 'b', 'c')][string]$Role,
    [ValidateSet('none', 'locked')][string]$Canvas = 'locked',
    [switch]$Start
)
$ErrorActionPreference = 'Stop'
$runtimeLock = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'prompt_opt_runtime_lock.json') -Raw | ConvertFrom-Json
$validationRoot = Join-Path $env:USERPROFILE '.codex/workspaces/prompt-opt-validation'
$base = Join-Path $validationRoot $Role
$suffix = @{ a = 'ui'; b = 'service'; c = 'integration' }[$Role]
$port = @{ a = 8191; b = 8192; c = 8193 }[$Role]
$business = Join-Path $env:USERPROFILE ".codex/worktrees/prompt-opt-$suffix"
$python = Join-Path $env:USERPROFILE 'Documents/ComfyUI/.venv/Scripts/python.exe'
$core = Join-Path $env:LOCALAPPDATA 'Comfy-Desktop/ComfyUI-Installs/ComfyUI/ComfyUI'
$frontend = Join-Path $env:USERPROFILE 'Documents/ComfyUI/.venv/Lib/site-packages/comfyui_frontend_package/static'
$canvasRepo = Join-Path $env:USERPROFILE 'Documents/ComfyUI/custom_nodes/ComfyUI-DAELab-Creative-Canvas'
$canvasSha = '785bad3441550f580cb42b7a9532cc0f4ee547f9'
$coreSha = '7a0b5eede3f9721c8faab290689893f36edc6d66'
if ((git -C $core rev-parse HEAD) -ne $coreSha) { throw 'Core revision drift; revalidate the dependency lock.' }
if (git -C $core status --porcelain --untracked-files=no) { throw 'Core has tracked modifications.' }
if (Test-Path -LiteralPath (Join-Path $core 'extra_model_paths.yaml')) { throw 'Core automatic extra-model configuration must be absent.' }
if ((& $python -c "import importlib.metadata;print(importlib.metadata.version('comfyui-frontend-package'))") -ne '1.52.7') { throw 'Frontend version drift.' }
if (!(Test-Path -LiteralPath (Join-Path $business '__init__.py'))) { throw 'Expected business worktree is missing.' }
if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw "Port $port is occupied. Stop only the previously verified isolated service before reassembly." }
foreach ($name in @('', 'user', 'input', 'output', 'temp', 'custom_nodes', 'logs', 'dependencies')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $base $name) | Out-Null
}
$pluginPath = Join-Path $base 'custom_nodes/ComfyUI-DAELab-Custom-Nodes-Library'
if (Test-Path -LiteralPath $pluginPath) {
    $existing = Get-Item -LiteralPath $pluginPath
    if ($existing.LinkType -ne 'Junction' -or [IO.Path]::GetFullPath($existing.Target) -ne [IO.Path]::GetFullPath($business)) { throw 'Business assembly target mismatch.' }
} else {
    New-Item -ItemType Junction -Path $pluginPath -Target $business | Out-Null
}
$canvasPath = Join-Path $base 'custom_nodes/ComfyUI-DAELab-Creative-Canvas'
if ($Canvas -eq 'none' -and (Test-Path -LiteralPath $canvasPath)) {
    throw 'This installation contains Canvas. Use a clean base or explicitly remove only its verified junction first.'
}
if ($Canvas -eq 'locked') {
    $canvasSource = Join-Path $base "dependencies/canvas-$canvasSha"
    $canvasArchive = Join-Path $base "dependencies/canvas-$canvasSha.tar"
    $canvasHashes = Join-Path $base "dependencies/canvas-$canvasSha.sha256.json"
    if (!(Test-Path -LiteralPath $canvasSource)) {
        git -C $canvasRepo archive --format=tar --output=$canvasArchive $canvasSha
        if ($LASTEXITCODE -ne 0) { throw 'Canvas archive failed.' }
        New-Item -ItemType Directory -Path $canvasSource | Out-Null
        tar.exe -xf $canvasArchive -C $canvasSource
        if ($LASTEXITCODE -ne 0) { throw 'Canvas extraction failed.' }
        $hashes = Get-ChildItem -LiteralPath $canvasSource -Recurse -File | ForEach-Object {
            @{ path = [IO.Path]::GetRelativePath($canvasSource, $_.FullName); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
        }
        ConvertTo-Json -InputObject @($hashes) -Depth 5 | Set-Content -LiteralPath $canvasHashes -Encoding utf8
    }
    foreach ($entry in (Get-Content -LiteralPath $canvasHashes -Raw | ConvertFrom-Json)) {
        if ((Get-FileHash -LiteralPath (Join-Path $canvasSource $entry.path) -Algorithm SHA256).Hash -ne $entry.sha256) { throw "Canvas archive content drift: $($entry.path)" }
    }
    if (!(Test-Path -LiteralPath $canvasPath)) { New-Item -ItemType Junction -Path $canvasPath -Target $canvasSource | Out-Null }
    $existingCanvas = Get-Item -LiteralPath $canvasPath
    if ($existingCanvas.LinkType -ne 'Junction' -or [IO.Path]::GetFullPath($existingCanvas.Target) -ne [IO.Path]::GetFullPath($canvasSource)) { throw 'Canvas assembly target mismatch.' }
}
$expectedPlugins = if ($Canvas -eq 'locked') { 2 } else { 1 }
if (@(Get-ChildItem -LiteralPath (Join-Path $base 'custom_nodes')).Count -ne $expectedPlugins) { throw 'Unexpected plugins in assembly directory.' }
$dependenciesJson = & $python -c "import importlib.metadata as m,json,platform;print(json.dumps({'python':platform.python_version(),'packages':{d.metadata['Name']:d.version for d in m.distributions()}}))"
$dependencies = $dependenciesJson | ConvertFrom-Json
if ($dependencies.python -ne $runtimeLock.dependencies.python) { throw 'Python version drift.' }
$actualPackages = @($dependencies.packages.PSObject.Properties | ForEach-Object { "$($_.Name)==$($_.Value)" } | Sort-Object)
$lockedPackages = @($runtimeLock.dependencies.packages.PSObject.Properties | ForEach-Object { "$($_.Name)==$($_.Value)" } | Sort-Object)
if (Compare-Object $lockedPackages $actualPackages) { throw 'Installed dependency versions drifted; revalidate the lock before starting.' }
if ((Get-FileHash -LiteralPath (Join-Path $frontend 'index.html') -Algorithm SHA256).Hash -ne $runtimeLock.frontendIndexSha256) { throw 'Frontend artifact drift.' }
$arguments = @('-s', (Join-Path $core 'main.py'), '--cpu', '--listen', '127.0.0.1', '--port', "$port",
    '--base-directory', $base, '--user-directory', (Join-Path $base 'user'),
    '--input-directory', (Join-Path $base 'input'), '--output-directory', (Join-Path $base 'output'),
    '--temp-directory', (Join-Path $base 'temp'), '--database-url', ('sqlite:///' + (Join-Path $base 'user/comfyui.db').Replace('\', '/')),
    '--front-end-root', $frontend, '--disable-auto-launch', '--feature-flag', 'show_signin_button=true')
$record = [ordered]@{
    role = $Role; url = "http://127.0.0.1:$port"; businessPath = $business;
    pluginPath = $pluginPath; businessSha = (git -C $business rev-parse HEAD);
    businessStatus = @(git -C $business status --porcelain); corePath = $core; coreSha = $coreSha;
    frontendVersion = '1.52.7'; frontendPath = $frontend;
    frontendIndexSha256 = (Get-FileHash -LiteralPath (Join-Path $frontend 'index.html') -Algorithm SHA256).Hash;
    canvasMode = $Canvas; canvasSha = $(if ($Canvas -eq 'locked') { $canvasSha } else { $null });
    baseDirectory = $base; pythonPath = $python; dependencies = $dependencies;
    arguments = $arguments; recordedAt = (Get-Date).ToUniversalTime().ToString('o');
    extraModelPathsConfig = $null; managerEnabled = $false; paidRequests = 0
}
$record | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $base 'environment.json') -Encoding utf8
if ($Start) {
    # Hide the helper window. Arguments are paths assembled above, never user-provided shell code.
    $quotedArguments = $arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }
    $process = Start-Process -FilePath $python -ArgumentList $quotedArguments -WorkingDirectory $base -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $base 'logs/stdout.log') -RedirectStandardError (Join-Path $base 'logs/stderr.log')
    $process.Id | Set-Content -LiteralPath (Join-Path $base 'launcher.pid')
    Write-Output "Started isolated role $Role ($Canvas), PID $($process.Id), http://127.0.0.1:$port"
} else { Write-Output "Prepared isolated role $Role ($Canvas), http://127.0.0.1:$port" }
