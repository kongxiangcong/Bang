param([string]$Workspace = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path)
$bangHome = Join-Path $Workspace '.bang'
$runtimeFile = Join-Path $bangHome 'runtime\bang.mjs'
if (!(Test-Path -LiteralPath $runtimeFile)) { throw '先运行 Bang init' }
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
Start-Process -FilePath $nodeExecutable -ArgumentList @(('"' + $runtimeFile + '"'), 'watch', '--workspace', ('"' + $Workspace + '"')) -WorkingDirectory $bangHome -WindowStyle Hidden -RedirectStandardOutput (Join-Path $bangHome 'logs\watch.stdout.log') -RedirectStandardError (Join-Path $bangHome 'logs\watch.stderr.log')
