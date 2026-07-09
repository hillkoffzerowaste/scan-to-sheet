const fs = require('fs');
const path = 'c:/Users/Office14/Documents/scan to sheet/src/App.jsx';
let content = fs.readFileSync(path, 'utf8');

// Fix 1: saveScannedCode - replace fetchTodaySummary after scan with scheduleCountRefresh
content = content.replace(
  /        fetchTodaySummary\(\{ token, config \}\)\.then\(\(data\) => \{\n\s+if \(data\) \{\n\s+setPackerCounts\(data\.packerCounts\);\n\s+setSummary\(data\.courierCounts\);\n\s+\}\n\s+\}\)\.catch\(\(\) => \{\}\);/g,
  '        scheduleCountRefresh();'
);

// Fix 2: refreshSelectedCourierRows - replace fetchTodaySummary with scheduleCountRefresh
content = content.replace(
  /        fetchTodaySummary\(\{ token, config \}\)\.then\(\(data\) => \{\n\s+if \(data\) \{\n\s+setSummary\(data\.courierCounts\);\n\s+setPackerCounts\(data\.packerCounts\);\n\s+\}\n\s+\}\)\.catch\(\(\) => \{\}\);/g,
  '        scheduleCountRefresh();'
);

fs.writeFileSync(path, content, 'utf8');
console.log('Done - both debounce fixes applied');
