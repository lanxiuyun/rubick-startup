# 输入层：Rubick 搜索框 ⇄ 插件页面

插件的输入**不在插件页面里**，而是复用 Rubick 自己的搜索框。用户输入 `fav` 打开插件后，继续在同一个搜索框里打字，按回车执行。

这样做的原因：如果插件自带输入框，用户就得"搜关键词打开插件 → 再敲一遍命令 → 回车"，等于按两次回车，而 Win+R 的体验是一次。输入框越少越好。

## 涉及文件

- `src/StartupApp.tsx` — React 状态、`setSubInput` 注册、默认选择、键盘选择与执行入口
- `src/runtime.ts` — Rubick 存储、进程执行、剪贴板与日志
- `src/model.mjs` — `keyName` 同时识别 key / code / keyCode，筛选与选择边界
- `public/index.html` — `npm run build` 生成的离线入口，不直接手改
- `tools/probe-plugin/` + `tools/probe-setup.js` — 临时探测插件，Rubick 升级后用来重新问清协议

## 三条通道（全部真机实证）

| 方向 | 机制 | 实证 |
| --- | --- | --- |
| 搜索框内容 → 插件 | 搜索框组件把值 `sendSync('sendSubInputChangeEvent', {text})` 给插件；`rubick.setSubInput(onChange)` 注册的回调同步收到 `{text}` | 探测插件日志：连续打出 `PROBE-123`，回调逐次收到 `PROBE-12`→`P`，**每次变化都触发** |
| 搜索框按键 → 插件 | 搜索框 keydown 时发 `sendPluginSomeKeyDownEvent`，主进程用 `Sr.getView().webContents.sendInputEvent({type:'keyDown', keyCode: ur[e.code]})` 灌进插件页面 | 日志 `[key] key="Enter" code="Enter" keyCode=13`，3/3 触发执行 |
| 插件 → 搜索框 | `rubick.setSubInputValue(text)` | 设值后搜索框跟着变（回调反向回放证明双向） |

## 数据流

```
用户在 Rubick 搜索框打字
  ├─ 主窗口 onInput → searchValue 更新（用于启动器自己的插件匹配）
  └─ sendSubInputValue → 主进程 executeJavaScript → 插件回调 setSubInput(onChange)
                                                       └─ setCommand(text) → 过滤列表

用户按 Enter
  └─ sendPluginSomeKeyDownEvent → 主进程 sendInputEvent → 插件 window keydown
                                                              └─ launch() → 执行 + 清空搜索框
```

## 关键约定

**有输入时第一行是当前输入原文。** `listRows()` 在匹配历史前添加临时输入行，默认选中它，回车执行原文；按 ↓ 才选历史建议。输入行不入存储、不显示时间、不支持标签编辑，即使没有匹配历史或当前标签为空也显示。空输入时默认选中最新历史，空列表不选择。执行成功后仍清空选择，防止重复执行。

**⚠️ 按键只转发键码，文本不能靠按键重建。** 映射表写死在主进程里，只覆盖功能键与字母数字：

```js
ur = { Backspace, Tab, Enter, Escape, Space, PageUp, PageDown, End, Home,
       ArrowLeft:'Left', ArrowUp:'Up', ArrowRight:'Right', ArrowDown:'Down',
       PrintScreen, Insert, Delete, Digit0..Digit9, KeyA..KeyZ, F1..F12,
       Semicolon, Equal, Comma, Minus, Period, Slash, Backquote,
       BracketLeft, Backslash, BracketRight, Quote }
```

实测**只有 `Enter` 这类功能键会到达插件，普通字符一个都收不到**（日志里 `[key]` 只有 Enter）。所以：

- **文本一律走 `setSubInput` 回调**，不要试图用按键拼字符串。
- **`↑` `↓` 可用**（在映射表里），所以键盘选择列表是可行的 —— 这是当前实现的依据。

**⚠️ 执行后必须清空搜索框。** 两个原因：

1. 否则原文会继续参与 Rubick 的插件匹配（那正是"要按两次回车"的成因）
2. 否则再按一次回车会重复执行同一条

清空还有个附带好处：下次进来搜索框是干净的，不会残留 `fav`。实测用户"一进来没有 fav，只有自己输入 fav 才有"。

**⚠️ `@electron/remote` 在本版不可用**（`Cannot find module`），所以"直读主窗口 DOM"那条路走不通，不要去试。

## 改这个功能时要动哪里

1. `src/model.mjs` 的 `keyName` —— key / code / keyCode 都要认（见 [[electron-sendinputevent-keyboard-events-are-synthetic]]）
2. `setSubInput` 的回调选择 `listRows()` 第一行并重置滚动位置，键盘导航和渲染必须使用同一结果集
3. 执行路径 `launch()` 里顺序不能乱：**先同步取出原文**，再清空搜索框（清空会触发回调覆盖状态）
4. 用 `tools/probe-setup.js` 复测协议，不要靠猜

React 状态使用同步 ref 镜像，保证 `setSubInputValue('')` 同步回放时不会读取陈旧输入。标签编辑器打开时 window 捕获监听让路给 Ant Design Input；编辑器自己的处理器也调用 `keyName`，支持 Rubick 合成键码。

## 主输入焦点与菜单取消

非文本控件的鼠标操作后，通过 `runtime.ts` 的 `focusHostInput()` 恢复 Rubick 主窗口 webContents 和 `.rubick-select input` 的焦点；不要用普通按键拼接命令文本。标签搜索框和标签编辑器允许主动获得焦点，退出编辑后回到主输入框。右键记录立即更新选中行，勾选标签不清除选中状态。

Rubick 4.3.8 的主窗口 `before-input-event` 调用 `__EscapeKeyDown`，在页面收到 Esc 前就移除插件，因此页面 `preventDefault()` 不足以取消宿主退出。菜单或编辑器打开期间，`suspendHostEscape()` 只临时摘除这个宿主监听，关闭或组件清理时恢复；页面捕获 Esc 关闭临时界面，不清空命令文本。没有临时界面时保留宿主原有退出行为。

`@electron/remote` 从插件目录直接加载可能失败，可通过 `process.resourcesPath/app.asar/node_modules/@electron/remote` 加载 Rubick 自带模块。此通道只用于焦点和临时 Esc 控制，不读取或改写宿主输入值。宿主仿真测试覆盖右键高亮、两种输入框的 Esc、空白取消后直接输入与退格。

## 相关

- [命令执行成功退出插件-执行失败继续停留并显示错误的约定.md](命令执行成功退出插件-执行失败继续停留并显示错误的约定.md)
- [[rubick-plugin-loading]]
- [[electron-sendinputevent-keyboard-events-are-synthetic]]
- [[synthetic-keydown-has-no-key-property]]
