import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
const source = readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const names = source.match(/import \{ ([^}]+) \} from '@hermes\/plugin-sdk'/)[1].split(', ')
const props = { profile: 'default', domain: 'all', readFilter: 'all', searchText: '', showTags: true, updateMutation: {} }
const article = id => ({ id, headline: `Article ${id}`, url: `https://example.com/${id}` })
function nodes(tree, predicate, out = []) {
  if (!tree || typeof tree !== 'object') return out
  if (predicate(tree)) out.push(tree)
  for (const child of [tree.props?.children].flat(Infinity)) nodes(child, predicate, out)
  return out
}
function harness(fetchPage = async () => ({ items: [article(2)], next_cursor: null })) {
  const slots = [], refs = [], pending = [], requests = [], notices = [], observers = [], mutations = [], mutationCalls = [], invalidations = []
  const query = { dataUpdatedAt: 1 }
  let slot = 0, refSlot = 0
  const data = { items: [article(1)], next_cursor: 'two' }
  const context = Object.fromEntries(names.map(n => [n, n]))
  Object.assign(context, {
    URL, URLSearchParams, Date, setTimeout, clearTimeout,
    jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }),
    useState: initial => { const i = slot++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] },
    useRef: initial => refs[refSlot++] ??= { current: initial },
    useEffect: (fn, deps) => { const i = slot++; if (!slots[i] || deps.some((v, j) => v !== slots[i].deps[j])) pending.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() } }) },
    useValue: () => 'default', useQuery: o => ({ data: o.queryKey[1] === 'events' ? data : {}, ...query }),
    useQueryClient: () => ({ invalidateQueries: async options => { invalidations.push(options) }, fetchQuery: o => { requests.push(o.queryKey.at(-1)); return fetchPage(o.queryKey.at(-1)) } }),
    useMutation: options => { mutations.push(options); return { mutate: variables => mutationCalls.push(variables) } }, host: { state: { profile: {} }, notify: n => notices.push(n) },
    window: { matchMedia: () => ({ matches: true }) },
    IntersectionObserver: class { constructor(callback) { this.callback = callback; observers.push(this) } observe() {} disconnect() {} }
  })
  runInNewContext(source.replace(/^import .*$/gm, '').replace('export default {', 'const plugin = {') + '\nglobalThis.render = FeedResults', context)
  const ctx = { storage: { get: (_k, d) => d }, rest: async () => ({}) }
  return { ctx, requests, notices, data, observers, query, mutations, mutationCalls, invalidations,
    render(extra = {}) { slot = 0; refSlot = 0; const tree = context.render({ ctx, ...props, ...extra }); pending.splice(0).forEach(f => f()); return tree },
    unmount() { for (const entry of slots) entry?.cleanup?.() }
  }
}
const viewport = () => ({ scrollTop: 700, clientHeight: 300, scrollHeight: 1000 })
const scroll = tree => nodes(tree, n => n.type === 'ScrollArea')[0]
test('a new result scope resets pages, preview and cursor even when the query timestamp is unchanged', async () => {
  const app = harness(async cursor => ({ items: [article(cursor === 'two' ? 2 : 4)], next_cursor: null }))
  app.render(); let tree = app.render()
  await scroll(tree).props.onScrollCapture({ target: viewport() }); tree = app.render()
  await nodes(nodes(tree, n => n.type === 'li').at(-1), n => n.type === 'Button')[0].props.onClick()
  tree = app.render()
  const oldScroll = scroll(tree).props.onScrollCapture
  app.data.items = [article(3)]; app.data.next_cursor = 'new'
  const next = { searchText: 'chip' }
  tree = app.render(next)
  assert.deepEqual(nodes(tree, n => n.type === 'li').map(n => n.key), [3], 'Never paint old appended pages in the new scope')
  tree = app.render(next)
  assert.equal(nodes(tree, n => typeof n.type === 'function' && n.type.name === 'PreviewPane')[0].props.url, null)
  assert.ok(nodes(tree, n => n.type === 'li').every(n => !n.props['data-selected']))
  await oldScroll({ target: viewport() })
  assert.deepEqual(app.requests, ['two'], 'Old scroll closures must not use the new cursor')
  await scroll(tree).props.onScrollCapture({ target: viewport() }); tree = app.render(next)
  assert.deepEqual(app.requests, ['two', 'new'])
  assert.deepEqual(nodes(tree, n => n.type === 'li').map(n => n.key), [3, 4])
})
test('filter changes reject late page and article-open responses without remounting', async () => {
  let finishPage, finishRead
  const app = harness(() => new Promise(resolve => { finishPage = resolve }))
  app.render(); const tree = app.render()
  const pendingPage = scroll(tree).props.onScrollCapture({ target: viewport() })
  app.ctx.rest = () => new Promise(resolve => { finishRead = resolve })
  const pendingRead = nodes(nodes(tree, n => n.type === 'li')[0], n => n.type === 'Button')[0].props.onClick()
  app.data.items = [article(3)]; app.data.next_cursor = null
  const next = { domain: 'ai', readFilter: 'unread' }
  app.render(next); app.render(next)
  finishPage({ items: [article(2)], next_cursor: 'three' }); finishRead({})
  await Promise.all([pendingPage, pendingRead])
  const current = app.render(next)
  assert.deepEqual(nodes(current, n => n.type === 'li').map(n => n.key), [3])
  assert.equal(nodes(current, n => typeof n.type === 'function' && n.type.name === 'PreviewPane')[0].props.url, null)
  assert.equal(app.notices.length, 0)
})
test('returning to the same filter still rejects an article opened in an earlier scope lifetime', async () => {
  let finishRead
  const app = harness(); app.render(); const tree = app.render()
  app.ctx.rest = () => new Promise(resolve => { finishRead = resolve })
  const response = nodes(nodes(tree, n => n.type === 'li')[0], n => n.type === 'Button')[0].props.onClick()
  app.render({ domain: 'ai' }); app.render({ domain: 'ai' })
  app.render(); app.render()
  finishRead({}); await response
  assert.equal(nodes(app.render(), n => typeof n.type === 'function' && n.type.name === 'PreviewPane')[0].props.url, null)
})
test('favorite responses carry their originating scope even when mutation options have changed', async () => {
  const app = harness(); app.render(); let tree = app.render()
  nodes(nodes(tree, n => n.type === 'li')[0], n => n.type === 'Button')[1].props.onClick({ stopPropagation() {} })
  const oldVariables = app.mutationCalls.at(-1)
  const next = { domain: 'favorites' }
  app.render(next); tree = app.render(next)
  await scroll(tree).props.onScrollCapture({ target: viewport() }); tree = app.render(next)
  await app.mutations.at(-1).onSuccess({}, oldVariables)
  assert.deepEqual(nodes(app.render(next), n => n.type === 'li').map(n => n.key), [1, 2])
})
test('status bar belongs to the whole page and favorites rule cancels the sidebar inset', () => {
  const results = source.split('function FeedResults(')[1].split('function validDestination(')[0]
  assert.doesNotMatch(results, /jsxs\('footer'/)
  assert.match(source, /jsx\(FeedStatusBar, \{ ctx, profile, updateMutation, locale \}\)/)
  assert.match(source, /className: 'intelligence-feed-workspace'/)
  assert.match(source, /className: 'intelligence-feed-favorites'/)
  assert.match(source, /marginLeft: -8, marginRight: -8/)
})
test('bottom scrolling has one request in flight, deduplicates rows and stops at the last cursor', async () => {
  let resolve
  const app = harness(() => new Promise(r => { resolve = r }))
  app.render(); const tree = app.render()
  assert.equal(nodes(tree, n => n.type === 'Button' && n.props.children === 'Load more').length, 0)
  assert.equal(typeof scroll(tree).props.onScrollCapture, 'function')
  const first = scroll(tree).props.onScrollCapture({ target: viewport() })
  scroll(tree).props.onScrollCapture({ target: viewport() })
  assert.deepEqual(app.requests, ['two'])
  resolve({ items: [article(1), article(2)], next_cursor: null }); await first
  const next = app.render()
  assert.deepEqual(nodes(next, n => n.type === 'li').map(n => n.key), [1, 2])
  await scroll(next).props.onScrollCapture({ target: viewport() })
  assert.equal(app.requests.length, 1)
})
test('queued bottom events cannot start another page until the previous append has committed', async () => {
  const app = harness(async cursor => ({ items: [article(cursor === 'two' ? 2 : 3)], next_cursor: cursor === 'two' ? 'three' : null }))
  app.render(); const tree = app.render(), handler = scroll(tree).props.onScrollCapture
  await handler({ target: viewport() })
  await handler({ target: viewport() })
  assert.deepEqual(app.requests, ['two'])
  const committed = app.render()
  await scroll(committed).props.onScrollCapture({ target: viewport() })
  assert.deepEqual(app.requests, ['two', 'three'])
})

test('failure pauses automatic retries and exposes an explicit retry, without dropping earlier rows', async () => {
  let fail = true
  const app = harness(async () => { if (fail) throw Error('offline'); return { items: [article(2)], next_cursor: null } })
  app.render(); let tree = app.render()
  await scroll(tree).props.onScrollCapture({ target: viewport() })
  tree = app.render()
  await scroll(tree).props.onScrollCapture({ target: viewport() })
  assert.equal(app.requests.length, 1)
  assert.equal(nodes(tree, n => n.type === 'li').length, 1)
  const retry = nodes(tree, n => n.type === 'Button' && n.props.children === 'Retry')[0]
  assert.ok(retry)
  fail = false; await retry.props.onClick(); tree = app.render()
  assert.equal(nodes(tree, n => n.type === 'li').length, 2)
})
test('late continuation responses and old scroll callbacks are inert after unmount', async () => {
  let resolve
  const app = harness(() => new Promise(r => { resolve = r }))
  app.render(); const tree = app.render(), oldScroll = scroll(tree).props.onScrollCapture
  const pending = oldScroll({ target: viewport() })
  app.unmount(); resolve({ items: [article(2)], next_cursor: 'three' }); await pending
  await oldScroll({ target: viewport() })
  assert.equal(app.requests.length, 1)
  assert.equal(app.notices.length, 0)
})
test('opening an appended article in the all filter preserves its row and selection', async () => {
  const app = harness(); app.render(); let tree = app.render()
  await scroll(tree).props.onScrollCapture({ target: viewport() }); tree = app.render()
  const row = nodes(tree, n => n.type === 'li').at(-1)
  await nodes(row, n => n.type === 'Button')[0].props.onClick(); tree = app.render()
  assert.equal(nodes(tree, n => n.type === 'li').length, 2)
  assert.equal(nodes(tree, n => n.type === 'li').at(-1).props['data-selected'], true)
  assert.equal(nodes(nodes(tree, n => n.type === 'li').at(-1), n => n.type === 'Button')[0].props.style.fontWeight, 400, 'Read state must use the same field as the displayed row')
  assert.ok(app.invalidations.filter(o => o.queryKey[1] === 'events').every(o => o.refetchType === 'none'))
})

test('favorite success in a normal domain updates the row without clearing appended pages', async () => {
  const app = harness(); app.render(); let tree = app.render()
  await scroll(tree).props.onScrollCapture({ target: viewport() }); tree = app.render()
  nodes(nodes(tree, n => n.type === 'li').at(-1), n => n.type === 'Button')[1].props.onClick({ stopPropagation() {} })
  await app.mutations.at(-1).onSuccess({}, app.mutationCalls.at(-1)); tree = app.render()
  const rows = nodes(tree, n => n.type === 'li')
  assert.equal(rows.length, 2)
  assert.equal(nodes(rows.at(-1), n => n.type === 'Button').at(-1).props['aria-pressed'], true)
  assert.equal(nodes(tree, n => typeof n.type === 'function' && n.type.name === 'PreviewPane')[0].props.url, null)
})

test('a refreshed first page rejects a late response from the previous cursor generation', async () => {
  let resolve
  const app = harness(() => new Promise(r => { resolve = r }))
  app.render(); let tree = app.render()
  const response = scroll(tree).props.onScrollCapture({ target: viewport() })
  app.data.items = [article(3)]; app.data.next_cursor = null; app.query.dataUpdatedAt = 2
  app.render(); resolve({ items: [article(2)], next_cursor: 'three' }); await response
  tree = app.render()
  assert.deepEqual(nodes(tree, n => n.type === 'li').map(n => n.key), [3])
  assert.equal(app.notices.length, 0)
})

test('repeated or cyclic cursors pause instead of requesting forever', async () => {
  const app = harness(async () => ({ items: [article(2)], next_cursor: 'two' }))
  app.render(); let tree = app.render()
  await scroll(tree).props.onScrollCapture({ target: viewport() }); tree = app.render()
  await scroll(tree).props.onScrollCapture({ target: viewport() })
  assert.deepEqual(app.requests, ['two'])
  assert.ok(nodes(tree, n => n.type === 'Button' && n.props.children === 'Retry').length)
})

test('clicked article selection is carried by the full row, not the title button', async () => {
  const app = harness(); let tree = app.render(), row = nodes(tree, n => n.type === 'li')[0]
  await nodes(row, n => n.type === 'Button')[0].props.onClick()
  tree = app.render(); row = nodes(tree, n => n.type === 'li')[0]
  assert.equal(row.props['data-selected'], true)
  assert.equal(row.props.className, 'intelligence-feed-row')
  assert.match(source, /\.intelligence-feed-row:hover/)
})
