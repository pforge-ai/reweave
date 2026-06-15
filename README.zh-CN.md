# Reweave

**Reweave 是一个面向 AI 生成 HTML 的本地可视化编辑器。**

AI 很擅长快速生成漂亮的单文件 HTML，但后续编辑经常会变成在一堆内联样式、嵌套 `div` 和长源码里找东西。Reweave 的目标很简单：让你能在 VS Code 里像看网页一样看到 HTML，点到哪里就编辑哪里，同时把修改安全写回原始源码，继续放进 Git / GitHub 管理。

[English README](./README.md)

## TL;DR

Reweave 让你打开一个 HTML 文件，看到渲染结果，选中想改的部分，编辑文字、样式、结构或可复用组件，并把修改写回原始 HTML。

它不是 AI 页面生成器。它是 AI 生成页面之后缺的那层编辑器。

## 为什么做这个

AI 生成的 HTML 往往“看起来能用”，但“改起来很烦”：

- 视觉结果一眼能懂，源码却很吵。
- 内容、布局、内联 CSS 混在一起。
- 一个小修改经常要在源码里来回找。
- 最终产物仍然应该是普通 HTML，能进 GitHub、能 review、能 diff、能部署。

Reweave 保持 HTML 文件是唯一真相，只在上面加一层本地可视化编辑体验。

## 功能

- **渲染预览**：在隔离 iframe 中查看 HTML，支持桌面、平板、手机、全宽视口。
- **点选编辑**：从画布或大纲选中组件，编辑映射到源码的文字和属性。
- **安全写回源码**：每次编辑都会生成最小 `WorkspaceEdit` patch，写回原始 HTML。
- **跟随源码**：选中组件时可在 VS Code 源码编辑器中定位对应范围。
- **就地编辑文字**：在预览中双击文字即可直接编辑。
- **组件大纲**：搜索、折叠、导航，同级组件支持拖拽重排。
- **重复组同步编辑**：自动识别重复卡片 / 列表项，可一次同步编辑同组成员。
- **组件库**：把选中 HTML 保存为工作区组件，也可以把内置或已保存组件插入到所选目标前后。
- **离线、确定性**：不调用模型，不依赖网络，没有隐藏生成步骤。

## 从 VSIX 安装

构建扩展包：

```bash
npm install
npm run package
```

然后在 VS Code 中安装生成的 `reweave-*.vsix`：

```bash
code --install-extension reweave-0.2.6.vsix
```

## 开发

```bash
npm install
npm run compile
npm test
```

在 VS Code 中打开本目录，按 `F5` 启动扩展开发宿主，打开 `samples/report.html`，执行 `Reweave: Open in Reweave`。

在 VS Code 之外调试 Webview UI：

```bash
npm run compile
node scripts/build-harness.js samples/report.html
open /tmp/reweave-harness.html
```

也可以传入任意本地 HTML：

```bash
node scripts/build-harness.js /path/to/page.html
```

## 架构

```text
VS Code 中的 HTML 文档
  -> 带源码区间的确定性解析器
  -> 规则引擎生成组件 IR
  -> Webview 渲染预览、大纲、检查器、组件库
  -> 用户操作变成结构化 mutation
  -> mutation 变成最小源码 patch
  -> VS Code WorkspaceEdit 写回 HTML 文件
```

## 当前边界

- 解析器刻意保守，依赖很少。
- 来自样式表的属性是启发式推断，主要覆盖简单选择器。
- Reweave 编辑已有 HTML，不从 prompt 生成新页面。
- 暂不面向复杂前端工程或构建流水线。最适合单文件 HTML，尤其是 AI 生成的页面、报告、原型和说明页。

## License

MIT
