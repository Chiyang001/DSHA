$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$archivePath = Join-Path $projectRoot 'vendor/nodejs-mobile-android-24.21.0-0.zip'
$expectedHash = 'E3CD29A1BE03405F11DD5C857AF8CD3AD13F84F1409EA648F5328F0BADA5BD76'
$url = 'https://github.com/fogtape/nodejs-mobile/releases/download/v24.21.0-0/nodejs-mobile-android-24.21.0-0.zip'
New-Item -ItemType Directory -Force (Split-Path $archivePath) | Out-Null
if (-not (Test-Path $archivePath)) { Invoke-WebRequest -Uri $url -OutFile $archivePath }
$actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
if ($actualHash -ne $expectedHash) { throw "Node 移动运行时校验失败：$actualHash" }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    foreach ($entry in $archive.Entries) {
        if ($entry.FullName -eq 'bin/arm64-v8a/libnode.so') {
            $target = Join-Path $projectRoot 'app/src/main/jniLibs/arm64-v8a/libnode.so'
        } elseif ($entry.FullName.StartsWith('include/node/') -and -not $entry.FullName.EndsWith('/')) {
            $target = Join-Path $projectRoot ('app/libnode/' + $entry.FullName)
        } else { continue }
        New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
    }
} finally { $archive.Dispose() }
Write-Output 'Node 24.21.0 Android arm64 运行时已准备好。'
