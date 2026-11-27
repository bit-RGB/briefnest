# 📰 BriefNest

🏷️ **Version: v0.1.5** · 📜 **License: MIT**

A community news dashboard for Hermes Desktop: semiconductors, AI, automotive, music, Weibo hot topics and bookmarks. **English is the default UI language.** Switch to **简体中文** in Settings; the choice is saved. Article titles and publisher names remain source content.

## ✨ Installation and capabilities

```bash
hermes plugins install bit-RGB/briefnest --enable --yes-deps
```

Enable **BriefNest** in Desktop plugin settings too, open the sidebar entry and select **Update now**. Features include search, read/unread filters, bookmarks, source switches, unread counts and mail-style rows separated by horizontal rules. The internal plugin ID remains `intelligence-feed`.

**GitHub Trending** opens on **This month** and can be switched to **Today** or **This week**. It keeps GitHub's original order, displays star counts for reference, and retains the last successful snapshot for each period if collection fails.

Requires Python 3.11+ and Hermes Desktop exporting `SandboxedFrame` from `@hermes/plugin-sdk`, dashboard APIs, `hermes_constants.get_hermes_home()` and `agent.secret_scope.get_secret()`. No unverified minimum Hermes version is claimed. Windows is the currently tested platform; this is not an official plugin. Installation does not create cron jobs.

## 🌐 Right-side browser and remembered login

On the supported local Windows backend, the right-hand reader uses a **dedicated local browser profile** and displays its in-memory image stream through the public plugin REST API. Page images and keyboard/pointer input pass through the plugin helper; this is **not authentication handled exclusively by the Hermes host**. Remote pages receive no plugin bridge, Node integration or guest-script injection. Login frames are not written to disk or sent to a model by this feature. Remote connection routes do not start a login browser by default.

Closing a preview, restarting Hermes or updating this plugin does not intentionally erase its dedicated login profile. It is separated by the actual backend Hermes home and selected connection/profile scope; your ordinary Edge/Chrome data is never imported. Use **Clear login data** and confirm to remove only the current dedicated profile, without touching articles or favorites. The old temporary prototype's login is not migrated: sign in once in this new dedicated profile. Sites can still expire or revoke login, require another verification, or reject automation.

The toolbar keeps **− / percentage / +** immediately before Close: default 80%, range 40%–150%, step 10 points; clicking the percentage resets to 80%. Browser viewport scaling does not alter Hermes's application zoom. Panel animation, divider sizing and reduced-motion support remain. The currently supported helper requires Windows, Microsoft Edge and a Node 26+ runtime discovered through Hermes; no browser, native binary or Node dependency is bundled or automatically installed. Where the helper is unavailable, SDK `SandboxedFrame` keeps its default sandbox and the visible **Open externally** fallback. An `onLoad` event is not proof that a site rendered. No embedding restrictions are bypassed.

The preview is a full-height right-hand pane, aligned with the top of the workspace and ending above the shared status bar. Search, read/unread filters and settings stay above the article list only; they do not reduce preview height. Narrow list columns wrap filter controls instead of overlapping the preview.

Drag the vertical divider to resize the preview (default 60%, range 30%–75%); the width is saved when the drag ends. The focused divider also supports Left/Right and Home/End. News rows use full-width horizontal separators and compact spacing. Hover highlights the entire row, including the bookmark area; opening an article retains its selection. Bookmark clicks do not open articles. The favorites separator spans the full sidebar width.

Scrolling to the bottom automatically appends the next page; there is no **Load more** button. Short first pages automatically fill the viewport. Continuations are serialized and deduplicated, stop at the final cursor, and ignore responses from an old filter/profile or refreshed first page. A failed continuation keeps existing rows and pauses until **Retry**. Opening an article in **All**, or changing a bookmark outside **Favorites**, preserves appended rows and scroll position; changes that remove an article from the current read/favorites filter refresh that filtered list.

A fixed page-level bottom status bar spans the channel sidebar, article list and preview, above Hermes's own global status bar. It shows the last update in Beijing time and the manual update action; it is not part of the article list or its scroll area.

The channel sidebar is 1.5 times its natural content width, still adapting to the current font and longest localized label and keeping every channel equally wide with compact icon spacing. Counts appear beside **Unread** and **Read** for the selected channel (or favorites), not in the sidebar; zero counts are hidden and displayed counts are capped at `(999)`. These are channel totals, not search-result counts.

## 🔒 Profile storage and upgrading

Each operation resolves `get_hermes_home() / "plugin-data" / "intelligence-feed" / "intelligence.db"`. The process-global `INTELLIGENCE_FEED_DATA_DIR` override is no longer honored. Shared legacy data has no reliable profile owner, so it is **never imported automatically**.

Before first collection: back up the old database, stop the old collector during the version switch, select the intended Hermes profile/environment, and run from the plugin directory using Hermes's Python:

```bash
python scripts/migrate_data.py --source "/absolute/path/to/old/intelligence.db"
python scripts/migrate_data.py --source "/absolute/path/to/old/intelligence.db" --apply
```

The first command is a dry run; confirm its destination before applying. SQLite backup includes committed WAL data. Integrity checks, history, read state, bookmarks and source switches are retained. The source is never removed, an existing destination is never overwritten, and partial copies are not published. Reconcile an existing destination deliberately, not by deleting it to force import. Imported state keeps its original profile labels. Do not copy shared history to multiple profiles without explicitly intending to share it. Models are not copied.

Default feeds require no API keys. The fetch adapter, collector redaction and API URL-redaction paths all use `agent.secret_scope.get_secret(NAME)` with no plugin-defined environment fallback. The optional legacy Last.fm adapter uses `LASTFM_API_KEY`, declared in manifest `requires_env`; missing credentials skip that source. Provision it through Hermes for the intended profile. Any custom `api_key_env` name must also be declared in `requires_env`. Never commit credentials or embed them in source URLs.

## 🛠️ Development

Use an isolated Python environment with Hermes core modules importable, plus `requirements-dev.txt`:

```bash
python -m pytest tests/ -q
node --test tests/test_desktop_*.mjs
node --check desktop/plugin.js
```

Tests use temporary profile homes, fixture feeds and synthetic credentials. SDK-adapter tests are not live acceptance for every publisher or OS. Optional local title translation is unchanged and its development is paused; no model is bundled/downloaded. `INTELLIGENCE_FEED_TRANSLATION_MODEL_DIR` can point to an existing separately managed model.

Code is MIT licensed; third-party articles, titles, trademarks and images are not relicensed. Feed/preview/external requests contact the original sites. Respect their terms and access restrictions. No telemetry, self-updater or native binaries are bundled.

---

# 简体中文 · 讯集

🏷️ **当前版本：v0.1.5** · 📜 **许可证：MIT**

在 Hermes 中，一站浏览你关心的资讯。BriefNest · 讯集是 Hermes Desktop 的多频道资讯插件，支持半导体、AI、汽车、音乐资讯和微博热搜。

> 📌 非 Hermes 官方插件。当前主要在 Windows + Hermes Desktop 环境验证；单独安装 Hermes CLI 不会提供桌面页面。

## ✨ 功能

- 🗂️ **多频道看板**：全部、半导体、AI、汽车、音乐、微博热搜、GitHub 趋势和收藏夹。
- 📈 **GitHub 趋势**：进频道默认本月，可临时切换今日和本周；按 GitHub 原榜单顺序展示。采集失败保留该档上次成功榜单，已收藏仓库下榜后仍可访问。
- ⭐ **阅读管理**：关键词搜索、已读 / 未读筛选、收藏、分页与未读数量。
- 📡 **多来源聚合**：RSS / Atom、HTML 列表及微博热搜适配器；相近资讯聚合为事件。
- 🌐 **右侧网页阅读**：本机专用浏览器画面流，通过公开插件接口接入；不可用时保留 SDK 沙箱预览与外部打开。
- 🔐 **记住登录**：专用档案重启/更新不主动清除；工具栏可确认清除当前来源登录，不影响新闻、收藏或系统浏览器。
- 🌏 **语言切换**：默认英文，在设置中切换简体中文并记忆。
- 📧 **横线列表**：邮件式分隔，不再给每条消息单独加边框。
- ⚙️ **来源设置**：单独启停来源，停用后保留历史数据与收藏。
- ⚡ **无 LLM 采集**：Python 标准库抓取与 SQLite 存储，不需要大模型 API Key。
- 🌏 **可选本地翻译**：支持 CTranslate2 英文标题翻译，未安装模型仍可正常采集和阅读原文。

## 🧰 环境要求

- 支持桌面插件 SDK 与 `dashboard/plugin_api.py` 的 Hermes Desktop。
- Python 3.11+；后端依赖 FastAPI 和 Pydantic 2。
- 本机画面流需要可用的 Chromium 浏览器与 Hermes 能发现的 Node；当前验证平台为 Windows，不自动安装浏览器或依赖。远程连接不默认启动登录浏览器。
- 能通过 HTTPS 访问所选资讯来源。
- 开发测试需要 pytest、httpx；前端导航测试需要 Node.js 18+。

## 🚀 安装

本仓库是统一插件包：Python 后端在根目录，前端位于 `desktop/plugin.js`。

1. 使用 Hermes 的插件管理命令安装本 GitHub 仓库并启用：

   ```bash
   hermes plugins install bit-RGB/briefnest --enable --yes-deps
   ```

2. 完全退出并重新打开 Hermes Desktop，让后端加载新 API。
3. 在桌面端插件管理页面启用 **讯集**。前端默认关闭，和 Python 插件启用状态是两个开关。
4. 打开侧边栏「讯集」，点击更新按钮采集首批资讯。

如安装后没有页面，可在命令面板运行 **Reload desktop plugins**。API 提示 404 时，检查当前 profile 是否已启用 `intelligence-feed`，并重启 Desktop 后端。

> 🔗 仓库已更名为 `briefnest`。内部插件 ID、路由、Python 包名保留不变。v0.1.1 改用 profile 隔离目录，须按上文显式导入旧库，不会自动删除或跨 profile 导入历史。

安装机制参考：[Hermes 插件文档](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins) · [Desktop Plugin SDK](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk)。

### 🔄 手动采集

在插件根目录执行：

```bash
python scripts/run_update.py
```

命令输出采集结果 JSON。可由操作系统任务计划或 Hermes cron 运行；**安装插件不会自动创建定时任务**。`scripts/intelligence_feed_update.py` 从当前 Hermes profile 的 home 下查找插件，不再写死 Windows 路径。

## 📡 来源配置

编辑 `config/sources.json`。默认包括爱集微、芯查查、IT之家、电子发烧友、TrendForce、量子位、OpenAI、Anthropic、Mistral、NVIDIA、GitHub Blog、TechCrunch、Nature、第一电动、凤凰网音乐、新浪音乐、中华网音乐和微博热搜。

各条目指定：

| 字段 | 说明 |
| --- | --- |
| `id` / `name` | 唯一标识与显示名称 |
| `domain` | `semiconductor`、`ai`、`automotive`、`music`、`weibo`、`github-trending` |
| `adapter` | `feed`、`html-list`、`weibo-hot` 或 `github-trending` |
| `url` | HTTPS 来源地址 |
| `include_url_regex` | HTML 列表正文链接白名单，避免采到导航页 |
| `max_items` | 单次收取上限 |
| `enabled` | 默认启用状态；页面可保存单独的来源开关 |

新来源应先实际抓取并检查标题、链接是否为正文，再加入默认清单。网站结构、访问限制和网络条件可能变化，不保证每次采集所有来源均可用。

## 🔒 数据与隐私

数据库不在源码仓库中。当前 profile 的存储位置：

```text
<current Hermes home>/plugin-data/intelligence-feed/intelligence.db
```

旧 Windows 默认位置为 `%LOCALAPPDATA%/hermes/data/intelligence-feed/intelligence.db`，其他平台原为 `~/hermes/data/intelligence-feed/intelligence.db`。不再使用进程级 `INTELLIGENCE_FEED_DATA_DIR` 覆盖。迁移前先备份，使用上文脚本查看目标 profile 后加 `--apply`；原库保留、目标存在时拒绝覆盖。

仓库不包含个人数据库、阅读记录、收藏、密钥、日志或翻译模型。插件会连接配置的第三方资讯站点；打开原文或内嵌预览同样会访问对应站点。

**登录与画面流：** 网页画面及输入会经过 BriefNest 的本机辅助层，不再等同于由 Hermes 宿主独占处理认证；画面只在内存中用于显示，不由此功能落盘或交给模型。登录交给专用浏览器档案保存，不复制日常 Edge/Chrome 的 Cookie。档案按当前后端 Hermes home 与连接/profile 作用域分开；退出阅读、重启与插件更新不会主动清除。点击「清除登录数据」并确认，只清当前专用档案，不删资讯库。旧隔离版的临时登录不自动迁入，需在新档案登录一次；网站自行过期或风控时仍可能要求重登。扫码、短信与每个真实站点的可用性须单独复测，不能用模拟页测试冒充验收。

### 🌏 可选英文标题翻译

翻译模块延迟加载 `ctranslate2` 和 `sentencepiece`。如需使用，在运行后端的 Python 环境安装这两个依赖，并自行准备兼容的 Marian CTranslate2 英译中模型。模型目录需要 `model.bin`、`source.spm`、`target.spm` 及模型所需词表等文件。

用 `INTELLIGENCE_FEED_TRANSLATION_MODEL_DIR` 指向模型目录；默认位于数据目录下的 `models/opus-mt-en-zh-ctranslate2`。本仓库不附带模型、不自动下载模型，模型和依赖的许可证需另行遵守。

## 🛠️ 开发与测试

```bash
python -m pip install -r requirements-dev.txt
python -m pytest tests/ -q
node --test tests/test_desktop_navigation.mjs
```

测试使用 fixture 和模拟网络，不依赖在线站点可用性；前端测试不替代实际 Desktop UI 验收。前端是原生 ESM，无 npm 构建步骤。

```text
config/sources.json       默认来源清单
desktop/plugin.js        Hermes Desktop 页面
dashboard/plugin_api.py  FastAPI 后端
intelligence_feed/       采集、解析、事件聚合、数据库和翻译
scripts/                 无 LLM 采集入口
tests/                   Python / Node 测试及 fixtures
```

修改前端后，注意 Hermes 可能加载 `desktop-plugins/intelligence-feed/plugin.js` 的运行时副本，而不是包内文件；开发时需同步或由宿主重新加载。修改 Python 后端后需重启后端进程。

## 📜 许可证与内容声明

插件代码使用 [MIT License](LICENSE)。第三方网站的文章、标题、商标和图片权利归原权利人所有，不属于本仓库的 MIT 授权范围。使用者应遵守来源网站的条款、访问频率限制和适用规则，不要将采集内容当作本项目开源内容重新分发。
