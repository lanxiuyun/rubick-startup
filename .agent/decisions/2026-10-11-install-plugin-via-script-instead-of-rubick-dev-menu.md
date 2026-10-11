# 不通过 Rubick 开发者菜单安装插件

## 背景

官方文档推荐的本地开发流程是：

```powershell
cd <插件目录>
npm link
```

然后在 Rubick 的「插件市场 → 开发者」里填写**插件名**安装。

实际执行时插件始终不出现，反复"移除再安装"也没用。

## 问题

反编译 `app.asar` 后发现，`npm link` **只完成了安装所需的两件事之一**：

| 需要做的事 | `npm link` | `install.js` |
| --- | --- | --- |
| 目录出现在 `rubick-plugins-new\node_modules\<name>` | ✅ | ✅（junction） |
| 名字出现在 `rubick-local-plugin.json` 注册表 | ❌ | ✅ |

而主进程读插件名单**只认注册表**：

```js
getLocalPlugins(){
  return global.LOCAL_PLUGINS.PLUGINS.length
    || (global.LOCAL_PLUGINS.PLUGINS = JSON.parse(fs.readFileSync(Fr, 'utf-8'))),
    global.LOCAL_PLUGINS.PLUGINS
}
```

并且这个值**启动时读一次就缓存**（`||` 短路），所以即使补上注册表也必须重启 Rubick 才生效。

## 决定

写 `tools/install.js` 一条命令做完两件事：

1. 建 **junction**（不是 symlink）指向项目目录 —— Windows 上目录 symlink 需要管理员权限或开发者模式，junction 不需要
2. 往注册表写入一条，形状复刻 Rubick 自己写的样子：
   `{ ...点击时传入的字段, ...链接目录里的 package.json, isDev: true, indexPath }`

同时提供 `--check`（只体检：链接在不在、注册表对不对）和 `--uninstall`（含清理旧系统插件的残留登记）。

## 代价与收益

**代价**：绕开了官方 GUI 流程，所以必须跟着 Rubick 的版本变化维护这个脚本；注册表格式若变，脚本要跟着改。

**收益**：

- 一条命令装好，不需要在 GUI 里点好几步
- **可体检**：`--check` 能明确告诉你"是链接缺了还是注册表缺了"，而不是面对一个不出现的插件猜
- **可复现**：换一台机器、重装 Rubick 之后，`npm run install:rubick` 就能恢复
- 能清理历史残留（旧的系统插件登记会让 Rubick 每次启动去 `require` 一个不存在的模块）

## 如果脚本失效了

按顺序查这三处，它们是全部判定依据：

1. `%APPDATA%\Rubick\rubick-plugins-new\rubick-local-plugin.json` 里有没有这条 `name`
2. `node_modules\<name>` 是不是一条指向项目目录的 junction
3. `pluginType` 和入口字段是否配对：**UI 插件读 `main`，系统插件读 `entry`**

## 相关

- [[rubick-plugin-loading]]
- [[2026-10-11-registry-is-read-once-at-startup-so-installing-needs-a-restart]]
