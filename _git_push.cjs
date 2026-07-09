const { execSync } = require('child_process');
const fs = require('fs');
const cwd = 'c:/Users/Office14/Documents/scan to sheet';
const out = [];

try {
  out.push('=== git status ===');
  out.push(execSync('git status --short', { cwd, encoding: 'utf8' }));
  
  out.push('=== git diff HEAD --name-only ===');
  out.push(execSync('git diff HEAD --name-only', { cwd, encoding: 'utf8' }));
  
  const diffResult = out[out.length-1].trim();
  if (diffResult) {
    out.push('=== CHANGES DETECTED, committing... ===');
    out.push(execSync('git add -A', { cwd, encoding: 'utf8' }));
    out.push(execSync('git commit -m "fix: all bug fixes - cancel toggle, api route, scanRemark, courier count, lastError"', { cwd, encoding: 'utf8' }));
    out.push(execSync('git push origin main 2>&1', { cwd, encoding: 'utf8' }));
    out.push('=== git log -1 ===');
    out.push(execSync('git log -1 --oneline', { cwd, encoding: 'utf8' }));
  } else {
    out.push('NO CHANGES - working tree matches HEAD');
  }
  
} catch(e) {
  out.push('ERROR: ' + e.message);
  if (e.stdout) out.push('STDOUT: ' + e.stdout);
  if (e.stderr) out.push('STDERR: ' + e.stderr);
}

fs.writeFileSync(cwd + '/_git_result.txt', out.join('\n'), 'utf8');
