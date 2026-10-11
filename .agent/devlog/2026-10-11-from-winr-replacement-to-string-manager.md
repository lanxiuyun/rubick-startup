# 2026-10-11 从"Win+R 替代品"到"字符串管家"

## 本次目标

承接上一台机器上中断的会话（`session-daaf34ad`，归档里只有对话和截图、**没有源码**），把这套东西在本机重建并跑通。

## 完成

- 从会话归档**重放 70 次 write/edit** 还原出项目源码（归档不含项目文件）
- 反编译 `app.asar` 搞清 Rubick 的插件加载机制，写出 `tools/install.js`
- 修掉"回车没反应"等一串 bug，**`notepad` 真机跑通**
- 架构从**两个插件（UI + 系统桥接）简化为单插件** —— 实测页面自己能 `require('child_process')`
- 输入层改为**复用 Rubick 搜索框**，并支持 `↑↓` 选择
- 产品形态重构：**标签取代收藏**、虚拟滚动、砍掉无用 UI
- 建两个仓库并公开：[rubick-startup](https://github.com/lanxiuyun/rubick-startup)、[rubick-startup-design](https://github.com/lanxiuyun/rubick-startup-design)

## 剩余

- UI 方案（`rubick-startup-design/ui-proposal.html`）**尚未落进实现**
- `$env:USERPROFILE\...` 这类 PowerShell 语法不被展开（走 `cmd.exe`）
- 不能导入旧的 Win+R 历史；没有全局热键
- 标签不能排序 / 分组

## 关键文件变更

| 文件 | 变更 |
| --- | --- |
| `public/index.html` | 全部重写：输入层接搜索框、标签模型、虚拟滚动、单行顶栏 |
| `tools/install.js` | 新增：junction + 注册表，含 `--check` / `--uninstall` 与旧残留清理 |
| `tools/lint-page.js` | 新增：页面静态检查（语法、残留引用、已砍元素复活、虚拟滚动前提） |
| `tools/probe-plugin/`、`tools/probe-setup.js` | 新增：临时探测插件，用来查清宿主协议 |
| `tools/privacy-scan.js`、`tools/history-scan.js` | 新增：发布前扫工作区与 git 历史的隐私 |
| `tests/ui.test.js` | 重写：最小 DOM + 虚拟时钟，24 项 |

## 这次最值得记住的

1. **"改了但还不行"时，让程序打印决策依据，不要继续猜。** 两个根因叠在一起时（来源校验 + appPath 误用），修掉第一个会让人以为应该好了。加日志一次钉死。
2. **测试桩的不真实会把怀疑引向错误方向。** 桩只派发事件给 `window`、`remove()` 是空实现，导致真 bug 漏网、假 bug 出现。见 [[fake-dom-harness-must-dispatch-events-to-the-focused-element]]。
3. **数据比直觉可靠。** 有人建议 500 条时要改存储结构，实测端到端 ~1.7ms（判据 16ms），**不改** —— 改了反而让磁盘占用涨 4.4 倍。
4. **产品定义比 UI 打磨重要。** 前几轮我一直在砍界面、调布局，但真正的问题是"这个工具是干嘛的"没定清楚。等用户说清"它就是管理字符串、标签是分类"，界面自然就收敛了。

## 相关

- [[rubick-plugin-loading]]
- [[input-layer]]
- [[records-and-tags]]
