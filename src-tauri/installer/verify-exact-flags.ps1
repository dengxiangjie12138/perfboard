param([string]$ToolsRoot = (Join-Path $env:TEMP 'perfboard-nsis-validation'))
$ErrorActionPreference = 'Stop'
$template = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'installer.nsi')
$helperStart = $template.IndexOf('Var PerfboardRunAfterInstall')
$helperEnd = $template.IndexOf('FunctionEnd', $helperStart) + 'FunctionEnd'.Length
$helper = $template.Substring($helperStart, $helperEnd - $helperStart)
$tests = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'exact-flag-tests.nsi')
$outPath = Join-Path $ToolsRoot 'exact-flag-tests.exe'
$logPath = Join-Path $ToolsRoot 'exact-flag-tests.txt'
$sourcePath = Join-Path $ToolsRoot 'exact-flag-tests.nsi'
$tests = $tests.Replace('__HELPER__', $helper).Replace('__OUTFILE__', $outPath).Replace('__LOGFILE__', $logPath)
[IO.File]::WriteAllText($sourcePath, $tests, [Text.UTF8Encoding]::new($true))
$compiler = Join-Path $ToolsRoot 'nsis-3.11\makensis.exe'
& $compiler /INPUTCHARSET UTF8 /V2 $sourcePath
if ($LASTEXITCODE -ne 0) { throw 'Exact-flag helper compilation failed.' }
$process = Start-Process -FilePath $outPath -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
Get-Content -Encoding Unicode -LiteralPath $logPath
if ($process.ExitCode -ne 0) { throw "Exact-flag tests failed: $($process.ExitCode)" }
Write-Output '12 exact argv flag tests passed; no installer was launched.'
