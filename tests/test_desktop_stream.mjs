import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
const source = readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
function api() {
  const context = { URL, Date }
  runInNewContext(source.replace(/^import .*$/gm, '').replace('export default {', 'const definition = {') + '\nglobalThis.api = { streamRouteScope, streamPoint, createStreamFrameGuard }', context)
  return context.api
}

test('stream scope uses a unique public route descriptor and rejects ambiguous sources', () => {
  const { streamRouteScope } = api()
  assert.equal(streamRouteScope([{ profile: 'p', targetProfile: 'agent', connectionId: 'source-a' }], 'p'), '["source-a","agent","p"]')
  assert.equal(streamRouteScope([], 'p'), '["local","p","p"]')
  assert.throws(() => streamRouteScope([{profile:'p',connectionId:'a'},{profile:'p',connectionId:'b'}], 'p'))
  assert.throws(() => streamRouteScope([{profile:'other',connectionId:'b'}], 'p'))
  assert.equal(streamRouteScope([{profile:'p',connectionId:'a',mode:'local'},{profile:'p',connectionId:'b',mode:'remote'}], 'p', 'a'), '["a","p","p"]')
  assert.throws(() => streamRouteScope([{profile:'p',connectionId:'b',mode:'remote'}], 'p', 'b'), 'remote login pixels are not sent to a remote browser by default')
})
test('pointer coordinates map to the browser viewport, not decoded PNG dimensions', () => {
  const { streamPoint } = api()
  const point = streamPoint({clientX:150,clientY:100}, {left:50,top:20,width:400,height:200}, 1600,800)
  assert.equal(point.x,400); assert.equal(point.y,320)
  assert.throws(() => streamPoint({clientX:NaN,clientY:1},{left:0,top:0,width:1,height:1},100,100))
})
test('painting, acknowledgement and generation invalidation gate all user input', () => {
  const guard = api().createStreamFrameGuard()
  guard.adopt(3)
  assert.equal(guard.inputView(),null)
  const old = guard.ticket({view:3,seq:1})
  assert.equal(guard.painted(old),true)
  assert.equal(guard.inputView(),null)
  assert.equal(guard.acknowledge(old),true)
  assert.equal(guard.inputView(),3)
  guard.adopt(4)
  assert.equal(guard.painted(old),false); assert.equal(guard.acknowledge(old),false)
  const current = guard.ticket({view:4,seq:2})
  guard.painted(current); guard.acknowledge(current)
  guard.invalidate()
  assert.equal(guard.inputView(),null); assert.equal(guard.painted(current),false)
  guard.adopt(4)
  assert.equal(guard.painted(current),false, 'same numeric server generation cannot revive an old local lifetime')
  guard.dispose()
  assert.equal(guard.ticket({view:4,seq:99}),null)
})
test('an older paint ACK can authorize newer pixels only within the same view revision', () => {
  const guard = api().createStreamFrameGuard()
  guard.adopt(2)
  const first = guard.ticket({view:2,seq:1}), second = guard.ticket({view:2,seq:2})
  assert.equal(guard.acknowledge(first),false,'unpainted ticket enabled input')
  guard.painted(first); guard.painted(second)
  assert.equal(guard.acknowledge(first),true,'motion superseded a valid first-paint ACK')
  assert.equal(guard.inputView(),2)
})
test('production preview uses public REST and private canvas without a frame query cache', () => {
  assert.doesNotMatch(source,/ctx\.browser|browser\.embed/)
  assert.match(source,/\/browser\/sessions/)
  const surface = source.split('function StreamSurface(')[1].split('function PreviewPane(')[0]
  assert.doesNotMatch(surface,/useQuery|queryClient|refetchInterval/)
  assert.match(surface,/\/frame\?after_seq=.*&wait_ms=/)
  assert.match(source,/gatewayActivationEpoch/)
  assert.match(source,/function StreamSurface/)
  assert.match(source,/清除登录数据/)
})
