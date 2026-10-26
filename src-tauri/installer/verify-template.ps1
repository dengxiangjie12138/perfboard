param([string]$ToolsRoot = (Join-Path $env:TEMP 'perfboard-nsis-validation'))
$ErrorActionPreference = 'Stop'
$compiler = Join-Path $ToolsRoot 'nsis-3.11\makensis.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw 'Supply ToolsRoot with official NSIS 3.11 and matching Tauri utils, plugin and language includes.' }
$template = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'installer.nsi')
if ($template -match 'RmDir /r(?:\s|$)|DeleteAppDataCheckbox') { throw 'Uninstaller must never remove app data.' }
# Placeholder payloads verify template structure, not production installation.
$rendered = [regex]::Replace($template, '\{\{#each languages\}\}.*?\{\{/each\}\}', '!insertmacro MUI_LANGUAGE "SimpChinese"' + "`n" + '!insertmacro MUI_LANGUAGE "English"', 'Singleline')
$rendered = [regex]::Replace($rendered, '\{\{#each language_files\}\}.*?\{\{/each\}\}', '!include "SimpChinese.nsh"' + "`n" + '!include "English.nsh"', 'Singleline')
do {
  $previous = $rendered
  $rendered = [regex]::Replace($rendered, '\{\{#each [^}]+\}\}(?:(?!\{\{#each).)*?\{\{/each\}\}', '', 'Singleline')
} while ($previous -ne $rendered)
$rendered = [regex]::Replace($rendered, '\{\{#if [^}]+\}\}.*?\{\{/if\}\}', '', 'Singleline')
$values = @{
  compression='lzma'; manufacturer='Perfboard'; product_name='Perfboard'
  version='0.1.0'; version_with_build='0.1.0.0'; install_mode='currentUser'
  main_binary_name='perfboard'; main_binary_path=(Join-Path $env:WINDIR 'System32\cmd.exe')
  bundle_id='com.perfboard.toolbox'; out_file=(Join-Path $ToolsRoot 'template-validation.exe')
  arch='x64'; additional_plugins_path=(Join-Path $ToolsRoot 'nsis-3.11\Plugins\x86-unicode\additional')
  allow_downgrades='true'; display_language_selector='false'
  install_webview2_mode='offlineInstaller'; webview2_installer_args='/silent /install'
  webview2_installer_path=(Join-Path $env:WINDIR 'System32\cmd.exe'); estimated_size='1024'
}
$rendered = [regex]::Replace($rendered, '\{\{([a-z0-9_]+)\}\}', { param($match) [string]$values[$match.Groups[1].Value] })
if ($rendered.Contains('{{')) { throw ('Unresolved Handlebars expression: ' + ([regex]::Matches($rendered, '\{\{.*?\}\}').Value -join ', ')) }
$renderedPath = Join-Path $ToolsRoot 'rendered-validation.nsi'
[IO.File]::WriteAllText($renderedPath, $rendered, [Text.UTF8Encoding]::new($true))
Push-Location -LiteralPath $ToolsRoot
try {
  & $compiler /INPUTCHARSET UTF8 /V3 $renderedPath
  if ($LASTEXITCODE -ne 0) { throw "Full template compilation failed: $LASTEXITCODE" }
} finally { Pop-Location }
$guardStart = $template.IndexOf('Function PerfboardRepositoryCheck')
$guardEnd = $template.IndexOf('FunctionEnd', $guardStart) + 'FunctionEnd'.Length
$guard = $template.Substring($guardStart, $guardEnd - $guardStart)
$fixture = Join-Path $ToolsRoot 'path-fixtures'
New-Item -ItemType Directory -Path (Join-Path $fixture 'not-empty') -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $fixture 'not-empty\owned-fixture.txt'), 'test fixture')
[IO.File]::WriteAllText((Join-Path $fixture 'is-file.txt'), 'test fixture')
New-Item -ItemType Directory -Path (Join-Path $fixture 'junction-target') -Force | Out-Null
if (!(Test-Path -LiteralPath (Join-Path $fixture 'junction'))) {
  New-Item -ItemType Junction -Path (Join-Path $fixture 'junction') -Target (Join-Path $fixture 'junction-target') | Out-Null
}
$guardHarness = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'repository-guard-tests.nsi')
$guardExe = Join-Path $ToolsRoot 'repository-guard-tests.exe'
$logFile = Join-Path $ToolsRoot 'repository-guard-tests.txt'
$guardHarness = $guardHarness.Replace('__OUTFILE__', $guardExe).Replace('__FIXTURE__', $fixture).Replace('__LOGFILE__', $logFile).Replace('__GUARD__', $guard)
$guardPath = Join-Path $ToolsRoot 'repository-guard-tests.nsi'
[IO.File]::WriteAllText($guardPath, $guardHarness, [Text.UTF8Encoding]::new($true))
& $compiler /INPUTCHARSET UTF8 /V2 $guardPath
if ($LASTEXITCODE -ne 0) { throw "Guard test compilation failed: $LASTEXITCODE" }
$testProcess = Start-Process -FilePath $guardExe -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
Get-Content -Encoding Unicode -LiteralPath $logFile
if ($testProcess.ExitCode -ne 0) { throw "Repository guard tests failed: $($testProcess.ExitCode)" }
Write-Output 'Full template compiled; 15 native directory guard tests passed.'




