import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
const source = readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const sdkNames = source.match(/import \{ ([^}]+) \} from '@hermes\/plugin-sdk'/)[1].split(', ')
function harness({ reduced = false, saved = {}, openExternal = async () => true, queryState = {}, onMutation = () => {} } = {}) {
  const state = [], refs = [], effects = [], timers = new Map(), notices = []
  let slot = 0, refSlot = 0, serial = 0
  const context = Object.fromEntries(sdkNames.map(name => [name, name]))
  Object.assign(context, {
    URL, Date, jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }),
    useState: initial => { const i = slot++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next }] },
    useRef: initial => refs[refSlot++] ??= { current: initial },
    useEffect: (fn, deps) => { const i = slot++; if (!state[i] || deps.some((d, j) => d !== state[i].deps[j])) effects.push(() => { state[i]?.cleanup?.(); state[i] = { deps, cleanup: fn() } }) },
    useValue: () => 'default', useQueryClient: () => ({ invalidateQueries() {} }), useMutation: options => { onMutation(options); return {} },
    useQuery: options => ({ data: options.queryKey[1] === 'events' ? { items: [{ id: 1, headline: '原始标题', url: 'https://example.com', evidence_count: 2 }]} : options.queryKey[1] === 'sources' ? [{ id: 'x', domain: 'ai', name: '来源原名', enabled: true }] : {}, ...queryState, ...(options.queryKey[1] === 'sources' && queryState.data ? { data: [] } : {}) }),
    host: { state: { profile: {} }, notify: n => notices.push(n) }, window: { matchMedia: () => ({ matches: reduced }) },
    setTimeout: (fn, ms) => { timers.set(++serial, { fn, ms }); return serial }, clearTimeout: id => timers.delete(id)
  })
  runInNewContext(source.replace(/^import .*$/gm, '').replace('export default {', 'const pluginDefinition = {') + '\nglobalThis.api = { FeedPage, FeedResults, PreviewPane }', context)
  const ctx = { storage: { get: (key, fallback) => saved[key] ?? fallback, set: (key, value) => saved[key] = value }, os: { openExternal } }
  return { ctx, notices, saved, timers, render(name, props = {}) { slot = 0; refSlot = 0; const tree = context.api[name]({ ctx, locale: 'en', ...props }); effects.splice(0).forEach(fn => fn()); return tree } }
}
function all(node, pred, out = []) {
  if (!node || typeof node !== 'object') return out
  if (pred(node)) out.push(node)
  const children = node.props?.children
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) all(child, pred, out)
  return out
}
const byLabel = (tree, label) => all(tree, n => n.props?.['aria-label'] === label)[0]
test('SDK sandbox has an always-available fallback and no false embedding-success detection', () => {
  const app = harness(), tree = app.render('PreviewPane', { url: 'https://example.com' })
  const frame = all(tree, n => n.type === 'SandboxedFrame')[0]
  assert.ok(frame, 'SDK SandboxedFrame is required')
  assert.equal(frame.props.src, 'https://example.com')
  assert.equal(frame.props.title, 'Article preview')
  assert.equal(frame.props.sandbox, undefined)
  assert.equal(frame.props.onLoad, undefined)
  assert.ok(byLabel(tree, 'Open in external browser'))
  const externalLink = all(tree, n => n.type === 'a')[0]
  assert.ok(externalLink, 'Provide a visible plain-link fallback, not just an icon')
  assert.equal(externalLink.props.href, 'https://example.com')
  frame.props.onError()
  assert.match(JSON.stringify(app.render('PreviewPane', { url: 'https://example.com' })), /Preview could not be loaded/)
  assert.doesNotMatch(source, /webview|executeJavaScript|console-message|setZoomFactor|previewZoom|PreviewZoomControls/i)
})
test('external false and rejection notify; unsafe URLs never embed or open', async () => {
  for (const openExternal of [async () => false, async () => { throw Error('denied') }]) {
    const app = harness({ openExternal })
    await byLabel(app.render('PreviewPane', { url: 'https://example.com' }), 'Open in external browser').props.onClick()
    assert.match(app.notices[0].message, /Could not open.*browser/)
  }
  for (const url of ['http://example.com', 'javascript:alert(1)', 'file:///secret', 'not a url']) {
    const app = harness({ openExternal: () => assert.fail('unsafe open') }), tree = app.render('PreviewPane', { url })
    assert.equal(all(tree, n => n.type === 'SandboxedFrame').length, 0)
    assert.equal(byLabel(tree, 'Open in external browser'), undefined)
  }
})
test('180ms inert exit, rapid reopen cancellation and reduced motion', () => {
  const app = harness()
  app.render('PreviewPane', { url: 'https://one.example' }); app.render('PreviewPane', { url: null })
  let tree = app.render('PreviewPane', { url: null })
  assert.equal(tree.props.inert, true)
  assert.equal(all(tree, n => n.type === 'SandboxedFrame').length, 1)
  assert.equal([...app.timers.values()][0].ms, 180)
  app.render('PreviewPane', { url: 'https://two.example' })
  assert.equal(app.timers.size, 0)
  tree = app.render('PreviewPane', { url: 'https://two.example' })
  assert.equal(all(tree, n => n.type === 'SandboxedFrame')[0].props.src, 'https://two.example')
  app.render('PreviewPane', { url: null }); for (const timer of app.timers.values()) timer.fn()
  assert.equal(all(app.render('PreviewPane', { url: null }), n => n.type === 'SandboxedFrame').length, 0)
  const quiet = harness({ reduced: true })
  quiet.render('PreviewPane', { url: 'https://example.com' }); quiet.render('PreviewPane', { url: null })
  assert.equal(all(quiet.render('PreviewPane', { url: null }), n => n.type === 'SandboxedFrame').length, 0)
})
test('English default, persistent immediate locale switch and original content in flat rows', () => {
  const app = harness()
  let tree = app.render('FeedPage')
  assert.ok(byLabel(tree, 'News categories'))
  assert.ok(byLabel(tree, 'Search news'))
  byLabel(tree, 'Interface language').props.onChange({ target: { value: 'zh-CN' } })
  tree = app.render('FeedPage')
  assert.equal(app.saved['settings.locale'], 'zh-CN')
  assert.ok(byLabel(tree, '资讯分类')); assert.ok(byLabel(tree, '搜索资讯'))
  assert.ok(byLabel(harness({ saved: app.saved }).render('FeedPage'), '搜索资讯'))
  assert.ok(byLabel(harness({ saved: { 'settings.locale': 'invalid' } }).render('FeedPage'), 'Search news'))
  for (const locale of ['en', 'zh-CN']) {
    const results = harness().render('FeedResults', { profile: 'default', domain: 'all', readFilter: 'all', searchText: '', showTags: true, updateMutation: {}, locale })
    const row = all(results, n => n.type === 'li')[0]
    assert.match(JSON.stringify(row), /原始标题/)
    assert.equal(row.props.style.borderBottom, '1px solid var(--ui-stroke-secondary)')
    assert.doesNotMatch(JSON.stringify(row), /"borderRadius":8/)
    assert.ok(byLabel(results, locale === 'en' ? 'Add favorite: 原始标题' : '收藏：原始标题'))
    assert.equal(all(results, n => typeof n.type === 'function' && n.type.name === 'PreviewPane')[0].props.locale, locale)
  }
})

test('English covers empty, loading, failure and notification surfaces; settings keep approved layout', () => {
  const props = { profile: 'default', domain: 'all', readFilter: 'all', searchText: '', updateMutation: {} }
  for (const queryState of [{}, { isLoading: true }, { isError: true }, { data: { items: [] } }]) {
    for (const name of ['FeedPage', 'FeedResults']) {
      const mutations = []
      const app = harness({ queryState, onMutation: options => mutations.push(options) })
      const tree = app.render(name, props)
      // Third-party article/source text and the language's native name are not UI translations.
      const text = JSON.stringify(tree).replaceAll('原始标题', '').replaceAll('来源原名', '').replaceAll('简体中文', '')
      assert.doesNotMatch(text, /[\u3400-\u9fff]/)
      for (const mutation of mutations) {
        mutation.onError?.()
        if (mutation.onSuccess && String(mutation.onSuccess).includes('result.status')) {
          for (const status of ['failed', 'partial', 'success']) mutation.onSuccess({ status })
        }
      }
      assert.ok(app.notices.length > 0)
      for (const notice of app.notices) assert.doesNotMatch(notice.message, /[\u3400-\u9fff]/)
    }
  }
  const app = harness(), tree = app.render('FeedPage')
  const dialog = all(tree, n => n.type === 'DialogContent')[0]
  assert.equal(all(dialog, n => n.type === 'ScrollArea').length, 0)
  const tags = byLabel(tree, 'Keyword tags')
  const tagRow = all(dialog, n => n.type === 'label' && n.props.children.includes(tags))[0]
  assert.equal(tagRow.props.children.at(-1), tags)
  tags.props.onCheckedChange(false)
  assert.equal(app.saved['settings.showTags'], false)
  assert.equal(byLabel(app.render('FeedPage'), 'Keyword tags').props.checked, false)
  const title = all(dialog, n => n.type === 'DialogTitle')[0]
  assert.equal(title.props.style.fontSize, 14)
  assert.equal(title.props.style.fontWeight, 700)
  assert.equal(dialog.props.style.fontSize, 12)
  assert.equal(dialog.props.style.fontWeight, 400)
})

test('stale frame error and external gestures after close do not affect the next preview', async () => {
  let opened = 0
  const app = harness({ openExternal: async () => { opened++; return true } })
  const old = app.render('PreviewPane', { url: 'https://one.example' })
  const oldFrame = all(old, n => n.type === 'SandboxedFrame')[0]
  const oldOpen = byLabel(old, 'Open in external browser').props.onClick
  app.render('PreviewPane', { url: 'https://two.example' })
  oldFrame.props.onError()
  const next = app.render('PreviewPane', { url: 'https://two.example' })
  assert.doesNotMatch(JSON.stringify(next), /Preview could not be loaded/)
  app.render('PreviewPane', { url: null })
  await oldOpen()
  assert.equal(opened, 0)
})
