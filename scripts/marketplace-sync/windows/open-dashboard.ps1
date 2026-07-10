$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
Set-Location $root
$url = "http://127.0.0.1:8787"
Start-Process $url
npm run marketplace:dashboard
