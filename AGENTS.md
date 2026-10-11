# 项目约定

Rubick 插件「启动收藏」：把用过的字符串（路径 / 命令）变成可分类、可检索的资产。

## 导航

**先读 [`.agent/manifest.yaml`](.agent/manifest.yaml)** —— 那是知识索引，按任务关键词查它，再打开对应文档。

常用入口：

| 我要做什么 | 读哪份 |
| --- | --- |
| 改输入 / 按键 / 执行 | [`.agent/features/input-layer/README.md`](.agent/features/input-layer/README.md) |
| 改记录 / 标签 / 列表渲染 | [`.agent/features/records-and-tags/README.md`](.agent/features/records-and-tags/README.md) |
| 装插件 / 插件不出现 / 改加载行为 | [`.agent/architecture/rubick-plugin-loading/README.md`](.agent/architecture/rubick-plugin-loading/README.md) |
| 按键没反应、"UI 没更新" | [`.agent/bugs/`](.agent/bugs/) 按症状找 |
| 写测试 / 调 DOM 桩 | [`.agent/skills/fake-dom-harness-must-dispatch-events-to-the-focused-element/README.md`](.agent/skills/fake-dom-harness-must-dispatch-events-to-the-focused-element/README.md) |

## 硬约定

1. **命令都走 `npm run`**：`npm test`（lint + 静态 + 端到端）、`npm run install:rubick`、`npm run check:rubick`。
2. **改完必须跑 `npm test`。** `tools/lint-page.js` 会抓语法、已删元素的残留引用、已砍 UI 的复活、虚拟滚动的三个前提。
3. **别用 shell 管道改源码或文档。** PowerShell 的字符串替换在本项目上已经坏过三次（全角括号混进 JS、README 章节被裁掉、转义吃掉引号）。改文件用编辑工具，不用 `Set-Content` / `-replace` / `node -e` 里的引号拼接。
4. **行高是虚拟滚动的硬约束。** `ROW_H` 是常量，任何让行高变化的改动都必须同时调整布局与常量，否则滚动条会跳。
5. **发布前跑隐私体检**：`node tools/privacy-scan.js .` 与 `node tools/history-scan.js`。示例数据和文档里不要出现真实本机路径。
6. **改完知识库跑 `node .agent/validate.js`**，确认索引没指向不存在的文件。

## 这个项目的三个反复踩的坑

- 按键从 Rubick 搜索框转发过来时是**合成事件，只有 `keyCode`**（见 skills 目录）
- 装插件必须重启 Rubick（注册表启动时读一次就缓存），而改页面文件只要重开插件
- `ctx.appPath` 是程序目录，不是插件所在的 userData 目录

## 上一台机器的会话归档

原始会话（截图、对话、子代理记录）在工作区的 `_imported-session-daaf34ad/` 里，**不在本仓库**。需要追溯当初的需求讨论时看它。
