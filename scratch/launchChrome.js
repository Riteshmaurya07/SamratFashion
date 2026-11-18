const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const userDataDir = 'C:\\Users\\Dell.000\\AppData\\Local\\Google\\Chrome\\User Data';
const lockFile = path.join(userDataDir, 'lockfile');
const activePortFile = path.join(userDataDir, 'DevToolsActivePort');

console.log('Checking lockfile:', fs.existsSync(lockFile));
console.log('Checking active port file:', fs.existsSync(activePortFile));

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const customDataDir = 'C:\\Users\\Dell.000\\AppData\\Local\\Google\\Chrome\\User Data DevTools';
if (!fs.existsSync(customDataDir)) fs.mkdirSync(customDataDir, { recursive: true });

const child = spawn(chromePath, [
  '--remote-debugging-port=9222',
  `--user-data-dir=${customDataDir}`,
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  'about:blank'
]);

child.stdout.on('data', d => console.log('STDOUT:', d.toString()));
child.stderr.on('data', d => console.log('STDERR:', d.toString()));
child.on('exit', (code, sig) => console.log('EXIT:', code, sig));

setTimeout(() => {
  const customPortFile = path.join(customDataDir, 'DevToolsActivePort');
  console.log('Custom port file exists:', fs.existsSync(customPortFile));
  if (fs.existsSync(customPortFile)) {
    const portContent = fs.readFileSync(customPortFile, 'utf8');
    console.log('Port content:', portContent);
    // Write copy to default user data dir where subagent expects it:
    try {
      fs.writeFileSync(activePortFile, portContent);
      console.log('Copied DevToolsActivePort to default dir successfully!');
    } catch (e) {
      console.error('Failed to copy to default dir:', e.message);
    }
  }
  http.get('http://127.0.0.1:9222/json/version', res => {
    let d = '';
    res.on('data', chunk => d += chunk);
    res.on('end', () => {
      try {
        const v = JSON.parse(d);
        const wsUrl = new URL(v.webSocketDebuggerUrl);
        const content = `9222\n${wsUrl.pathname}\n`;
        fs.writeFileSync(activePortFile, content, 'utf8');
        console.log('Successfully wrote DevToolsActivePort to:', activePortFile);
        console.log('Content:\n' + content);
      } catch (err) {
        console.error('Failed to parse or write active port:', err.message);
      }
    });
  }).on('error', err => console.log('DEVTOOLS HTTP ERROR:', err.message));
}, 2500);

setInterval(() => {}, 60000);
