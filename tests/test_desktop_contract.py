"""Offline static contracts for the build-free Hermes desktop entry point."""
from pathlib import Path
import re

P = Path(__file__).parents[1] / "desktop" / "plugin.js"


def contract(check):
    def test():
        check(P.read_text(encoding="utf-8"))
    test.__name__ = check.__name__
    return test


@contract
def test_registration(source):
    for token in ("const ID = 'intelligence-feed'", "id: ID", "defaultEnabled: false",
                  "area: ROUTES_AREA", "area: SIDEBAR_NAV_AREA",
                  "path: '/intelligence-feed'", "name: 'BriefNest'", "label: 'BriefNest'", "codicon: 'rss'"):
        assert token in source


@contract
def test_build_free_imports_and_theme(source):
    imports = re.findall(r"import\s+.*?\s+from\s+['\"]([^'\"]+)", source, re.S)
    assert set(imports) == {'@hermes/plugin-sdk', 'react', 'react/jsx-runtime'}
    assert not re.search(r'<(?:[A-Za-z][\w.]*\b|/|>)', source)
    assert not re.search(r'#[0-9a-fA-F]{3,8}\b|rgba?\s*\(|[\'"](?:black|white)[\'"]', source)
    # Backgrounds are allowed only via theme tokens (card fill, tint capsules).
    for value in re.findall(r"background:\s*'([^']+)'", source):
        assert 'var(--ui-' in value
    assert 'var(--ui-' in source
    sdk = re.search(r'import\s*{([^}]+)}\s*from\s*[\'"]@hermes/plugin-sdk', source).group(1)
    imported = set(re.findall(r'\b\w+\b', sdk))
    local = set(re.findall(r'function\s+([A-Z]\w*)', source))
    referenced = set(re.findall(r'jsx[s]?\(\s*([A-Z]\w*)', source))
    assert referenced - local <= imported


@contract
def test_filters_debounce_and_query_keys(source):
    for state in ('domain', 'readFilter', 'draftSearch', 'searchText', 'cursor', 'pages'):
        assert re.search(r'const \[' + state + r',\s*set\w+\] = useState\(', source)
    assert 'useValue(host.state.profile)' in source
    assert 'setTimeout(() => setSearchText(draftSearch), 250)' in source
    assert 'clearTimeout(timer)' in source
    assert '[draftSearch]' in source
    assert "[ID, 'events', profile, domain, readFilter, searchText, trendingPeriod]" in source
    assert "[ID, 'events', profile, domain, readFilter, searchText, cursor]" in source
    assert 'JSON.stringify([profile, domain, readFilter, searchText, trendingPeriod])' in source
    assert 'const profileKey = JSON.stringify([profile])' in source
    assert '}, profileKey)' in source  # preserve toolbar DOM/focus within one profile
    assert 'const sameResults = resultsScope === scope' in source
    assert 'setResultsScope(scope)' in source
    for token in ('read: readFilter', 'q: searchText', "limit: '50'", 'cursor'):
        assert token in source
    assert '[scope, events.dataUpdatedAt, events.isPlaceholderData]' in source
    assert 'queryClient.fetchQuery' in source
    assert 'const paginationGeneration = useRef(0)' in source
    assert 'const generation = paginationGeneration.current' in source
    assert 'if (!state.alive || scope !== activeScope.current || generation !== paginationGeneration.current) return' in source


@contract
def test_settings_dialog_can_persistently_hide_keyword_tags(source):
    for component in ('Switch', 'Dialog', 'DialogContent', 'DialogDescription',
                      'DialogFooter', 'DialogHeader', 'DialogTitle'):
        assert component in source
    assert "ctx.storage.get('settings.showTags', true)" in source
    assert "ctx.storage.set('settings.showTags', next)" in source
    assert "showTags && jsx('span'" in source
    assert "ctx.storage.get('settings.locale', 'en')" in source
    assert "ctx.storage.set('settings.locale', next)" in source
    assert 'function normalizeLocale(value)' in source
    assert re.search(r"jsx\(FeedResults, \{ ctx, profile, domain,[^\n]*\bshowTags, updateMutation, locale, (?:sidebarResizing, )?children:", source)


@contract
def test_settings_dialog_lists_and_toggles_sources_by_domain(source):
    assert "const SOURCE_GROUPS = [" in source
    for domain, label in (
        ("semiconductor", "半导体"), ("ai", "AI"), ("automotive", "汽车"),
        ("music", "音乐"), ("weibo", "热搜"),
    ):
        assert f"['{domain}', '{label}']" in source
    assert "queryKey: [ID, 'sources']" in source
    assert "ctx.rest('/sources')" in source
    assert "ctx.rest(`/sources/${id}`, { method: 'PATCH', body: { value } })" in source
    assert 'children: t(locale, "信息源")' in source
    assert "style: settingsTitleStyle, children: t(locale, label)" in source
    assert "style: settingsOptionStyle, children: source.name" in source
    assert "sourceSettings.data?.filter(source => source.domain === value)" in source
    assert '${source.enabled ? t(locale, "停用") : t(locale, "启用")} ${source.name}' in source
    assert "checked: source.enabled" in source
    assert "sourceMutation.mutate({ id: source.id, value })" in source
    assert "queryClient.invalidateQueries({ queryKey: [ID, 'sources'] })" in source
    assert "queryClient.invalidateQueries({ queryKey: [ID, 'counts', profile] })" in source
    assert "queryClient.invalidateQueries({ queryKey: [ID, 'events', profile] })" in source
    assert "关闭后停止采集并从普通列表隐藏，历史收藏仍会保留。" in source


@contract
def test_settings_typography_is_consistent(source):
    assert "const settingsTitleStyle = { fontSize: 14, fontWeight: 700, color: 'var(--ui-text-primary)' }" in source
    assert "const settingsOptionStyle = { fontSize: 12, fontWeight: 400 }" in source
    for title in ('关键词标签', '界面语言', '信息源'):
        assert f'style: settingsTitleStyle, children: t(locale, "{title}")' in source
    assert "jsx(DialogTitle, { style: settingsTitleStyle" in source
    assert "jsxs(DialogContent, { style: settingsOptionStyle" in source
    assert "jsx(DialogDescription, { style: settingsOptionStyle" in source


@contract
def test_settings_scrolls_as_one_body_and_places_tag_switch_on_right(source):
    dialog = source.split('jsx(Dialog, { open: settingsOpen', 1)[1].split('function FeedStatusBar(', 1)[0]
    assert 'jsx(ScrollArea' not in dialog
    assert 'maxHeight: 360' not in dialog
    row = dialog.split("jsxs('label',", 1)[1].split("jsxs('div',", 1)[0]
    assert "justifyContent: 'space-between'" in row
    assert row.index('children: t(locale, "关键词标签")') < row.index('jsx(Switch,')


@contract
def test_scoped_routes_and_mutations(source):
    for route in ('/events?', '/counts?', '/sources', '/sources/${id}', '/runs/latest', '/updates', '/events/${event.id}/read', '/events/${id}/favorite'):
        assert route in source
    assert "method: 'POST'" in source
    assert source.count("method: 'PATCH'") == 3
    assert 'body: { profile, value: true }' in source
    assert 'body: { profile, value }' in source
    opened = source.split('async function openEvent(event) {')[1].split('function favoriteClick')[0]
    assert opened.index('/read') < opened.index('await refresh()') < opened.index('setPreviewUrl(event.url)')
    assert 'catch' in opened and 'host.notify' in opened
    assert opened.index('validDestination(event.url)') < opened.index('/read')
    assert 'domEvent.stopPropagation()' in source
    assert 'setPreviewUrl(event.url)' in source
    assert 'jsx(SandboxedFrame, {' in source
    assert 'src: displayUrl' in source
    assert "ctx.os.openExternal(url) === false" in source
    assert "parsed.protocol === 'https:'" in source
    assert 'onError: () =>' in source
    assert 'onLoad:' not in source
    for forbidden in ('webview', 'executeJavaScript', 'console-message', 'setZoomFactor', 'previewZoom'):
        assert forbidden not in source
    assert 'prefers-reduced-motion: reduce' in source
    assert 'grid-template-columns 180ms ease-out' in source
    assert source.count('link-external') == 1
    assert 'value: !event.favorite' in source
    assert "event.favorite ? 'star-full' : 'star-empty'" in source
    assert 'onMutate' not in source  # server-confirmed state, no optimistic loss on error
    assert "queryKey: [ID, 'events', profile]" in source
    assert "queryKey: [ID, 'counts', profile]" in source
    assert 'onError:' in source and "kind: 'error'" in source
    assert "timeoutMs: 160_000" in source
    assert "result.status === 'failed'" in source and "result.status === 'partial'" in source
    assert "[ID, 'runs/latest', profile]" in source


@contract
def test_cards_tags_and_time_display(source):
    assert "border: `1px solid ${softAccent}`" not in source
    assert "borderRadius: 8" not in source
    row = source.split("}, event.id) : jsxs('li',", 1)[1].split('children: [', 1)[0]
    assert "borderBottom: '1px solid var(--ui-stroke-secondary)'" in row
    assert "color: event.read ? muted : 'var(--ui-text-primary)'" in source
    assert 'color: event.read ? muted : softAccent' in source
    assert source.count('style: softButtonStyle') >= 4  # Load-more action was removed.
    # 领域/阅读筛选沿用 Desktop 原生浅色选中态，非选中项透明。
    assert "const selected = domain === value" in source
    assert "color-mix(in srgb, var(--ui-accent) 85%, transparent)" not in source
    assert "const selectedControlStyle = { background: 'var(--ui-control-active-background)'" in source
    assert "selected ? selectedControlStyle : undefined" in source
    assert "readFilter === value ? selectedControlStyle : undefined" in source
    # 左栏随字体自适应，领域/收藏夹等宽；计数移到阅读筛选。
    domain_button = source.split('function domainButton(value, label) {', 1)[1].split("return jsxs('div'", 1)[0]
    assert "counts.data?.favorites_unread" in source
    assert "Math.min(count, 999)" in source
    assert "count > 0" in source
    assert "width: '100%'" in domain_button
    assert "width: sidebarWidth ?? 'calc-size(max-content, size * 1.5)'" in source
    assert 'gap: 4' in domain_button
    assert "variant: 'ghost', size: 'sm'" in domain_button
    assert "jsx(Codicon, { name: DOMAIN_ICONS[value]" in domain_button
    assert "children: t(locale, label)" in domain_button
    assert "countLabel" not in domain_button
    assert "children: readingLabel(value, label)" in source
    for value, icon in (('all', 'home'), ('semiconductor', 'circuit-board'),
                        ('ai', 'hubot'), ('automotive', 'dashboard'),
                        ('music', 'music'), ('weibo', 'flame'), ('favorites', 'star-empty')):
        assert f"{value}: '{icon}'" in source
    # 阅读状态筛选按钮同样的选中高亮。
    assert "readFilter === value" in source
    # 滚动条留位放到行内，分隔线不缩短；上下留白4px。
    assert "padding: '4px 12px 4px 10px'" in row
    assert 'paddingRight: 12' not in source
    # 列表内部按钮不填充（默认 variant 是主题色填充，必须显式 ghost）。
    assert source.count("variant: 'ghost'") >= 2
    # 横线覆盖完整行（包括星标），按钮不引入额外内边距。
    assert "variant: 'ghost', size: 'inline'" in source
    assert "size: 'icon-xs'" in source
    assert 'marginTop: 2' in source
    assert "useState('all')" in source
    assert 'domainButton(\'all\', t(locale, "全部"))' in source
    # 热度元素：多源报道显示 ×N，单源显示 -。
    assert 'event.evidence_count > 1' in source
    assert 't(locale, "热度")' in source
    # 关键词标签：内置词表、最多 3 个、浅色主题色胶囊。
    assert 'const KEYWORDS = [' in source
    assert 'function keywordsFor(headline)' in source
    assert 'if (hits.length === 3) break' in source
    assert 'color-mix(in srgb, var(--ui-accent) 14%, transparent)' in source
    assert 'borderRadius: 999' in source
    # 时间：北京时间数字格式 + 距今相对时间；标签在左、时间在右同一行。
    assert 'function formatTime(iso)' in source
    assert "replace('T', ' ')" in source
    assert "function relativeTime(iso, locale = 'en')" in source
    assert "'刚刚'" in source and '分钟前' in source and '小时前' in source and '天前' in source
    assert "justifyContent: 'space-between'" in source


@contract
def test_navigation_and_reading_toolbar_have_region_dividers(source):
    assert "marginTop: 'auto', marginLeft: -8, marginRight: -8, borderTop: '1px solid var(--ui-stroke-secondary)'" in source
    toolbar = source.split('jsx(Input, { \'aria-label\': t(locale, "搜索资讯")', 1)[1].split("jsx(Dialog,", 1)[0]
    assert "borderBottom: '1px solid var(--ui-stroke-secondary)', padding: '0 20px 12px'" in toolbar
    assert "padding: '20px 0 0'" in source


@contract
def test_translated_title_is_primary_and_original_is_preserved(source):
    assert "event.translated_headline || event.headline" in source
    assert "event.translated_headline && jsx('span'" in source
    assert "children: event.headline" in source
    assert "fontSize: 12" in source
    assert "keywordsFor(event.translated_headline || event.headline)" in source


@contract
def test_layout_and_states(source):
    for label in ('全部', '半导体', 'AI', '汽车', '音乐', '热搜', '收藏夹', '未读', '已读', '手动更新', '更新时间',
                  '暂无未读消息', '近 30 天暂无消息', '收藏夹为空', '没有匹配的消息', '加载更多', '重试'):
        assert label in source
    for component in ('Skeleton', 'ErrorState', 'EmptyState', 'ScrollArea'):
        assert re.search(r'jsx[s]?\(' + component + r'\b', source)
    assert "marginTop: 'auto'" in source
    assert "display: 'flex'" in source
    assert 'events.isError' in source and 'events.refetch()' in source
    assert 'events.isLoading' in source
    assert 'pages.flatMap(page => page.items)' in source
    assert 'setPages(previous => [...previous, page])' in source
    assert 'setCursor(nextCursor)' in source
    assert 'setPages([])' in source and 'setCursor(null)' in source
    assert 'state.request' in source and 'eventsRef.current.isFetching' in source
    assert 'onScrollCapture: onListScroll' in source
    assert 'new IntersectionObserver' in source
    assert "onClick: () => loadMore(true)" in source
    assert 'fontWeight: event.read ? 400 : 600' in source
    assert 'var(--ui-border)' not in source
    assert 'var(--ui-stroke-secondary)' in source
    assert "'aria-live': 'polite'" in source
    assert "${event.headline}" in source


@contract
def test_browser_preview_uses_only_public_rest_and_local_canvas(source):
    assert 'browser.embed' not in source and 'ctx.browser' not in source
    assert "ctx.rest('/browser/status')" in source
    assert "ctx.rest('/browser/sessions'" in source
    for action in ('navigate', 'resize', 'paint', 'reload'):
        assert f"'{action}'" in source
    assert 'life.guard.dispose()' in source
    assert 'lifeRef.current !== life' in source
    assert 'gatewayActivationEpoch' in source
    surface = source.split('function StreamSurface(', 1)[1].split('function PreviewPane(', 1)[0]
    assert 'useQuery' not in surface and 'queryClient' not in surface
    assert '/frame?after_seq=' in surface and '&wait_ms=' in surface
    assert "className: 'intelligence-feed-stream-browser'" in source
    assert '受限预览' in source and 'Limited preview' in source
    assert '刷新预览' in source and 'Refresh preview' in source
    assert '!parsed.username && !parsed.password' in source
    for forbidden in ('window.hermesDesktop', 'electron', 'MutationObserver', 'document.querySelector', 'contentDocument', 'contentWindow'):
        assert forbidden not in source
    # Only the plugin-owned canvas's window is used for outside mouse release;
    # this does not inspect a remote frame or inject scripts into guest content.
    assert source.count('ownerDocument') == 1
    assert 'canvas.ownerDocument.defaultView' in source
    stream_slot = source.split('children: useStream ? jsx(StreamSurface,', 1)[1].split('jsx(SandboxedFrame', 1)[0]
    assert 'transform' not in stream_slot
    frame = source.split('jsx(SandboxedFrame,', 1)[1]
    assert 'sandbox:' not in frame


if __name__ == '__main__':
    import unittest
    result = unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(
        unittest.FunctionTestCase(check) for name, check in list(globals().items())
        if name.startswith('test_')
    ))  # pytest and the stdlib runner execute the identical contracts
    raise SystemExit(not result.wasSuccessful())
