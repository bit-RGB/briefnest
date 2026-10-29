import { Button, Codicon, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, ErrorState, Input, ROUTES_AREA, SandboxedFrame, ScrollArea, SIDEBAR_NAV_AREA, Skeleton, Switch, host, useMutation, useQuery, useQueryClient, useValue } from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'intelligence-feed'
const muted = 'var(--ui-text-secondary)'
const settingsTitleStyle = { fontSize: 14, fontWeight: 700, color: 'var(--ui-text-primary)' }
const settingsOptionStyle = { fontSize: 12, fontWeight: 400 }
// 卡片边框保留柔和主题色；控件使用 Desktop 原生背景与选中态。
const softAccent = 'color-mix(in srgb, var(--ui-accent) 50%, transparent)'
const softButtonStyle = { background: 'var(--ui-bg-quaternary)', color: 'var(--ui-text-primary)' }
const selectedControlStyle = { background: 'var(--ui-control-active-background)', color: 'var(--ui-text-primary)', fontWeight: 600 }
const DOMAIN_ICONS = {
  all: 'home',
  semiconductor: 'circuit-board',
  ai: 'hubot',
  automotive: 'dashboard',
  music: 'music',
  weibo: 'flame',
  favorites: 'star-empty'
}
const PREVIEW_MOTION_MS = 180

const EN = {
  "本次更新失败，已保留原有资讯": "Update failed. Existing news has been preserved.",
  "部分来源更新失败，已保存成功结果": "Some sources failed to update. Successful results were saved.",
  "资讯更新完成": "News updated.",
  "更新失败或正在更新，请稍后重试": "Update failed or is already running. Try again later.",
  "信息源设置保存失败，请重试": "Could not save source settings. Please try again.",
  "资讯分类": "News categories",
  "全部": "All",
  "半导体": "Semiconductors",
  "汽车": "Automotive",
  "音乐": "Music",
  "热搜": "Trending",
  "收藏夹": "Favorites",
  "AI": "AI",
  "重试计数": "Retry counts",
  "搜索资讯": "Search news",
  "阅读状态": "Reading status",
  "未读": "Unread",
  "已读": "Read",
  "讯集设置": "BriefNest settings",
  "设置": "Settings",
  "控制资讯卡片中显示的辅助信息。": "Choose your interface language and news display preferences. Articles stay in their original language.",
  "关键词标签": "Keyword tags",
  "关闭后隐藏资讯标题下方的关键词标签。": "Hide keyword tags below news headlines when disabled.",
  "界面语言": "Interface language",
  "信息源": "Sources",
  "关闭后停止采集并从普通列表隐藏，历史收藏仍会保留。": "Disabled sources stop collecting and leave regular lists. Existing favorites are kept.",
  "加载信息源中": "Loading sources",
  "信息源加载失败": "Could not load sources",
  "无法读取当前信息源设置。": "Source settings could not be retrieved.",
  "重试": "Retry",
  "完成": "Done",
  "收藏操作失败，请重试": "Could not update favorite. Please try again.",
  "该消息的原始链接不可用": "The original article link is unavailable.",
  "打开消息失败，请重试": "Could not open article. Please try again.",
  "加载更多失败，请重试": "Could not load more. Please try again.",
  "没有匹配的消息": "No matching news",
  "收藏夹中暂无未读消息": "No unread favorites",
  "收藏夹中暂无已读消息": "No read favorites",
  "收藏夹为空": "No favorites yet",
  "暂无未读消息": "No unread news",
  "暂无已读消息": "No read news",
  "近 30 天暂无消息": "No news in the last 30 days",
  "尚未更新": "Not updated yet",
  "重试更新时间": "Retry update time",
  "更新中…": "Updating…",
  "手动更新": "Update now",
  "加载资讯中": "Loading news",
  "加载失败": "Could not load news",
  "无法加载资讯，请重试。": "News could not be loaded. Please try again.",
  "加载更多中": "Loading more",
  "加载更多": "Load more",
  "刚刚": "Just now",
  "启用": "Enable",
  "停用": "Disable",
  "收藏": "Add favorite",
  "取消收藏": "Remove favorite",
  "无": "None",
  "单一来源": "Single source",
  "在外部浏览器打开": "Open in external browser",
  "关闭预览": "Close preview",
  "文章预览": "Article preview",
  "无法打开外部浏览器，请使用系统浏览器访问原始链接。": "Could not open external browser. Please use your system browser to visit the original link.",
  "预览无法加载，请在外部浏览器打开。": "Preview could not be loaded. Open it in an external browser.",
  "部分网站不允许内嵌预览。如果页面空白或无法使用，请在外部浏览器打开。": "Some sites block embedded previews. If this page is blank or unusable, open it in an external browser.",
  "更新时间": "Updated:",
  "热度": "Coverage:"
}

function normalizeLocale(value) { return value === 'zh-CN' ? 'zh-CN' : 'en' }
function t(locale, key) { return locale === 'zh-CN' ? key : EN[key] ?? key }

const SOURCE_GROUPS = [
  ['semiconductor', '半导体'],
  ['ai', 'AI'],
  ['automotive', '汽车'],
  ['music', '音乐'],
  ['weibo', '热搜']
]

// 关键词表：按领域整理的常见标签词库，长词在前，优先命中更具体的词。
const KEYWORDS = [
  // 半导体
  '中芯国际', '长江存储', '北方华创', '中微公司', '兆易创新', '韦尔股份', '寒武纪', '摩尔线程',
  '长鑫', '华虹', '海光', '燧原', '壁仞', '华为', '昇腾', '麒麟', '鸿蒙',
  'HBM', 'DRAM', 'NAND', '存储', '光刻', 'EUV', '先进封装', 'Chiplet', '芯粒', '晶圆', 'EDA',
  'RISC-V', 'GPU', 'CPU', 'MCU', 'AI芯片', '碳化硅', 'SiC', '氮化镓', 'GaN',
  '台积电', '三星', '英特尔', '高通', '英伟达', 'AMD', 'Arm', 'ASML',
  '涨价', 'IPO', '并购', '国产替代', '2nm', '3nm', '制程', '封装',
  '晶圆代工', '封测', '光模块', 'CPO', '硅光', '功率半导体', 'IGBT', '模拟芯片', '射频',
  '传感器', 'CIS', '光刻胶', '刻蚀', '薄膜沉积', '良率', '产能',
  // AI
  '大模型', '智能体', 'Agent', '多模态', '具身智能', 'DeepSeek', 'OpenAI', 'GPT', 'Sora',
  '通义', '文心', '豆包', 'Kimi', '千问', '混元', '推理模型', '开源模型', '微调', '算力',
  'AIGC', '生成式AI', 'Copilot', 'Claude', 'Gemini', 'Llama', 'Anthropic', 'xAI', 'Grok',
  'AI编程', 'AI办公', 'AI视频', '数字人', '人形机器人', '机器人', '世界模型', '强化学习',
  '蒸馏', '量化', '边缘AI', '端侧AI', 'AI眼镜', 'AI手机', 'AI PC', 'RAG',
  // 汽车
  '新能源', '电动车', '智驾', '自动驾驶', '激光雷达', '固态电池', '超充', '换电',
  '蔚来', '小鹏', '理想', '小米汽车', '比亚迪', '特斯拉', '极氪', '鸿蒙智行',
  '问界', '阿维塔', '零跑', '哪吒', '奇瑞', '吉利', '长城', '混动', '增程', '纯电',
  '动力电池', '800V', '智能座舱', 'OTA', 'NOA', 'L3', 'L4', 'Robotaxi', '召回', '交付量', '销量',
  // 音乐
  '新专辑', '新歌', '单曲', 'MV', '演唱会', '巡演', '音乐节', '金曲奖', '首发', '上线',
  '原声', 'OST', '乐队', '歌手', '制作人', '唱片', '作曲', '作词', '编曲', '翻唱',
  'Livehouse', '世界巡演', '音源', '播放量', '音乐奖', '摇滚', '民谣', '说唱', '嘻哈', '国风'
]

function keywordsFor(headline) {
  if (!headline) return []
  const hits = []
  for (const word of KEYWORDS) {
    if (headline.includes(word) && !hits.some(hit => hit.includes(word) || word.includes(hit))) hits.push(word)
    if (hits.length === 3) break
  }
  return hits
}

// 2026-09-14T16:44:12+08:00 → 2026-09-14 16:44:12（北京时间数字，不带时区后缀）
function formatTime(iso) {
  return (iso ?? '').replace('T', ' ').replace(/([+-]\d{2}:\d{2}|Z)$/, '')
}

function relativeTime(iso, locale = 'en') {
  const then = new Date(iso).getTime()
  if (!then) return ''
  const minutes = Math.max(0, Math.floor((Date.now() - then) / 60000))
  if (minutes < 1) return t(locale, '刚刚')
  if (minutes < 60) return locale === 'zh-CN' ? `${minutes}分钟前` : `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return locale === 'zh-CN' ? `${hours}小时前` : `${hours}h ago`
  return locale === 'zh-CN' ? `${Math.floor(hours / 24)}天前` : `${Math.floor(hours / 24)}d ago`
}

export default {
  id: ID,
  name: 'BriefNest',
  defaultEnabled: false,
  register(ctx) {
    ctx.registerMany([
      { id: 'page', area: ROUTES_AREA, data: { path: '/intelligence-feed' }, render: () => jsx(FeedPage, { ctx }) },
      { id: 'nav', area: SIDEBAR_NAV_AREA, order: 70, data: { path: '/intelligence-feed', label: 'BriefNest', codicon: 'rss' } }
    ])
  }
}

function FeedPage({ ctx }) {
  const profile = useValue(host.state.profile)
  const queryClient = useQueryClient()
  const [domain, setDomain] = useState('all')
  const [readFilter, setReadFilter] = useState('all')
  const [draftSearch, setDraftSearch] = useState('')
  const [searchText, setSearchText] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showTags, setShowTags] = useState(() => ctx.storage.get('settings.showTags', true) !== false)
  const [locale, setLocale] = useState(() => normalizeLocale(ctx.storage.get('settings.locale', 'en')))
  function changeLocale(value) {
    const next = normalizeLocale(value)
    setLocale(next)
    ctx.storage.set('settings.locale', next)
  }
  useEffect(() => {
    const timer = setTimeout(() => setSearchText(draftSearch), 250)
    return () => clearTimeout(timer)
  }, [draftSearch])
  const updateMutation = useMutation({
    mutationFn: () => ctx.rest('/updates', { method: 'POST', timeoutMs: 160_000 }),
    onSuccess: result => {
      queryClient.invalidateQueries({ queryKey: [ID] })
      if (result.status === 'failed') host.notify({ kind: 'error', message: t(locale, "本次更新失败，已保留原有资讯") })
      else if (result.status === 'partial') host.notify({ kind: 'warning', message: t(locale, "部分来源更新失败，已保存成功结果") })
      else host.notify({ kind: 'success', message: t(locale, "资讯更新完成") })
    },
    onError: () => host.notify({ kind: 'error', message: t(locale, "更新失败或正在更新，请稍后重试") })
  })
  const counts = useQuery({
    queryKey: [ID, 'counts', profile],
    queryFn: () => ctx.rest('/counts?' + new URLSearchParams({ profile })),
    refetchInterval: 60_000
  })
  const sourceSettings = useQuery({
    queryKey: [ID, 'sources'],
    queryFn: () => ctx.rest('/sources')
  })
  const sourceMutation = useMutation({
    mutationFn: ({ id, value }) => ctx.rest(`/sources/${id}`, { method: 'PATCH', body: { value } }),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: [ID, 'sources'] }),
      queryClient.invalidateQueries({ queryKey: [ID, 'counts', profile] }),
      queryClient.invalidateQueries({ queryKey: [ID, 'events', profile] })
    ]),
    onError: () => host.notify({ kind: 'error', message: t(locale, "信息源设置保存失败，请重试") })
  })
  // React's key resets cursor/pages atomically, including on profile switches.
  const filterKey = JSON.stringify([profile, domain, readFilter, searchText])
  function domainButton(value, label) {
    const count = value === 'favorites' ? counts.data?.favorites_unread : counts.data?.[value]?.unread
    const countLabel = count > 0 ? ` (${Math.min(count, 999)})` : ''
    const selected = domain === value
    return jsxs(Button, {
      variant: 'ghost', size: 'sm',
      'aria-pressed': selected,
      'aria-label': `${t(locale, label)}${countLabel}`,
      title: t(locale, label),
      onClick: () => setDomain(value),
      style: { width: 120, minHeight: 28, alignSelf: 'flex-start', justifyContent: 'flex-start', gap: 8, ...(selected ? selectedControlStyle : undefined) },
      children: [
        jsx(Codicon, { name: DOMAIN_ICONS[value], 'aria-hidden': true, style: { fontSize: 14, flexShrink: 0 } }),
        jsx('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: t(locale, label) }),
        countLabel && jsx('span', { style: { marginLeft: 'auto', flexShrink: 0, fontSize: 11, fontWeight: 400, color: muted }, children: countLabel })
      ]
    }, value)
  }
  return jsxs('div', {
    style: { display: 'flex', height: '100%', minHeight: 0, color: 'var(--ui-text-primary)' },
    children: [
      jsxs('nav', {
        'aria-label': t(locale, "资讯分类"),
        style: { display: 'flex', flexDirection: 'column', width: 144, flexShrink: 0, padding: 12, gap: 4, borderRight: '1px solid var(--ui-stroke-secondary)' },
        children: [domainButton('all', t(locale, "全部")), domainButton('semiconductor', t(locale, "半导体")), domainButton('ai', t(locale, "AI")), domainButton('automotive', t(locale, "汽车")), domainButton('music', t(locale, "音乐")), domainButton('weibo', t(locale, "热搜")),
          counts.isError && jsx(Button, { onClick: () => counts.refetch(), style: softButtonStyle, children: t(locale, "重试计数") }),
          jsx('div', { style: { marginTop: 'auto', borderTop: '1px solid var(--ui-stroke-secondary)', paddingTop: 12 }, children: domainButton('favorites', t(locale, "收藏夹")) })]
      }),
      jsxs('main', {
        style: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0, padding: 20, gap: 12 },
        children: [
          jsx(Input, { 'aria-label': t(locale, "搜索资讯"), placeholder: t(locale, "搜索资讯"), value: draftSearch, maxLength: 100, onChange: e => setDraftSearch(e.target.value) }),
          jsxs('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderBottom: '1px solid var(--ui-stroke-secondary)', paddingBottom: 12 }, children: [
            jsx('div', { role: 'group', 'aria-label': t(locale, "阅读状态"), style: { display: 'flex', gap: 4 }, children:
              [['all', t(locale, "全部")], ['unread', t(locale, "未读")], ['read', t(locale, "已读")]].map(([value, label]) => jsx(Button, {
                variant: 'ghost', size: 'sm',
                'aria-pressed': readFilter === value, onClick: () => setReadFilter(value),
                style: readFilter === value ? selectedControlStyle : undefined,
                children: t(locale, label)
              }, value)) }),
            jsxs(Button, { variant: 'ghost', size: 'sm', 'aria-label': t(locale, "讯集设置"), onClick: () => setSettingsOpen(true), children: [
              jsx(Codicon, { name: 'gear' }),
              t(locale, "设置")
            ] })
          ] }),
          jsx(Dialog, { open: settingsOpen, onOpenChange: setSettingsOpen, children: jsxs(DialogContent, { style: settingsOptionStyle, children: [
            jsxs(DialogHeader, { children: [
              jsx(DialogTitle, { style: settingsTitleStyle, children: t(locale, "讯集设置") }),
              jsx(DialogDescription, { style: settingsOptionStyle, children: t(locale, "控制资讯卡片中显示的辅助信息。") })
            ] }),
            jsxs('label', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'pointer' }, children: [
              jsxs('span', { style: { display: 'flex', flexDirection: 'column', gap: 2 }, children: [
                jsx('span', { style: settingsTitleStyle, children: t(locale, "关键词标签") }),
                jsx('span', { style: { color: muted, fontSize: 12 }, children: t(locale, "关闭后隐藏资讯标题下方的关键词标签。") })
              ] }),
              jsx(Switch, { 'aria-label': t(locale, "关键词标签"), checked: showTags, size: 'xs', onCheckedChange: value => {
                const next = Boolean(value)
                setShowTags(next)
                ctx.storage.set('settings.showTags', next)
              } })
            ] }),
            jsxs('label', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, children: [
              jsx('span', { style: settingsTitleStyle, children: t(locale, "界面语言") }),
              jsxs('select', { 'aria-label': t(locale, "界面语言"), value: locale, onChange: e => changeLocale(e.target.value), style: { ...settingsOptionStyle, color: 'var(--ui-text-primary)', background: 'var(--ui-bg-quaternary)' }, children: [
                jsx('option', { value: 'en', children: 'English' }),
                jsx('option', { value: 'zh-CN', children: '简体中文' })
              ] })
            ] }),
            jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12, borderTop: '1px solid var(--ui-stroke-secondary)' }, children: [
              jsx('div', { style: settingsTitleStyle, children: t(locale, "信息源") }),
              jsx('div', { style: { color: muted, fontSize: 12 }, children: t(locale, "关闭后停止采集并从普通列表隐藏，历史收藏仍会保留。") }),
              sourceSettings.isLoading && jsx(Skeleton, { style: { height: 96 }, 'aria-label': t(locale, "加载信息源中") }),
              sourceSettings.isError && jsxs('div', { children: [
                jsx(ErrorState, { title: t(locale, "信息源加载失败"), description: t(locale, "无法读取当前信息源设置。") }),
                jsx(Button, { onClick: () => sourceSettings.refetch(), style: softButtonStyle, children: t(locale, "重试") })
              ] }),
              !sourceSettings.isLoading && !sourceSettings.isError && jsx('div', {
                style: { display: 'flex', flexDirection: 'column', gap: 12 }, children:
                  SOURCE_GROUPS.map(([value, label]) => {
                    const domainSources = sourceSettings.data?.filter(source => source.domain === value) ?? []
                    if (!domainSources.length) return null
                    return jsxs('section', { style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: [
                      jsx('div', { style: settingsTitleStyle, children: t(locale, label) }),
                      domainSources.map(source => jsxs('label', {
                        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: sourceMutation.isPending ? 'default' : 'pointer' },
                        children: [
                          jsx('span', { style: settingsOptionStyle, children: source.name }),
                          jsx(Switch, { 'aria-label': `${source.enabled ? t(locale, "停用") : t(locale, "启用")} ${source.name}`, checked: source.enabled, size: 'xs', disabled: sourceMutation.isPending, onCheckedChange: checked => {
                            const value = Boolean(checked)
                            sourceMutation.mutate({ id: source.id, value })
                          } })
                        ]
                      }, source.id))
                    ] }, value)
                  })
              })
            ] }),
            jsx(DialogFooter, { children: jsx(Button, { onClick: () => setSettingsOpen(false), style: softButtonStyle, children: t(locale, "完成") }) })
          ] }) }),
          jsx(FeedResults, { ctx, profile, domain, readFilter, searchText, showTags, updateMutation, locale }, filterKey)
        ]
      })
    ]
  })
}

function FeedResults({ ctx, profile, domain, readFilter, searchText, showTags, updateMutation, locale = 'en' }) {
  const queryClient = useQueryClient()
  const [cursor, setCursor] = useState(null)
  const [pages, setPages] = useState([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(null)
  const paginationGeneration = useRef(0)
  const events = useQuery({
    queryKey: [ID, 'events', profile, domain, readFilter, searchText, null],
    queryFn: () => ctx.rest('/events?' + new URLSearchParams({
      profile, domain, read: readFilter, q: searchText, limit: '50'
    })),
    staleTime: 30_000,
    refetchInterval: 60_000
  })
  const latest = useQuery({
    queryKey: [ID, 'runs/latest', profile],
    queryFn: () => ctx.rest('/runs/latest'),
    refetchInterval: 60_000
  })
  useEffect(() => {
    if (!events.data) return
    paginationGeneration.current += 1
    setPages([])
    setCursor(events.data.next_cursor)
  }, [events.dataUpdatedAt])
  async function refresh() {
    paginationGeneration.current += 1
    setPages([])
    setCursor(null)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [ID, 'events', profile] }),
      queryClient.invalidateQueries({ queryKey: [ID, 'counts', profile] }),
      queryClient.invalidateQueries({ queryKey: [ID, 'runs/latest', profile] })
    ])
  }
  const favoriteMutation = useMutation({
    mutationFn: ({ id, value }) => ctx.rest(`/events/${id}/favorite`, { method: 'PATCH', body: { profile, value } }),
    onSuccess: refresh,
    onError: () => host.notify({ kind: 'error', message: t(locale, "收藏操作失败，请重试") })
  })
  async function openEvent(event) {
    if (!validDestination(event.url)) {
      host.notify({ kind: 'warning', message: t(locale, "该消息的原始链接不可用") })
      return
    }
    try {
      await ctx.rest(`/events/${event.id}/read`, { method: 'PATCH', body: { profile, value: true } })
      await refresh()
      setPreviewUrl(event.url)
    } catch {
      host.notify({ kind: 'error', message: t(locale, "打开消息失败，请重试") })
    }
  }
  function favoriteClick(domEvent, event) {
    domEvent.stopPropagation()
    favoriteMutation.mutate({ id: event.id, value: !event.favorite })
  }
  async function loadMore() {
    if (events.isFetching || loadingMore || !cursor) return
    const generation = paginationGeneration.current
    setLoadingMore(true)
    try {
      const page = await queryClient.fetchQuery({
        queryKey: [ID, 'events', profile, domain, readFilter, searchText, cursor],
        queryFn: () => ctx.rest('/events?' + new URLSearchParams({
          profile, domain, read: readFilter, q: searchText, limit: '50', cursor
        }))
      })
      if (generation !== paginationGeneration.current) return
      setPages(previous => [...previous, page])
      setCursor(page.next_cursor)
    } catch {
      host.notify({ kind: 'error', message: t(locale, "加载更多失败，请重试") })
    } finally {
      setLoadingMore(false)
    }
  }
  // The polled first page is authoritative; when it changes, the effect above
  // clears accumulated pages so stale cursor snapshots are never mixed in.
  const items = [...new Map([...(events.data?.items ?? []), ...pages.flatMap(page => page.items)]
    .map(event => [event.id, event])).values()]
  const emptyMessage = searchText ? t(locale, "没有匹配的消息")
    : domain === 'favorites' && readFilter === 'unread' ? t(locale, "收藏夹中暂无未读消息")
    : domain === 'favorites' && readFilter === 'read' ? t(locale, "收藏夹中暂无已读消息")
    : domain === 'favorites' ? t(locale, "收藏夹为空")
    : readFilter === 'unread' ? t(locale, "暂无未读消息") : readFilter === 'read' ? t(locale, "暂无已读消息") : t(locale, "近 30 天暂无消息")
  return jsxs('div', {
    className: 'intelligence-feed-results',
    style: { display: 'grid', gridTemplateColumns: previewUrl ? 'minmax(0, 2fr) minmax(0, 3fr)' : 'minmax(0, 5fr) minmax(0, 0fr)', flex: 1, minHeight: 0, minWidth: 0, gap: previewUrl ? 12 : 0, transition: 'grid-template-columns 180ms ease-out, gap 180ms ease-out' },
    children: [
      jsx('style', { children: '@media (prefers-reduced-motion: reduce) { .intelligence-feed-results, .intelligence-feed-preview { transition: none !important; } }' }),
      jsxs('div', {
        style: { display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, gap: 12 },
        children: [
      jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 12 }, children: [
        jsx('span', { style: { color: muted }, children: `${t(locale, "更新时间")} ${latest.data?.run?.finished_at ?? latest.data?.run?.started_at ?? t(locale, "尚未更新")}` }),
        latest.isError && jsx(Button, { onClick: () => latest.refetch(), style: softButtonStyle, children: t(locale, "重试更新时间") }),
        jsx(Button, { disabled: updateMutation.isPending, onClick: () => updateMutation.mutate(), style: softButtonStyle, children: updateMutation.isPending ? t(locale, "更新中…") : t(locale, "手动更新") })
      ] }),
      events.isLoading && !items.length && jsx(Skeleton, { style: { height: 120 }, 'aria-label': t(locale, "加载资讯中"), role: 'status', 'aria-live': 'polite' }),
      events.isError && jsxs('div', { children: [
        jsx(ErrorState, { title: t(locale, "加载失败"), description: t(locale, "无法加载资讯，请重试。") }),
        jsx(Button, { onClick: () => events.refetch(), style: softButtonStyle, children: t(locale, "重试") })
      ] }),
      !events.isLoading && !events.isError && !items.length && jsx('div', { role: 'status', 'aria-live': 'polite', children: jsx(EmptyState, { title: emptyMessage }) }),
      jsx(ScrollArea, { style: { flex: 1, minHeight: 0 }, children: jsx('ul', {
        // paddingRight 给滚动条让位，避免与卡片右侧的星标重叠。
        style: { listStyle: 'none', padding: 0, paddingRight: 12, margin: 0, display: 'flex', flexDirection: 'column', gap: 0 },
        children: items.map(event => jsxs('li', {
          style: { display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--ui-stroke-secondary)' },
          children: [
            jsx('div', {
              style: { flex: 1, minWidth: 0, padding: '6px 10px' },
              children: jsx(Button, {
                variant: 'ghost', size: 'inline',
                onClick: () => openEvent(event),
                style: { width: '100%', minWidth: 0, textAlign: 'left', height: 'auto', whiteSpace: 'normal', justifyContent: 'flex-start', color: event.read ? muted : 'var(--ui-text-primary)', fontWeight: event.read ? 400 : 600 },
                children: jsxs('span', { style: { display: 'block', width: '100%' }, children: [
                  // 圆点常显：未读=柔和主题蓝（与按钮统一），已读=灰。
                  jsx('span', { 'aria-label': event.read ? t(locale, "已读") : t(locale, "未读"), style: { color: event.read ? muted : softAccent }, children: '● ' }),
                  event.translated_headline || event.headline,
                  event.translated_headline && jsx('span', {
                    style: { display: 'block', color: muted, fontSize: 12, marginTop: 2, fontWeight: 400 },
                    children: event.headline
                  }),
                  jsxs('span', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2, fontWeight: 400 }, children: [
                    showTags && jsx('span', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }, children:
                      keywordsFor(event.translated_headline || event.headline).map(word => jsx('span', {
                        style: { background: 'color-mix(in srgb, var(--ui-accent) 14%, transparent)', color: 'var(--ui-text-primary)', borderRadius: 999, padding: '1px 8px', fontSize: 12 },
                        children: word
                      }, word)) }),
                    jsxs('span', { style: { color: muted, whiteSpace: 'nowrap', marginLeft: 'auto' }, children: (() => {
                      const iso = event.published_at ?? event.first_seen_at ?? ''
                      const relative = relativeTime(iso, locale)
                      const hot = domain === 'weibo' && event.summary ? event.summary
                        : event.evidence_count > 1 ? `×${event.evidence_count}` : '-'
                      return [
                        jsx('span', { key: 'hot', 'aria-label': `${t(locale, "热度")} ${event.evidence_count > 1 ? locale === 'zh-CN' ? `${event.evidence_count} 个来源报道` : `${event.evidence_count} sources` : t(locale, "无")}`, title: event.evidence_count > 1 ? locale === 'zh-CN' ? `${event.evidence_count} 个来源报道` : `${event.evidence_count} sources` : t(locale, "单一来源"), children: `${hot} · ` }),
                        `${event.source_name ?? ''} · ${formatTime(iso)}${relative ? ` · ${relative}` : ''}`
                      ]
                    })() })
                  ] })
                ] })
              })
            }),
            jsx(Button, { variant: 'ghost', size: 'icon-xs', 'aria-label': `${event.favorite ? t(locale, "取消收藏") : t(locale, "收藏")}${locale === 'zh-CN' ? '：' : ': '}${event.headline}`, 'aria-pressed': Boolean(event.favorite),
              disabled: favoriteMutation.isPending, onClick: e => favoriteClick(e, event),
              children: jsx(Codicon, { name: event.favorite ? 'star-full' : 'star-empty' }) })
          ]
        }, event.id))
      }) }),
          loadingMore && jsx(Skeleton, { style: { height: 32 }, 'aria-label': t(locale, "加载更多中"), role: 'status' }),
          !events.isError && cursor && jsx(Button, { disabled: events.isFetching || loadingMore, onClick: loadMore, style: softButtonStyle, children: t(locale, "加载更多") })
        ]
      }),
      jsx(PreviewPane, {
        url: previewUrl, locale,
        onClose: () => setPreviewUrl(null), ctx
      })
    ]
  })
}

function validDestination(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && Boolean(parsed.hostname)
  } catch { return false }
}

function PreviewPane({ url, onClose, ctx, locale = 'en' }) {
  const [displayUrl, setDisplayUrl] = useState(() => validDestination(url) ? url : null)
  const [expanded, setExpanded] = useState(false)
  const [failedUrl, setFailedUrl] = useState(null)
  const activeUrl = useRef(url)
  activeUrl.current = url
  useEffect(() => {
    if (validDestination(url)) {
      setDisplayUrl(url)
      setFailedUrl(null)
      setExpanded(true)
      return
    }
    setExpanded(false)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplayUrl(null)
      return
    }
    const timer = setTimeout(() => setDisplayUrl(null), PREVIEW_MOTION_MS)
    return () => clearTimeout(timer)
  }, [url])
  async function openExternal() {
    if (!url || activeUrl.current !== url || !validDestination(url)) return
    try {
      if (await ctx.os.openExternal(url) === false) throw new Error('unavailable')
    } catch {
      host.notify({ kind: 'warning', message: t(locale, "无法打开外部浏览器，请使用系统浏览器访问原始链接。") })
    }
  }
  return jsx('div', {
    className: 'intelligence-feed-preview',
    'aria-hidden': !url, inert: !url,
    style: { display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, border: displayUrl ? '1px solid var(--ui-stroke-secondary)' : undefined, borderRadius: 4, overflow: 'hidden', opacity: expanded ? 1 : 0, transform: expanded ? 'translateX(0)' : 'translateX(12px)', transition: 'opacity 180ms ease-out, transform 180ms ease-out' },
    children: displayUrl && [
      jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, padding: '4px 8px', borderBottom: '1px solid var(--ui-stroke-secondary)' }, children: [
        jsx('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: muted, fontSize: 12 }, children: new URL(displayUrl).hostname }),
        jsx(Button, { variant: 'ghost', size: 'icon-xs', 'aria-label': t(locale, "在外部浏览器打开"), onClick: openExternal, children: jsx(Codicon, { name: 'link-external' }) }),
        jsx(Button, { variant: 'ghost', size: 'icon-xs', 'aria-label': t(locale, "关闭预览"), onClick: onClose, children: jsx(Codicon, { name: 'close' }) })
      ] }, 'toolbar'),
      jsxs('div', { role: 'status', style: { padding: '6px 8px', color: muted, fontSize: 12 }, children: [
        t(locale, failedUrl === displayUrl ? "预览无法加载，请在外部浏览器打开。" : "部分网站不允许内嵌预览。如果页面空白或无法使用，请在外部浏览器打开。"),
        ' ',
        jsx('a', { href: displayUrl, target: '_blank', rel: 'noopener noreferrer', onClick: event => { event.preventDefault(); void openExternal() }, style: { color: 'var(--ui-accent)', textDecoration: 'underline' }, children: t(locale, "在外部浏览器打开") })
      ] }, 'notice'),
      jsx('div', {
        style: { position: 'relative', flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' },
        children: jsx(SandboxedFrame, {
          src: displayUrl, title: t(locale, "文章预览"),
          onError: () => { if (activeUrl.current === displayUrl) setFailedUrl(displayUrl) },
          style: { position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }
        }, displayUrl)
      }, 'content')
    ]
  })
}
