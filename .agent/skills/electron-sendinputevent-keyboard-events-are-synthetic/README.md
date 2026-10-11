# Electron 的 sendInputEvent 造出来的是合成键盘事件

**结论：`webContents.sendInputEvent({type:'keyDown', keyCode:'Enter'})` 派发的事件只带 `keyCode`，不带 `key` / `code`。**

## 症状

用 `e.key === 'Enter'` 判断回车，**永远不命中**。表现是"按键完全没反应"，而且不报错、不抛异常 —— 因为它不是错误，只是条件判断恒为假。

## 为什么会这样

`sendInputEvent` 的设计目的是模拟**输入**（按键产生的字符），不是复制一个浏览器原生 KeyboardEvent。它接受的是 accelerator 风格的 keyCode（`'Enter'`、`'Up'`、`'A'`），构造出来的事件对象只填充它能对应的字段。

对比：

| 事件来源 | `e.key` | `e.code` | `e.keyCode` |
| --- | --- | --- | --- |
| 真实用户按键 | `'Enter'` | `'Enter'` | `13` |
| `webContents.sendInputEvent` | `undefined` | `undefined` | `13` |

## 正确做法

**三个特征都认**，别只认一个：

```js
function isEnterKey(e){
  if (e.key === 'Enter' || e.key === 'Return') return true;
  if (e.code === 'Enter' || e.code === 'NumpadEnter') return true;
  if (e.keyCode === 13 || e.which === 13) return true;   // 合成事件走这条
  return false;
}
function isUpKey(e){
  if (e.key === 'ArrowUp' || e.key === 'Up') return true;
  if (e.code === 'ArrowUp') return true;
  if (e.keyCode === 38 || e.which === 38) return true;
  return false;
}
```

## 排查方法

**把收到的原始字段记进日志**，不要靠猜：

```js
window.addEventListener('keydown', e => {
  logLine('key', `key=${JSON.stringify(e.key)} code=${JSON.stringify(e.code)} keyCode=${JSON.stringify(e.keyCode)}`);
}, true);
```

日志里出现 `key=undefined code=undefined keyCode=13` 就能一眼确认是这条路。

## 相关坑：只有部分按键会被转发

如果这个合成事件是宿主程序转发过来的（例如 Rubick 把搜索框的按键转发给插件页面），那么**宿主通常只转发它映射表里的键**。功能键（Enter / Escape / Arrow*）通常在表里，普通字符往往不在。

后果：

- 能靠按键实现"回车执行"、"上下键选择"
- **不能**靠按键重建用户输入的文本 —— 文本要走宿主的文本回调（例如 `setSubInput(onChange)`）

**动工前先确认目标键在不在宿主的映射表里**，一条日志就能验证，比事后猜快得多。

## 相关

- [[fake-dom-harness-must-dispatch-events-to-the-focused-element]]
- [[input-layer]]
