const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isAllowedCorsOrigin,
  getServerListenOptions
} = require('../src/server');

test('server boundary: CORS permits requests without an Origin header', () => {
  assert.equal(isAllowedCorsOrigin(undefined), true);
  assert.equal(isAllowedCorsOrigin(null), true);
  assert.equal(isAllowedCorsOrigin(''), true);
});

test('server boundary: CORS permits only the literal null renderer origin', () => {
  assert.equal(isAllowedCorsOrigin('null'), true);

  for (const untrustedOrigin of [
    'https://pages.fm',
    'https://pancake.vn',
    'https://evil.example',
    'http://127.0.0.1:8787',
    'NULL',
    ' null '
  ]) {
    assert.equal(
      isAllowedCorsOrigin(untrustedOrigin),
      false,
      `expected CORS to reject ${JSON.stringify(untrustedOrigin)}`
    );
  }
});

test('server boundary: listen configuration binds the API to IPv4 loopback', () => {
  assert.deepEqual(getServerListenOptions(8787), {
    port: 8787,
    host: '127.0.0.1'
  });
});
