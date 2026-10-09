'use strict';
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createWebApp } = require('../../../src/server/web');

async function listen(server, port) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}
async function close(server) {
  if (!server?.listening) return;
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
async function startBridgeServers() {
  // Never reuse/kill a foreign process on the fixed dashboard manifest port.
  const probe = await listen(http.createServer(), 8787);
  await close(probe);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pdb-bridge-e2e-'));
  let dashboard;
  let pancake;
  const stop = async () => {
    await close(pancake);
    await close(dashboard);
    if (path.dirname(temporary) !== path.resolve(os.tmpdir()) || !path.basename(temporary).startsWith('pdb-bridge-e2e-')) throw new Error('Unexpected temporary directory');
    fs.rmSync(temporary, { recursive: true, force: true });
  };
  try {
    const key = path.join(temporary, 'key.pem');
    const cert = path.join(temporary, 'cert.pem');
    const openssl = fs.existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
    execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=pages.fm', '-addext', 'subjectAltName=DNS:pages.fm', '-keyout', key, '-out', cert], { stdio: 'pipe', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
    dashboard = await listen(http.createServer(createWebApp({ env: { WEB_ACCESS_TOKEN: 'synthetic-e2e-token' } })), 8787);
    const html = fs.readFileSync(path.join(__dirname, 'web-extension-bridge.html'));
    pancake = await listen(https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    }), 0);
    return { temporary, fixturePort: pancake.address().port, stop };
  } catch (error) { await stop(); throw error; }
}
module.exports = { startBridgeServers };
