import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'

// Execute the real build-free component with deterministic SDK/hook adapters.
const source = readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const sdkNames = source.match(/import \{ ([^}]+) \} from '@hermes\/plugin-sdk'/)[1].split(', ')
function harness(saved = {}) {
  const state = []
  let slot = 0
  const counts = { all: { total: 1500, unread: 1234 }, ai: { total: 12, unread: 0 }, favorites: 10, favorites_unread: 8 }
  const context = Object.fromEntries(sdkNames.map(name => [name, name]))
  Object.assign(context, {
    jsx: (type, props, key) => ({ type, props, key }),
    jsxs: (type, props, key) => ({ type, props, key }),
    useState: initial => {
      const i = slot++
      if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial
      return [state[i], next => { state[i] = next }]
    },
    useEffect() {},
    useRef: initial => {
      const i = slot++
      if (!(i in state)) state[i] = { current: initial }
      return state[i]
    },
    useValue: () => 'default',
    useQueryClient: () => ({}),
    useMutation: () => ({}),
    useQuery: options => ({ data: options.queryKey[1] === 'counts' ? counts : [] }),
    host: { state: { profile: {} } }
  })
  const compiled = source.replace(/^import .*$/gm, '').replace('export default {', 'const pluginDefinition = {')
  runInNewContext(compiled + '\nglobalThis.renderFeed = FeedPage', context)
  const writes = []
  const ctx = { storage: { get: (key, fallback) => saved[key] ?? fallback, set: (key, value) => { writes.push([key, value]); saved[key] = value } } }
  const render = () => { slot = 0; return context.renderFeed({ ctx }) }
  return { render, writes }
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return undefined
  if (predicate(node)) return node
  const children = node.props?.children
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) {
    const found = find(child, predicate)
    if (found) return found
  }
}
function groups(tree) {
  const nav = find(tree, n => n.props?.['aria-label'] === 'News categories')
  const navButtons = nav.props.children.filter(n => n?.type === 'Button')
  navButtons.push(nav.props.children.at(-1).props.children)
  const filters = find(tree, n => n.props?.['aria-label'] === 'Reading status').props.children
  return { navButtons, filters }
}

test('navigation uses font-sized equal widths, compact icons and no count badges', () => {
  const app = harness()
  let { navButtons } = groups(app.render())
  assert.equal(navButtons.length, 8)
  assert.deepEqual(Array.from(navButtons, n => n.props.children[0].props.name), ['home', 'circuit-board', 'hubot', 'dashboard', 'music', 'flame', 'github', 'star-empty'])
  for (const button of navButtons) {
    assert.equal(button.props.variant, 'ghost')
    assert.equal(button.props.style.width, '100%')
    assert.equal(button.props.style.gap, 4)
    assert.equal(button.props.style.textAlign, 'left')
    assert.equal(button.props.children[1].props.style.minWidth, 0)
    assert.equal(button.props.children[1].props.style.textOverflow, 'ellipsis')
  }
  assert.equal(navButtons[1].props.title, 'Semiconductors')
  assert.ok(navButtons.every(button => button.props.children.length === 2))
  const nav = find(app.render(), n => n.props?.['aria-label'] === 'News categories')
  assert.equal(nav.props.style.width, 'calc-size(max-content, size * 1.5)')
  navButtons[5].props.onClick()
  ;({ navButtons } = groups(app.render()))
  assert.equal(navButtons.filter(n => n.props['aria-pressed']).length, 1)
  assert.equal(navButtons[5].props.style.background, 'var(--ui-control-active-background)')
  assert.equal(navButtons[0].props.style.background, undefined)
  navButtons.at(-1).props.onClick()
  ;({ navButtons } = groups(app.render()))
  assert.equal(navButtons.at(-1).props['aria-pressed'], true)
  assert.equal(navButtons[5].props.style.background, undefined)
})

test('read and unread badges follow selected domain and favorites, capped at 999', () => {
  const app = harness()
  let { navButtons, filters } = groups(app.render())
  assert.equal(filters[0].props.children, 'All')
  assert.equal(filters[1].props.children, 'Unread (999)')
  assert.equal(filters[2].props.children, 'Read (266)')
  navButtons[2].props.onClick()
  ;({ navButtons, filters } = groups(app.render()))
  assert.equal(filters[1].props.children, 'Unread')
  assert.equal(filters[2].props.children, 'Read (12)')
  navButtons.at(-1).props.onClick()
  ;({ filters } = groups(app.render()))
  assert.equal(filters[1].props.children, 'Unread (8)')
  assert.equal(filters[2].props.children, 'Read (2)')
})

test('dragging the category edge saves only on release and restores the saved width on remount', () => {
  const saved = {}, app = harness(saved)
  const nav = () => find(app.render(), n => n.type === 'nav')
  const handle = () => find(nav(), n => n.props?.role === 'separator')?.props
  let captured = null
  const target = { parentElement: { getBoundingClientRect: () => ({ width: 155 }), parentElement: { clientWidth: 800 } },
    setPointerCapture: id => { captured = id }, hasPointerCapture: id => captured === id, releasePointerCapture: () => { captured = null } }
  const event = clientX => ({ currentTarget: target, button: 0, pointerId: 1, clientX, preventDefault() {} })
  assert.ok(handle(), 'category resize handle is present')
  assert.equal(handle().onDoubleClick, undefined)
  handle().onPointerDown(event(150))
  handle().onPointerMove(event(205))
  assert.equal(nav().props.style.width, 210)
  assert.equal(app.writes.length, 0)
  handle().onPointerUp(event(205))
  assert.deepEqual(app.writes, [['settings.sidebarWidth', 210]])
  assert.equal(captured, null)
  assert.equal(find(harness(saved).render(), n => n.type === 'nav').props.style.width, 210)
  handle().onPointerDown(event(150))
  handle().onPointerMove(event(650))
  assert.equal(nav().props.style.width, 360)
  handle().onPointerCancel(event(650))
  assert.equal(nav().props.style.width, 210)
  assert.equal(app.writes.length, 1)
  target.parentElement.parentElement.clientWidth = 400
  handle().onPointerDown(event(150))
  handle().onPointerUp(event(650))
  assert.equal(nav().props.style.width, 180)
})

test('reading filters switch selection without persistent fill on inactive items', () => {
  const app = harness()
  let { filters } = groups(app.render())
  assert.equal(filters[0].props['aria-pressed'], true)
  filters[1].props.onClick()
  ;({ filters } = groups(app.render()))
  assert.equal(filters.filter(n => n.props['aria-pressed']).length, 1)
  assert.equal(filters[1].props.style.background, 'var(--ui-control-active-background)')
  assert.equal(filters[0].props.style, undefined)
  assert.equal(filters[2].props.style, undefined)
  assert.ok(filters.every(n => n.props.variant === 'ghost'))
})

test('GitHub Trending opens on monthly; period switches are temporary', () => {
  const app = harness()
  const byLabel = label => find(app.render(), n => n.props?.['aria-label'] === label)
  assert.ok(byLabel('GitHub Trending'))
  byLabel('GitHub Trending').props.onClick()
  const periods = () => byLabel('Trending period').props.children
  assert.deepEqual(Array.from(periods(), n => n.props.children), ['Today', 'This week', 'This month'])
  assert.equal(periods()[2].props['aria-pressed'], true)
  periods()[1].props.onClick()
  assert.equal(periods()[1].props['aria-pressed'], true)
  byLabel('BriefNest settings').props.onClick()
  assert.equal(byLabel('Default period'), undefined)
  byLabel('All').props.onClick()
  byLabel('GitHub Trending').props.onClick()
  assert.equal(periods()[2].props['aria-pressed'], true)
})
