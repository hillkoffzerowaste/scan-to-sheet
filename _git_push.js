const { execSync } = require('child_process');
const fs = require('fs');
const cwd = 'c:/Users/Office14/Documents/scan to sheet';
const out = [];

try {
  out.push('=== git status ===');
  out.push(execSync('git status --short', { cwd, encoding: 'utf8' }));
  
  out.push('=== git diff HEAD --name-only ===');
  out.push(execSync('git diff HEAD --name-only', { cwd, encoding: 'utf8' }));
  
  out.push('=== git add -A ===');
  out.push(execSync('git add -A', { cwd, encoding: 'utf8' }));
  
  out.push('=== git status after add ===');
  out.push(execSync('git status --short', { cwd, encoding: 'utf8' }));
  
  if (out[out.length-1].trim()) {
    out.push('=== git commit ===');
    out.push(execSync('git commit -m "fix: all bug fixes - cancel toggle, api route, scanRemark, courier count, lastError"', { cwd, encoding: 'utf8' }));
    
    out.push('=== git push ===');
    out.push(execSync('git push origin main', { cwd, encoding: 'utf8', stdio: 'pipe' }));
  } else {
    out.push('NOTHING TO COMMIT - already clean');
  }
  
  out.push('=== git log -1 ===');
  out.push(execSync('git log -1 --oneline', { cwd, encoding: 'utf8' }));
  
} catch(e) {
  out.push('ERROR: ' + e.message);
  out.push('STDERR: ' + (e.stderr || ''));
  out.push('STDOUT: ' + (e.stdout || ''));
}

fs.writeFileSync(cwd + '/_git_result.txt', out.join('\n'), 'utf8');
console.log('DONE');
