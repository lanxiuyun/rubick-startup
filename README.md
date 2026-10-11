# 启动收藏 · Rubick 里的字符串管家

**在 Rubick 搜索框里输入路径或命令，回车就跑，同时这条字符串进列表。给它打标签，它就永久留下。**

它替代的是 Windows 的「运行」对话框 —— 但真正的价值在于 Win+R 做不到的那部分：**你跑过的字符串会被分类管理，随时能找回来重跑**。Win+R 的历史是一锅混在一起的字符串，这个是能打标签的资产。

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

其它命令：

```powershell
npm run check:rubick        # 只体检：链接在不在、注册表对不对
npm run uninstall:rubick    # 从 Rubick 移除
```

---

## 怎么用

界面只有三样东西，全是紧凑的一行：

```
 ▣ 启动收藏                                  ● 可以运行
 [全部] [项目文件夹] [IP查询] [常用]
 ────────────────────────────────────────────────
 ›_ ipconfig /all                          10-11
     [IP查询 ×] [常用 ×] ＋
 ↗  D:\dlcv\datasets                    10-11
     [项目文件夹 ×] ＋
```

| 操作 | 结果 |
| --- | --- |
| 在 Rubick 搜索框输入，**回车** | 运行它，并把字符串加进列表 |
| 打字（不回车） | 实时过滤列表（在**全部**记录里模糊匹配，不丢老记录） |
| 点记录行 | 直接重跑 |
| 点记录下方的 `＋` | 给它加标签（输入名字回车即可，新名字就新建标签） |
| 点标签 chip 上的 `×` | 把这条从该标签移出 |
| **右键**记录行 | 新建标签 / 加入已有标签 / 移出标签 / 删除这条 |
| 点顶部标签 | 只看该标签的记录 |
| `Esc` | 清空搜索框 |

**没有 ☆ 收藏按钮** —— 标签就是收藏。想"钉住"一条就给它打个标签。

### 两条保留规则

- **打过标签的记录永不清理**（你主动归类的东西不该被挤掉）
- 没打标签的算临时历史，最多留 **500 条**，超出后按最久未使用淘汰

### 为什么列表界面这么空

记录列表是**虚拟滚动**：500 条也只渲染屏幕内的十几行；滚动条长度按真实条数算。所以列表再长也不会卡，界面也不用分页。

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

Rubick 建插件视图时给的是 `nodeIntegration: true` + `contextIsolation: false`，所以页面里 `require` 直接可用，**不需要系统插件桥接**。

### 输入层是怎么接上的（都有实证，不是猜）

| 机制 | 依据 |
| --- | --- |
| 搜索框内容 → 插件 | 搜索框组件把值 `sendSync('sendSubInputChangeEvent',{text})` 给插件；`rubick.setSubInput(onChange)` 注册的回调同步收到 `{text}`。**真机探测：每次变化都触发** |
| 搜索框按键 → 插件 | 搜索框 keydown 时发 `sendPluginSomeKeyDownEvent`，主进程用 `Sr.getView().webContents.sendInputEvent` 灌进插件页面 |
| 插件 → 搜索框 | `rubick.setSubInputValue(text)`；用来在执行后清空输入 |
| 直读主窗口 DOM | **走不通** —— `@electron/remote` 在本版不可用（`Cannot find module`），真机探测确认 |

三个**踩过的坑**，写在这里省得再犯：

**坑一：按键只转发键码，文本不能靠按键重建。** `\`、`:` 这类字符不在映射表里，所以文本一律走 `setSubInput` 回调。映射表在主进程里写死的：

```js
ur = { Backspace:'Backspace', Tab:'Tab', Enter:'Enter', Escape:'Escape', Space:'Space',
       ArrowUp:'Up', ArrowDown:'Down', ..., KeyA:'A', ..., Digit0:'0', ..., Slash:'/', ... }
```

实测：**只有 `Enter` 这类功能键会到达插件，普通字符一个都收不到**（日志里 `[key]` 只有 Enter）。

**坑二：`sendInputEvent` 造出来的是合成事件，只有 `keyCode`、没有 `key`。** 判断回车**不能**写 `e.key === 'Enter'`（实测永不命中，表现为"回车完全没反应"）：

```js
function isEnterKey(e){
  if (e.key === 'Enter' || e.key === 'Return') return true;
  if (e.code === 'Enter' || e.code === 'NumpadEnter') return true;
  if (e.keyCode === 13 || e.which === 13) return true;   // 合成事件走这条
  return false;
}
```

**坑三：执行后必须清空搜索框。** 否则原文会继续参与 Rubick 的插件匹配，导致"要按两次回车"；而且再按一次回车会重复执行。清空还有个好处：下次进来搜索框是干净的，不会残留 `fav`。

### 为什么不走"一个系统插件"那条路

系统插件确实能出界面（官方文档说它拿得到 electron 主进程所有能力），但它进不了 Rubick 的搜索框：主进程会把系统插件的 `indexPath` 解析成 `entry` 的绝对路径，于是点击时去加载 `index.js` 当网页 → 白屏。而 `entry` 要同时满足"给主进程 `require`（CJS）"和"当页面入口（HTML）"是矛盾的。

所以两条路各自成立：**当前这条**（UI 插件 + 搜索框输入），和**另一条**（系统插件 + 自建窗口 + 全局热键，能脱离 Rubick 直接呼出）。当前选了前者。

---

## 排查问题

页面自己写一份日志（用 `fs` 直接落盘，不依赖任何 IPC）：

```
%TEMP%\rubick-startup.log
```

正常的样子：

```
2026-...Z [session] 打开插件 v0.4.3
2026-...Z [run] 已启动：notepad
2026-...Z [key] key="Enter" code="Enter" keyCode=13
2026-...Z [run-result] ok
```

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 没有日志文件 | 页面里连 `fs` 都取不到 | 基本不可能；先看右下角状态 |
| 状态显示 `无法执行：…` | `require('child_process')` 失败 | 确认用的是 Rubick 4.x，且插件从本项目目录装的 |
| 按回车没反应，且日志里**没有 `[key]` 行** | 搜索框没有转发按键 | 用 `tools/probe-setup.js` 重测协议 |
| 有 `[key] keyCode=13` 但没 `[run]` 行 | 插件的回车判断没命中 | 看 `isEnterKey` 是否被改坏 |
| 有 `已启动` 但程序没出现 | `cmd.exe` 认不出这个输入 | 换成完整路径，或写 `powershell -c "..."` |

**如果 Rubick 升级后输入失灵**，仓库里留了一套探测工具，可以重新问清协议：

```powershell
node tools/probe-setup.js install     # 装临时探测插件
# 搜索 probe 打开，按提示在搜索框打字 / 按回车，看页面和 %TEMP%\rubick-startup-input-probe.log
node tools/probe-setup.js uninstall
```

---

## 已知边界（照实说）

- 执行走 `cmd.exe /d /s /c <原文>`。**不是**模拟系统 Win+R，也不保证所有文本解析与运行框完全一致。
- `$env:USERPROFILE\...` 是 PowerShell 语法，`cmd.exe` 不会按 PowerShell 语义解释。想跑 PowerShell 得显式写 `powershell -c "..."`。
- 成功提示表示**启动请求被系统接受**，不代表目标 GUI 程序之后运行成功——有意不等待 GUI 程序退出。
- 命令以当前 Windows 用户权限运行。**只跑你自己信得过的输入。**

### 关于存储结构（有实测数据支撑）

历史存在**一个 PouchDB 文档**里（`rubick.db`，落盘在 `%APPDATA%\rubick\default` 的 LevelDB）。每次运行重写整个数组。

实测（500 条，N=500）：整份 `get`+`put` 中位 **1.29 ms**，Electron 同步 IPC 往返 76 KB 载荷 **0.4 ms**，端到端上界约 **1.7 ms**、p95 < 4 ms —— **不构成可感知卡顿**（掉帧阈值 16 ms）。所以**没有**改成"每条一个文档"：那会让磁盘占用涨 4.4 倍（PouchDB 每条 doc 都有 `_rev`/rev-tree 开销）。

值得改的触发条件：如果以后要把上限从 500 放到几千条（整份 put 约 2 µs/条线性增长），或者要支持多设备同步，就该拆成一条一文档。

---

## 目录结构

```
package.json              插件清单（pluginType: ui；Rubick 靠 features[].cmds 建索引）
public/
  index.html              全部界面与逻辑：输入层 / 标签 / 虚拟滚动 / 执行，原生 JS 无依赖
tools/
  install.js              安装 / 卸载 / 体检
  lint-page.js            页面静态检查（语法、残留引用、关键元素、已砍元素复活）
  probe-plugin/           临时探测插件：查清 Rubick 输入协议
  probe-setup.js          探测插件的安装 / 卸载
  privacy-scan.js         发布前的隐私体检（扫绝对路径/邮箱/密钥）
  history-scan.js         扫 git 历史里的隐私
tests/
  run-all.js              npm test（先跑 lint，再跑两个套件）
  static.test.js          清单、无桥接残留、结构关键点、安装器逻辑
  ui.test.js              最小 DOM + 虚拟时钟：输入层 / 标签 / 虚拟滚动 / 上限 / 排序
```

---

## 下一步可以做的

1. **标签重命名与删除**：现在只能新建和给记录加/移出；改名会留下孤儿标签。
2. **执行语义补齐**：`$env:` 这类 PowerShell 写法、URL、文档关联。当前锚点是 `cmd.exe`，要更贴近 Win+R 可以换 `ShellExecuteW`。
3. **全局热键**：让输入框脱离 Rubick 主窗口直接呼出（"系统插件 + 自建窗口"那条路）。
4. **导入 Win+R 旧历史**：把你原来那堆混杂的历史一次性导进来，再慢慢打标签。
