Set-Location "c:\Users\Office14\Documents\scan to sheet"
$out = @()

$out += "=== git add ==="
git add -A 2>&1 | ForEach-Object { $out += $_ }

$out += "=== git commit ==="
git commit -m "fix: all bug fixes" 2>&1 | ForEach-Object { $out += $_ }

$out += "=== git push ==="
git push origin main 2>&1 | ForEach-Object { $out += $_ }

$out += "=== git log -1 ==="
git log -1 --oneline 2>&1 | ForEach-Object { $out += $_ }

$out | Out-File -FilePath "_push_result.txt" -Encoding UTF8
