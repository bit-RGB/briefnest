import { Button, Codicon, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, ErrorState, Input, ROUTES_AREA, SandboxedFrame, ScrollArea, SIDEBAR_NAV_AREA, Skeleton, Switch, gatewayActivationEpoch, host, useMutation, useQuery, useQueryClient, useValue } from '@hermes/plugin-sdk'
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
  'github-trending': 'github',
  favorites: 'star-empty'
}
const PREVIEW_MOTION_MS = 180
const TRENDING_PERIODS = [['daily', '今日'], ['weekly', '本周'], ['monthly', '本月']]
const trendingColumns = '32px minmax(0,1fr) min(84px,16%) min(84px,16%) min(70px,15%) 24px'
const trendingRowStyle = { display: 'grid', gridTemplateColumns: trendingColumns, alignItems: 'center', columnGap: 6, padding: '4px 12px 4px 10px', borderBottom: '1px solid var(--ui-stroke-secondary)' }
const trendingEllipsis = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const trendingNumericStyle = { ...trendingEllipsis, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }

const EN = {
  "本机浏览器 · 记住登录": "Local browser · Remember login",
  "浏览器正在启动…": "Starting browser…",
  "网页浏览器连接失败，请重试": "Browser connection failed. Please retry.",
  "实际站点尚未确认": "Current site not yet confirmed",
  "返回原页": "Return to previous page",
  "清除登录数据": "Clear login data",
  "清除当前来源专用浏览器的登录数据？新闻、收藏和系统浏览器不受影响。": "Clear this source's dedicated browser login data? News, favorites and your system browser are not affected.",
  "清除并重新打开": "Clear and reopen",
  "取消": "Cancel",
  "登录数据清除失败，请重试": "Could not clear login data. Please retry.",
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
  "GitHub 趋势": "GitHub Trending",
  "榜单周期": "Trending period",
  "今日": "Today",
  "本周": "This week",
  "本月": "This month",
  "排名": "Rank",
  "仓库": "Repository",
  "语言": "Language",
  "本期新增 ★": "New ★",
  "总 ★": "Total ★",
  "按 GitHub Trending 官方顺序": "GitHub Trending order",
  "榜单尚未采集": "No ranking has been collected yet",
  "该榜单来源已停用": "This ranking source is disabled",
  "本次采集失败，正在显示上次成功榜单": "Update failed; showing the last successful ranking",
  "本次未采集到榜单": "The ranking was not updated in the last run",
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
  "受限预览": "Limited preview",
  "刷新预览": "Refresh preview",
  "缩小网页": "Zoom out article",
  "放大网页": "Zoom in article",
  "恢复网页缩放至80%": "Reset article scale to 80%",
  "无法打开外部浏览器，请使用系统浏览器访问原始链接。": "Could not open external browser. Please use your system browser to visit the original link.",
  "预览无法加载，请在外部浏览器打开。": "Preview could not be loaded. Open it in an external browser.",
  "部分网站不允许内嵌预览。如果页面空白或无法使用，请在外部浏览器打开。": "Some sites block embedded previews. If this page is blank or unusable, open it in an external browser.",
  "更新时间": "Updated:",
  "资讯状态栏": "News status bar",
  "调整列表和网页宽度": "Resize news and preview",
  "网页占比": "Preview width:",
  "热度": "Coverage:"
}

function normalizePreviewShare(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(30, Math.min(75, value)) : 60
}

function formatUpdateTime(value, locale) {
  if (!value) return t(locale, '尚未更新')
  const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}+08:00`)
  if (Number.isNaN(date.getTime())) return t(locale, '尚未更新')
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(date)
}

function normalizeLocale(value) { return value === 'zh-CN' ? 'zh-CN' : 'en' }
function t(locale, key) { return locale === 'zh-CN' ? key : EN[key] ?? key }

const SOURCE_GROUPS = [
  ['semiconductor', '半导体'],
  ['ai', 'AI'],
  ['automotive', '汽车'],
  ['music', '音乐'],
  ['weibo', '热搜'],
  ['github-trending', 'GitHub 趋势']
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
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = ctx.storage.get('settings.sidebarWidth', null)
    return Number.isFinite(saved) && saved > 0 ? Math.min(360, Math.round(saved)) : null
  })
  const sidebarDrag = useRef(null)
  const [sidebarResizing, setSidebarResizing] = useState(false)
  function sidebarLimits(handle) {
    const max = Math.min(360, Math.floor(handle.parentElement.parentElement.clientWidth * 0.45))
    return [Math.min(80, max), max]
  }
  function clampSidebar(handle, width) {
    const [min, max] = sidebarLimits(handle)
    return Math.max(min, Math.min(max, Math.round(width)))
  }
  function startSidebarDrag(event) {
    if (event.button !== 0 || sidebarDrag.current || sidebarLimits(event.currentTarget)[1] < 1) return
    const handle = event.currentTarget
    event.preventDefault()
    handle.setPointerCapture(event.pointerId)
    sidebarDrag.current = { id: event.pointerId, x: event.clientX, width: handle.parentElement.getBoundingClientRect().width, saved: sidebarWidth }
    setSidebarResizing(true)
  }
  function moveSidebarDrag(event, finish = false) {
    const drag = sidebarDrag.current
    if (!drag || drag.id !== event.pointerId) return
    const handle = event.currentTarget
    const width = clampSidebar(handle, drag.width + event.clientX - drag.x)
    if (finish) {
      sidebarDrag.current = null
      setSidebarResizing(false)
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
      if (width > 0 && Math.abs(event.clientX - drag.x) >= 1) ctx.storage.set('settings.sidebarWidth', width)
      else { setSidebarWidth(drag.saved); return }
    }
    setSidebarWidth(width || drag.saved)
  }
  function cancelSidebarDrag(event) {
    const drag = sidebarDrag.current
    if (!drag || drag.id !== event.pointerId) return
    sidebarDrag.current = null
    const handle = event.currentTarget
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
    setSidebarResizing(false)
    setSidebarWidth(drag.saved)
  }
  const [domain, setDomain] = useState('all')
  const [trendingPeriod, setTrendingPeriod] = useState('monthly')
  const isTrending = domain === 'github-trending'
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
  // Keep toolbar DOM/focus stable within a profile; FeedResults resets its query scope.
  const profileKey = JSON.stringify([profile])
  const domainCounts = domain === 'favorites'
    ? { total: counts.data?.favorites, unread: counts.data?.favorites_unread }
    : counts.data?.[domain]
  function readingLabel(value, label) {
    const count = value === 'unread' ? domainCounts?.unread
      : value === 'read' ? Math.max(0, domainCounts?.total - domainCounts?.unread) : 0
    return `${t(locale, label)}${count > 0 ? ` (${Math.min(count, 999)})` : ''}`
  }
  function domainButton(value, label) {
    const selected = domain === value
    return jsxs(Button, {
      variant: 'ghost', size: 'sm',
      'aria-pressed': selected,
      'aria-label': t(locale, label),
      title: t(locale, label),
      onClick: () => {
        if (value === 'github-trending' && !isTrending) setTrendingPeriod('monthly')
        setDomain(value)
      },
      style: { width: '100%', minHeight: 28, justifyContent: 'flex-start', textAlign: 'left', gap: 4, padding: '0 6px', ...(selected ? selectedControlStyle : undefined) },
      children: [
        jsx(Codicon, { name: DOMAIN_ICONS[value], 'aria-hidden': true, style: { fontSize: 14, flexShrink: 0 } }),
        jsx('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: t(locale, label) })
      ]
    }, value)
  }
  return jsxs('div', {
    style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: 'var(--ui-text-primary)' },
    children: [
      jsxs('div', { className: 'intelligence-feed-workspace', style: { display: 'flex', flex: 1, minHeight: 0, minWidth: 0 }, children: [
      jsxs('nav', {
        'aria-label': t(locale, "资讯分类"),
        style: { position: 'relative', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', width: sidebarWidth ?? 'calc-size(max-content, size * 1.5)', maxWidth: 'min(360px, 45%)', minWidth: 0, flexShrink: 0, padding: 8, gap: 4, borderRight: '1px solid var(--ui-stroke-secondary)' },
        children: [domainButton('all', t(locale, "全部")), domainButton('semiconductor', t(locale, "半导体")), domainButton('ai', t(locale, "AI")), domainButton('automotive', t(locale, "汽车")), domainButton('music', t(locale, "音乐")), domainButton('weibo', t(locale, "热搜")), domainButton('github-trending', 'GitHub 趋势'),
          counts.isError && jsx(Button, { onClick: () => counts.refetch(), style: softButtonStyle, children: t(locale, "重试计数") }),
          jsx('div', { role: 'separator', 'aria-orientation': 'vertical', 'aria-label': locale === 'zh-CN' ? '调整频道栏宽度' : 'Resize categories sidebar',
            style: { position: 'absolute', insetBlock: 0, right: -1, width: 8, zIndex: 1, cursor: 'col-resize', touchAction: 'none', userSelect: 'none' },
            onPointerDown: startSidebarDrag, onPointerMove: moveSidebarDrag, onPointerUp: event => moveSidebarDrag(event, true),
            onPointerCancel: cancelSidebarDrag, onLostPointerCapture: cancelSidebarDrag }),
          jsx('div', { className: 'intelligence-feed-favorites', style: { marginTop: 'auto', marginLeft: -8, marginRight: -8, borderTop: '1px solid var(--ui-stroke-secondary)', padding: '12px 8px 0' }, children: domainButton('favorites', t(locale, "收藏夹")) })]
      }),
      jsxs('main', {
        style: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 },
        children: [
          jsx(FeedResults, { ctx, profile, domain, trendingPeriod: isTrending ? trendingPeriod : null, readFilter: isTrending ? 'all' : readFilter, searchText: isTrending ? '' : searchText, showTags, updateMutation, locale, sidebarResizing, children: jsxs('div', {
            className: 'intelligence-feed-toolbar', style: { display: 'flex', flexDirection: 'column', flexShrink: 0, padding: '20px 0 0', gap: 12 }, children: [
          !isTrending && jsx('div', { style: { padding: '0 20px' }, children: jsx(Input, { 'aria-label': t(locale, "搜索资讯"), placeholder: t(locale, "搜索资讯"), value: draftSearch, maxLength: 100, style: { width: '100%', minWidth: 0 }, onChange: e => setDraftSearch(e.target.value) }) }),
          jsxs('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderBottom: '1px solid var(--ui-stroke-secondary)', padding: '0 20px 12px' }, children: [
            isTrending ? jsx('div', { role: 'group', 'aria-label': t(locale, '榜单周期'), style: { display: 'flex', flexWrap: 'wrap', gap: 4 }, children:
              TRENDING_PERIODS.map(([value, label]) => jsx(Button, { variant: 'ghost', size: 'sm',
                'aria-pressed': trendingPeriod === value, onClick: () => setTrendingPeriod(value),
                style: trendingPeriod === value ? selectedControlStyle : undefined, children: t(locale, label)
              }, value)) }) : jsx('div', { role: 'group', 'aria-label': t(locale, "阅读状态"), style: { display: 'flex', flexWrap: 'wrap', minWidth: 0, gap: 4 }, children:
              [['all', t(locale, "全部")], ['unread', t(locale, "未读")], ['read', t(locale, "已读")]].map(([value, label]) => jsx(Button, {
                variant: 'ghost', size: 'sm',
                'aria-pressed': readFilter === value, onClick: () => setReadFilter(value),
                style: readFilter === value ? selectedControlStyle : undefined,
                children: readingLabel(value, label)
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
          ] }) }, profileKey)
        ]
      })
      ] }),
      jsx(FeedStatusBar, { ctx, profile, updateMutation, locale })
    ]
  })
}

function FeedStatusBar({ ctx, profile, updateMutation, locale = 'en' }) {
  const latest = useQuery({
    queryKey: [ID, 'runs/latest', profile],
    queryFn: () => ctx.rest('/runs/latest'),
    refetchInterval: 60_000
  })
  return jsxs('footer', {
    role: 'status', 'aria-label': t(locale, '资讯状态栏'),
    style: { display: 'flex', flexShrink: 0, alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '4px 12px', borderTop: '1px solid var(--ui-stroke-secondary)', fontSize: 12 },
    children: [
      jsx('span', { style: { color: muted, minWidth: 0 }, children: `${t(locale, '更新时间')} ${formatUpdateTime(latest.data?.run?.finished_at ?? latest.data?.run?.started_at, locale)}` }),
      jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }, children: [
        latest.isError && jsx(Button, { variant: 'ghost', size: 'sm', onClick: () => latest.refetch(), children: t(locale, '重试更新时间') }),
        jsx(Button, { variant: 'ghost', size: 'sm', disabled: updateMutation.isPending, onClick: () => updateMutation.mutate(), children: updateMutation.isPending ? t(locale, '更新中…') : t(locale, '手动更新') })
      ] })
    ]
  })
}

function FeedResults({ ctx, profile, domain, trendingPeriod = null, readFilter, searchText, showTags, updateMutation, locale = 'en', sidebarResizing = false, children: toolbar }) {
  const queryClient = useQueryClient()
  const filterKey = JSON.stringify([profile, domain, readFilter, searchText, trendingPeriod])
  // A unique lifetime token also rejects old A responses after switching A -> B -> A.
  const activeScope = useRef({ filterKey })
  if (activeScope.current.filterKey !== filterKey) activeScope.current = { filterKey }
  const scope = activeScope.current
  const [resultsScope, setResultsScope] = useState(scope)
  const sameResults = resultsScope === scope
  const [cursor, setCursor] = useState(null)
  const [pages, setPages] = useState([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState(false)
  const [storedSelectedEventId, setSelectedEventId] = useState(null)
  const selectedEventId = sameResults ? storedSelectedEventId : null
  const [eventOverrides, setEventOverrides] = useState(() => new Map())
  const continuation = useRef({ scope, cursor: null, request: null, error: false, seen: new Set(), alive: true })
  const scrollHostRef = useRef(null)
  const continuationRef = useRef(null)
  const [storedPreviewUrl, setPreviewUrl] = useState(null)
  const previewUrl = sameResults ? storedPreviewUrl : null
  const [previewShare, setPreviewShare] = useState(() => normalizePreviewShare(ctx.storage.get('settings.previewShare', 60)))
  const [resizing, setResizing] = useState(false)
  const layoutRef = useRef(null)
  const dragRef = useRef(null)
  const shareRef = useRef(previewShare)
  const resizeEnabled = useRef(false)
  shareRef.current = previewShare
  resizeEnabled.current = Boolean(previewUrl)
  function changeShare(value, persist = false) {
    const next = normalizePreviewShare(value)
    shareRef.current = next
    setPreviewShare(next)
    if (persist) ctx.storage.set('settings.previewShare', next)
  }
  function releaseDrag() {
    const active = dragRef.current
    dragRef.current = null
    try { active?.target.releasePointerCapture(active.pointerId) } catch {}
    return active
  }
  function finishResize(event, cancelled = false) {
    if (!dragRef.current || (event && event.pointerId !== dragRef.current.pointerId)) return
    const active = releaseDrag()
    changeShare(cancelled ? active.startShare : shareRef.current, !cancelled)
    setResizing(false)
  }
  function startResize(event) {
    if (!resizeEnabled.current || dragRef.current || event.button !== 0 || event.isPrimary === false) return
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { return }
    event.preventDefault()
    dragRef.current = { pointerId: event.pointerId, target: event.currentTarget, startShare: shareRef.current }
    setResizing(true)
  }
  function moveResize(event) {
    if (!dragRef.current || event.pointerId !== dragRef.current.pointerId) return
    const bounds = layoutRef.current?.getBoundingClientRect()
    if (!bounds || bounds.width <= 8) return
    changeShare(100 - (event.clientX - bounds.left - 4) / (bounds.width - 8) * 100)
  }
  function keyResize(event) {
    if (!resizeEnabled.current || dragRef.current) return
    const next = { ArrowLeft: shareRef.current + 2, ArrowRight: shareRef.current - 2, Home: 75, End: 30 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    changeShare(next, true)
  }
  function closePreview() {
    resizeEnabled.current = false
    finishResize(null, true)
    setPreviewUrl(null)
  }
  useEffect(() => () => { resizeEnabled.current = false; releaseDrag() }, [])
  const paginationGeneration = useRef(0)
  const events = useQuery({
    queryKey: [ID, 'events', profile, domain, readFilter, searchText, trendingPeriod],
    queryFn: () => trendingPeriod ? ctx.rest('/github-trending?' + new URLSearchParams({ profile, period: trendingPeriod })) : ctx.rest('/events?' + new URLSearchParams({
      profile, domain, read: readFilter, q: searchText, limit: '50'
    })),
    staleTime: 30_000,
    refetchInterval: 60_000
  })
  const eventsRef = useRef(events)
  eventsRef.current = events
  const firstPage = events.isPlaceholderData ? null : events.data
  useEffect(() => {
    continuation.current.alive = true
    return () => {
      continuation.current.alive = false
      continuation.current.request = null
      paginationGeneration.current += 1
    }
  }, [])
  useEffect(() => {
    const filterChanged = continuation.current.scope !== scope
    paginationGeneration.current += 1
    Object.assign(continuation.current, { scope, cursor: firstPage?.next_cursor ?? null, request: null, error: false, seen: new Set() })
    setResultsScope(scope)
    setLoadingMore(false)
    setLoadMoreError(false)
    setPages([])
    setCursor(firstPage?.next_cursor ?? null)
    if (filterChanged) {
      setSelectedEventId(null)
      setPreviewUrl(null)
      setEventOverrides(new Map())
      const active = releaseDrag()
      if (active) changeShare(active.startShare)
      setResizing(false)
      const viewport = scrollHostRef.current?.querySelector('[data-slot="scroll-area-viewport"]') ?? scrollHostRef.current
      if (viewport) viewport.scrollTop = 0
    }
  }, [scope, events.dataUpdatedAt, events.isPlaceholderData])
  useEffect(() => {
    // Keep stale bottom callbacks locked until the appended DOM has committed.
    if (continuation.current.request?.awaitingCommit) {
      continuation.current.request = null
      setLoadingMore(false)
    }
  }, [pages])
  async function refresh() {
    paginationGeneration.current += 1
    Object.assign(continuation.current, { cursor: null, request: null, error: false, seen: new Set() })
    setLoadingMore(false)
    setLoadMoreError(false)
    setPages([])
    setCursor(null)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [ID, 'events', profile] }),
      queryClient.invalidateQueries({ queryKey: [ID, 'counts', profile] }),
      queryClient.invalidateQueries({ queryKey: [ID, 'runs/latest', profile] })
    ])
  }
  function updateRow(id, fields) {
    setEventOverrides(previous => new Map(previous).set(id, { ...previous.get(id), ...fields }))
  }
  async function refreshRowState() {
    // Keep loaded pages/scroll position; invalidate other views for their next mount.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [ID, 'events', profile], refetchType: 'none' }),
      queryClient.invalidateQueries({ queryKey: [ID, 'counts', profile] })
    ])
  }
  const favoriteMutation = useMutation({
    mutationFn: ({ id, value }) => ctx.rest(`/events/${id}/favorite`, { method: 'PATCH', body: { profile, value } }),
    onSuccess: async (_data, { id, value, scope: requestScope }) => {
      if (!continuation.current.alive || requestScope !== activeScope.current) { await refreshRowState(); return }
      updateRow(id, { favorite: value })
      if (domain === 'favorites') await refresh()
      else await refreshRowState()
    },
    onError: () => host.notify({ kind: 'error', message: t(locale, "收藏操作失败，请重试") })
  })
  async function openEvent(event) {
    if (!continuation.current.alive || scope !== activeScope.current) return
    if (!validDestination(event.url)) {
      host.notify({ kind: 'warning', message: t(locale, "该消息的原始链接不可用") })
      return
    }
    try {
      await ctx.rest(`/events/${event.id}/read`, { method: 'PATCH', body: { profile, value: true } })
      if (!continuation.current.alive || scope !== activeScope.current) { await refreshRowState(); return }
      updateRow(event.id, { read: true })
      if (readFilter === 'all') await refreshRowState()
      else await refresh()
      if (!continuation.current.alive || scope !== activeScope.current) return
      setSelectedEventId(event.id)
      setPreviewUrl(event.url)
    } catch {
      if (continuation.current.alive && scope === activeScope.current) host.notify({ kind: 'error', message: t(locale, "打开消息失败，请重试") })
    }
  }
  function favoriteClick(domEvent, event) {
    domEvent.stopPropagation()
    if (!continuation.current.alive || scope !== activeScope.current) return
    favoriteMutation.mutate({ id: event.id, value: !event.favorite, scope })
  }
  async function loadMore(retry = false) {
    const state = continuation.current
    const cursor = state.cursor
    if (!state.alive || state.scope !== scope || scope !== activeScope.current || state.request || (state.error && !retry) || !cursor || eventsRef.current.isFetching || eventsRef.current.isError) return
    const generation = paginationGeneration.current
    const request = { generation, cursor }
    state.request = request
    state.error = false
    setLoadMoreError(false)
    setLoadingMore(true)
    try {
      const page = await queryClient.fetchQuery({
        queryKey: [ID, 'events', profile, domain, readFilter, searchText, cursor],
        queryFn: () => ctx.rest('/events?' + new URLSearchParams({
          profile, domain, read: readFilter, q: searchText, limit: '50', cursor
        }))
      })
      if (!state.alive || scope !== activeScope.current || generation !== paginationGeneration.current) return
      const nextCursor = page.next_cursor ?? null
      if (nextCursor && (nextCursor === cursor || state.seen.has(nextCursor))) throw new Error('Invalid continuation cursor')
      state.seen.add(cursor)
      state.cursor = nextCursor
      request.awaitingCommit = true
      setPages(previous => [...previous, page])
      setCursor(nextCursor)
    } catch {
      if (!state.alive || scope !== activeScope.current || generation !== paginationGeneration.current) return
      state.error = true
      setLoadMoreError(true)
      host.notify({ kind: 'error', message: t(locale, "加载更多失败，请重试") })
    } finally {
      if (state.alive && state.request === request && !request.awaitingCommit) {
        state.request = null
        setLoadingMore(false)
      }
    }
  }
  function onListScroll(event) {
    const viewport = event.target
    if (viewport.clientHeight > 0 && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 32) return loadMore()
  }
  // The polled first page is authoritative; when it changes, the effect above
  // clears accumulated pages so stale cursor snapshots are never mixed in.
  const items = [...new Map([...(firstPage?.items ?? []), ...(sameResults ? pages.flatMap(page => page.items) : [])]
    .map(event => [event.id, event])).values()].map(event => ({ ...event, ...(sameResults ? eventOverrides.get(event.id) : undefined) }))
  useEffect(() => {
    if (!sameResults || typeof IntersectionObserver === 'undefined' || !cursor || loadMoreError) return
    const root = scrollHostRef.current?.querySelector('[data-slot="scroll-area-viewport"]') ?? scrollHostRef.current
    if (!root || !continuationRef.current) return
    const generation = paginationGeneration.current
    let disposed = false
    const observer = new IntersectionObserver(entries => {
      if (!disposed && generation === paginationGeneration.current && entries.some(entry => entry.isIntersecting)) void loadMore()
    }, { root, rootMargin: '0px 0px 32px 0px' })
    observer.observe(continuationRef.current)
    return () => { disposed = true; observer.disconnect() }
  }, [scope, sameResults, cursor, items.length, loadingMore, loadMoreError, events.isFetching])
  const emptyMessage = trendingPeriod ? t(locale, firstPage?.status === 'disabled' ? '该榜单来源已停用' : firstPage?.status === 'failed' || firstPage?.status === 'not_started_budget' ? '本次未采集到榜单' : '榜单尚未采集')
    : searchText ? t(locale, "没有匹配的消息")
    : domain === 'favorites' && readFilter === 'unread' ? t(locale, "收藏夹中暂无未读消息")
    : domain === 'favorites' && readFilter === 'read' ? t(locale, "收藏夹中暂无已读消息")
    : domain === 'favorites' ? t(locale, "收藏夹为空")
    : readFilter === 'unread' ? t(locale, "暂无未读消息") : readFilter === 'read' ? t(locale, "暂无已读消息") : t(locale, "近 30 天暂无消息")
  return jsxs('div', {
    style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 },
    children: [
      jsx('style', { children: '@media (prefers-reduced-motion: reduce) { .intelligence-feed-results, .intelligence-feed-preview { transition: none !important; } } .intelligence-feed-divider:hover, .intelligence-feed-divider:focus-visible { background: var(--ui-control-active-background); outline: 1px solid var(--ui-accent); outline-offset: -1px; } .intelligence-feed-row:hover, .intelligence-feed-row:focus-within, .intelligence-feed-row[data-selected="true"] { background: var(--ui-control-active-background); } .intelligence-feed-row button:hover { background: none; }' }),
      jsxs('div', {
        className: 'intelligence-feed-results', ref: layoutRef,
        style: { display: 'grid', gridTemplateColumns: previewUrl ? `minmax(0, ${100 - previewShare}fr) 8px minmax(0, ${previewShare}fr)` : 'minmax(0, 100fr) 0px minmax(0, 0fr)', flex: 1, minHeight: 0, minWidth: 0, transition: resizing ? 'none' : 'grid-template-columns 180ms ease-out', userSelect: resizing ? 'none' : undefined, cursor: resizing ? 'col-resize' : undefined },
        children: [
      jsxs('div', {
        style: { display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, gap: 12 },
        children: [
      toolbar,
      events.isLoading && !items.length && jsx(Skeleton, { style: { height: 120 }, 'aria-label': t(locale, "加载资讯中"), role: 'status', 'aria-live': 'polite' }),
      events.isError && jsxs('div', { children: [
        jsx(ErrorState, { title: t(locale, "加载失败"), description: t(locale, "无法加载资讯，请重试。") }),
        jsx(Button, { onClick: () => events.refetch(), style: softButtonStyle, children: t(locale, "重试") })
      ] }),
      !events.isLoading && !events.isError && !items.length && jsx('div', { role: 'status', 'aria-live': 'polite', children: jsx(EmptyState, { title: emptyMessage }) }),
      trendingPeriod && items.length > 0 && jsx('div', { role: 'status', style: { padding: '0 12px', color: muted, fontSize: 12 }, children: [
        `${t(locale, '按 GitHub Trending 官方顺序')} · ${t(locale, '更新时间')} ${formatUpdateTime(firstPage?.updated_at, locale)}`,
        firstPage?.status === 'failed' ? ` · ${t(locale, '本次采集失败，正在显示上次成功榜单')}`
          : firstPage?.status === 'not_started_budget' ? ` · ${t(locale, '本次未采集到榜单')}` : ''
      ] }),
      jsx('div', { ref: scrollHostRef, className: 'intelligence-feed-scroll-host', style: { flex: 1, minHeight: 0 }, children:
      jsx(ScrollArea, { style: { height: '100%', minHeight: 0 }, onScrollCapture: onListScroll, children: jsxs('div', { children: [
        trendingPeriod && items.length > 0 && jsx('div', { style: { ...trendingRowStyle, color: muted, fontSize: 12 }, children:
          ['排名', '仓库', '语言', '本期新增 ★', '总 ★'].map((label, index) =>
            jsx('span', { style: index > 2 ? trendingNumericStyle : trendingEllipsis, title: t(locale, label), children: t(locale, label) }, label)) }),
        jsx('ul', {
        // 边线铺满列表；滚动条与星标的间距放在行内，不缩短横线。
        style: { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 0 },
        children: items.map(event => trendingPeriod ? jsx(TrendingRow, { event, locale, selected: selectedEventId === event.id,
          open: () => openEvent(event), toggle: e => favoriteClick(e, event), pending: favoriteMutation.isPending
        }, event.id) : jsxs('li', {
          className: 'intelligence-feed-row', 'data-selected': selectedEventId === event.id,
          style: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px 4px 10px', borderBottom: '1px solid var(--ui-stroke-secondary)' },
          children: [
            jsx('div', {
              style: { flex: 1, minWidth: 0 },
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
                    jsxs('span', { style: { color: muted, whiteSpace: 'nowrap', marginLeft: 'auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }, children: (() => {
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
      }), jsx('div', { ref: continuationRef, 'aria-hidden': true, style: { height: 1 } })] }) }) }),
          sameResults && loadingMore && jsx(Skeleton, { style: { height: 32 }, 'aria-label': t(locale, "加载更多中"), role: 'status' }),
          sameResults && loadMoreError && jsx(Button, { variant: 'ghost', size: 'sm', onClick: () => loadMore(true), children: t(locale, '重试') })
        ]
      }),
      previewUrl ? jsx('div', {
        className: 'intelligence-feed-divider', role: 'separator', tabIndex: 0,
        'aria-label': t(locale, '调整列表和网页宽度'), 'aria-orientation': 'vertical',
        'aria-valuemin': 25, 'aria-valuemax': 70, 'aria-valuenow': 100 - previewShare,
        'aria-valuetext': `${t(locale, '网页占比')} ${Math.round(previewShare)}%`,
        title: t(locale, '调整列表和网页宽度'),
        style: { cursor: 'col-resize', touchAction: 'none', minWidth: 0, display: 'flex', justifyContent: 'center' },
        onPointerDown: startResize, onPointerMove: moveResize, onPointerUp: event => finishResize(event),
        onPointerCancel: event => finishResize(event, true), onLostPointerCapture: event => finishResize(event, true), onKeyDown: keyResize,
        children: jsx('span', { style: { width: 1, background: 'var(--ui-stroke-secondary)', pointerEvents: 'none' } })
      }) : jsx('div', { 'aria-hidden': true }),
      jsx(PreviewPane, {
        url: previewUrl, locale, resizing: resizing || sidebarResizing,
        onClose: closePreview, ctx
      })
        ]
      })
    ]
  })
}

function TrendingRow({ event, locale, selected, open, toggle, pending }) {
  const number = new Intl.NumberFormat(locale)
  const total = number.format(event.stars)
  const added = '+' + number.format(event.period_stars)
  return jsxs('li', { className: 'intelligence-feed-row', 'data-selected': selected, style: trendingRowStyle, children: [
    jsx('span', { style: { color: muted, fontVariantNumeric: 'tabular-nums' }, children: event.rank }),
    jsx(Button, { variant: 'ghost', size: 'inline', onClick: open, title: event.headline,
      style: { width: '100%', minWidth: 0, height: 'auto', textAlign: 'left', justifyContent: 'flex-start' },
      children: jsxs('span', { style: { display: 'block', minWidth: 0, width: '100%' }, children: [
        jsx('strong', { style: { ...trendingEllipsis, display: 'block' }, children: event.headline }),
        event.summary && jsx('span', { title: event.summary, style: { ...trendingEllipsis, display: 'block', color: muted, fontSize: 12, fontWeight: 400 }, children: event.summary })
      ] }) }),
    jsx('span', { style: { ...trendingEllipsis, color: muted }, title: event.language, children: event.language || '–' }),
    jsx('span', { style: trendingNumericStyle, title: added, children: added }),
    jsx('span', { style: { ...trendingNumericStyle, color: muted }, title: total, children: total }),
    jsx(Button, { variant: 'ghost', size: 'icon-xs', disabled: pending, onClick: toggle,
      'aria-label': `${t(locale, event.favorite ? '取消收藏' : '收藏')}: ${event.headline}`, 'aria-pressed': Boolean(event.favorite),
      children: jsx(Codicon, { name: event.favorite ? 'star-full' : 'star-empty' }) })
  ] })
}

function validDestination(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && Boolean(parsed.hostname) && !parsed.username && !parsed.password
  } catch { return false }
}

function streamRouteScope(routes, profile, connectionId = null) {
  if (typeof profile !== 'string' || !profile) throw new Error('browser scope unavailable')
  if (!Array.isArray(routes)) throw new Error('browser scope unavailable')
  const matches = routes.filter(route => route?.profile === profile && (connectionId ? route.connectionId === connectionId : route.mode !== 'remote'))
  if (matches.length > 1 || ((routes.length > 0 || connectionId) && matches.length !== 1)) throw new Error('browser scope ambiguous')
  const route = matches[0]
  if (route?.mode === 'remote') throw new Error('local browser only')
  const scope = JSON.stringify([route?.connectionId || 'local', route?.targetProfile || profile, profile])
  if (scope.length > 512) throw new Error('browser scope unavailable')
  return scope
}

function streamPoint(event, rect, width, height) {
  if (![event.clientX, event.clientY, rect.left, rect.top, rect.width, rect.height, width, height].every(Number.isFinite)
    || rect.width <= 0 || rect.height <= 0 || width <= 0 || height <= 0) throw new Error('invalid pointer')
  return {
    x: Math.max(0, Math.min(width - 1, (event.clientX - rect.left) * width / rect.width)),
    y: Math.max(0, Math.min(height - 1, (event.clientY - rect.top) * height / rect.height))
  }
}

function createStreamFrameGuard() {
  let alive = true, view = -1, seq = 0, revision = 0, ready = false
  const sameView = ticket => alive && ticket && ticket.revision === revision && ticket.view === view
  const invalidate = () => { revision += 1; view = -1; seq = 0; ready = false }
  return {
    invalidate,
    adopt(next) {
      if (!alive || !Number.isSafeInteger(next) || next < 0 || next < view) return false
      if (view !== next) { invalidate(); view = next }
      return true
    },
    ticket(frame) {
      return alive && frame?.view === view && Number.isSafeInteger(frame.seq) && frame.seq > 0 && frame.seq >= seq
        ? { revision, view, seq: frame.seq } : null
    },
    painted(ticket) { if (!sameView(ticket) || ticket.seq < seq) return false; seq = ticket.seq; return true },
    acknowledge(ticket) { if (!sameView(ticket) || ticket.seq > seq) return false; ready = true; return true },
    inputView() { return alive && ready ? view : null },
    dispose() { alive = false; invalidate() }
  }
}

function streamEpoch() { return typeof gatewayActivationEpoch === 'function' ? gatewayActivationEpoch() : 0 }
const STREAM_WAIT_MS = 1000, STREAM_RETRY_MS = 200, STREAM_READ_TIMEOUT_MS = 4000

// Only local pixels and controls enter this component. Remote pages never receive the plugin bridge.
function StreamSurface({ ctx, url, active, resizing, scale, profile, connectionId, locale, controllerRef, onOrigin, onReady }) {
  const canvasRef = useRef(null), containerRef = useRef(null), lifeRef = useRef(null)
  const urlRef = useRef(url), localeRef = useRef(locale), scaleRef = useRef(scale), resizingRef = useRef(resizing), activeRef = useRef(active)
  urlRef.current = url; localeRef.current = locale; scaleRef.current = scale; resizingRef.current = resizing; activeRef.current = active
  const [attempt, setAttempt] = useState(0), [sessionId, setSessionId] = useState(null)
  const [error, setError] = useState(false), [readError, setReadError] = useState(false), [painted, setPainted] = useState(false)
  const epoch = streamEpoch()
  function sameRoute(life) {
    return streamEpoch() === life.epoch
      && (!host.state.profile?.get || host.state.profile.get() === life.profile)
      && (!host.state.connectionId?.get || host.state.connectionId.get() === life.connectionId)
  }
  function current(life) {
    if (!life?.alive || life.invalidated || !activeRef.current || lifeRef.current !== life) return false
    if (!sameRoute(life)) {
      life.guard.invalidate()
      if (!life.lost) { life.lost = true; setAttempt(value => value + 1) }
      return false
    }
    return true
  }
  function cancelMouse(life) {
    life.releaseListeners?.(); life.releaseListeners = null
    life.presses?.clear()
    life.hover = null; life.hoverPending = false; life.mousePoint = null
    life.inputRevision = (life.inputRevision || 0) + 1
  }
  function discardFrames(life) {
    if (life.image) {
      life.image.onload = life.image.onerror = null
      life.image.removeAttribute('src')
    }
    if (life.ackJob) clearTimeout(life.ackJob.timer)
    life.image = life.pendingFrame = life.ackJob = life.ackTicket = null
    life.readSeq = 0
  }
  function resetPicture(life) {
    cancelMouse(life)
    life.guard.invalidate(); life.composition = null; life.keys.clear()
    discardFrames(life)
    const canvas = canvasRef.current
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    setPainted(false); onOrigin('')
  }
  async function action(life, op, payload = {}) {
    if (!current(life) || !life.id) throw new Error('browser unavailable')
    const result = await ctx.rest(`/browser/sessions/${encodeURIComponent(life.id)}/action`, {
      method: 'POST', body: { op, payload }, timeoutMs: 15000
    })
    if (!current(life)) throw new Error('browser scope changed')
    return result
  }
  function currentPicture(life, version) {
    return current(life) && life.lastUrl === urlRef.current && version === life.navigationVersion
  }
  async function acknowledgePaint(life, version, job) {
    const valid = () => currentPicture(life, version) && life.ackJob === job
    if (!valid()) return
    const ticket = life.ackTicket
    try {
      const result = await action(life, 'paint', { view: ticket.view, seq: ticket.seq })
      if (!valid()) return
      if (result?.ok === true && life.guard.acknowledge(ticket)) {
        life.ackJob = life.ackTicket = null
        setPainted(true); setError(false)
        return
      }
    } catch { if (!valid()) return }
    // A rejected first ACK never enables input. Retry even if the page is static,
    // using the newest painted ticket for this view without decoding it again.
    if (++job.failures === 3) setError(true)
    job.timer = setTimeout(() => void acknowledgePaint(life, version, job), STREAM_RETRY_MS)
  }
  function decodeNext(life, version) {
    if (!currentPicture(life, version) || life.image || !life.pendingFrame) return
    const { data, ticket } = life.pendingFrame
    life.pendingFrame = null
    const image = new Image()
    life.image = image
    const finish = loaded => {
      if (!currentPicture(life, version) || life.image !== image) return
      life.image = null
      image.onload = image.onerror = null
      try {
        const canvas = canvasRef.current, context = canvas?.getContext('2d')
        if (!loaded || !context || !image.naturalWidth || !image.naturalHeight) throw new Error('invalid browser frame')
        if (canvas.width !== image.naturalWidth) canvas.width = image.naturalWidth
        if (canvas.height !== image.naturalHeight) canvas.height = image.naturalHeight
        context.drawImage(image, 0, 0)
        if (life.guard.painted(ticket)) {
          if (life.guard.inputView() === null) {
            life.ackTicket = ticket
            if (!life.ackJob) void acknowledgePaint(life, version, life.ackJob = { failures: 0 })
          } else setError(false)
        }
      } catch { setError(true) }
      // Paint the decode that finished rather than cancelling it whenever a
      // newer PNG arrives. Only the newest *waiting* frame is kept.
      decodeNext(life, version)
    }
    image.onload = () => finish(true)
    image.onerror = () => finish(false)
    image.src = `data:image/png;base64,${data}`
  }
  function accept(life, state, version) {
    if (!currentPicture(life, version) || !state || !Number.isSafeInteger(state.view)
      || state.view < Math.max(life.minimumView, life.view)) return
    const switched = state.view !== life.view
    if (switched) {
      resetPicture(life); life.view = state.view
    }
    life.guard.adopt(state.view)
    life.width = state.width; life.height = state.height
    const origin = typeof state.origin === 'string' ? state.origin : ''
    // Never label an authentication redirect using the article's original hostname.
    try { onOrigin(new URL(origin).origin === origin ? origin : '') } catch { onOrigin('') }
    const frame = state.frame
    if (!frame || frame.format !== 'png' || typeof frame.data !== 'string' || frame.data.length > 24 * 1024 * 1024
      || frame.seq <= life.readSeq || frame.view !== state.view) return switched
    const ticket = life.guard.ticket(frame)
    if (!ticket) return switched
    life.readSeq = frame.seq
    life.pendingFrame = { data: frame.data, ticket }
    decodeNext(life, version)
    return true
  }
  function canRead(life) {
    return currentPicture(life, life?.navigationVersion) && life.id && !life.transitioning && !life.clearing && !resizingRef.current
  }
  function scheduleRead(life, delay = 0) {
    if (!canRead(life) || life.reading || life.readTimer !== undefined) return
    life.readTimer = setTimeout(() => {
      life.readTimer = undefined
      if (canRead(life)) void readFrame(life)
    }, delay)
  }
  async function readFrame(life) {
    life.reading = true
    const { id, navigationVersion: version, readSeq } = life
    const started = performance.now()
    const valid = () => canRead(life) && life.id === id && life.navigationVersion === version
    let delay = 0
    try {
      // The installed REST SDK does not forward AbortSignal. Hold this slot
      // until the bounded call settles, but invalidate its result immediately.
      const state = await ctx.rest(`/browser/sessions/${encodeURIComponent(id)}/frame?after_seq=${readSeq}&wait_ms=${STREAM_WAIT_MS}`, { timeoutMs: STREAM_READ_TIMEOUT_MS })
      if (!valid()) return
      if (life.readFailures) { life.readFailures = 0; setReadError(false) }
      if (!accept(life, state, version) && performance.now() - started < STREAM_RETRY_MS) delay = STREAM_RETRY_MS
    } catch {
      if (!valid()) return
      if (++life.readFailures === 3) setReadError(true)
      delay = STREAM_RETRY_MS
    } finally {
      life.reading = false
      scheduleRead(life, delay)
    }
  }
  async function transition(life, op, payload) {
    if (!current(life) || life.clearing) return
    resetPicture(life); life.minimumView = Math.max(0, life.view + (op === 'back' ? 0 : 1))
    life.transitioning = true
    const version = ++life.navigationVersion
    try { accept(life, await action(life, op, payload), version) }
    catch { if (current(life) && version === life.navigationVersion) setError(true) }
    finally {
      if (current(life) && version === life.navigationVersion) {
        life.transitioning = false
        scheduleRead(life)
      }
    }
  }
  function syncNavigation(life) {
    if (!current(life) || !life.id || life.clearing || life.lastUrl === urlRef.current) return
    life.lastUrl = urlRef.current
    void transition(life, 'navigate', { url: life.lastUrl })
  }
  function geometry() {
    const rect = containerRef.current?.getBoundingClientRect()
    return { width: Math.max(100, Math.min(2400, Math.round(rect?.width || 800))), height: Math.max(100, Math.min(1800, Math.round(rect?.height || 600))), scale: scaleRef.current }
  }
  useEffect(() => {
    if (!active) return
    const life = { alive: true, epoch, profile, connectionId, id: null, guard: createStreamFrameGuard(), view: -1, readSeq: 0, readFailures: 0,
      navigationVersion: 0, minimumView: 0, lastUrl: urlRef.current, keys: new Map(), presses: new Map(), composition: null, image: null }
    lifeRef.current = life
    setError(false); setReadError(false); setPainted(false); setSessionId(null); onOrigin(''); onReady(false)
    const control = {
      invalidate: () => { life.invalidated = true; resetPicture(life); clearTimeout(life.readTimer) },
      reload: () => transition(life, 'reload', {}),
      back: () => transition(life, 'back', {}),
      clear: async () => {
        if (!current(life) || !life.id || life.clearing) throw new Error('browser unavailable')
        life.clearing = true; life.transitioning = false; life.navigationVersion += 1
        resetPicture(life)
        try {
          const result = await ctx.rest(`/browser/sessions/${encodeURIComponent(life.id)}/clear`, { method: 'POST', body: { confirm: true }, timeoutMs: 30000 })
          if (!current(life) || result?.cleared !== true) throw new Error('clear failed')
          life.id = null; setSessionId(null); setAttempt(value => value + 1)
        } finally {
          life.clearing = false
          if (current(life) && life.id) {
            syncNavigation(life)
            life.resize?.()
            scheduleRead(life)
          }
        }
      }
    }
    controllerRef.current = control
    void (async () => {
      try {
        const routes = typeof host.profileRoutes === 'function' ? await host.profileRoutes() : []
        if (!current(life)) return
        const scope = streamRouteScope(routes, profile, connectionId)
        const initialGeometry = geometry()
        life.geometry = JSON.stringify(initialGeometry)
        const state = await ctx.rest('/browser/sessions', { method: 'POST', body: { scope, url: life.lastUrl, ...initialGeometry }, timeoutMs: 30000 })
        if (typeof state?.id !== 'string' || !state.id) throw new Error('invalid browser session')
        life.id = state.id
        if (!current(life)) {
          if (sameRoute(life)) void ctx.rest(`/browser/sessions/${encodeURIComponent(state.id)}`, { method: 'DELETE' }).catch(() => {})
          return
        }
        setSessionId(state.id); onReady(true); accept(life, state, 0); scheduleRead(life)
      } catch { if (current(life)) setError(true) }
    })()
    return () => {
      cancelMouse(life)
      life.alive = false; life.guard.dispose(); life.keys.clear(); life.composition = null
      clearTimeout(life.readTimer); discardFrames(life)
      if (controllerRef.current === control) controllerRef.current = null
      if (life.id && sameRoute(life)) void ctx.rest(`/browser/sessions/${encodeURIComponent(life.id)}`, { method: 'DELETE', timeoutMs: 15000 }).catch(() => {})
      const canvas = canvasRef.current
      if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [ctx, active, profile, connectionId, epoch, attempt])
  useEffect(() => {
    const life = lifeRef.current
    if (sessionId && life?.id === sessionId) syncNavigation(life)
  }, [url, sessionId])
  useEffect(() => {
    const life = lifeRef.current
    const node = containerRef.current
    if (!sessionId || !node || !current(life) || life.id !== sessionId) return
    let previous = life.geometry || ''
    const resize = () => {
      const size = geometry(), key = JSON.stringify(size)
      if (key === previous || !current(life) || life.clearing || resizingRef.current) return
      previous = key; life.geometry = key
      void transition(life, 'resize', size)
    }
    const observer = new ResizeObserver(resize)
    life.resize = resize
    observer.observe(node); resize()
    return () => { life.resize = null; observer.disconnect() }
  }, [sessionId, scale])
  useEffect(() => {
    const life = lifeRef.current
    if (!resizing) life?.resize?.()
    scheduleRead(life)
  }, [resizing])
  function inputLife() {
    const life = lifeRef.current
    return current(life) && active && !resizingRef.current && life.lastUrl === urlRef.current && life.guard.inputView() !== null ? life : null
  }
  function sendInput(op, payload, life = inputLife()) {
    if (!life || life !== inputLife()) return
    void action(life, op, { ...payload, view: life.guard.inputView() }).catch(() => {})
  }
  function modifiers(event) { return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0) }
  function releaseMouse(life, event, blur = false) {
    // A release belongs to the press's lifetime AND painted view, never the
    // currently displayed replacement. Capture handles both canvas and outside up.
    const view = life.guard.inputView()
    if (life !== inputLife() || [...life.presses.values()].some(press => press.view !== view)) {
      cancelMouse(life); return
    }
    const buttons = blur ? [...life.presses.keys()] : [event.button]
    for (const button of buttons) {
      const press = life.presses.get(button)
      if (!press) continue
      life.presses.delete(button) // Before dispatch: React's bubbling onMouseUp is a no-op.
      life.hover = null; life.hoverPending = false
      life.inputRevision = (life.inputRevision || 0) + 1
      const remaining = [...life.presses.keys()].reduce((mask, value) => mask | [1, 4, 2][value], 0)
      const point = blur ? life.mousePoint || press.point
        : streamPoint(event, canvasRef.current.getBoundingClientRect(), life.width, life.height)
      sendInput('mouse', { ...point, type: 'mouseReleased', button: ['left', 'middle', 'right'][button],
        buttons: remaining, modifiers: blur ? 0 : modifiers(event), clickCount: press.clickCount }, life)
    }
    if (!life.presses.size) { life.releaseListeners?.(); life.releaseListeners = null }
  }
  function watchMouse(life, canvas) {
    if (life.releaseListeners) return
    const owner = canvas.ownerDocument.defaultView
    const up = event => releaseMouse(life, event)
    const blur = () => releaseMouse(life, null, true)
    owner.addEventListener('mouseup', up, true)
    owner.addEventListener('blur', blur)
    life.releaseListeners = () => {
      owner.removeEventListener('mouseup', up, true)
      owner.removeEventListener('blur', blur)
    }
  }
  function mouse(event, type) {
    const life = inputLife(), canvas = canvasRef.current
    if (!life || !canvas) return
    event.preventDefault()
    if (type === 'mouseReleased') { releaseMouse(life, event); return }
    if (type === 'mousePressed') canvas.focus()
    const point = streamPoint(event, canvas.getBoundingClientRect(), life.width, life.height)
    const button = type === 'mouseWheel' || (type === 'mouseMoved' && !event.buttons) ? 'none'
      : type === 'mouseMoved' ? (event.buttons & 1 ? 'left' : event.buttons & 2 ? 'right' : 'middle')
        : ['left', 'middle', 'right'][event.button] || 'none'
    const payload = { ...point, type, button, buttons: event.buttons, modifiers: modifiers(event), clickCount: Math.max(1, Math.min(2, event.detail || 1)) }
    life.mousePoint = point
    if (type === 'mousePressed') {
      if (![0, 1, 2].includes(event.button)) return
      life.presses.set(event.button, { view: life.guard.inputView(), point, clickCount: payload.clickCount })
      watchMouse(life, canvas)
    }
    if (type === 'mouseWheel') { payload.deltaX = event.deltaX; payload.deltaY = event.deltaY }
    if (type !== 'mouseMoved') { sendInput('mouse', payload, life); return }
    life.hover = payload
    if (life.hoverPending) return
    life.hoverPending = true
    const inputRevision = life.inputRevision
    void (async () => {
      try {
        while (life.hover && life === inputLife() && life.inputRevision === inputRevision) {
          const next = life.hover; life.hover = null
          await action(life, 'mouse', { ...next, view: life.guard.inputView() })
        }
      } catch { /* Input is deliberately not replayed after navigation or scope changes. */ }
      finally { if (life.inputRevision === inputRevision) { life.hoverPending = false; life.hover = null } }
    })()
  }
  function key(event, up) {
    const life = inputLife()
    if (!life || event.isComposing || event.key === 'Process') return
    if (event.key === 'Tab' && !life.keys.has(event.code)) return // Keep an accessible way out of the canvas.
    event.preventDefault()
    if (!up && event.key?.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { sendInput('text', { text: event.key }, life); return }
    if (up && !life.keys.has(event.code)) return
    if (up) life.keys.delete(event.code); else life.keys.set(event.code, event.key)
    sendInput('key', { type: up ? 'keyUp' : 'keyDown', key: event.key, code: event.code, windowsVirtualKeyCode: event.keyCode, modifiers: modifiers(event) }, life)
  }
  return jsxs('div', { ref: containerRef, className: 'intelligence-feed-stream-browser', style: { position: 'absolute', inset: 0, overflow: 'hidden' }, children: [
    jsx('canvas', { ref: canvasRef, tabIndex: 0, role: 'application', 'aria-label': t(locale, '文章预览'),
      style: { position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: painted ? 1 : 0, pointerEvents: resizing ? 'none' : undefined, outlineColor: 'var(--ui-accent)' },
      onMouseDown: event => mouse(event, 'mousePressed'), onMouseUp: event => mouse(event, 'mouseReleased'),
      onMouseMove: event => mouse(event, 'mouseMoved'), onWheel: event => mouse(event, 'mouseWheel'),
      onContextMenu: event => event.preventDefault(), onKeyDown: event => key(event, false), onKeyUp: event => key(event, true),
      onPaste: event => { event.preventDefault(); const text = event.clipboardData?.getData('text/plain'); if (text && text.length <= 4096) sendInput('text', { text }) },
      onCompositionStart: () => { const life = inputLife(); if (life) life.composition = life.guard.inputView() },
      onCompositionEnd: event => { const life = inputLife(); if (life && life.composition === life.guard.inputView() && event.data?.length <= 4096) sendInput('text', { text: event.data }, life); if (life) life.composition = null },
      onBlur: () => { const life = inputLife(); if (!life) return; for (const [code, value] of life.keys) sendInput('key', { type: 'keyUp', key: value, code }, life); life.keys.clear(); life.composition = null }
    }),
    (!painted || error || readError) && jsxs('div', { role: 'status', style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, padding: 12, color: muted, background: 'var(--ui-background)' }, children: [
      t(localeRef.current, error || readError ? '网页浏览器连接失败，请重试' : '浏览器正在启动…'),
      (error || readError) && jsx(Button, { variant: 'ghost', size: 'sm', onClick: () => setAttempt(value => value + 1), children: t(locale, '重试') })
    ] })
  ] })
}

function PreviewPane({ url, onClose, ctx, locale = 'en', resizing = false }) {
  const [displayUrl, setDisplayUrl] = useState(() => validDestination(url) ? url : null)
  const [expanded, setExpanded] = useState(false)
  const [failedUrl, setFailedUrl] = useState(null)
  const [pageScale, setPageScale] = useState(() => {
    const saved = ctx.storage.get('settings.pageScale', 80)
    return typeof saved === 'number' && Number.isFinite(saved) ? Math.max(40, Math.min(150, Math.round(saved))) : 80
  })
  const scaleRef = useRef(pageScale)
  scaleRef.current = pageScale
  const activeUrl = useRef(url)
  activeUrl.current = url
  const streamRef = useRef(null), clearTriggerRef = useRef(null)
  const clearRevision = useRef(0)
  const [siteOrigin, setSiteOrigin] = useState(''), [streamReady, setStreamReady] = useState(false)
  const [clearOpen, setClearOpen] = useState(false), [clearBusy, setClearBusy] = useState(false), [clearError, setClearError] = useState(false)
  const [frameRevision, setFrameRevision] = useState(0)
  const active = validDestination(url)
  const profile = useValue(host.state.profile)
  const routeConnection = useValue(host.state.connectionId || host.state.profile)
  const connectionId = host.state.connectionId ? routeConnection : null
  const epoch = streamEpoch()
  const browserStatus = useQuery({
    queryKey: [ID, 'browser-status', profile, connectionId, epoch], enabled: active && typeof ctx.rest === 'function', retry: 1,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: async () => {
      const result = await ctx.rest('/browser/status')
      if (streamEpoch() !== epoch) throw new Error('browser scope changed')
      return result
    }
  })
  const useStream = browserStatus.data?.available === true
  useEffect(() => {
    clearRevision.current += 1
    setClearOpen(false); setClearBusy(false); setClearError(false)
  }, [url, profile, connectionId, epoch])
  function close() {
    activeUrl.current = null
    streamRef.current?.invalidate()
    clearRevision.current += 1
    setClearOpen(false); setClearBusy(false); setClearError(false)
    onClose()
  }
  async function reloadPreview() {
    if (!active || activeUrl.current !== url) return
    if (useStream) await streamRef.current?.reload()
    else { setFailedUrl(null); setFrameRevision(value => value + 1); void browserStatus.refetch?.() }
  }
  async function clearLogin() {
    if (!active || clearBusy || !streamRef.current) return
    const control = streamRef.current, revision = ++clearRevision.current
    const currentClear = () => clearRevision.current === revision && streamRef.current === control && activeUrl.current === url
    setClearBusy(true); setClearError(false)
    try { await control.clear(); if (currentClear()) setClearOpen(false) }
    catch { if (currentClear()) setClearError(true) }
    finally { if (clearRevision.current === revision) setClearBusy(false) }
  }
  function changeScale(delta) {
    if (!url || activeUrl.current !== url || !validDestination(url)) return
    const next = delta === null ? 80 : Math.max(40, Math.min(150, scaleRef.current + delta))
    scaleRef.current = next
    setPageScale(next)
    ctx.storage.set('settings.pageScale', next)
  }
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
        jsx('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: muted, fontSize: 12 }, children: useStream ? siteOrigin || t(locale, '实际站点尚未确认') : new URL(displayUrl).hostname }),
        jsx(Button, { variant: 'ghost', size: 'icon-xs', 'aria-label': t(locale, "在外部浏览器打开"), onClick: openExternal, children: jsx(Codicon, { name: 'link-external' }) }),
        useStream && jsx(Button, { variant: 'ghost', size: 'icon-xs', disabled: !streamReady, 'aria-label': t(locale, '返回原页'), onClick: () => { void streamRef.current?.back() }, children: jsx(Codicon, { name: 'arrow-left' }) }),
        useStream && jsx(Button, { ref: clearTriggerRef, variant: 'ghost', size: 'icon-xs', disabled: !streamReady || clearBusy, 'aria-label': t(locale, '清除登录数据'), onClick: () => { setClearError(false); setClearOpen(true) }, children: jsx(Codicon, { name: 'clear-all' }) }),
        jsx(Button, { variant: 'ghost', size: 'icon-xs', 'aria-label': t(locale, '刷新预览'), onClick: reloadPreview, children: jsx(Codicon, { name: 'refresh' }) }),
        jsx(Button, { variant: 'ghost', size: 'icon-xs', 'aria-label': t(locale, '缩小网页'), disabled: pageScale <= 40, onClick: () => changeScale(-10), children: '−' }),
        jsx(Button, { variant: 'ghost', size: 'sm', 'aria-label': t(locale, '恢复网页缩放至80%'), title: t(locale, '恢复网页缩放至80%'), onClick: () => changeScale(null), style: { minWidth: 48, fontSize: 12, fontVariantNumeric: 'tabular-nums' }, children: `${pageScale}%` }),
        jsx(Button, { variant: 'ghost', size: 'icon-xs', 'aria-label': t(locale, '放大网页'), disabled: pageScale >= 150, onClick: () => changeScale(10), children: '+' }),
        jsx(Button, { variant: 'ghost', size: 'icon-xs', 'aria-label': t(locale, "关闭预览"), onClick: close, children: jsx(Codicon, { name: 'close' }) })
      ] }, 'toolbar'),
      jsxs('div', { role: 'status', style: { padding: '6px 8px', color: muted, fontSize: 12 }, children: [
        useStream ? t(locale, '本机浏览器 · 记住登录') : `${t(locale, '受限预览')} — ${t(locale, failedUrl === displayUrl ? "预览无法加载，请在外部浏览器打开。" : "部分网站不允许内嵌预览。如果页面空白或无法使用，请在外部浏览器打开。")}`,
        ' ',
        jsx('a', { href: displayUrl, target: '_blank', rel: 'noopener noreferrer', onClick: event => { event.preventDefault(); void openExternal() }, style: { color: 'var(--ui-accent)', textDecoration: 'underline' }, children: t(locale, "在外部浏览器打开") })
      ] }, 'notice'),
      jsx('div', {
        style: { position: 'relative', flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' },
        children: useStream ? jsx(StreamSurface, {
          ctx, url, active, resizing, scale: pageScale, profile, connectionId, locale,
          controllerRef: streamRef, onOrigin: setSiteOrigin, onReady: setStreamReady
        }) : jsx(SandboxedFrame, {
          src: displayUrl, title: t(locale, "文章预览"),
          onError: () => { if (activeUrl.current === displayUrl) setFailedUrl(displayUrl) },
          // Scale only the sandbox element; compensate its viewport to keep the panel filled.
          style: { position: 'absolute', inset: 0, width: `${10000 / pageScale}%`, height: `${10000 / pageScale}%`, transform: `scale(${pageScale / 100})`, transformOrigin: 'top left', border: 'none', pointerEvents: resizing ? 'none' : undefined }
        }, `${displayUrl}:${frameRevision}`)
      }, 'content'),
      jsx(Dialog, { open: clearOpen, onOpenChange: value => { if (!clearBusy) setClearOpen(value) }, children: jsx(DialogContent, {
        onCloseAutoFocus: event => { event.preventDefault(); clearTriggerRef.current?.focus() },
        children: jsxs('div', { children: [
          jsxs(DialogHeader, { children: [jsx(DialogTitle, { children: t(locale, '清除登录数据') }), jsx(DialogDescription, { children: t(locale, '清除当前来源专用浏览器的登录数据？新闻、收藏和系统浏览器不受影响。') })] }),
          clearError && jsx('p', { role: 'alert', children: t(locale, '登录数据清除失败，请重试') }),
          jsxs(DialogFooter, { children: [jsx(Button, { variant: 'ghost', disabled: clearBusy, onClick: () => setClearOpen(false), children: t(locale, '取消') }), jsx(Button, { disabled: clearBusy, onClick: () => { void clearLogin() }, children: t(locale, '清除并重新打开') })] })
        ] })
      }) }, 'clear-login')
    ]
  })
}
