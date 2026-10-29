param([string]$ToolsRoot = (Join-Path $env:TEMP 'perfboard-nsis-validation'))
$ErrorActionPreference = 'Stop'
$compiler = Join-Path $ToolsRoot 'nsis-3.11\makensis.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw 'Supply ToolsRoot with official NSIS 3.11.' }
$template = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'installer.nsi')
function Read-TemplateFunction([string]$Name) {
  $match = [regex]::Match($template, '(?ms)^Function ' + [regex]::Escape($Name) + '\r?\n.*?^FunctionEnd\b')
  if (!$match.Success) { throw "Missing template function: $Name" }
  $match.Value
}
# Page callbacks must bypass all repository UI and validation in update mode.
foreach ($name in @('PerfboardRepositoryInit', 'PerfboardRepositoryLeave', 'PerfboardRepositoryCheck', 'PerfboardRepositoryFinish')) {
  $body = Read-TemplateFunction $name
  if ($body -notmatch '(?s)^Function [^\r\n]+\r?\n(?:  StrCpy \$RepositoryExitCode 0\r?\n)?  \$\{If\} \$UpdateMode = 1\r?\n(?:    StrCpy \$RepositoryExitCode 0\r?\n)?    Return\r?\n  \$\{EndIf\}') {
    throw "Repository operation is not guarded before side effects: $name"
  }
}
if ((Read-TemplateFunction 'PerfboardRepositoryPage') -notmatch '(?s)^Function [^\r\n]+\r?\n  \$\{If\} \$PassiveMode = 1\r?\n  \$\{OrIf\} \$UpdateMode = 1\r?\n    Abort') {
  throw 'The repository page must be skipped in update mode.'
}
if ($template -notmatch '(?s)Section EarlyChecks\r?\n  Call PerfboardInstallationPathCheck.*?Call PerfboardRepositoryCheck') {
  throw 'Independent installation-directory validation must run before repository checks.'
}

$helpers = @('PerfboardParseUpdateFlag', 'PerfboardNormalizeInstallDirectory', 'PerfboardInstallationPathCheck',
  'PerfboardUpdateRegistrationCheck', 'PerfboardRepositoryInit', 'PerfboardRepositoryCheck', 'PerfboardRepositoryFinish') |
  ForEach-Object { Read-TemplateFunction $_ }
$source = $helpers -join "`r`n"
# Replace all external side effects in the extracted production functions with
# in-memory fixtures/counters. Never read or write even a temporary HKCU key.
$registry = @{
  'ReadRegStr $1 HKCU "${MANUPRODUCTKEY}" ""' = 'StrCpy $1 $RegisteredDirectory'
  'ReadRegStr $1 HKCU "${UNINSTKEY}" "InstallLocation"' = 'StrCpy $1 $RegisteredLocation'
  'ReadRegStr $1 HKCU "${UNINSTKEY}" "DisplayName"' = 'StrCpy $1 $RegisteredName'
  'ReadRegStr $1 HKCU "${UNINSTKEY}" "Publisher"' = 'StrCpy $1 $RegisteredPublisher'
  'ReadRegStr $1 HKCU "${UNINSTKEY}" "MainBinaryName"' = 'StrCpy $1 $RegisteredBinary'
  'ReadRegStr $1 HKCU "${UNINSTKEY}" "UninstallString"' = 'StrCpy $1 $RegisteredUninstaller'
  'ReadRegStr $0 HKCU "${MANUPRODUCTKEY}" "RepositoryPath"' = "IntOp `$RepositoryReads `$RepositoryReads + 1`r`n  StrCpy `$0 `$RepositoryPointer"
  'WriteRegStr HKCU "${MANUPRODUCTKEY}" "RepositoryPath" "$RepositoryPath"' = "IntOp `$PointerWrites `$PointerWrites + 1`r`n  StrCpy `$RepositoryPointer `$RepositoryPath"
}
foreach ($entry in $registry.GetEnumerator()) {
  if (!$source.Contains($entry.Key)) { throw ('Missing expected registry operation: ' + $entry.Key) }
  $source = $source.Replace($entry.Key, $entry.Value)
}
$calls = [regex]::Matches($source, '(?m)^  (?:  )?ExecWait [^\r\n]+')
if ($calls.Count -ne 2) { throw 'Expected exactly two repository helper invocations.' }
$source = [regex]::Replace($source, '(?m)^  (?:  )?ExecWait [^\r\n]+', "  IntOp `$RepositoryCalls `$RepositoryCalls + 1`r`n  StrCpy `$RepositoryExitCode 0")
$source = [regex]::Replace($source, '(?m)^\s*MessageBox [^\r\n]+', '      FileWriteUTF16LE $TestLog "ordinary missing repository rejected$\r$\n"')
if ($source -match '(?im)^\s*(ReadRegStr|WriteRegStr|ExecWait|Delete|RMDir)\b') {
  throw 'An external operation remained in the isolated helper harness.'
}
$fixture = Join-Path $ToolsRoot 'update-fixtures'
foreach ($directory in @('program', 'missing-main', 'missing-uninstaller', 'directory-binary\perfboard.exe', 'existing-repository', 'junction-target')) {
  New-Item -ItemType Directory -Path (Join-Path $fixture $directory) -Force | Out-Null
}
foreach ($file in @('program\perfboard.exe', 'program\uninstall.exe', 'missing-main\uninstall.exe',
    'missing-uninstaller\perfboard.exe', 'directory-binary\uninstall.exe', 'is-file.txt', 'existing-repository\perfboard.sqlite3')) {
  [IO.File]::WriteAllText((Join-Path $fixture $file), 'Non-executable fixture. No application or database is opened.')
}
if (!(Test-Path -LiteralPath (Join-Path $fixture 'junction'))) {
  New-Item -ItemType Junction -Path (Join-Path $fixture 'junction') -Target (Join-Path $fixture 'junction-target') | Out-Null
}
$harness = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'update-mode-tests.nsi')
$outPath = Join-Path $ToolsRoot 'update-mode-tests.exe'
$logPath = Join-Path $ToolsRoot 'update-mode-tests.txt'
$sourcePath = Join-Path $ToolsRoot 'update-mode-tests.nsi'
$harness = $harness.Replace('__HELPERS__', $source).Replace('__OUTFILE__', $outPath).Replace('__LOGFILE__', $logPath).Replace('__FIXTURE__', $fixture)
[IO.File]::WriteAllText($sourcePath, $harness, [Text.UTF8Encoding]::new($true))
& $compiler /INPUTCHARSET UTF8 /V2 $sourcePath
if ($LASTEXITCODE -ne 0) { throw 'Update-mode helper compilation failed.' }
$oldTemp = $env:TEMP
$oldTmp = $env:TMP
try {
  $env:TEMP = Join-Path $ToolsRoot 'update-temp'
  $env:TMP = $env:TEMP
  New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
  $runs = @(
    @{Arguments='/S'; ExitCode=0},
    @{Arguments=('/S /ORDINARY /REPOSITORY="' + (Join-Path $fixture 'existing-repository') + '" /REUSE'); ExitCode=0},
    @{Arguments='/S /ORDINARY'; ExitCode=2}
  )
  for ($i = 0; $i -lt $runs.Count; $i++) {
    $process = Start-Process -FilePath $outPath -ArgumentList $runs[$i].Arguments -WindowStyle Hidden -PassThru -Wait
    $log = Get-Content -Raw -Encoding Unicode -LiteralPath $logPath
    [IO.File]::WriteAllText((Join-Path $ToolsRoot "update-mode-tests-run-$i.txt"), $log)
    if ($process.ExitCode -ne $runs[$i].ExitCode) { throw "Update-mode run $i failed: $($process.ExitCode)" }
    if ($runs[$i].ExitCode -eq 0) {
      if ($log -notmatch 'checks=(\d+) failures=0') { throw "Update-mode run $i reported a failure." }
      Write-Output "Run ${i}: $($matches[0])"
    } elseif ($log -notmatch 'ordinary missing repository rejected') {
      throw 'Ordinary silent installation did not reject the missing repository argument.'
    } else {
      Write-Output 'Run 2: ordinary silent installation rejects missing repository arguments (exit 2).'
    }
  }
} finally {
  $env:TEMP = $oldTemp
  $env:TMP = $oldTmp
}
Write-Output 'Update-mode checks passed. Only isolated helper EXEs ran; no registry access, application launch, installation or database operation occurred.'
