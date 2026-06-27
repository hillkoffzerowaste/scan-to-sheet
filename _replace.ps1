$path = "c:\Users\Office14\Documents\scan to sheet\src\App.jsx"
$content = [System.IO.File]::ReadAllText($path)

# Fix 1: saveScannedCode
$old1 = @"
        fetchTodaySummary({ token, config }).then((data) => {
          if (data) {
            setPackerCounts(data.packerCounts);
            setSummary(data.courierCounts);
          }
        }).catch(() => {});
"@
$new1 = "        scheduleCountRefresh();"

# Fix 2: refreshSelectedCourierRows  
$old2 = @"
        fetchTodaySummary({ token, config }).then((data) => {
          if (data) {
            setSummary(data.courierCounts);
            setPackerCounts(data.packerCounts);
          }
        }).catch(() => {});
"@
$new2 = "        scheduleCountRefresh();"

$content = $content.Replace($old1, $new1)
$content = $content.Replace($old2, $new2)

[System.IO.File]::WriteAllText($path, $content)
Write-Output "Done"
