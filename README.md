# 启动收藏 · 一个像 Win+R 的 Rubick 插件

**直接在 Rubick 的搜索框里输入路径、程序名或命令，按回车就跑**；每次运行自动留记录，可模糊过滤、可收藏、可重跑。

它替代的是 Windows 的「运行」对话框，不是文件夹收藏夹。也不用先进插件再敲第二遍。

- 搜索关键词：`运行`、`启动`、`start`、`fav`
- 插件安装位置：`%APPDATA%\Rubick\rubick-plugins-new`（在 Rubick 4.3.8 上开发验证）
- 项目放哪都行，下文用 `%PROJECT%` 代指本项目所在目录

---

## 一分钟装好

```powershell
cd %PROJECT%

npm test                  # 先自检（不需要 Rubick 在跑）
npm run install:rubick    # 装进 Rubick：建链接 + 写注册表
```

然后**关掉插件再重新打开**（页面文件是每次打开重新读的），搜索 `fav` 打开「启动收藏」。

页面右下角就是状态：

| 显示 | 含义 |
| --- | --- |
| `可以运行` | 正常。在 Rubick 搜索框输入 `notepad` 回车即可 |
| `无法执行命令` | 页面拿不到 `child_process`，看下面的排查 |

点右下角状态可以**立即重新检测**（检测是同步的，不需要重启任何东西）。

其它命令：

```powershell
npm run check:rubick        # 只体检：链接在不在、注册表对不对
npm run uninstall:rubick    # 从 Rubick 移除
```

---

## 怎么用

1. 搜索框输入 **`fav`**（或 `运行`、`启动`、`start`）打开「启动收藏」
2. 插件打开后，**继续在同一个搜索框里打字** —— 插件上方会实时回显
3. 按 **`回车`** 执行

插件页面里**没有输入框**：输入的唯一来源是 Rubick 搜索框，上方只做回显。这样不存在"两边同步、谁是真值"的歧义，也不需要回环防护。

下方只有记录列表：点一下直接重跑，点右边的 `☆` 收藏。执行后搜索框自动清空，避免再按一次回车重复执行。

---

## 架构：一个插件，两处机制

```
Rubick 搜索框  ──setSubInput(onChange)──►  插件页面（BrowserView）
     ▲                                            │
     └──────setSubInputValue(text)────────────────┘
                                                  │ require('child_process').spawn
                                                  ▼
                                            cmd.exe /d /s /c <原文>
```

Rubick 建插件视图时给的是 `nodeIntegration: true` + `contextIsolation: false`：

```js
t = new e.BrowserView({ webPreferences: {
  webSecurity: false, nodeIntegration: true, contextIsolation: false, devTools: true,
  preload: <插件自己的 preload>, session: <插件专属 partition>
}});
```

所以页面里 `require` 直接可用，**不需要系统插件桥接**。

### 输入层是怎么接上的（都有实证，不是猜）

| 机制 | 依据 |
| --- | --- |
| 搜索框内容 → 插件 | 搜索框组件把值 `sendSync('sendSubInputChangeEvent',{text})` 给插件；`rubick.setSubInput(onChange)` 注册的回调同步收到 `{text}`。**真机探测：每次按键都触发** |
| 搜索框按键 → 插件 | 搜索框 keydown 时发 `sendPluginSomeKeyDownEvent`，主进程用 `Sr.getView().webContents.sendInputEvent` 灌进插件页面 |
| 插件 → 搜索框 | `rubick.setSubInputValue(text)`；用来在执行后清空输入 |
| 直读主窗口 DOM | **走不通** —— `@electron/remote` 在本版不可用（`Cannot find module`），真机探测确认 |

两个**踩过的坑**，都写在这里省得再犯：

**坑一：按键只转发键码，文本不能靠按键重建。** `\`、`:` 这类字符不在映射表里，所以文本一律走 `setSubInput` 回调。映射表在主进程里写死的，只覆盖功能键与字母数字：

```js
ur = { Backspace:'Backspace', Tab:'Tab', Enter:'Enter', Escape:'Escape', Space:'Space',
       ArrowUp:'Up', ArrowDown:'Down', ..., KeyA:'A', ..., Digit0:'0', ..., Slash:'/', ... }
```

**坑二：`sendInputEvent` 造出来的是合成事件，只有 `keyCode`、没有 `key`。** 所以判断回车**不能**写 `e.key === 'Enter'`（实测永不命中，表现为"回车完全没反应"）。必须同时看 `e.key` / `e.code` / `e.keyCode`：

```js
function isEnterKey(e){
  if (e.key === 'Enter' || e.key === 'Return') return true;
  if (e.code === 'Enter' || e.code === 'NumpadEnter') return true;
  if (e.keyCode === 13 || e.which === 13) return true;
  return false;
}
```

插件会把每次收到的按键原始字段写进日志（`[key] key=... code=... keyCode=...`），以后再出这类问题可以直接看日志，不用猜。

**如果以后 Rubick 升级导致输入层失灵**，仓库里留了一套探测工具，可以重新问清楚协议：

```powershell
node tools/probe-setup.js install     # 装一个临时探测插件
# 搜索 probe 打开，按提示在搜索框打字 / 按回车，看页面和 %TEMP%\rubick-startup-input-probe.log
node tools/probe-setup.js uninstall   # 测完卸掉
```

### 为什么不走"一个系统插件"那条路

系统插件确实能出界面——官方文档说它拿得到 **electron 主进程所有能力**（`ctx.mainWindow` 也挂在上面），所以它完全可以自己开窗口。但它进不了 Rubick 的搜索框：

1. **能被搜到**：启动器搜索不按类型过滤，只看 `features` 在不在。
2. **点开之后白屏**：系统插件的 `indexPath` 在主进程启动阶段被解析成 `entry` 的绝对路径 ——

   ```js
   getLocalPlugins().filter(e => "system" === e.pluginType)
     .map(e => ({ ...e, indexPath: path.join(node_modules, e.name, e.entry) }))
   ```

   而点击处理放行了两类：`if ("ui" === e.pluginType || "system" === e.pluginType)`，于是它会去加载 `index.js` 当网页。
3. **同一个字段干不了两件事**：`entry` 要给主进程 `require()`（必须是 CJS），同时又被当页面入口（必须是 HTML）。

所以"系统插件 + 自建窗口 + 全局热键"是一条**成立的独立路线**（更接近取代 Win+R，不用先开 Rubick），代价是放弃搜索框集成、界面自己写。当前版本选了搜索框这条路。

---

## 之前踩过的三个坑（都记在这，别再踩）

**坑一：Rubick 不认 `npm link`，只认它自己的注册表。**

```js
getLocalPlugins()   // 只读 %APPDATA%\Rubick\rubick-plugins-new\rubick-local-plugin.json
```

`npm link` 只把目录放进 `node_modules`、**跳过注册表**，插件因此永远不在 Rubick 名单里。`tools/install.js` 把两件事都做：建 junction（Windows 免管理员权限，比符号链接稳）+ 写注册表。

**坑二：`ctx.appPath` 是程序目录，不是 userData。**

开发时我拿 `ctx.appPath`（Rubick 安装目录）当成了插件所在的 userData 目录，于是算出来的白名单里只有安装目录，插件页面根本不在里面，握手被反复拒掉。

实际两者不同，而且 userData 目录的**大小写可能和插件目录不一致**（例如 userData 是小写 `rubick`，而插件目录是大写 `Rubick`），它由 Rubick 主进程的 `--user-data-dir` 参数决定。所以**永远不要用 `appPath` 去推插件目录**，要么问 Electron 要 `app.getPath('userData')`，要么直接把几种候选拼出来。

**坑三：Rubick 的插件页面不是主窗口，是 BrowserView。**

所以 `event.sender === mainWindow.webContents` **恒为假** —— 任何基于"来源就是主窗口"的判断都会把合法请求全部拒掉。这个坑只对系统插件桥接方案有意义；现在已经没有桥接层了，但它值得记下来。

另外一条**独立**的坑：官方文档明确写 `logo` **必须是 http/https 在线地址，不支持本地 logo**。之前用本地 `logo.svg`，插件列表里就显示不出图标。现在清单和页面都用 `data:image/svg+xml;base64,...`。

---

## 用起来是什么样

- **回车**：执行输入框里的**原文**。就算这条命中了历史，也不会偷偷换成别的条目。
- **↑ / ↓**：在当前筛选结果里选历史，把原文填回输入框，再回车执行。
- **输入即过滤**：匹配命令原文、备注、分类，按相关度排序。
- **点记录行**：直接重跑。
- **☆ / ★**：收藏；「收藏」筛选只看收藏。
- **Ctrl+K** 聚焦输入框，**Esc** 清空。
- 记录存在 Rubick 本地数据库（`rubick.db`），最多 500 条；浏览器里预览时退回 `localStorage`。

---

## 排查问题

页面自己写一份日志（用 `fs` 直接落盘，不依赖任何 IPC）：

```
%TEMP%\rubick-startup.log
```

正常的样子：

```
2026-...Z [session] 打开插件（v0.3.0）
2026-...Z [env] 可直接执行 · IPC 可用 · 日志 <临时目录>\rubick-startup.log
2026-...Z [run] 已启动：notepad
```

对照着看：

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 没有这个日志文件 | 页面里连 `fs` 都取不到 | 基本不可能；先看右下角状态 |
| 状态是 `无法执行命令` | `require('child_process')` 失败 | 确认用的是 Rubick 4.x，且插件是从本项目目录装的 |
| 有 `已启动` 但程序没出现 | `cmd.exe` 认不出这个输入 | 换成完整路径，或写 `powershell -c "..."` |
| Rubick 插件列表里图标/描述不对 | 清单字段问题 | `npm run uninstall:rubick` 后重新 `npm run install:rubick` |

改页面（`public/`）**只要关掉插件重新打开**；只有改插件的 `name`/`main`/`features` 这类清单字段才需要重装。

---

## 已知边界（照实说）

- 执行走 `cmd.exe /d /s /c <原文>`。**不是**模拟系统 Win+R，也不保证所有文本解析与运行框完全一致。
- `$env:USERPROFILE\...` 是 PowerShell 语法，`cmd.exe` 不会按 PowerShell 语义解释。想跑 PowerShell 得显式写 `powershell -c "..."`。
- 路径、程序名、cmd 命令是主要目标场景，逐项实测为准。
- 成功提示表示**启动请求被系统接受**，不代表目标 GUI 程序之后运行成功——有意不等待 GUI 程序退出。
- 命令以当前 Windows 用户权限运行。**只跑你自己信得过的输入。**

---

## 目录结构

```
package.json              插件清单（pluginType: ui；Rubick 靠 features[].cmds 建索引）
public/
  index.html              界面 + 交互 + 输入层 + 执行，全在原生 JS 里，无框架、无依赖
tools/
  install.js              安装 / 卸载 / 体检
  lint-page.js            页面静态检查（语法、残留引用、关键元素、中文混入代码）
  probe-plugin/           临时探测插件：查清 Rubick 输入协议
  probe-setup.js          探测插件的安装 / 卸载
  privacy-scan.js         发布前的隐私体检（扫绝对路径/邮箱/密钥）
  history-scan.js         扫 git 历史里的隐私
tests/
  run-all.js              npm test（先跑 lint，再跑两个套件）
  static.test.js          清单、无桥接残留、输入层关键调用、安装器逻辑
  ui.test.js              最小 DOM + 虚拟时钟下跑真实页面脚本，验证端到端链路
```

---

## 下一步可以做的

按优先级：

1. 执行语义补齐：`$env:` 这类 PowerShell 写法、URL、文档关联。当前锚点是 `cmd.exe`，要更贴近 Win+R 可以换 `ShellExecuteW`。
2. 历史上的备注/分类编辑、去重、常用排序、导入旧 Win+R 历史。
3. 全局热键：让运行框脱离 Rubick 主窗口直接呼出（走"系统插件 + 自建窗口"那条路）。
