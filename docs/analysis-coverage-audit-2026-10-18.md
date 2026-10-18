# Claude Desktop 静态分析覆盖审计（2026-10-18）

> **对象**：仓库内 Claude Desktop Windows MSIX 样本 `2.42304.0.0`、其 `app.asar` 与 `resources/ion-dist`。历史样本 `2.37337.1.0` 只作为版本对照。本文评估现有逆向记录的覆盖和证据强度，不把静态分析描述成完整反编译或运行时验证。

## 结论

现有材料足以描述 Electron 外壳、部分主进程与前端构件、若干 IPC/配置/存储线索，但不能称为“Claude Desktop 已被还原成源码”。最重要的修正是：MSIX 中约 245.8 MB 的 `app\Claude.exe` 是 Electron 桌面启动程序，不是 Code helper；Code helper 是 buildPin 指向的另一项下载文件，本样本没有包含其 payload。另一个优先级更高的缺口是以 `LocalSystem` 声明的 Cowork 服务：已有 PE 身份和签名检查，尚无原生函数、服务 IPC/ACL 或运行态网络分析。

因此，当前架构图应理解为**有证据标注的静态结构图**。尚未建立一条从用户操作到 helper/网关，再到渲染与持久化的完整、运行时可复现链路。

## 已补正或新增的证据

| 范围 | 直接证据 | 可下的结论 | 仍不能下的结论 |
|---|---|---|---|
| 本地样本哈希基线 | `Claude.msix` 297,191,037 字节，SHA-256 `2bf309665f0de4eaa76a7e64033594e6f73ceb6413c60080f72f3ce640fa24ee`；解包目录中的 `app.asar` 49,338,428 字节，SHA-256 `8f4d3dec5e4f3ddffb150321060b18807d83a40f3a65618fe4f29325379da9db`；桌面 PE SHA-256 `84b6beb90538fcc401197130f888d121d92a9ce38e493ff7bad3b69cc1d8cc1d` | 为当前工作区文件建立可复核的哈希基线 | 尚未把 MSIX BlockMap/签名与每个解包文件逐项关联 |
| 桌面启动程序 | `AppxManifest.xml` 指向 `app\Claude.exe`；PE 产品名 `Claude`、版本 `2.42304.0`；REA 检出 Electron fuses。Evidence `ev_dcdca099f431131dcee8325abccea52dbb4a97fc852fca098af2fe1986b4b6f8` | 该 PE 是 MSIX 声明的 Electron 桌面启动程序 | fuses 不等于完整安全审计；未做原生反编译 |
| Code helper | `app.asar` buildPin 元数据指向 `win32-x64` `claude.exe.zst`，清单大小 `95,700,039` 字节；MSIX 文件清单中没有该 payload | helper 与桌面 EXE 是不同文件；现有样本不含 helper 本体 | helper 版本、实际字节、签名、启动参数及运行行为 |
| Cowork 服务 PE 哈希 | `cowork-svc.exe` 13,761,360 字节，SHA-256 `934e5b671813ef3d5684c0ee0d1d18835af74e9ecfb114575e0d8fdbb663ba8f`；REA PE 检查 Evidence `ev_67da2a1fc0141c0a6ad9611a818a3c2ee7fc86cbab518cc50382fabbc35fe3a2` | 标记本工作区被检查的原生服务字节 | 尚未做原生函数分析；哈希不表明运行状态 |
| Electron fuses | 对桌面 PE 的 fuse 检查记录了各 fuse 状态，见前端专题报告 | 可描述该样本的静态 fuse 配置 | 不能由 fuse 状态推出所有运行时防护都有效，或推断 Code helper 的配置 |
| 主进程与 preload | 六个选定 JS 文件的专项 REA Evidence `ev_747c33c0fe55845f39d1b5e1d918e9e6775473c08cad837380c69e1250bf2c44`：约 11.9 MB、3,209 findings、无语法 parse failure；语义图到 30,000 节点上限，另有 181,857 个 unknown。IPC 汇总 1,364 项操作，其中 1,355 项为动态通道操作；1,185 次 renderer transmission 中只有 1 次与 main handler 配对 | 静态分析找到大量 IPC/主进程候选结构 | IPC 清单不是完整的可达调用图；动态通道、注册时序和调用者关系大量未闭合 |
| 前端资源 | `ion-dist` 盘点约 3,644 个文件；专项语义分析只选 6 个 JS 文件，Evidence `ev_d8151593574491f547f089baa1376b2602064febb931203c8132928ef447f58a` | 可分析入口、部分 vendor 及选定模块 | 其余 3,614 个文件没有进入该次语义分析；压缩 bundle、动态 import 与 React 页面挂载链仍不完整 |
| 会话存储 | `index.html` 预读 `claude-conversation-store/trees`；bundle 有 `trees`、`meta`、`2.2` schema 标记及迁移/清理线索 | 存在前端本地会话树存储结构 | 写入者、提交时机、字段内容、加密、清理期限和账户隔离未追完 |

上述统计来自不同 REA 任务，不能相加成“覆盖率百分比”。六文件专项结果明确是 partial；`ion-dist` 的 6 文件分析也不是全前端分析。

## 仍未分析到位的部分（按优先级）

### 1. Cowork 服务的权限边界与原生实现

这是当前最值得继续做的安全/架构分析。Manifest 有 `\pipe\cowork-vm-service` 字符串和自定义 ETW trigger，但随包注释明确说 pipe activity 不触发该 ETW trigger、应用会自行启动已停止的服务；这仍未回答服务何时启动、管道如何授权或调用方如何认证。静态 PE 检查也没有揭示服务入口点、COM/RPC、服务 ACL、HCS/VM 创建参数、网络转发规则或文件系统挂载范围。应取得 Ghidra/IDA 等原生分析器后，对已校验签名和 SHA-256 的 `cowork-svc.exe` 建立函数级记录；再在隔离 VM 中观察服务安装、启动、停止、进程树、句柄/IPC、命名管道 ACL、监听端口和有效防火墙规则。静态声明与运行态配置应分别记录。

### 2. Code helper 本体和真实进程交接

当前样本没有 `claude.exe.zst`，所以不能从 Electron 包内的 helper 管理代码反推 helper 内部实现。还没有闭合从用户提交到 `spawn` 参数、环境变量、stdin/stdout 管道、子进程存活管理、App Job 归属和退出处理的完整调用链。

当前代码的 `joinAppJob()` 调用不传子进程 PID；另一个 `isProcessInAppJob(pid)` 分支只检查首个观察到的 child 并记录告警。它们不能证明每个 helper 都被加入 Job Object。下一步需取得与 buildPin 版本/哈希匹配的 helper，验证下载清单、压缩后/解压后哈希与签名，并在隔离环境跟踪实际父子进程和 Job Object。

### 3. 请求链、认证与离线/内网行为

包内存在 `/v1/messages`、`ANTHROPIC_BASE_URL`、gateway 配置键、更新/下载域名和认证回调名称；这些是静态字符串或分支证据。当前没有验证首次启动是否下载 helper、登录/刷新认证会访问哪些主机、Code/Cowork/Chat 分支分别使用哪个 provider，也没有验证禁用更新/遥测配置是否覆盖全部请求。内网可用性仍未证明。

补证应使用匹配版本的干净 Windows VM，按无缓存首次启动、已有缓存冷启动、内网兼容网关、认证失效/刷新、更新关闭、Cowork 开关等场景分别采集进程级 DNS/连接、TLS 主机名、文件写入和失败行为。网络出口限制需由防火墙/代理策略验证，客户端配置项不能作为隔离证明。

### 4. 主进程 IPC 和前端页面调用链

REA 专项图的节点预算已耗尽，IPC 动态通道占比很高，handler 配对数极少。`ion-dist` 专项分析只含 6 个文件，不能支持“已完整分析前端”。尤其未闭合的部分包括：React 实际 mount 与路由懒加载、Composer 提交与 `LocalSessions.sendMessage` 的页面调用者、会话树写入者、事件回传到具体组件的链路，以及 Worker 创建者和消息 schema。

后续应按入口分块拆分多个有预算上限的 REA Evidence：先连接首页入口与首屏/lazy chunk，再单独分析 Composer、会话/消息渲染、Cowork/Code 页面和存储模块。对动态 IPC 结合运行时断点或受控 tracing 记录 channel、sender frame、参数 schema 与 handler，避免将静态名称配对冒充真实路由。

### 5. 原生扩展完整性矛盾与安全结论

当前 ASAR 检出 5 处 unpacked 原生文件哈希矛盾，REA 标记为 `observed-untrusted`。这表示当前读取字节与 ASAR 声明哈希不一致，不能直接定性为恶意篡改；但在来源、签名、安装器解包和版本匹配关系厘清前，也不能把这些字节作为已验证实现来推断凭据加密、DLP、Job Object 或系统 API 行为。

应分别记录 MSIX 整包签名/哈希、BlockMap、ASAR 声明哈希、实际文件哈希、Authenticode 状态和安装目录样本哈希，并确认分析对象是否来自同一个原始包。REA 输出本身不替代厂商签名链或供应链验证。

### 6. 数据流稿中需要避免的确定性表述

数据流稿已修正此前缺证的凭据匿名 FD、立即 unlink、强制 Job 绑定、401 后自动续约、每轮原子写完整会话和 GPU 零拷贝等说法。仍需把以下内容限制为静态候选关系：`enqueueCliInput` 的消息是否实际写进 helper 管道；`can_use_tool` 的 UI/审批/回复完整往返；SSE 解析、主进程事件与 renderer 的端到端回传；Shiki Worker 是否由特定页面创建、性能是否改善；标题生成具体请求是否实际执行。

`mainView.js` 的 UUID IPC 通道前缀是路由标识，不是加密证据；前端 HTML 中 IndexedDB 读取代码证明预读路径存在，不证明消息已完整加密落盘。`ImageDecoder`、`OffscreenCanvas` 只支持解码/绘制代码线索，不支持硬件解码或 GPU 零拷贝结论。

## 下一轮建议的取证顺序

1. 以本表中的 MSIX、ASAR、桌面 PE 和 Cowork 服务 SHA-256 为本地样本基线；再核验 MSIX 签名与 BlockMap，并逐项确认解包文件与原始包对应，给后续证据绑定同一份样本身份。
2. 优先配置一个原生分析器，先检查 `cowork-svc.exe` 的服务控制入口、IPC 和 HCS/VM 相关调用；再检查桌面 PE 的启动/更新/子进程边界。
3. 获取与 buildPin 清单精确匹配的 Code helper payload，核验签名和哈希后再做原生与运行时分析。
4. 对六个主进程/preload 文件按职责拆分 REA 任务，增加前端入口、Composer、消息渲染和存储写入者的独立语义分析；记录每次任务的 Evidence ID、选择文件和 unknown/partial 状态。
5. 在隔离 VM 做首次启动、登录、Code 请求、审批、认证失效、Cowork VM、更新/遥测开关与断网场景；同时采集网络和进程证据。最后才据此更新“内网部署是否可行”的结论。

## 本轮工具状态与校验

本轮复核到 REA CLI `6.5.0`。`rea doctor --client claude_code --format json` 中 Node 与 Claude Code 注册项健康，但 `environment_healthy=false`：Hopper、Ghidra、IDA、JADX provider 均未配置；Claude Desktop 的 REA 注册也显示缺失。此状态只描述当前 REA 环境，不是 Claude Desktop 自身故障。
