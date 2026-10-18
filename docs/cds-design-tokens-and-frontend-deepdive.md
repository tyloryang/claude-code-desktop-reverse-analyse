# Claude Desktop CDS 与前端：REA 静态证据笔记

> 分析对象：本仓库解包的 Claude Desktop Windows MSIX，AppxManifest 版本 2.42304.0.0 x64；REA 6.5.0。
> 本文只记录当前包内能重复检查的 HTML、CSS、JavaScript 线索。没有启动客户端、运行前端或进行浏览器视觉测试；描述的顺序与职责不等于已观测到的运行时行为。

## 范围与计数方法

当前解包的 `resources/ion-dist` 有 25 个 CSS 文件，合计 2,161,979 字节；JavaScript 总量约 116 MB。对 CSS 文本做词法盘点，正则 `--cds-[A-Za-z0-9_-]+` 得到 1,070 个不同名称。该数字包括 CSS 中出现的变量定义和引用，不等于运行时实际使用的设计令牌数量，也不证明每个名称都被定义。

下表是对 25 个 CSS 文件的简单文本匹配次数，不是组件数、唯一规则数或运行时执行次数：

| 文本模式 | 匹配次数 | 可以说明什么 |
|---|---:|---|
| `@container` | 318 | 包内 CSS 含容器查询规则 |
| `color-mix(` | 884 | 包内 CSS 含颜色混合表达式 |
| `text-box:` | 1 | 包内出现一次 Text Box Trim 声明 |
| `GRAD` | 136 | 包内出现可变字体 Grade 轴标记 |
| `font-variation-settings` | 216 | 包内出现字体多轴设置声明 |

统计对大小写、空格和打包文本按上表的正则处理；修改样本或正则后结果可能变化。计数本身不证明功能支持、页面覆盖范围、可访问性等级或视觉效果。

## 设计变量与字体样式

CSS 可见 `--cds-surface-*`、`--cds-text-*`、`--cds-fill-*`、`--cds-role-*`、`--cds-font-*`、`--cds-chart-*` 等名称。它们支持“样式资源使用语义化自定义属性”的静态结论。具体变量是否定义、覆盖、被页面使用，需结合对应 CSS 规则和运行时 computed style 核验。

暗色系统主题相关选择器中出现 `font-variation-settings`，其中包含 `"GRAD" var(--cds-font-grad, 0)`。这能证明样式表提供了 Grade 轴设置路径，不能证明 AnthropicSans/AnthropicSerif 的每个字体文件都实现该轴，也不能仅凭 CSS 推断笔画变化、字宽保持不变或主题切换无布局偏移。要验证这些效果，应检查字体轴元数据并在目标系统对比实际渲染与布局指标。

CSS 还含有 `text-box: trim-start cap alphabetic` 声明。包内存在这条规则，并不等于目标 Electron Chromium 版本一定支持该属性，也不等于页面已启用或达到设计稿像素级对齐。

## HTML 启动资源与缓存预热

`resources/ion-dist/index.html` 提供 `#root`、`#portal-root`、骨架占位元素和编辑器入口 DOM；HTML 还预加载若干 vendor/shared module。Inline 脚本访问 IndexedDB 的 `keyval-store`，尝试读取 React Query 缓存与 Composer 草稿键。它们证明包内有预热/恢复代码路径，不证明首次启动耗时、首帧时间、零白屏或缓存命中率。

`vendor-frame-DfPJ1QmD.js` 包含 React DOM 19.2.4 的 `createRoot` 与 `hydrateRoot` 实现；REA 对本轮选定的前端文件没有把具体 React root 调用和业务页面组件连成完整调用链。因此本文不推定实际使用了哪个 API、页面何时挂载或 hydration 是否发生。

## Worker 文件观察

| 文件 | 包内可观察到的线索 | 当前证据边界 |
|---|---|---|
| `highlightWorker-DC5uhXj0.js`（约 1.5 MB） | bundle 中有 Shiki、TextMate、grammar、tokenize 等名称 | 支持“包含语法高亮相关代码”的判断；不代表已映射所有语言包、入口调用和页面时序 |
| `framebufferCanvasWorker-DX2Rs-io.js`（约 2 KB） | 接收 MessagePort 与帧消息，处理 session/序号/尺寸等字段；出现 ImageDecoder 或 createImageBitmap、OffscreenCanvas 绘制 | 支持“存在独立画布解码/绘制 worker”；不能据此称为硬件解码、直通 GPU 或零拷贝链路 |
| `completionGzipWorker-Q_JtDKxH.js`（约 0.6 KB） | 使用 CompressionStream("gzip") 压缩 Uint8Array，并通过 transfer list 返回 | 证明该文件实现压缩方向的代码；不证明所有调用场景或端到端性能 |
| `rumEncoder.worker-D8GGzwpc.js`（约 63 KB） | 存在独立 RUM worker 文件；主 bundle 有创建 worker 的静态线索 | 不能据此推断遥测运行时开启、成功上报或上报目的地 |

worker 文件存在与其运行时创建、消息频率、GPU 后端和实际收益是不同问题。它们需要从调用点继续追踪，并在匹配版本的 Electron 环境中采集运行时证据。

## 编辑器与 UI 依赖

ion-dist HTML 将 ProseMirror/Tiptap vendor chunk 列为预加载资源；CSS 中可见 Monaco editor/diff editor 样式。它们支持“包内包含这些编辑器相关依赖或样式”的判断。胶囊节点、快捷命令、附件卡片、Diff 展示形态等具体交互仍需定位组件调用链或运行客户端验证。

## REA 覆盖限制

REA 本轮对 `ion-dist` 只选了 6 个 JavaScript 文件做语义关系分析；其余已盘点文件没有进入该次语义分析。bundle 中部分动态导入、压缩变量名和运行时注册关系不完整。静态字符串命中可证明字符串存在，不能单独证明调用可达、策略生效或流量被拦截。更完整的方法、样本哈希和具体文件清单见 [REA 架构与前端深度分析](../rea-architecture-frontend-deep-dive.md)。

## 复核命令

从仓库根目录运行以下 PowerShell 片段，可重算 CSS 文件数、变量名数和主要文本匹配次数：

```powershell
$root = Join-Path (Get-Location) 'extracted_msix\app\resources\ion-dist'
$css = Get-ChildItem -LiteralPath $root -Filter '*.css' -File -Recurse
$text = ($css | ForEach-Object { [IO.File]::ReadAllText($_.FullName) }) -join [Environment]::NewLine
$names = [regex]::Matches($text, '--cds-[A-Za-z0-9_-]+') | ForEach-Object Value | Sort-Object -Unique
[pscustomobject]@{
  CssFiles = $css.Count
  CssBytes = ($css | Measure-Object Length -Sum).Sum
  UniqueCdsNames = $names.Count
  AtContainerOccurrences = [regex]::Matches($text, '@container\b').Count
  ColorMixOccurrences = [regex]::Matches($text, 'color-mix\s*\(').Count
  TextBoxOccurrences = [regex]::Matches($text, 'text-box\s*:').Count
}
```

该命令重算的是当前解包样本；仓库忽略了 MSIX 与解包目录，克隆仓库后需先自行准备同一版本样本，才能得到对应计数。