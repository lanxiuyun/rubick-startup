# 手写 DOM 桩必须模拟事件派发路径，否则测试会给出错误的方向

用最小 DOM 桩在 Node 里跑前端脚本（不装 jsdom）是很有性价比的做法 —— 快、无依赖、能测真实代码。但**桩不真实的地方会制造假 bug 和假通过**，而且会把排查引向错误的方向。

以下是实际踩过的四处，每处都对应一个真 bug 或一次误判。

## 一、事件必须派发给"焦点元素"，不能只派发给 window

真实 Electron 的 `sendInputEvent` 把事件派发给**焦点元素**，然后冒泡到 window。

错误做法（只喂 window，且用捕获阶段）：

```js
fireKey(key, extra) {
  const ev = { type:'keydown', key, ...extra };
  for (const fn of windowListeners.get('keydown') || []) fn(ev);   // ← 只有 window
}
```

后果：**元素自身的 `addEventListener('keydown', ...)` 从来没被触发过**。于是"在输入框里按回车提交"这类逻辑永远测不到，真机上却会出问题（实测踩过：在标签输入框里按回车，被 window 的捕获监听当成"执行命令"抢先处理）。

正确做法：先派发 window 的捕获监听，再派发给焦点元素。

```js
fireKey(key, extra) {
  const ev = { type:'keydown', key, target:null, ...extra };
  for (const fn of windowListeners.get('keydown') || []) fn(ev);
  const focused = /* 当前有输入框就给它 */;
  if (focused) for (const fn of focused._listeners.get('keydown') || []) fn({ ...ev, target: focused });
}
```

真实实现里对应的防御：**捕获阶段的 window 监听在有内联输入框时必须让路**。

## 二、`remove()` 和 `querySelectorAll()` 不能是空实现

如果被测代码是"清掉旧节点再重建"：

```js
spacer.querySelectorAll('.row,.empty').forEach(el => el.remove());
spacer.appendChild(frag);
```

那么桩里 `querySelectorAll` 返回空数组、`remove()` 是空操作时，**旧节点永远不会被清掉，节点不断累积**。

后果：断言读到的是**第一轮渲染留下的陈旧节点**，看起来像"状态没更新"。实测累积到 9 行、两个 `.sel`，选中态断言因此错判，我一度以为选中逻辑写错了 —— **其实实现是对的，是桩在骗我**。

正确做法：

```js
remove() {
  if (this._parent) {
    const at = this._parent.children.indexOf(this);
    if (at >= 0) this._parent.children.splice(at, 1);
  }
}
// querySelectorAll 要真的按 class 过滤，支持 ".a,.b" 多选择器
```

## 三、`appendChild(DocumentFragment)` 会展开子节点

真实 DOM 里把 fragment 加进父节点，**父节点收到的是 fragment 的子节点**，不是 fragment 本身。

错误做法：`children.push(fragment)` —— 之后按 class 找行会一个都找不到。

正确做法：`if (child.tagName === 'FRAGMENT') children.push(...child.children)`。

## 四、`innerHTML` 里的元素要能被 `getElementById` 找到

被测代码常这样创建内联输入框：

```js
menu.innerHTML = '<input id="newgroup">';
const input = $('newgroup');       // 真实 DOM 里这行是有效的
```

如果桩的 `getElementById` 只是查一个预先注册的表，`newgroup` 就永远是 `null`。

**不要**用"请求就临时造一个"来糊弄 —— 那会让 `document.getElementById('tagInput')` 在它**并不存在**的时候也返回元素，于是 `inlineInputActive()` 这类判断恒为真，把所有按键都挡掉。

正确做法：在 `innerHTML` 的 setter 里扫 `id="..."` 并注册节点（模拟真实解析）。

```js
set innerHTML(v) {
  this._innerHTML = String(v);
  for (const m of this._innerHTML.matchAll(/id="([\w-]+)"/g)) {
    if (!this._owner.has(m[1])) this._owner.set(m[1], new El('input', m[1]));
  }
}
```

## 通用检查清单

写 DOM 桩时逐条确认：

- [ ] 事件派发覆盖"焦点元素 + 冒泡到 window"，捕获监听也跑
- [ ] `remove()` 真的从父节点摘除
- [ ] `querySelectorAll` 真的按选择器过滤（至少支持按 class）
- [ ] `appendChild(fragment)` 展开子节点
- [ ] `innerHTML` 里出现的 id 能被 `getElementById` 找到
- [ ] `className` 可读可写，且 `"row sel"` 这种多 class 能被词匹配
- [ ] 时间与随机数可注入（否则去重窗口、超时逻辑只能靠 sleep）

## 什么时候该换真浏览器

桩的复杂度逼近真实 DOM 时（需要布局、`getBoundingClientRect`、真实滚动），就该换 jsdom 或 Playwright。这里的判据：**如果你在给桩加"布局"相关的能力，说明测试目标已经超出桩的能力范围。**

## 相关

- [[electron-sendinputevent-keyboard-events-are-synthetic]]
