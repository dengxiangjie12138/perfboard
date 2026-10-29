param(
  [Parameter(Mandatory)][string]$ApplicationExe,
  [Parameter(Mandatory)][string]$ValidationRoot,
  [string]$ToolsRoot = (Join-Path $env:TEMP 'perfboard-nsis-validation'),
  [string]$PreviousApplicationExe,
  [string]$ExpectedApplicationVersion,
  [ValidatePattern('^PerfboardUpdateValidation-[0-9a-fA-F]{32}$')][string]$ValidationProductName,
  [ValidateSet('PerfboardValidation','perfboard')][string]$ValidationManufacturer = 'PerfboardValidation',
  [ValidatePattern('^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$')][string]$InitialVersion = '0.0.1',
  [ValidatePattern('^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$')][string]$UpdateVersion = '0.0.2',
  [switch]$AllowDowngrades,
  [switch]$Execute
)
$ErrorActionPreference = 'Stop'
if (!$ExpectedApplicationVersion) {
  $configuration = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot '..\tauri.conf.json') | ConvertFrom-Json
  $ExpectedApplicationVersion = $configuration.version
}
$compiler = Join-Path $ToolsRoot 'nsis-3.11\makensis.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw 'Supply ToolsRoot with the official NSIS 3.11 and Tauri includes/plugins.' }
if (!(Test-Path -LiteralPath $ApplicationExe -PathType Leaf)) { throw 'ApplicationExe must be an existing application build.' }
$applicationInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo([IO.Path]::GetFullPath($ApplicationExe))
if ($applicationInfo.ProductVersion -notin @($ExpectedApplicationVersion, ($ExpectedApplicationVersion + '.0'))) {
  throw "Refusing stale application payload: expected ProductVersion $ExpectedApplicationVersion, got $($applicationInfo.ProductVersion)."
}
if ([IO.Path]::GetFileName($ApplicationExe) -ine 'perfboard.exe') { throw 'ApplicationExe must retain the perfboard.exe payload filename.' }
if (!$PreviousApplicationExe) { $PreviousApplicationExe = $ApplicationExe }
if (!(Test-Path -LiteralPath $PreviousApplicationExe -PathType Leaf)) { throw 'PreviousApplicationExe is missing.' }
foreach ($version in @($InitialVersion,$UpdateVersion)) {
  foreach ($component in $version.Split('.')) {
    if ([long]$component -gt 65535) { throw 'NSIS validation versions must have three numeric components between 0 and 65535.' }
  }
}
if ([version]$UpdateVersion -le [version]$InitialVersion) { throw 'UpdateVersion must be greater than InitialVersion.' }
$validation = [IO.Path]::GetFullPath($ValidationRoot).TrimEnd('\')
if (![IO.Path]::IsPathRooted($ValidationRoot) -or $validation.Length -lt 12 -or (Test-Path -LiteralPath $validation)) {
  throw 'ValidationRoot must name a new, absolute, dedicated validation directory.'
}
$token = if ($ValidationProductName) { $ValidationProductName.Substring('PerfboardUpdateValidation-'.Length).ToLowerInvariant() } else { [Guid]::NewGuid().ToString('N') }
$product = if ($ValidationProductName) { $ValidationProductName } else { 'PerfboardUpdateValidation-' + $token }
$manufacturer = $ValidationManufacturer
$productKey = 'Software\' + $manufacturer + '\' + $product
$uninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\' + $product
$program = Join-Path $validation 'program'
$repository = Join-Path $validation 'repository'
$disconnected = Join-Path $validation 'repository-disconnected'
$appdata = Join-Path $validation 'appdata'
$temp = Join-Path $validation 'temp'
$config = Join-Path $appdata 'com.perfboard.toolbox'
$pointer = Join-Path $config 'repository.json'
$savedPointer = Join-Path $validation 'repository-pointer.saved.json'
New-Item -ItemType Directory -Path $validation,$temp,$appdata -Force | Out-Null
foreach ($include in @('utils.nsh','FileAssociation.nsh','SimpChinese.nsh','English.nsh')) {
  Copy-Item -LiteralPath (Join-Path $ToolsRoot $include) -Destination (Join-Path $validation $include)
}
$template = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'installer.nsi')

function Build-ValidationInstaller([string]$Version, [string]$Payload, [string]$Output) {
  # Render the real production template, changing only product identity and payload.
  # Resource loops are omitted: this is an installer/data-preservation integration test.
  $rendered = [regex]::Replace($template, '\{\{#each languages\}\}.*?\{\{/each\}\}', '!insertmacro MUI_LANGUAGE "SimpChinese"' + "`n" + '!insertmacro MUI_LANGUAGE "English"', 'Singleline')
  $rendered = [regex]::Replace($rendered, '\{\{#each language_files\}\}.*?\{\{/each\}\}', '!include "SimpChinese.nsh"' + "`n" + '!include "English.nsh"', 'Singleline')
  do {
    $previous = $rendered
    $rendered = [regex]::Replace($rendered, '\{\{#each [^}]+\}\}(?:(?!\{\{#each).)*?\{\{/each\}\}', '', 'Singleline')
  } while ($previous -ne $rendered)
  $rendered = [regex]::Replace($rendered, '\{\{#if [^}]+\}\}.*?\{\{/if\}\}', '', 'Singleline')
  $values = @{
    compression='lzma'; manufacturer=$manufacturer; product_name=$product
    version=$Version; version_with_build=($Version + '.0'); install_mode='currentUser'
    main_binary_name='perfboard'; main_binary_path=([IO.Path]::GetFullPath($Payload))
    bundle_id=('com.perfboard.validation.' + $token); out_file=$Output
    arch='x64'; additional_plugins_path=(Join-Path $ToolsRoot 'nsis-3.11\Plugins\x86-unicode\additional')
    allow_downgrades=$(if ($AllowDowngrades) {'true'} else {'false'}); display_language_selector='false'
    # Skip runtime installation completely; tests never launch a WebView.
    install_webview2_mode='skip'; estimated_size='1024'
  }
  $rendered = [regex]::Replace($rendered, '\{\{([a-z0-9_]+)\}\}', { param($match) [string]$values[$match.Groups[1].Value] })
  if ($rendered.Contains('{{')) { throw 'The rendered validation installer contains unresolved expressions.' }
  $sourcePath = $Output + '.nsi'
  [IO.File]::WriteAllText($sourcePath, $rendered, [Text.UTF8Encoding]::new($true))
  Push-Location -LiteralPath $ToolsRoot
  try {
    & $compiler /INPUTCHARSET UTF8 /V2 $sourcePath
    if ($LASTEXITCODE -ne 0) { throw "Validation installer compilation failed: $LASTEXITCODE" }
  } finally { Pop-Location }
}

$initialInstaller = Join-Path $validation ('initial-' + $InitialVersion + '-setup.exe')
$updateInstaller = Join-Path $validation ('update-' + $UpdateVersion + '-setup.exe')
Build-ValidationInstaller $InitialVersion $PreviousApplicationExe $initialInstaller
Build-ValidationInstaller $UpdateVersion $ApplicationExe $updateInstaller
$plan = [ordered]@{
  validationRoot=$validation; productName=$product; manufacturer=$manufacturer
  registryView='Registry64'; hive='CurrentUser'; productKey=$productKey; uninstallKey=$uninstallKey
  programDirectory=$program; repositoryDirectory=$repository; applicationConfigDirectory=$config
  initialInstaller=$initialInstaller; updateInstaller=$updateInstaller
  applicationVersion=$applicationInfo.ProductVersion
  initialVersion=$InitialVersion; updateVersion=$UpdateVersion
  applicationSha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $ApplicationExe).Hash
  previousApplicationSha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $PreviousApplicationExe).Hash
  runs=@('ordinary silent install with explicit synthetic repository',
    'update with connected repository', 'update without configured repository',
    'update with disconnected repository', 'uninstall isolated validation product')
  safeguards=@('unique product/registry keys', 'no UI startup or /R', '/NS disables shortcut creation',
    'APPDATA/TEMP/TMP redirected', 'no real user database/configuration used',
    'registry cleanup limited to the generated product keys')
  scope='Real NSIS integration; not a substitute for the application-side updater/signature/network integration.'
}
$planPath = Join-Path $validation 'plan.json'
[IO.File]::WriteAllText($planPath, ($plan | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
Write-Output "Prepared isolated validation plan: $planPath"
if (!$Execute) {
  Write-Output 'Preparation only. No installer/application was launched and no registry key or database was accessed.'
  return
}
foreach ($targetPath in @($program,$repository,$disconnected,$appdata,$temp,$config,$pointer,$savedPointer)) {
  $absoluteTarget = [IO.Path]::GetFullPath($targetPath)
  if (!$absoluteTarget.StartsWith($validation + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'An installation/move target escaped the dedicated validation directory.'
  }
}

function Registry-Value([string]$Subkey, [string]$Name) {
  $key = $script:validationHive.OpenSubKey($Subkey, $false)
  if (!$key) { return $null }
  try { $key.GetValue($Name, $null) } finally { $key.Dispose() }
}
function Run-Installer([string]$Executable, [string]$Arguments) {
  $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -WindowStyle Hidden -PassThru -Wait
  if ($process.ExitCode -ne 0) { throw "Isolated installer failed with exit $($process.ExitCode)." }
}
function Tree-Digest([string]$Directory) {
  $rows = Get-ChildItem -LiteralPath $Directory -File -Recurse | Sort-Object FullName | ForEach-Object {
    $_.FullName.Substring($Directory.Length) + ':' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
  }
  $rows -join "`n"
}
function Assert-DataPreserved([string]$Directory, [string]$Expected, [string]$ExpectedPointerHash) {
  if ((Tree-Digest $Directory) -cne $Expected) { throw 'Isolated repository bytes changed during update/uninstall.' }
  if ($ExpectedPointerHash) {
    if (!(Test-Path -LiteralPath $pointer) -or (Get-FileHash -LiteralPath $pointer -Algorithm SHA256).Hash -cne $ExpectedPointerHash) {
      throw 'Repository JSON pointer changed during update/uninstall.'
    }
  } elseif (Test-Path -LiteralPath $pointer) { throw 'Update created a repository pointer that did not exist.' }
}
$script:validationHive = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
foreach ($keyName in @($productKey,$uninstallKey)) {
  $existing = $script:validationHive.OpenSubKey($keyName, $false)
  if ($existing) { $existing.Dispose(); throw 'The unique validation product is already registered; refusing to overwrite it.' }
}
$oldAppdata = $env:APPDATA
$oldTemp = $env:TEMP
$oldTmp = $env:TMP
try {
  $env:APPDATA=$appdata
  $env:TEMP=$temp
  $env:TMP=$temp
  Run-Installer $initialInstaller ('/S /NS /REPOSITORY="' + $repository + '" /D=' + $program)
  if (!(Test-Path -LiteralPath $pointer) -or !(Test-Path -LiteralPath (Join-Path $repository 'perfboard.sqlite3'))) {
    throw 'Ordinary initial installation did not create the isolated repository/configuration.'
  }
  # Give the empty synthetic repository a nonempty attachment as preservation evidence.
  $attachments = Join-Path $repository 'attachments'
  New-Item -ItemType Directory -Path $attachments -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $attachments 'installer-validation.txt'), $token)
  $repositoryDigest=Tree-Digest $repository
  $pointerHash=(Get-FileHash -LiteralPath $pointer -Algorithm SHA256).Hash
  $registeredPointer=Registry-Value $productKey 'RepositoryPath'
  $updateArgs='/S /P /NS /UPDATE /D=' + $program
  Run-Installer $updateInstaller $updateArgs
  Assert-DataPreserved $repository $repositoryDigest $pointerHash
  if ((Registry-Value $productKey 'RepositoryPath') -cne $registeredPointer) { throw 'Update rewrote the registered repository path.' }
  if ((Registry-Value $uninstallKey 'DisplayVersion') -cne $UpdateVersion) { throw 'The registered program version did not update.' }
  if ((Get-FileHash -LiteralPath (Join-Path $program 'perfboard.exe') -Algorithm SHA256).Hash -cne $plan.applicationSha256) { throw 'Updated application payload does not match the provided build.' }
  Move-Item -LiteralPath $pointer -Destination $savedPointer
  Run-Installer $updateInstaller $updateArgs
  Assert-DataPreserved $repository $repositoryDigest ''
  Move-Item -LiteralPath $savedPointer -Destination $pointer
  Move-Item -LiteralPath $repository -Destination $disconnected
  Run-Installer $updateInstaller $updateArgs
  Assert-DataPreserved $disconnected $repositoryDigest $pointerHash
  if (Test-Path -LiteralPath $repository) { throw 'Update recreated the disconnected repository.' }
  if ((Registry-Value $productKey 'RepositoryPath') -cne $registeredPointer) { throw 'Disconnected update rewrote the registered repository path.' }
  Run-Installer (Join-Path $program 'uninstall.exe') ('/S /P /UPDATE _?=' + $program)
  Assert-DataPreserved $disconnected $repositoryDigest $pointerHash
  # Only these GUID-derived keys were created by this test; never enumerate/delete product siblings.
  foreach ($keyName in @($productKey,$uninstallKey)) {
    $script:validationHive.DeleteSubKeyTree($keyName, $false)
  }
  [IO.File]::WriteAllText((Join-Path $validation 'result.json'), (@{passed=$true; plan=$plan; repositorySha256BeforeAndAfterEqual=$true; pointerPreserved=$true; noRepositoryUpdatesPassed=$true} | ConvertTo-Json -Depth 7))
  Write-Output 'Real isolated first-install/update/uninstall checks passed; synthetic repository and pointer preserved.'
} finally {
  $env:APPDATA=$oldAppdata
  $env:TEMP=$oldTemp
  $env:TMP=$oldTmp
  $script:validationHive.Dispose()
}
