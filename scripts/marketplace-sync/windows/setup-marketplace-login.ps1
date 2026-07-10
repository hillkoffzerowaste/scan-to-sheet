param(
  [ValidateSet("all", "tiktok", "shopee", "lazada")]
  [string]$Platform = "all"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
Set-Location $root
npm run marketplace:login -- $Platform
