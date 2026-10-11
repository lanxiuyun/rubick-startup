# Rubick 插件的加载与安装机制

Rubick 4.3.8（下文用 `<安装目录>` 代指 Rubick 的程序目录，它是安装时选的）通过**两份东西**认一个插件：`node_modules` 里的目录 + 它自己的注册表文件。少一样都不认。

以下全部来自反编译 `<安装目录>\resources\app.asar` 得出的实证，不是官方文档的转述（官方文档在这一点上不完整，见"文档没说清的地方"）。

## 组件与模块

```
%APPDATA%\Rubick\rubick-plugins-new\        ← 插件根目录（常量 sr）
├── rubick-local-plugin.json                ← 注册表：唯一的插件名单（常量 Fr）
├── package.json                            ← npm 容器，只有 dependencies 字段
└── node_modules\
    ├── rubick-system-feature\              ← Rubick 自带的内置插件
    ├── rubick-startup\                     ← 本插件（junction 指到项目目录）
    └── <任何插件名>\
```

## 主进程怎么加载（关键代码）

```js
// 1) 读注册表；PLUGINS 是模块级缓存，只有第一次读文件
getLocalPlugins(){
  return global.LOCAL_PLUGINS.PLUGINS.length
    || (global.LOCAL_PLUGINS.PLUGINS = JSON.parse(fs.readFileSync(Fr, 'utf-8'))),
    global.LOCAL_PLUGINS.PLUGINS
}

// 2) 系统插件：启动时 require 进主进程
this.systemPlugins = (() => {
  let e = global.LOCAL_PLUGINS.getLocalPlugins().filter(e => 'system' === e.pluginType)
  e = e.map(e => ({ ...e, indexPath: path.join(sr, 'node_modules', e.name, e.entry) }))
  e.forEach(e => { if (fs.existsSync(e.indexPath)) { const r = require(e.indexPath)(); onReady.push(r.onReady) } })
  return { triggerReadyHooks: ev => onReady.forEach(fn => fn(ev)) }
})()

// 3) ready 之后才调用它们的 onReady，ctx 里没有 ipcMain
this.systemPlugins.triggerReadyHooks(Object.assign(t(), { mainWindow: window, API: Ar }))

// 4) UI 插件：点击时把 <main> 当网页加载
openPlugin({data: t}, r){
  t.indexPath = `file://${path.join(path.resolve(sr, 'node_modules', t.name), './', t.main)}`
  // 插件页面是挂在主窗口上的 BrowserView
  t = new BrowserView({ webPreferences: {
    webSecurity: false, nodeIntegration: true, contextIsolation: false, devTools: true,
    preload: <插件自己的 preload>, session: <插件专属 partition>
  }})
}
```

要点：

- **UI 插件读 `main`，系统插件读 `entry`** —— 两个不同字段，不能互换。
- 注册表是**启动时读一次就缓存**的（`PLUGINS.length ||` 短路），所以**装了插件必须重启 Rubick**才能被看见。
- 系统插件的 `onReady(ctx)` 拿到的 ctx 是 `{ ...API, mainWindow, API }` —— **没有 `ipcMain`**，也没有 `app`。
- 插件页面是 **BrowserView，不是主窗口本体**。所以 `event.sender === mainWindow.webContents` 恒为假 —— 任何"来源就是主窗口"的判断都会把合法请求全部拒掉。

## 安装一个插件需要做两件事

`tools/install.js` 把这两件都做了：

1. **建链接**：`%APPDATA%\Rubick\rubick-plugins-new\node_modules\<name>` → 项目目录。
   用 **junction** 而不是 symlink：Windows 上目录 symlink 需要管理员权限或开发者模式，junction 不需要。
2. **写注册表**：往 `rubick-local-plugin.json` 里加一条，形状是
   `{ ...点击时传入的字段, ...链接目录里的 package.json, isDev: true, indexPath }`。

**`npm link` 只做到第 1 件，跳过第 2 件** —— 这就是为什么"link 了但插件不出现"。

## 关键约定

- 注册表里 `pluginType: 'ui'` 的项必须有 `features[].cmds`，否则搜不到（启动器搜索只看 `features` 在不在，不按类型过滤）。
- `logo` **必须是 http/https 在线地址或 `data:` URI**，本地文件路径不显示图标（官方文档明说，实测确认）。
- 项目目录可以放在任何地方，junction 会把两边连起来；改页面文件**不用重启 Rubick**（页面每次打开重新读），改 `name`/`main`/`features` 才需要重装。

## 文档没说清的地方

官方文档只说"系统插件可能不会有 UI 界面"，没说系统插件**进不了搜索框**。实测与代码结论：

- 系统插件会被**解析出 indexPath = `entry` 的绝对路径**，而点击处理放行了 `'ui' === pluginType || 'system' === pluginType` —— 于是系统插件被点击时会去加载 `index.js` 当网页 → 白屏。
- `entry` 要同时满足"给主进程 `require`（CJS）"和"当页面入口（HTML）"，一个文件不能同时是两者。

所以两条路各自成立：**UI 插件 + 搜索框输入**（当前方案），或 **系统插件 + 自建窗口 + 全局热键**（能脱离 Rubick 直接呼出，但拿不到搜索框）。

## 相关

- [[input-layer]] — 插件页面与 Rubick 搜索框之间的通信
- [[installing-a-plugin-without-rubick-dev-menu]] — 为什么需要 install.js
