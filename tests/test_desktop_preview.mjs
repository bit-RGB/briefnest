import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
const source = readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
test('preview motion and isolated content sizing remain intact', () => {
  assert.match(source, /const PREVIEW_MOTION_MS = 180/)
  assert.match(source, /grid-template-columns 180ms ease-out/)
  assert.match(source, /prefers-reduced-motion: reduce/)
  assert.match(source, /position: 'relative', flex: 1, minWidth: 0, minHeight: 0/)
  assert.match(source, /position: 'absolute', inset: 0, width: '100%', height: '100%'/)
})
