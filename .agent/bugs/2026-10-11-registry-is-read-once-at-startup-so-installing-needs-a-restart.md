# 2026-10-11 装完插件必须重启 Rubick 才生效

## 症状

`install.js` 报告安装成功（链接和注册表都体检通过），但插件市场里看不到这个插件，搜关键词也搜不到。

## 根因

主进程读插件名单的代码是**读一次就缓存**：

```js
getLocalPlugins(){
  return global.LOCAL_PLUGINS.PLUGINS.length
    || (global.LOCAL_PLUGINS.PLUGINS = JSON.parse(fs.readFileSync(Fr, 'utf-8'))),
    global.LOCAL_PLUGINS.PLUGINS
}
```

`PLUGINS.length ||` 这个短路意味着：**只要内存里已经有名单，就永远不再读文件**。名单是在启动时被首次填充的，之后再改 `rubick-local-plugin.json` 对运行中的进程无效。

## 影响范围：分三种情况

这一点很容易搞混，混了就会白白重启很多次：

| 改了什么 | 需要做什么 |
| --- | --- |
| 插件的 `name` / `main` / `features`（清单字段） | **完全重启 Rubick** |
| 系统插件（`pluginType: 'system'`）的代码 | **完全重启 Rubick**（它由主进程在启动时 `require` 进去） |
| UI 插件的页面文件（`public/` 下的 html/js/css） | **只要关掉插件再打开**（页面每次打开重新读） |

## 附带教训

"UI 没更新"这个症状有三个不同的原因，别一上来就怀疑代码：

1. 页面文件改了但插件没重开
2. 改的是系统插件，需要重启的是 Rubick 本身
3. Rubick 没刷新本地链接的插件文件 —— 在「开发者」页点"刷新插件"再重新安装

当时我把它当成第 3 种，让你去开 DevTools 查错，属于排查顺序错了（应该先问"改的是哪一类文件"）。

## 相关

- [[rubick-plugin-loading]]
- [[2026-10-11-install-plugin-via-script-instead-of-rubick-dev-menu]]
