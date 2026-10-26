param(
  [Parameter(Mandatory = $true)][string]$SourceDirectory,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [ValidateRange(300, 2400)][int]$MaxEdge = 1200
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$coreSourcePath = (Resolve-Path -LiteralPath $SourceDirectory).Path
$coreOutputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $coreOutputPath -Force | Out-Null
$coreManifest = @()
foreach ($coreSource in Get-ChildItem -LiteralPath $coreSourcePath -File | Where-Object { $_.Extension -in '.emf', '.wmf' }) {
  $coreMetafile = $null
  $coreBitmap = $null
  $coreGraphics = $null
  try {
    $coreMetafile = [System.Drawing.Imaging.Metafile]::new($coreSource.FullName)
    $coreScale = [Math]::Min(1.0, $MaxEdge / [double][Math]::Max($coreMetafile.Width, $coreMetafile.Height))
    $coreWidth = [Math]::Max(1, [int][Math]::Round($coreMetafile.Width * $coreScale))
    $coreHeight = [Math]::Max(1, [int][Math]::Round($coreMetafile.Height * $coreScale))
    $coreBitmap = [System.Drawing.Bitmap]::new($coreWidth, $coreHeight)
    $coreGraphics = [System.Drawing.Graphics]::FromImage($coreBitmap)
    $coreGraphics.Clear([System.Drawing.Color]::White)
    $coreGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $coreGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $coreGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $coreGraphics.DrawImage($coreMetafile, [System.Drawing.Rectangle]::new(0, 0, $coreWidth, $coreHeight))
    $coreOriginalHash = (Get-FileHash -LiteralPath $coreSource.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $coreRenderedPath = [System.IO.Path]::Combine($coreOutputPath, $coreOriginalHash.Substring(0, 20) + '.png')
    $coreBitmap.Save($coreRenderedPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $coreRenderedHash = (Get-FileHash -LiteralPath $coreRenderedPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $coreManifest += [ordered]@{
      sourceFile = $coreSource.Name
      sourceSha256 = $coreOriginalHash
      assetFile = [System.IO.Path]::GetFileName($coreRenderedPath)
      sha256 = $coreRenderedHash
      width = $coreWidth
      height = $coreHeight
      bytes = (Get-Item -LiteralPath $coreRenderedPath).Length
    }
  } finally {
    if ($null -ne $coreGraphics) { $coreGraphics.Dispose() }
    if ($null -ne $coreBitmap) { $coreBitmap.Dispose() }
    if ($null -ne $coreMetafile) { $coreMetafile.Dispose() }
  }
}
$coreManifestPath = [System.IO.Path]::Combine($coreOutputPath, 'render-manifest.json')
[System.IO.File]::WriteAllText($coreManifestPath, (ConvertTo-Json -InputObject @($coreManifest) -Depth 6), [System.Text.UTF8Encoding]::new($false))
Write-Output ('Rendered ' + $coreManifest.Count + ' source metafiles; manifest: ' + $coreManifestPath)