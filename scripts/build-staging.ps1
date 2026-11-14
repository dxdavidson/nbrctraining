# Builds the staging frontend for public_html/trainingdev. Run from anywhere:
#   .\scripts\build-staging.ps1
# Output: dist-staging\ and dist-staging.zip (upload and extract the zip; it includes .htaccess).
param(
  [string]$BasePath = '/trainingdev/',
  [string]$ApiUrl = 'https://nbrctraining-staging.up.railway.app',
  [string]$Label = 'STAGING'
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$names = 'BASE_PATH', 'VITE_API_BASE_URL', 'VITE_ENV_LABEL'
$saved = @{}
foreach ($n in $names) { $saved[$n] = [Environment]::GetEnvironmentVariable($n, 'Process') }

try {
  $env:BASE_PATH = $BasePath
  $env:VITE_API_BASE_URL = $ApiUrl
  $env:VITE_ENV_LABEL = $Label

  npm run build -- --outDir dist-staging --emptyOutDir
  if ($LASTEXITCODE -ne 0) { throw 'Build failed' }

  $htaccess = Join-Path 'dist-staging' '.htaccess'
  $text = Get-Content $htaccess -Raw
  $text = $text -replace '(?m)^RewriteBase .*$', "RewriteBase $BasePath"
  $text = $text -replace '(?m)^# NBRC Training SPA, deployed at .*$', "# NBRC Training SPA (staging), deployed at $BasePath"
  Set-Content -Path $htaccess -Value $text -NoNewline

  # tar.exe writes forward-slash zip paths and includes dotfiles, unlike Compress-Archive in Windows PowerShell 5.
  $zip = Join-Path (Get-Location) 'dist-staging.zip'
  if (Test-Path $zip) { Remove-Item $zip }
  tar.exe -a -c -f $zip -C dist-staging .
  if ($LASTEXITCODE -ne 0) { throw 'Zip failed' }

  Write-Host "`nDone. Upload and extract $zip in public_html$($BasePath.TrimEnd('/'))" -ForegroundColor Green
}
finally {
  foreach ($n in $names) { [Environment]::SetEnvironmentVariable($n, $saved[$n], 'Process') }
}
