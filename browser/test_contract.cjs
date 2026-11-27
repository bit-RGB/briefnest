const { test } = require('node:test');
const assert = require('node:assert/strict');
let guard;
try { guard = require('./guards.cjs'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
test('runtime has strict navigation and input guards before launching a browser', () => {
  assert.ok(guard, 'isolated stream runtime guards are not implemented');
  assert.equal(guard.validUrl('https://example.com/news', 'http://127.0.0.1:12345'), true);
  for (const url of ['javascript:alert(1)', 'file:///C:/fixture', 'data:text/html,x', 'http://example.com', 'https://fixture-user:fixture-pass@example.com']) {
    assert.equal(guard.validUrl(url, 'http://127.0.0.1:12345'), false);
  }
  assert.equal(guard.validUrl('http://127.0.0.1:12345/fixture', 'http://127.0.0.1:12345'), true);
  assert.equal(guard.validUrl('http://127.0.0.1:12346/fixture', 'http://127.0.0.1:12345'), false);
  assert.deepEqual(guard.point({ x: 10, y: 20 }, 100, 200), { x: 10, y: 20 });
  assert.throws(() => guard.point({ x: -1, y: 2 }, 100, 200));
  assert.throws(() => guard.point({ x: NaN, y: 2 }, 100, 200));
  assert.equal(guard.boundedText('中文测试'), '中文测试');
  assert.throws(() => guard.boundedText('x'.repeat(4097)));
  assert.deepEqual(guard.geometry(800, 600, 80), { width: 1000, height: 750, scale: 80 });
  assert.throws(() => guard.geometry(800, 600, 10));
});
test('popup guard never mistakes an initial page without an opener for a popup', () => {
  assert.equal(typeof guard.isOwnedPopup, 'function', 'popup ownership guard is missing');
  assert.equal(guard.isOwnedPopup({}, undefined), false);
  assert.equal(guard.isOwnedPopup({ openerId: 'another' }, undefined), false);
  assert.equal(guard.isOwnedPopup({}, 'owned'), false);
  assert.equal(guard.isOwnedPopup({ openerId: 'owned' }, 'owned'), true);
});
