# 2026-10-11 桥接装了却一直提示"未检测到运行桥接"

（这是"系统插件桥接"方案时期的问题。方案后来被删掉了，但两个根因值得留下 —— 它们对任何"UI 插件 + 系统插件"通信都成立。）

## 症状

系统插件桥接已安装、Rubick 已重启，但插件页面右下角一直显示"未检测到运行桥接"，握手从未成功。

## 根因一：`sender` 永远不等于 `mainWindow.webContents`

桥接里的来源校验写的是：

```js
const { ipcMain, mainWindow } = ctx;
if (!ipcMain || !mainWindow.webContents) return;      // ctx 里根本没有 ipcMain
if (event.sender !== mainWindow.webContents) return;  // 这一行恒为假
```

两个硬伤：

1. Rubick 传给系统插件 `onReady` 的 ctx 是 `{ ...API, mainWindow, API }` —— **没有 `ipcMain`**，想用必须自己 `require('electron')`。
2. **插件页面不是主窗口本体，而是挂在主窗口上的 `BrowserView`**：

   ```js
   new BrowserView({ webPreferences: { nodeIntegration: true, contextIsolation: false, ... } })
   ```

   所以 `event.sender` 是那个 BrowserView 的 `webContents`，跟外层窗口的 `webContents` **永远不相等**。

每一次握手都被这一行拒掉，日志里只看到 `trusted = false`。

## 根因二（修完第一个才暴露）：把 `ctx.appPath` 当成了 userData

改成按来源 URL 前缀校验后，日志显示白名单只有：

```
allowed url prefixes: file:///<安装目录>//
```

而插件页面在 `%APPDATA%\Rubick\...`。

`ctx.appPath` 是**程序目录**（`<安装目录>`），不是插件所在的 userData 目录。而且 userData 目录的**大小写可能和插件目录不一致**（例如 userData 是小写 `rubick`，插件目录是大写 `Rubick`），它由主进程的 `--user-data-dir` 参数决定，从 `process.argv` 里能查到。

## 教训

**两个根因叠在一起时，修掉第一个会让人以为"应该好了"，而第二个还在拦。** 在这种"改了但还不行"的情况下，最有价值的动作不是继续猜，而是**让程序把决策依据打印出来**（谁的 URL、白名单是什么、判定结果是什么）。这个项目里 `[DIAG]` / `allowed url prefixes` 那几行日志就是这么来的，一次就把两个根因都钉死了。

## 修复

- `ipcMain` 从 `require('electron')` 取，不用 ctx
- 来源校验改为 URL 前缀匹配，不用对象身份比较
- 白名单优先问 `app.getPath('userData')`，再依次兜底 `pluginBaseDir` / `appPath + rubick-plugins-new` / `%APPDATA%\Rubick` / `%APPDATA%\rubick`（大小写两种都试）

## 后续

这个方案**整个被删掉了**：实测发现 UI 插件页面自己能 `require('child_process')`，不需要任何桥接。所以上面这些问题不再存在 —— 但"不要把系统插件当 UI 用"的结论仍然成立，见 [[rubick-plugin-loading]]。

## 相关

- [[rubick-plugin-loading]]
- [[installing-a-plugin-without-rubick-dev-menu]]
