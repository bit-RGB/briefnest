import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
const source = readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const sdkNames = source.match(/import \{ ([^}]+) \} from '@hermes\/plugin-sdk'/)[1].split(', ')
function harness({ legacyHost = true, reduced = false, saved = {}, openExternal = async () => true, queryState = {}, latestRun = null, onMutation = () => {} } = {}) {
  const state = [], refs = [], effects = [], timers = new Map(), notices = []
  let slot = 0, refSlot = 0, serial = 0
  const context = Object.fromEntries(sdkNames.map(name => [name, name]))
  Object.assign(context, {
    URL, Date, jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }),
    useState: initial => { const i = slot++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next }] },
    useRef: initial => refs[refSlot++] ??= { current: initial },
    useEffect: (fn, deps) => { const i = slot++; if (!state[i] || deps.some((d, j) => d !== state[i].deps[j])) effects.push(() => { state[i]?.cleanup?.(); state[i] = { deps, cleanup: fn() } }) },
    useValue: () => 'default', useQueryClient: () => ({ invalidateQueries() {} }), useMutation: options => { onMutation(options); return {} },
    useQuery: options => ({ data: options.queryKey[1] === 'runs/latest' ? { run: latestRun } : options.queryKey[1] === 'events' ? { items: [{ id: 1, headline: '原始标题', url: 'https://example.com', evidence_count: 2 }]} : options.queryKey[1] === 'sources' ? [{ id: 'x', domain: 'ai', name: '来源原名', enabled: true }] : {}, ...queryState, ...(options.queryKey[1] === 'sources' && queryState.data ? { data: [] } : {}) }),
    host: { state: { profile: {} }, notify: n => notices.push(n) }, window: { matchMedia: () => ({ matches: reduced }) },
    setTimeout: (fn, ms) => { timers.set(++serial, { fn, ms }); return serial }, clearTimeout: id => timers.delete(id)
  })
  runInNewContext(source.replace(/^import .*$/gm, '').replace('export default {', 'const pluginDefinition = {') + '\nglobalThis.api = { FeedPage, FeedStatusBar, FeedResults, PreviewPane }', context)
  const ctx = { rest: async () => ({}), storage: { get: (key, fallback) => saved[key] ?? fallback, set: (key, value) => saved[key] = value }, os: { openExternal } }
  // Deliberately exercise old hosts in the iframe regressions, not accidental SDK omission.
  if (!legacyHost) ctx.browser = { isAvailable: () => false }
  return { ctx, notices, saved, timers, unmount() { for (const entry of state) entry?.cleanup?.() }, render(name, props = {}) { slot = 0; refSlot = 0; const tree = context.api[name]({ ctx, locale: 'en', ...props }); effects.splice(0).forEach(fn => fn()); return tree } }
}
function all(node, pred, out = []) {
  if (!node || typeof node !== 'object') return out
  if (pred(node)) out.push(node)
  const children = node.props?.children
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) all(child, pred, out)
  return out
}
const byLabel = (tree, label) => all(tree, n => n.props?.['aria-label'] === label)[0]
test('legacy host adapter and capability-unavailable adapter both identify limited preview', () => {
  for (const legacyHost of [true, false]) {
    const tree = harness({ legacyHost }).render('PreviewPane', { url: 'https://example.com' })
    assert.equal(all(tree, n => n.type === 'SandboxedFrame').length, 1)
    assert.match(JSON.stringify(tree), /Limited preview/)
  }
})
test('search and reading filters keep the toolbar owner key stable', () => {
  const app = harness()
  let tree = app.render('FeedPage')
  const results = node => all(node, n => typeof n.type === 'function' && n.type.name === 'FeedResults')[0]
  const key = results(tree).key
  byLabel(tree, 'Search news').props.onChange({ target: { value: 'chip' } })
  app.render('FeedPage')
  for (const timer of app.timers.values()) if (timer.ms === 250) timer.fn()
  tree = app.render('FeedPage')
  assert.equal(results(tree).props.searchText, 'chip')
  assert.equal(results(tree).key, key, 'Debouncing must not unmount the toolbar')
  all(byLabel(tree, 'Reading status'), n => n.type === 'Button')[1].props.onClick()
  tree = app.render('FeedPage')
  assert.equal(results(tree).props.readFilter, 'unread')
  assert.equal(results(tree).key, key)
  byLabel(tree, 'AI').props.onClick()
  tree = app.render('FeedPage')
  assert.equal(results(tree).props.domain, 'ai')
  assert.equal(results(tree).key, key)
})
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
test('local article scale controls precede close, persist, clamp and reject stale clicks', () => {
  const app = harness(), props = { url: 'https://example.com' }
  let tree = app.render('PreviewPane', props)
  const order = all(tree.props.children[0], n => n.type === 'Button').map(n => n.props['aria-label'])
  assert.deepEqual(order.slice(-4), ['Zoom out article', 'Reset article scale to 80%', 'Zoom in article', 'Close preview'])
  assert.equal(byLabel(tree, 'Reset article scale to 80%').props.children, '80%')
  const plus = byLabel(tree, 'Zoom in article').props.onClick
  plus(); plus()
  tree = app.render('PreviewPane', props)
  assert.equal(byLabel(tree, 'Reset article scale to 80%').props.children, '100%')
  assert.equal(app.saved['settings.pageScale'], 100)
  for (let i = 0; i < 20; i++) plus()
  tree = app.render('PreviewPane', props)
  assert.equal(byLabel(tree, 'Zoom in article').props.disabled, true)
  assert.equal(app.saved['settings.pageScale'], 150)
  const minus = byLabel(tree, 'Zoom out article').props.onClick
  for (let i = 0; i < 20; i++) minus()
  tree = app.render('PreviewPane', props)
  assert.equal(byLabel(tree, 'Zoom out article').props.disabled, true)
  assert.equal(app.saved['settings.pageScale'], 40)
  byLabel(tree, 'Reset article scale to 80%').props.onClick()
  tree = app.render('PreviewPane', props)
  const frame = all(tree, n => n.type === 'SandboxedFrame')[0]
  assert.equal(frame.props.style.transform, 'scale(0.8)')
  assert.equal(frame.props.style.transformOrigin, 'top left')
  assert.equal(frame.props.style.width, '125%')
  assert.equal(frame.props.style.height, '125%')
  assert.equal(frame.props.sandbox, undefined)
  assert.equal(byLabel(harness({ saved: app.saved }).render('PreviewPane', props), 'Reset article scale to 80%').props.children, '80%')
  app.render('PreviewPane', { url: null })
  plus()
  assert.equal(app.saved['settings.pageScale'], 80)
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

const resultProps = { profile: 'default', domain: 'all', readFilter: 'all', searchText: '', showTags: true, updateMutation: {} }
const gridOf = tree => all(tree, n => n.props?.className === 'intelligence-feed-results')[0]
const dividerOf = tree => all(tree, n => n.props?.role === 'separator')[0]
async function openedResults(options = {}) {
  const app = harness(options)
  const render = extra => app.render('FeedResults', { ...resultProps, ...extra })
  const row = all(render(), n => n.type === 'li')[0]
  await all(row, n => n.type === 'Button')[0].props.onClick()
  return { app, render, tree: render() }
}
function pointerTarget() {
  const held = new Set()
  return { setPointerCapture: id => held.add(id), releasePointerCapture: id => held.delete(id), hasPointerCapture: id => held.has(id) }
}
function attachBounds(tree) {
  gridOf(tree).props.ref.current = { getBoundingClientRect: () => ({ left: 100, width: 1008 }) }
}
function gesture(target, clientX, pointerId = 1, button = 0) {
  return { currentTarget: target, clientX, pointerId, button, preventDefault() {} }
}
test('search and filters occupy only the list column while the preview is a full-height sibling', () => {
  const page = harness().render('FeedPage')
  const results = all(page, n => typeof n.type === 'function' && n.type.name === 'FeedResults')[0]
  const toolbar = results.props.children
  assert.equal(toolbar?.props?.className, 'intelligence-feed-toolbar')
  assert.equal(toolbar.props.style.padding, '20px 0 0')
  assert.equal(all(toolbar, n => n.type === 'Input').length, 1)
  assert.equal(all(toolbar, n => n.props?.['aria-label'] === 'Reading status').length, 1)
  const tree = harness().render('FeedResults', { ...resultProps, children: toolbar })
  const grid = gridOf(tree)
  assert.equal(grid.props.children[0].props.children[0], toolbar)
  assert.equal(all(grid.props.children.at(-1), n => n.props?.className === 'intelligence-feed-toolbar').length, 0)
})

test('rows are compact and edge-to-edge; fixed footer owns update actions and Beijing timestamp', () => {
  let calls = 0
  const page = harness().render('FeedPage')
  const main = all(page, n => n.type === 'main')[0]
  assert.equal(main.props.style.padding, undefined, 'Preview must start at the page top, without search-area padding')
  const statusBar = all(page, n => typeof n.type === 'function' && n.type.name === 'FeedStatusBar')[0]
  assert.equal(page.props.children.at(-1), statusBar)
  assert.equal(all(main, n => typeof n.type === 'function' && n.type.name === 'FeedStatusBar').length, 0)
  for (const locale of ['en', 'zh-CN']) {
    const app = harness({ latestRun: { finished_at: '2026-10-29T02:03:04Z' } })
    const tree = app.render('FeedResults', { ...resultProps, locale, updateMutation: { mutate: () => calls++ } })
    const list = all(tree, n => n.type === 'ul')[0], row = all(tree, n => n.type === 'li')[0]
    assert.equal(list.props.style.paddingRight ?? 0, 0)
    assert.equal(row.props.style.padding, '4px 12px 4px 10px')
    assert.equal(row.props.children[0].props.style.padding ?? 0, 0)
    const metadata = all(row, n => n.type === 'span' && n.props.style?.whiteSpace === 'nowrap')[0]
    assert.equal(metadata.props.style.minWidth, 0)
    assert.equal(metadata.props.style.overflow, 'hidden')
    const footer = harness({ latestRun: { finished_at: '2026-10-29T02:03:04Z' } }).render('FeedStatusBar', { ...resultProps, locale, updateMutation: { mutate: () => calls++ } })
    assert.ok(footer, 'Status bar must be outside both scrolling content and resizable grid')
    assert.equal(footer.props.style.flexShrink, 0)
    assert.equal(all(gridOf(tree), n => n.type === 'footer').length, 0)
    assert.match(JSON.stringify(footer), /2026-10-29 10:03:04/)
    assert.doesNotMatch(JSON.stringify(footer), /T02:03:04Z/)
    all(footer, n => n.type === 'Button' && n.props.children === (locale === 'en' ? 'Update now' : '手动更新'))[0].props.onClick()
    const busy = app.render('FeedStatusBar', { ...resultProps, locale, updateMutation: { isPending: true } })
    const busyButton = all(busy, n => n.type === 'Button' && n.props.children === (locale === 'en' ? 'Updating…' : '更新中…'))[0]
    assert.equal(busyButton.props.disabled, true)
  }
  assert.equal(calls, 2)
})
test('preview divider supports defaults, keyboard limits and persistent remounts', async () => {
  const { app, render, tree } = await openedResults()
  let divider = dividerOf(tree)
  assert.ok(divider)
  assert.equal(divider.props['aria-valuenow'], 40)
  assert.equal(divider.props['aria-orientation'], 'vertical')
  assert.equal(divider.props.tabIndex, 0)
  for (const [key, share] of [['ArrowLeft', 62], ['ArrowRight', 60], ['Home', 75], ['End', 30]]) {
    divider.props.onKeyDown({ key, preventDefault() {} })
    divider = dividerOf(render())
    assert.equal(divider.props['aria-valuenow'], 100 - share)
    assert.equal(app.saved['settings.previewShare'], share)
  }
  const restored = await openedResults({ saved: app.saved })
  assert.equal(dividerOf(restored.tree).props['aria-valuenow'], 70)
  for (const [saved, expected] of [[null, 60], ['invalid', 60], [NaN, 60], [99, 75], [-1, 30]]) {
    const entry = await openedResults({ saved: { 'settings.previewShare': saved } })
    assert.equal(dividerOf(entry.tree).props['aria-valuenow'], 100 - expected)
  }
})
test('captured drag clamps, disables transitions/frame input and saves only on release', async () => {
  const { app, render, tree } = await openedResults()
  attachBounds(tree)
  const target = pointerTarget(), separator = dividerOf(tree)
  separator.props.onPointerDown(gesture(target, 504))
  assert.equal(target.hasPointerCapture(1), true)
  separator.props.onPointerMove(gesture(target, -500))
  let next = render()
  assert.equal(dividerOf(next).props['aria-valuenow'], 25)
  assert.equal(gridOf(next).props.style.transition, 'none')
  assert.equal(all(next, n => typeof n.type === 'function' && n.type.name === 'PreviewPane')[0].props.resizing, true)
  assert.equal(app.saved['settings.previewShare'], undefined)
  separator.props.onPointerMove(gesture(target, 3000, 2))
  assert.equal(dividerOf(render()).props['aria-valuenow'], 25)
  separator.props.onPointerMove(gesture(target, 3000))
  assert.equal(dividerOf(render()).props['aria-valuenow'], 70)
  separator.props.onPointerUp(gesture(target, 3000))
  assert.equal(app.saved['settings.previewShare'], 30)
  assert.equal(target.hasPointerCapture(1), false)
  next = render()
  assert.notEqual(gridOf(next).props.style.transition, 'none')
  assert.equal(all(next, n => typeof n.type === 'function' && n.type.name === 'PreviewPane')[0].props.resizing, false)
})
test('cancel, lost capture and close roll back a drag and reject stale events', async () => {
  for (const method of ['onPointerCancel', 'onLostPointerCapture', 'close']) {
    const { app, render, tree } = await openedResults()
    attachBounds(tree)
    const target = pointerTarget(), separator = dividerOf(tree)
    separator.props.onPointerDown(gesture(target, 504, 1, 2))
    assert.equal(target.hasPointerCapture(1), false)
    separator.props.onPointerDown(gesture(target, 504))
    separator.props.onPointerMove(gesture(target, -500))
    if (method === 'close') all(render(), n => typeof n.type === 'function' && n.type.name === 'PreviewPane')[0].props.onClose()
    else separator.props[method](gesture(target, -500))
    separator.props.onPointerUp(gesture(target, -500))
    assert.equal(target.hasPointerCapture(1), false)
    assert.equal(app.saved['settings.previewShare'], undefined)
    if (method === 'close') {
      separator.props.onPointerDown(gesture(target, 504))
      separator.props.onKeyDown({ key: 'Home', preventDefault() {} })
      assert.equal(dividerOf(render()), undefined)
      assert.equal(app.saved['settings.previewShare'], undefined)
    } else assert.equal(dividerOf(render()).props['aria-valuenow'], 40)
  }
})

test('unmount releases active capture without persisting; resizing shields only the frame', async () => {
  const { app, tree } = await openedResults()
  attachBounds(tree)
  const target = pointerTarget(), separator = dividerOf(tree)
  separator.props.onPointerDown(gesture(target, 504))
  separator.props.onPointerMove(gesture(target, -500))
  app.unmount()
  separator.props.onPointerUp(gesture(target, -500))
  separator.props.onKeyDown({ key: 'Home', preventDefault() {} })
  assert.equal(target.hasPointerCapture(1), false)
  assert.equal(app.saved['settings.previewShare'], undefined)
  const frame = all(harness().render('PreviewPane', { url: 'https://example.com', resizing: true }), n => n.type === 'SandboxedFrame')[0]
  assert.equal(frame.props.style.pointerEvents, 'none')
  assert.equal(frame.props.sandbox, undefined)
})
