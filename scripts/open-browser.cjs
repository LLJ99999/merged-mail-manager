// Wait until the server answers, then open the default browser once. Used by start.bat / start.sh.
// Silent: never writes to the console (it shares the server's window), gives up after 90 s.
// Usage: node scripts/open-browser.cjs <port>
const http = require('http');
const { exec } = require('child_process');
const port = Number(process.argv[2]) || 3000;
const url = `http://localhost:${port}`;
let tries = 0;
function open() {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, { windowsHide: true }, () => process.exit(0));
}
function probe() {
  if (++tries > 90) process.exit(0);
  const req = http.get(`${url}/api/version`, { timeout: 2000 }, res => { res.resume(); res.statusCode < 500 ? open() : setTimeout(probe, 1000); });
  req.on('timeout', () => req.destroy());
  req.on('error', () => setTimeout(probe, 1000));
}
probe();
