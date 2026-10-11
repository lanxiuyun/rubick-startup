# 2026-10-11 在 Rubick 搜索框按回车完全没反应

## 症状

插件页面显示"可以运行"、输入回显正常，但在搜索框按回车没有任何反应：不执行、不报错、日志里也没有 `[run]` 行。

## 根因

Rubick 主进程用 `webContents.sendInputEvent({type:'keyDown', keyCode:'Enter'})` 把搜索框的按键转发进插件页面。**这是合成事件，只带 `keyCode`，不带 `key`**。而插件里的判断写的是：

```js
if (e.key === 'Enter') { ... }   // 合成事件下 e.key 是 undefined → 永不命中
```

不是错误、不抛异常，只是条件恒为假。

## 定位过程

最初的日志只有 `[run]` 计数为 0 —— 说明"执行路径从未被触发"，但不能区分是"按键没到达"还是"到达了没识别"。

加了原始字段日志后一眼确认：

```
[key] key="Enter" code="Enter" keyCode=13
[run] 已启动：calc
```

修好之后再对照，日志里同时有 `[key]` 和 `[run]`，每次回车 12~24ms 内触发执行。

**关键教训**：先记录"收到了什么"，再判断"为什么没处理"。直接猜会猜错方向。

## 修复

`isEnterKey` 三个特征都认（`key` / `code` / `keyCode`），并把每次按键的原始字段写进日志。

## 为什么没被测试发现

当时的测试用 `fireKey('Enter')` 构造了带完整 `key` 的事件 —— **测试数据比现实"更完整"**，于是恰好绕过了这个 bug。

修复方式不是只改实现，而是**把测试改成模拟真实形态**（只给 `keyCode: 13`、不给 `key`），这条路径从此有回归覆盖。

## 相关

- [[electron-sendinputevent-keyboard-events-are-synthetic]]
- [[input-layer]]
