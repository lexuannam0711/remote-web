const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const { MAX_EXCEL_BYTES, isAllowedExcelUpload } = require('../src/server/uploadPolicy');

test('Excel upload policy accepts only bounded xls/xlsx metadata', () => {
  assert.equal(isAllowedExcelUpload({ originalname: 'shortcuts.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), true);
  assert.equal(isAllowedExcelUpload({ originalname: 'shortcuts.xls', mimetype: 'application/vnd.ms-excel' }), true);
  assert.equal(MAX_EXCEL_BYTES, 5 * 1024 * 1024);
});

test('Excel upload policy rejects misleading extensions and MIME types', () => {
  assert.equal(isAllowedExcelUpload({ originalname: 'payload.exe', mimetype: 'application/vnd.ms-excel' }), false);
  assert.equal(isAllowedExcelUpload({ originalname: 'payload.xlsx.exe', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), false);
  assert.equal(isAllowedExcelUpload({ originalname: 'shortcuts.xlsx', mimetype: 'application/octet-stream' }), false);
  assert.equal(isAllowedExcelUpload({ originalname: 'shortcuts.xlsx', mimetype: 'text/html' }), false);
});

let uploads;
let server;
let url;
const excelMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const { createTemplateBuffer } = require('../src/server/shortcutImporter');

test.before(async () => {
  uploads = await fs.mkdtemp(path.join(os.tmpdir(), 'pdb-upload-'));
  const storePath = require.resolve('../src/server/store');
  const store = require(storePath);
  const original = require.cache[storePath].exports;
  require.cache[storePath].exports = { ...store, UPLOADS: uploads, appendLog: async () => {} };
  test.after(() => { require.cache[storePath].exports = original; });
  const telegram = require('../src/server/telegram');
  test.mock.method(telegram, 'notifyError', async () => {});
  const { createApp } = require('../src/server');
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  url = `http://127.0.0.1:${server.address().port}/api/shortcuts/import-excel`;
});

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (uploads) {
    assert.equal(path.dirname(uploads), os.tmpdir());
    assert.ok(path.basename(uploads).startsWith('pdb-upload-'));
    await fs.rm(uploads, { recursive: true, force: true });
  }
  test.mock.restoreAll();
});

async function uploadFile(buffer = createTemplateBuffer(), name = 'shortcuts.xlsx', mime = excelMime) {
  const body = new FormData();
  body.append('file', new Blob([buffer], { type: mime }), name);
  return fetch(url, { method: 'POST', body });
}

test('upload route rejects files exceeding MAX_EXCEL_BYTES and removes partial files', async () => {
  const response = await uploadFile(Buffer.alloc(MAX_EXCEL_BYTES + 1));
  assert.equal(response.status, 413);
  assert.equal(typeof (await response.json()).error, 'string');
  assert.deepEqual(await fs.readdir(uploads), []);
});

test('upload route rejects disallowed extensions before writing a file', async () => {
  for (const name of ['payload.exe', 'payload.xlsx.exe']) {
    const response = await uploadFile(createTemplateBuffer(), name);
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.deepEqual(await fs.readdir(uploads), []);
});

test('upload route rejects disallowed MIME types before writing a file', async () => {
  for (const mime of ['application/octet-stream', 'text/html']) {
    const response = await uploadFile(createTemplateBuffer(), 'shortcuts.xlsx', mime);
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.deepEqual(await fs.readdir(uploads), []);
});

test('upload route still parses valid Excel files', async () => {
  const response = await uploadFile();
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal(preview.validRows.length, 4);
  assert.equal(preview.validRows[0].shortcut, '/1');
  assert.deepEqual(preview.errors, []);
});

test('upload route removes temporary files after a successful parse', async () => {
  const response = await uploadFile();
  assert.equal(response.status, 200);
  await response.json();
  assert.deepEqual(await fs.readdir(uploads), []);
});

test('upload route removes temporary files after a parser failure', async () => {
  const response = await uploadFile(Buffer.from('PK\x03\x04broken workbook'));
  assert.equal(response.status, 500);
  await response.json();
  assert.deepEqual(await fs.readdir(uploads), []);
});

test('upload route handles a missing file without throwing', async () => {
  const response = await fetch(url, { method: 'POST', body: new FormData() });
  assert.equal(response.status, 400);
  assert.equal(typeof (await response.json()).error, 'string');
  assert.deepEqual(await fs.readdir(uploads), []);
});
