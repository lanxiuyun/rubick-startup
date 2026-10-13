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

**有结果时始终选中第一条可见记录。** 页面初始化、`onPluginReady` 重新加载、搜索输入变化及标签切换后，都按当前过滤结果选择第一行；无匹配结果时不选中。上下键继续在当前结果中移动选择。执行后清空搜索框并清空选择，防止重复执行。

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
2. `setSubInput` 的回调里清空 selected，并重置滚动位置；输入变了过滤结果也变了
3. 执行路径 `launch()` 里顺序不能乱：**先同步取出原文**，再清空搜索框（清空会触发回调覆盖状态）
4. 用 `tools/probe-setup.js` 复测协议，不要靠猜

React 状态使用同步 ref 镜像，保证 `setSubInputValue('')` 同步回放时不会读取陈旧输入。标签编辑器打开时 window 捕获监听让路给 Ant Design Input；编辑器自己的处理器也调用 `keyName`，支持 Rubick 合成键码。

## 相关

- [命令执行成功退出插件-执行失败继续停留并显示错误的约定.md](命令执行成功退出插件-执行失败继续停留并显示错误的约定.md)
- [[rubick-plugin-loading]]
- [[electron-sendinputevent-keyboard-events-are-synthetic]]
- [[synthetic-keydown-has-no-key-property]]
