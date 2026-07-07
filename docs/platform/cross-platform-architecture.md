# 跨平台架构：Windows 与 Android 实现解析

> 深度解析 Claude Haha 的 Windows 桌面端、Android 移动端的数据连接与控制同步机制，以及 Electron→Sidecar→CLI→Adapter 四层架构的设计原因

<p align="center">
<a href="#一整体架构总览">架构总览</a> ·
<a href="#二为什么是-electronsidecarcliadapter-四层架构">架构设计原因</a> ·
<a href="#三tauri-迁移历史">Tauri 迁移</a> ·
<a href="#四windows-桌面端实现">Windows 端</a> ·
<a href="#五android-移动端实现">Android 端</a> ·
<a href="#六数据连接机制">数据连接</a> ·
<a href="#七控制同步机制">控制同步</a> ·
<a href="#八消息协议对比">消息协议</a> ·
<a href="#九启动流程对比">启动流程</a> ·
<a href="#十关键差异总结">差异总结</a>
</p>

---

## 一、整体架构总览

Claude Haha 采用 **Server-Client 架构**，本地服务器（Server Sidecar）作为统一中枢，所有客户端（Desktop UI、IM 适配器、Android App）通过 HTTP + WebSocket 与之通信。

桌面端采用 **Electron→Sidecar→CLI→Adapter** 四层进程隔离架构。

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Claude Haha 架构总览                          │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │  Windows Desktop │  │  IM 适配器        │  │  Android App     │  │
│  │  (Electron+React)│  │  (Bun 进程)      │  │  (React Native)  │  │
│  │                  │  │  Telegram/飞书/  │  │                  │  │
│  │  本地直连         │  │  微信/钉钉/WA    │  │  局域网远程连接    │  │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  │
│           │ HTTP+WebSocket     │ HTTP+WebSocket     │ HTTP+WS+Token│
│           │ 127.0.0.1:{port}   │ 127.0.0.1:3456     │ 192.168.x.x:3456│
│           └────────┬───────────┴────────────────────┘             │
│                    │                                                │
│           ┌────────▼─────────┐                                     │
│           │  Server Sidecar  │  ← Bun HTTP/WS 服务器                │
│           │  (Bun.serve)     │    API 网关 + 会话管理 + 协议代理     │
│           └────────┬─────────┘                                     │
│                    │ stdin/stdout JSON                              │
│           ┌────────▼─────────┐                                     │
│           │  CLI 子进程       │  ← AI 对话核心 + 工具执行             │
│           │  (Agent Loop)    │    代码编辑 / 搜索 / 终端 / MCP      │
│           └──────────────────┘                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 核心设计原则

1. **服务端中心化**：所有逻辑在 Server Sidecar 中处理，客户端仅负责展示和输入
2. **统一协议**：所有客户端使用相同的 WebSocket 消息格式和 HTTP API
3. **会话持久化**：对话历史以 JSONL 格式存储在服务器端，客户端可随时重连
4. **多端协同**：同一 Session 可被多个客户端同时访问，消息实时同步

---

## 二、为什么是 Electron→Sidecar→CLI→Adapter 四层架构？

桌面端没有采用"Electron 主进程里跑一切"的单体方案，而是拆为四层独立进程。这种设计有明确的工程考量：

### 2.1 进程隔离的必要性

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Electron Host (main/preload)                      │
│  职责：窗口、菜单、托盘、对话框、自动更新、原生 API 桥接        │
│  为什么独立：                                                  │
│  - 渲染层崩溃不能拖垮整个应用                                   │
│  - Chromium 渲染进程 sandbox 隔离                             │
│  - preload contextBridge 精确控制暴露给渲染层的能力            │
│  - 系统级能力（文件对话框、通知）由 main 进程统一管控            │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Server Sidecar (Bun 进程)                          │
│  职责：HTTP/WS 服务器、会话管理、API 路由、协议代理、配置读写     │
│  为什么独立：                                                  │
│  - Server 是核心业务，不依赖 Electron，可以脱离桌面壳独立运行     │
│  - Android 手机、IM 适配器、H5 浏览器都直连这个 Server          │
│  - Server 崩溃不影响 Electron 窗口（自动重启 Sidecar）          │
│  - 开发时可以用 `bun run src/server/index.ts` 单独启动          │
│  - 动态端口分配，避免端口冲突                                   │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: CLI 子进程 (Bun Agent Loop)                        │
│  职责：AI 对话核心、工具执行、Agent 编排、代码编辑               │
│  为什么独立：                                                  │
│  - 每个 Session 一个独立 CLI 进程，会话间完全隔离                │
│  - AI 推理是 CPU/内存密集型，避免阻塞 Server 的事件循环          │
│  - 工具执行可能出错/超时/挂死，子进程可独立 kill 不影响其他会话    │
│  - stdin/stdout JSON 通信天然支持流式输出                       │
│  - 可独立测试 CLI 逻辑而不启动 UI                               │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: Adapter Sidecar (Bun 进程, 可选)                    │
│  职责：IM 平台接入（Telegram/飞书/微信/钉钉/WhatsApp）          │
│  为什么独立：                                                  │
│  - 用户可能只用一个 IM 平台，按需启动不浪费资源                  │
│  - IM SDK 可能有内存泄漏或不稳定，独立进程可以随时重启            │
│  - 适配器通过 WebSocket 连接 Server，和 Android 是同一套协议     │
│  - 配置变更只需重启 Adapter 进程，不影响正在进行的对话           │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 如果不分层会怎样？

**反模式：Electron 主进程跑一切**

```
// ❌ 不推荐的单体方案
Electron main 进程 = HTTP服务器 + 会话管理 + AI推理 + IM适配 + 窗口管理
```

问题：
- AI 阻塞主进程 → UI 卡死
- IM SDK 崩溃 → 整个应用挂掉
- 无法脱离 Electron 运行 Server → Android 无法连接
- 无法单独测试 Server 或 CLI 逻辑
- 内存泄漏无法通过进程重启恢复

### 2.3 这种架构的直接收益

| 设计决策 | 收益 |
|---------|------|
| Server 作为独立 HTTP/WS 服务 | Android/IM/H5 多端复用同一套 API，零额外开发 |
| CLI 子进程 per-session | 会话隔离、崩溃隔离、可独立 kill、流式通信天然支持 |
| Adapter 独立进程 | 按需加载、配置热更新、SDK 崩溃不影响核心 |
| preload contextBridge | 安全边界，渲染层无法直接访问 Node.js/Electron API |
| 动态端口 | 避免端口冲突，支持便携模式和多实例 |
| HTTP+WebSocket 边界（非 IPC） | 前端 API client 可在浏览器/RN/Electron 通用 |

### 2.4 关键设计约束：不把业务协议改成 IPC

迁移文档中明确强调（[07-electron-migration-research.md:28](file:///d:/Code/Ai/cc-haha/docs/desktop/07-electron-migration-research.md#L28)）：

> 不要把本地 Bun server 合并进 Electron main，也不要把 renderer 从 HTTP/WebSocket 改成全 IPC；现有 `desktop/src/api/*`、`chatStore`、`workspacePanelStore`、`teamStore` 已经围绕 local server contract 做了重连、去重、流式 flush 和多客户端观察，这些成熟行为应作为迁移边界保留。

这意味着：
- 渲染层通过 HTTP/WS 与 Server 通信，而不是 Electron IPC
- WebSocket 重连、消息去重、流式缓冲等逻辑在前端 API client 层统一处理
- 切换桌面壳（Tauri→Electron）时，业务层代码零改动

---

## 三、Tauri 迁移历史

### 3.1 当前状态：Tauri 已不是运行时，但代码仍保留

**生产运行时已经是 Electron**，Tauri 代码（[desktop/src-tauri/](file:///d:/Code/Ai/cc-haha/desktop/src-tauri)）作为历史资源保留：

| 组件 | 状态 | 说明 |
|------|------|------|
| Electron main/preload | ✅ **当前运行时** | [desktop/electron/](file:///d:/Code/Ai/cc-haha/desktop/electron) 40+ 文件 |
| desktopHost 抽象层 | ✅ **当前架构** | [desktopHost/index.ts](file:///d:/Code/Ai/cc-haha/desktop/src/lib/desktopHost/index.ts) 自动检测 Electron/Browser |
| Tauri Rust 代码 | ⚠️ 历史保留 | [desktop/src-tauri/src/](file:///d:/Code/Ai/cc-haha/desktop/src-tauri/src) 不再被生产代码调用 |
| `@tauri-apps/*` 引用 | ✅ 已清除 | 生产代码零引用，仅在测试 mock 中出现 |
| sidecar 二进制 | ✅ 复用 | [desktop/src-tauri/binaries/](file:///d:/Code/Ai/cc-haha/desktop/src-tauri/binaries) 仍被 Electron 加载 |
| Tauri 图标/资源 | ⚠️ 历史保留 | icons/ 目录被 electron-builder 复用 |
| CI/CD | ✅ 已切换 | release workflow 使用 electron-builder |

验证：生产代码中 `@tauri-apps` 引用全部在 `.test.ts/.test.tsx` 文件中，业务逻辑零依赖。

### 3.2 desktopHost 抽象层

迁移过程中引入了 Host Adapter 模式，使得渲染层不感知底层是 Tauri 还是 Electron：

[desktopHost/index.ts](file:///d:/Code/Ai/cc-haha/desktop/src/lib/desktopHost/index.ts#L18-L23)：

```typescript
export function createDesktopHost(
  environment: DesktopHostEnvironment = detectDesktopHostEnvironment(),
): DesktopHost {
  if (environment.electronHost) return environment.electronHost  // Electron preload 注入
  return browserHost  // 浏览器/H5 fallback
}
```

**注意**：`tauriHost.ts` 在迁移完成后已被移除，当前只有 `electronHost`（Electron 环境）和 `browserHost`（浏览器 fallback）两个实现。

### 3.3 为什么从 Tauri 迁移到 Electron？

根据迁移调研文档（[07-electron-migration-research.md](file:///d:/Code/Ai/cc-haha/docs/desktop/07-electron-migration-research.md)），核心原因是：

| 原因 | 详细说明 |
|------|---------|
| **滚动性能问题** | macOS Tauri 使用 WKWebView（WebKit），卡顿严重；Electron 固定使用 Chromium/Blink，滚动性能接近官方 Claude Code |
| **跨平台渲染一致性** | Tauri 在各平台使用系统 WebView（macOS=WKWebView, Windows=WebView2, Linux=WebKitGTK），渲染差异大；Electron 内置 Chromium，三平台表现一致 |
| **WebKit 兼容性** | 系统 WebView 对现代 CSS/JS 特性支持不一致，增加前端适配成本 |
| **PTY 终端成熟度** | node-pty 在 Electron 生态中更成熟，Windows shell 解析行为更可控 |
| **子 WebView 预览** | Electron `WebContentsView` API 比 Tauri child webview 更稳定 |
| **生态成熟度** | electron-builder、electron-updater 自动更新链路在 Windows/macOS/Linux 更成熟 |

迁移时间线：
- **2026-05-31**：调研与方案设计
- **2026-06-01**：完成 Host Adapter 抽象、Electron 壳实现、系统能力迁移、CI/CD 切换
- **当前**：Electron 是唯一生产运行时，Tauri Rust 代码保留在 `src-tauri/` 但不再参与构建

---

## 四、Windows 桌面端实现

### 4.1 技术栈

| 层级 | 技术 | 版本 | 职责 |
|------|------|------|------|
| **UI 层** | React | 18 | 用户界面渲染 |
| | Zustand | 5 | 状态管理（12 个 Store） |
| | Vite | 6 | 构建工具 |
| | Tailwind CSS | 4 | 样式系统 |
| | Lucide React | - | 图标库 |
| **桌面层** | Electron | - | 跨平台桌面 Host |
| | electron-builder | - | 打包与自动更新 |
| | electron-updater | - | 版本更新 |
| | node-pty | - | 终端 PTY 运行时 |
| **服务端** | Bun | latest | HTTP/WebSocket 运行时 |
| | Bun.serve | - | 原生 HTTP/WS 服务器 |

### 4.2 三层架构

桌面端采用经典的 **Electron 三层架构**：

```
┌─────────────────────────────────────────────┐
│      Electron Host (main/preload)           │
│  ┌──────────────────────────────────────┐   │
│  │   Chromium Renderer (React UI)       │   │  ← 用户交互界面
│  └───────────────┬──────────────────────┘   │
│                  │ HTTP + WebSocket         │
│  ┌───────────────▼──────────────────────┐   │
│  │   Server Sidecar (Bun 进程)          │   │  ← API + 会话管理
│  │   Port: 动态分配                       │   │
│  └───────────────┬──────────────────────┘   │
│                  │ 子进程 spawn (stdin/stdout)│
│  ┌───────────────▼──────────────────────┐   │
│  │   CLI 子进程 (Agent Loop)            │   │  ← AI 推理 + 工具执行
│  └──────────────────────────────────────┘   │
│                                            │
│  ┌──────────────────────────────────────┐   │
│  │   Adapter Sidecar (可选)             │   │  ← IM 适配进程
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

#### 第一层：Electron Host

**职责**：窗口管理、Sidecar 进程编排、原生 API 桥接

核心文件位于 [desktop/electron/](file:///d:/Code/Ai/cc-haha/desktop/electron)：

| 能力 | 说明 | 对应文件 |
|------|------|----------|
| `runtime.getServerUrl` | 获取 Server Sidecar 动态端口 | `desktop/electron/ipc/` |
| `dialogs.open/save` | 系统文件/目录对话框 | `desktop/electron/services/dialogs.ts` |
| `shell.open/openPath` | 外链与路径打开（含白名单校验） | `desktop/electron/services/shell.ts` |
| `updates.*` | 自动更新检查/下载/安装 | `desktop/electron/services/updater.ts` |
| `terminal.*` | node-pty 终端会话管理 | `desktop/electron/services/terminal.ts` |
| `adapters.restartSidecar` | 重启 IM 适配器进程 | `desktop/electron/` |
| `appMode.*` | 默认/便携模式与配置目录 | `desktop/electron/` |

**进程管理核心**（[desktop/electron/services/serverRuntime.ts](file:///d:/Code/Ai/cc-haha/desktop/electron/services/serverRuntime.ts)）：

- 启动时动态分配端口，通过 `runtime.getServerUrl()` 注入给前端
- 健康检查通过后才允许前端连接
- 配置变更时自动重启对应 Sidecar 进程

#### 第二层：Server Sidecar

**职责**：HTTP REST API + WebSocket 网关 + 会话管理 + 协议代理

核心目录 [src/server/](file:///d:/Code/Ai/cc-haha/src/server)：

```
src/server/
├── index.ts              # 入口
├── server.ts             # Bun.serve HTTP/WS 服务器
├── router.ts             # 路由注册
├── sessionManager.ts     # 会话生命周期管理
├── api/                  # REST 路由层（14+ 模块）
│   ├── sessions.ts       # 会话 CRUD
│   ├── adapters.ts       # 适配器配置
│   ├── providers.ts      # AI 提供商管理
│   ├── models.ts         # 模型配置
│   ├── scheduled-tasks.ts # 定时任务
│   └── ...
├── services/             # 业务服务层（14+ 模块）
│   ├── adapterService.ts # 适配器配置读写
│   └── ...
├── ws/                   # WebSocket 消息处理
├── proxy/                # API 协议代理（Anthropic/OpenAI 转换）
├── middleware/            # auth / cors / errorHandler
└── config/               # Provider 预设
```

#### 第三层：CLI 子进程

**职责**：AI 对话核心、工具执行、Agent 编排

- Server 为每个 Session spawn 一个独立 CLI 子进程
- 通过 stdin/stdout 进行 JSON 格式通信
- 每个子进程拥有独立的工作目录和上下文

#### Sidecar 构建

统一入口 [desktop/sidecars/claude-sidecar.ts](file:///d:/Code/Ai/cc-haha/desktop/sidecars/claude-sidecar.ts)，三种运行模式：

| 模式 | 命令 | 说明 |
|------|------|------|
| `server` | `claude-sidecar server` | 启动 HTTP/WS 服务 |
| `cli` | `claude-sidecar cli` | 启动 CLI Agent 进程 |
| `adapters` | `claude-sidecar adapters --feishu --telegram` | 按需启动 IM 适配器 |

编译产物位于 `desktop/src-tauri/binaries/`，通过 `asarUnpack` 打入安装包。

### 4.3 桌面端状态管理

使用 Zustand，按领域拆分为 12 个 Store（[desktop/src/stores/](file:///d:/Code/Ai/cc-haha/desktop/src/stores)）：

| Store | 核心状态 |
|-------|----------|
| `chatStore` | per-session 消息、流式状态、权限请求、Token 统计 |
| `sessionStore` | 会话列表、activeSessionId、项目筛选 |
| `tabStore` | 标签页顺序（localStorage 持久化） |
| `settingsStore` | 权限模式、当前模型、effort、语言 |
| `providerStore` | Provider 列表、activeId |
| `adapterStore` | 适配器配置、配对码、登录状态 |
| `uiStore` | 主题、侧边栏、activeView、Toast |
| `taskStore` | 定时任务、运行记录 |
| `teamStore` | Agent 团队、成员转录 |
| `agentStore` | Agent 定义列表 |
| `skillStore` | 技能元数据、详情 |
| `cliTaskStore` | per-session CLI 任务追踪 |

**数据流**：
```
用户操作 → Component → Store → API/WebSocket → Server → Store → Component 重渲染
```

---

## 五、Android 移动端实现

### 5.1 技术栈

| 层级 | 技术 | 版本 | 职责 |
|------|------|------|------|
| **跨平台框架** | Expo + React Native | Expo 51 / RN 0.74 | 移动端应用框架 |
| **状态管理** | Zustand | 5 | 会话与消息状态 |
| **导航** | React Navigation | 6 | 页面路由 |
| **本地存储** | AsyncStorage | 1.23 | 服务器配置持久化 |
| **图标** | @expo/vector-icons | 14 | UI 图标 |
| **原生壳** | Android Native (Kotlin) | - | MainActivity / MainApplication |

### 5.2 项目结构

核心目录 [android/](file:///d:/Code/Ai/cc-haha/android)：

```
android/
├── App.tsx                          # 应用入口 + Navigation
├── app.json                         # Expo 配置
├── package.json                     # 依赖
├── android/                         # Android 原生工程
│   └── app/src/main/java/com/claudehaha/mobile/
│       ├── MainActivity.kt          # React Native Activity
│       └── MainApplication.kt       # Application 入口
└── src/
    ├── api/
    │   ├── client.ts                # HTTP API 封装（fetch + AbortController）
    │   ├── sessions.ts              # 会话 CRUD API
    │   └── websocket.ts             # WebSocket 管理器（重连/心跳/队列）
    ├── components/
    │   ├── chat/
    │   │   ├── ChatInput.tsx        # 消息输入框
    │   │   ├── MessageList.tsx      # 消息列表（FlatList）
    │   │   ├── AssistantMessage.tsx # AI 消息气泡
    │   │   └── UserMessage.tsx      # 用户消息气泡
    │   └── shared/
    │       └── Button.tsx           # 通用按钮组件
    ├── constants/
    │   └── config.ts                # 默认服务器地址/Token Key
    ├── lib/
    │   ├── serverEvents.ts          # WebSocket 事件 Reducer
    │   ├── messageContent.ts        # 消息内容处理
    │   └── serverEvents.test.ts     # 事件处理测试
    ├── screens/
    │   ├── HomeScreen.tsx           # 首页（自动连接 + 状态展示）
    │   ├── SessionListScreen.tsx    # 会话列表页
    │   ├── ChatScreen.tsx           # 聊天页（核心交互）
    │   └── ServerConfigScreen.tsx   # 服务器配置页
    ├── stores/
    │   ├── chatStore.ts             # 聊天状态（messages）
    │   └── sessionStore.ts          # 会话管理（sessions + activeSession）
    └── types/
        ├── chat.ts                  # 聊天消息类型
        └── session.ts               # 会话类型
```

### 5.3 Android 原生层

原生层非常精简，仅作为 React Native 的容器：

**[MainActivity.kt](file:///d:/Code/Ai/cc-haha/android/android/app/src/main/java/com/claudehaha/mobile/MainActivity.kt)**：
- 继承 `ReactActivity`，配置为默认导出的 RN 入口
- 无额外原生逻辑

**[MainApplication.kt](file:///d:/Code/Ai/cc-haha/android/android/app/src/main/java/com/claudehaha/mobile/MainApplication.kt)**：
- 继承 `Application`，初始化 React Native Host
- 注册 `ReactSettingsPlugin`（Expo 插件）

### 5.4 Android 状态管理

比桌面端精简，核心 2 个 Store：

**[sessionStore.ts](file:///d:/Code/Ai/cc-haha/android/src/stores/sessionStore.ts)**（主 Store）：

```typescript
type SessionStore = {
  sessions: SessionListItem[]           // 会话列表
  activeSessionId: string | null       // 当前激活会话
  activeMessages: MessageEntry[]       // 当前会话消息
  isLoading: boolean                   // 加载状态
  isLoadingMessages: boolean           // 历史消息加载
  isSending: boolean                   // 发送中状态
  streamingAssistantId: string | null  // 流式消息ID（增量拼接）
  pendingPermission: PendingPermission | null  // 待审批权限
  error: string | null                 // 错误信息

  // Actions
  fetchSessions: () => Promise<void>
  loadSession: (sessionId: string) => Promise<void>
  createSession: (workDir?: string) => Promise<string>
  deleteSession: (sessionId: string) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>
  handleServerEvent: (event: any) => void  // WebSocket 事件处理入口
}
```

**[chatStore.ts](file:///d:/Code/Ai/cc-haha/android/src/stores/chatStore.ts)**（基础 Store）：

```typescript
interface ChatStore {
  sessions: Session[]
  currentSessionId: string | null
  messages: ChatMessage[]
  setSessions: (sessions: Session[]) => void
  addMessage: (message: ChatMessage) => void
}
```

### 5.5 Android 页面流

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  HomeScreen │ ──► │SessionList   │ ──► │  ChatScreen │
│  (启动页)    │     │  (会话列表)   │     │  (聊天页)    │
│  自动连接检测 │     │  新建/选择会话 │     │  消息+权限   │
└──────┬──────┘     └──────────────┘     └──────┬──────┘
       │                                        │
       ▼                                        │
┌──────────────┐                                 │
│ServerConfig  │ ◄───────────────────────────────┘
│(服务器配置)   │
│URL + Token   │
└──────────────┘
```

---

## 六、数据连接机制

### 6.1 HTTP API 层

两端共享同一套 REST API，但客户端封装不同。

#### Android HTTP 客户端（[android/src/api/client.ts](file:///d:/Code/Ai/cc-haha/android/src/api/client.ts#L90-L153)）

```typescript
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${baseUrl}${path}`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  // Token 认证：Bearer Header
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)  // 8s 超时

  const res = await fetch(url, { method, headers, body, signal: controller.signal })
  // ... 错误处理与超时检测
}
```

**特点**：
- 基于 `fetch` API（React Native 内置）
- 8 秒请求超时（AbortController）
- Bearer Token 认证
- 配置存储在 AsyncStorage

#### Desktop HTTP 客户端

- 基于浏览器原生 `fetch`（Chromium 环境）
- 通过 `window.desktopHost.runtime.getServerUrl()` 获取动态端口
- 无固定超时（本地直连，延迟极低）

#### 共享 API 端点

| 方法 | 端点 | 说明 | Android | Desktop |
|------|------|------|---------|---------|
| GET | `/health` | 健康检查 | ✅（testConnection） | ✅ |
| GET | `/api/sessions` | 会话列表 | ✅ | ✅ |
| POST | `/api/sessions` | 创建会话 | ✅ | ✅ |
| GET | `/api/sessions/:id` | 会话详情 | ✅ | ✅ |
| GET | `/api/sessions/:id/messages` | 历史消息 | ✅ | ✅ |
| PATCH | `/api/sessions/:id` | 重命名 | ✅ | ✅ |
| DELETE | `/api/sessions/:id` | 删除会话 | ✅ | ✅ |
| GET/PUT | `/api/adapters` | 适配器配置 | ❌ | ✅ |
| GET/PUT | `/api/providers` | 提供商配置 | ❌ | ✅ |
| GET/POST | `/api/scheduled-tasks` | 定时任务 | ❌ | ✅ |

### 6.2 WebSocket 连接层

两端都通过 WebSocket 与 Server 进行实时双向通信，但实现细节有差异。

#### Android WebSocket 管理器（[android/src/api/websocket.ts](file:///d:/Code/Ai/cc-haha/android/src/api/websocket.ts)）

```typescript
class WebSocketManager {
  private connections = new Map<string, Connection>()

  connect(sessionId: string) {
    // URL 转换：http → ws
    const baseWsUrl = getBaseUrl().replace(/^http/, 'ws')
    let wsUrl = `${baseWsUrl}/ws/${sessionId}`

    // Android 特殊：Token 通过 URL 查询参数传递
    // （React Native WebSocket 不支持自定义 headers）
    const token = getAccessToken()
    if (token) {
      wsUrl += `?token=${encodeURIComponent(token)}`
    }

    const ws = new WebSocket(wsUrl)
    // ... 重连、心跳、消息队列
  }
}
```

**核心特性**：

| 特性 | 实现 |
|------|------|
| 多会话连接 | `Map<sessionId, Connection>` 支持并发多个会话 |
| 自动重连 | 指数退避 `min(1000ms × 2^n, 30000ms)` |
| 心跳保活 | 30 秒间隔 ping |
| 消息队列 | 未连接时消息暂存 `pendingMessages[]`，连接后自动发送 |
| 消息分发 | `Set<MessageHandler>` 支持多订阅者 |
| 认证方式 | URL Query 参数 `?token=xxx`（RN WebSocket 限制） |

#### Desktop/Adapter WebSocket Bridge（[adapters/common/ws-bridge.ts](file:///d:/Code/Ai/cc-haha/adapters/common/ws-bridge.ts)）

```typescript
export class WsBridge {
  private sessions = new Map<string, Session>()       // chatId → Session
  private handlers = new Map<string, MessageHandler>() // chatId → handler
  private handlerChains = new Map<string, Promise<void>>() // 串行队列

  connectSession(chatId: string, sessionId: string): boolean {
    const url = `${this.serverUrl}/ws/${sessionId}`
    const ws = new WebSocket(url)
    // ...
  }

  // 关键：消息串行处理，防止 await 点状态竞争
  ws.on('message', (raw) => {
    const prev = this.handlerChains.get(chatId) ?? Promise.resolve()
    const next = prev
      .catch(() => {})
      .then(() => Promise.resolve().then(() => handler(msg)))
    this.handlerChains.set(chatId, next)
  })
}
```

**核心特性**：

| 特性 | 实现 |
|------|------|
| chatId → sessionId 映射 | 一个 IM 聊天映射到一个 Agent Session |
| Handler Chain 串行化 | 同一 chat 的消息严格顺序处理，避免状态竞争 |
| 自动重连 | 指数退避，最多 10 次后放弃 |
| 心跳保活 | 30 秒间隔 ping |
| 认证方式 | 本地直连，无需 Token（127.0.0.1） |
| 消息发送 | `sendUserMessage` / `sendPermissionResponse` / `sendStopGeneration` |

#### WebSocket 连接对比

| 维度 | Android | Desktop (Adapter) |
|------|---------|-------------------|
| 连接地址 | `ws://192.168.x.x:3456/ws/:id?token=xxx` | `ws://127.0.0.1:3456/ws/:id` |
| 认证方式 | URL Query 参数 | 无（本地回环） |
| 连接标识 | sessionId | chatId + sessionId 映射 |
| 消息处理 | Set 多播（并行） | Handler Chain（串行 FIFO） |
| 最大重连次数 | 无上限（持续重连） | 最多 10 次后放弃 |
| 消息缓冲 | pendingMessages 队列 | 无（适配器自身处理） |
| 网络环境 | 局域网（需 0.0.0.0 绑定） | 本地回环 |

---

## 七、控制同步机制

### 7.1 配置同步

#### Android 配置同步

Android 的配置非常精简，仅需要服务器地址和可选 Token：

**存储**：AsyncStorage（[android/src/api/client.ts](file:///d:/Code/Ai/cc-haha/android/src/api/client.ts#L8-L24)）

```typescript
// 配置键
const SERVER_URL_KEY = '@server_url'
const SERVER_ACCESS_TOKEN_KEY = '@server_access_token'
const DEFAULT_SERVER_URL = 'http://192.168.1.100:3456'

// 初始化时加载
export async function initBaseUrl() {
  const [savedUrl, savedToken] = await Promise.all([
    AsyncStorage.getItem(SERVER_URL_KEY),
    AsyncStorage.getItem(SERVER_ACCESS_TOKEN_KEY),
  ])
  if (savedUrl) baseUrl = savedUrl
  if (savedToken) accessToken = savedToken
}
```

**配置流程**（[ServerConfigScreen.tsx](file:///d:/Code/Ai/cc-haha/android/src/screens/ServerConfigScreen.tsx)）：

1. 用户输入服务器 URL（如 `http://192.168.1.100:3456`）
2. 可选输入 Access Token
3. 点击"Test Connection"→ 调用 `/health` + `/api/sessions?limit=1` 验证
4. 保存到 AsyncStorage
5. 后续请求自动使用新配置

**连接测试**（[android/src/api/client.ts:155-171](file:///d:/Code/Ai/cc-haha/android/src/api/client.ts#L155-L171)）：

```typescript
export async function testConnection(): Promise<boolean> {
  await api.get('/health')           // 步骤1: 健康检查
  await api.get('/api/sessions?limit=1') // 步骤2: API 可用性
  return true
}
```

#### Desktop 配置同步

Desktop 配置更复杂，涉及 IM 适配器凭据管理：

**存储**：`~/.claude/adapters.json`（[adapterService.ts](file:///d:/Code/Ai/cc-haha/src/server/services/adapterService.ts#L72-L99)）

```typescript
function getConfigPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  return path.join(configDir, 'adapters.json')
}
```

**配置项**：

```typescript
type AdapterFileConfig = {
  serverUrl?: string
  defaultProjectDir?: string
  pairing?: PairingState           // 配对码
  telegram?: { botToken, allowedUsers, pairedUsers, ... }
  feishu?: { appId, appSecret, encryptKey, ... }
  wechat?: { accountId, botToken, baseUrl, ... }
  dingtalk?: { clientId, clientSecret, ... }
  whatsapp?: { accountJid, authDir, ... }
}
```

**配置生效流程**（[adapterStore.ts:82-89](file:///d:/Code/Ai/cc-haha/desktop/src/stores/adapterStore.ts#L82-L89)）：

```typescript
updateConfig: async (patch) => {
  const config = await adaptersApi.updateConfig(patch)  // 1. 写入 JSON 文件
  set({ config })
  void notifyDesktopRestartAdapters()  // 2. 重启适配器 Sidecar 进程
}
```

**原子写入**（[adapterService.ts:161-178](file:///d:/Code/Ai/cc-haha/src/server/services/adapterService.ts#L161-L178)）：

- 先写临时文件 `adapters.json.tmp.{timestamp}`
- 再 `rename` 覆盖目标文件（保证原子性）
- 文件权限设置为 `0o600`（仅所有者可读写）
- 敏感字段（Token、Secret）在 API 返回时自动脱敏

### 7.2 Session 同步

#### Session 生命周期

```
创建 → 消息交互 → 历史加载 → 重连恢复 → 删除
```

#### Android Session 同步

**会话列表**（[sessionStore.ts:41-49](file:///d:/Code/Ai/cc-haha/android/src/stores/sessionStore.ts#L41-L49)）：

```typescript
fetchSessions: async (project) => {
  const { sessions } = await sessionsApi.list({ project, limit: 100 })
  set({ sessions })
}
```

**加载会话**（[sessionStore.ts:51-69](file:///d:/Code/Ai/cc-haha/android/src/stores/sessionStore.ts#L51-L69)）：

```typescript
loadSession: async (sessionId) => {
  set({ isLoadingMessages: true })
  const session = await sessionsApi.get(sessionId)         // 获取元数据
  const { messages } = await sessionsApi.getMessages(sessionId) // 获取历史消息
  set({ activeSessionId: sessionId, activeMessages: messages, ... })
  // ChatScreen useEffect 自动建立 WebSocket 连接
}
```

**WebSocket 连接生命周期**（[ChatScreen.tsx:43-63](file:///d:/Code/Ai/cc-haha/android/src/screens/ChatScreen.tsx#L43-L63)）：

```typescript
useEffect(() => {
  wsManager.connect(activeSessionId)
  wsSubscriptionRef.current = wsManager.onMessage(activeSessionId, (message) => {
    handleServerEvent(message)  // 消息进入 Store Reducer
  })

  return () => {
    wsSubscriptionRef.current()  // 取消订阅
    wsManager.disconnect(activeSessionId)  // 页面离开时断开
  }
}, [activeSessionId])
```

#### Desktop Session 同步

- 会话列表通过 `sessionStore` 管理
- Tab 系统支持同时打开多个 Session
- WebSocket 连接在 tab 激活时建立，切换时保持连接
- 适配器侧通过 [session-store.ts](file:///d:/Code/Ai/cc-haha/adapters/common/session-store.ts) 持久化 chatId → sessionId 映射

### 7.3 消息同步与流式传输

#### Android 流式消息处理（[serverEvents.ts:52-130](file:///d:/Code/Ai/cc-haha/android/src/lib/serverEvents.ts#L52-L130)）

核心是 `reduceServerEvent` 纯函数 Reducer，根据事件类型更新状态：

```typescript
function reduceServerEvent(state, event, makeId) {
  switch (event.type) {
    case 'content_delta':
      // 增量文本 → 追加到 streamingAssistantId 对应消息
      return appendAssistantDelta(state, event.text, makeId)

    case 'message_complete':
      // 流结束 → 清除 streamingAssistantId
      return { ...state, streamingAssistantId: null, sending: false }

    case 'permission_request':
      // 权限请求 → 设置 pendingPermission，UI 弹出审批面板
      return { ...state, sending: false, pendingPermission: { ... } }

    case 'user_message_received':
      // 服务端确认收到用户消息
      return { ...state, sending: true, messages: [...] }

    case 'error':
      // 错误 → 添加系统消息
      return { ...state, sending: false, messages: [..., systemErrorMsg] }

    // 忽略的事件类型
    case 'status': case 'connected': case 'content_start':
    case 'tool_use_complete': case 'tool_result': case 'thinking': case 'pong':
      return state
  }
}
```

**增量文本拼接**（[serverEvents.ts:168-206](file:///d:/Code/Ai/cc-haha/android/src/lib/serverEvents.ts#L168-L206)）：

```typescript
function appendAssistantDelta(state, text, makeId) {
  const streamingId = state.streamingAssistantId || makeId()
  const existingIndex = state.messages.findIndex(m => m.id === streamingId)

  if (existingIndex >= 0) {
    // 已有流式消息：追加文本
    const updated = { ...existing, content: existing.content + text }
    return { ...state, streamingAssistantId: streamingId, messages: [..., updated, ...] }
  }
  // 新流式消息：创建
  return { ...state, streamingAssistantId: streamingId, messages: [..., newAssistantMsg] }
}
```

#### Desktop 流式消息处理

桌面端更复杂，支持：
- Thinking Block 展开/折叠
- Tool Call 分组展示
- Code Diff 高亮
- 图片/附件渲染
- Token 实时统计

### 7.4 权限同步

权限审批是控制同步的关键环节——Agent 在执行工具前需要用户授权。

#### Android 权限 UI（[ChatScreen.tsx:122-149](file:///d:/Code/Ai/cc-haha/android/src/screens/ChatScreen.tsx#L122-L149)）

```tsx
{pendingPermission ? (
  <View style={styles.permissionPanel}>
    <Text>Allow {pendingPermission.toolName}?</Text>
    <Text numberOfLines={3}>{pendingPermission.description}</Text>
    <View style={styles.permissionActions}>
      <TouchableOpacity onPress={() => respondToPermission(false)}>
        <Text>Deny</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => respondToPermission(true)}>
        <Text>Allow</Text>
      </TouchableOpacity>
    </View>
  </View>
) : null}
```

**权限响应流程**：

```typescript
const respondToPermission = (allowed: boolean) => {
  wsManager.send(activeSessionId,
    buildPermissionResponsePayload(pendingPermission.requestId, allowed)
  )
  clearPendingPermission()
  setSending(allowed)  // 允许后继续等待响应
}
```

#### Desktop/IM 权限 UI

| 平台 | 权限交互方式 |
|------|-------------|
| Desktop UI | Modal 对话框（Allow/Deny/Always allow） |
| Telegram | Inline Keyboard 按钮 |
| 飞书 | Interactive Card（卡片按钮） |
| 微信 | 卡片消息按钮 |
| 钉钉 | 权限卡片交互 |
| WhatsApp | 文本 + 快捷回复按钮 |

---

## 八、消息协议对比

### 8.1 客户端 → 服务端消息

所有客户端使用统一的消息格式：

| type | 字段 | 说明 | Android | Desktop | Adapter |
|------|------|------|---------|---------|---------|
| `user_message` | `content`, `attachments?` | 发送用户消息 | ✅ | ✅ | ✅ |
| `permission_response` | `requestId`, `allowed`, `rule?` | 权限审批响应 | ✅ | ✅ | ✅ |
| `stop_generation` | - | 停止生成 | ✅ | ✅ | ✅ |
| `set_permission_mode` | `mode` | 切换权限模式 | ❌ | ✅ | ❌ |
| `ping` | - | 心跳保活 | ✅ | ✅ | ✅ |

**Android 发送用户消息**（[ChatScreen.tsx:65-71](file:///d:/Code/Ai/cc-haha/android/src/screens/ChatScreen.tsx#L65-L71)）：

```typescript
const handleSend = async (text: string) => {
  appendMessage(createLocalUserMessage(text))  // 乐观更新：先显示本地消息
  setSending(true)
  wsManager.send(activeSessionId, buildUserMessagePayload(text))
}
```

### 8.2 服务端 → 客户端消息

| type | 字段 | 说明 | Android 处理 | Desktop 处理 |
|------|------|------|-------------|-------------|
| `connected` | - | 连接成功 | 忽略 | 更新状态 |
| `status` | `state`, `verb?`, `model?` | 状态变更 | 忽略 | 状态栏更新 |
| `content_start` | - | 开始输出 | 忽略 | 初始化渲染 |
| `content_delta` | `text` | 流式文本增量 | ✅ 追加到消息 | ✅ 增量渲染 |
| `thinking` | `text` | Extended Thinking | 忽略 | Thinking Block |
| `tool_use_complete` | `toolName`, `input`, `id` | 工具调用就绪 | 忽略 | ToolCall 渲染 |
| `tool_result` | `id`, `content` | 工具结果 | 忽略 | 结果展示 |
| `permission_request` | `requestId`, `toolName`, `input` | 权限请求 | ✅ 弹出审批面板 | ✅ Modal 对话框 |
| `message_complete` | `usage?` | 消息完成（含 Token 统计） | ✅ 结束流式状态 | ✅ 更新统计 |
| `session_title_updated` | `title` | 标题更新 | ❌ | ✅ 更新标题 |
| `error` | `message` | 错误通知 | ✅ 系统消息 | ✅ 错误提示 |
| `pong` | - | 心跳响应 | 忽略 | 忽略 |

### 8.3 消息序列化格式

```typescript
// WebSocket 消息统一为 JSON 文本帧
{
  "type": "content_delta",
  "text": "Hello, "
}

// 用户消息发送
{
  "type": "user_message",
  "content": "帮我查看当前目录"
}

// 权限响应
{
  "type": "permission_response",
  "requestId": "perm_abc123",
  "allowed": true
}
```

---

## 九、启动流程对比

### 9.1 Windows Desktop 启动流程

```
1. 双击启动应用
   ↓
2. Electron main 进程初始化
   ├─ 解析便携模式（设置 CLAUDE_CONFIG_DIR）
   ├─ 创建 BrowserWindow
   └─ 注入 preload host bridge
   ↓
3. Renderer (React) 加载
   ├─ 调用 window.desktopHost.runtime.getServerUrl()
   └─ Electron 启动 Server Sidecar (Bun 子进程)
      └─ 动态分配端口 (如 127.0.0.1:54321)
   ↓
4. 健康检查通过 (/health)
   ↓
5. React 初始化 Store
   ├─ sessionStore.fetchSessions()
   ├─ settingsStore 加载配置
   └─ 加载 Adapter 配置
   ↓
6. (可选) 启动 Adapter Sidecar
   └─ 按需加载 Telegram/飞书/微信/钉钉/WA 适配器
      └─ 适配器通过 WsBridge 连接 ws://127.0.0.1:{port}/ws/...
   ↓
7. UI 就绪，用户交互
```

**服务器启动命令**（[README.md/desktop](file:///d:/Code/Ai/cc-haha/docs/desktop/01-quick-start.md)）：

```bash
# 开发模式
SERVER_PORT=3456 bun run src/server/index.ts

# 局域网访问（供 Android 连接）
SERVER_HOST=0.0.0.0 SERVER_PORT=3456 bun run src/server/index.ts
```

### 9.2 Android App 启动流程

```
1. 点击 App 图标启动
   ↓
2. React Native 初始化
   ├─ App.tsx 加载 Navigation
   └─ initBaseUrl() 从 AsyncStorage 读取服务器配置
   ↓
3. HomeScreen 自动连接
   ├─ 显示 "Connecting to desktop server..."
   ├─ testConnection() → GET /health + /api/sessions?limit=1
   │
   ├─ [成功] → 自动跳转到 SessionList
   │           └─ fetchSessions() 加载会话列表
   │
   └─ [失败] → 显示错误信息
               └─ 用户可点击 "Server Configuration" 手动配置
   ↓
4. 用户选择/新建会话 → 进入 ChatScreen
   ↓
5. ChatScreen 建立 WebSocket 连接
   ├─ wsManager.connect(sessionId)
   │  └─ new WebSocket(ws://server/ws/sessionId?token=xxx)
   ├─ 注册 onMessage handler
   └─ loadSession() 加载历史消息
   ↓
6. 实时通信就绪
   ├─ 发送消息 → wsManager.send()
   ├─ 接收流式响应 → handleServerEvent() → Reducer 更新
   └─ 权限请求 → 弹出 Allow/Deny 面板
```

**前置条件**（[android/README.md](file:///d:/Code/Ai/cc-haha/android/README.md)）：

1. 电脑启动服务器时绑定 `SERVER_HOST=0.0.0.0`
2. 手机和电脑在同一 Wi-Fi 网络
3. Windows 防火墙允许 3456 端口
4. 获取电脑局域网 IP（`ipconfig` 查看 IPv4 地址）

---

## 十、关键差异总结

### 10.1 连接方式差异

| 维度 | Windows Desktop | Android |
|------|----------------|---------|
| **网络位置** | 本地回环 127.0.0.1 | 局域网 192.168.x.x |
| **服务器地址** | 动态分配端口（Electron 管理） | 手动配置固定 IP:Port |
| **认证方式** | 无（本地进程间通信） | Bearer Token（URL Query + Header） |
| **连接稳定性** | 极高（本地直连） | 受 Wi-Fi 信号影响 |
| **超时设置** | 无超时 | 8 秒请求超时 |
| **服务器绑定** | 127.0.0.1（默认） | 需 0.0.0.0 绑定 |

### 10.2 功能覆盖差异

| 功能 | Windows Desktop | Android |
|------|----------------|---------|
| AI 对话 | ✅ 完整功能 | ✅ 基本对话 |
| 流式响应 | ✅ 含 Thinking/Tool Call | ✅ 仅文本流 |
| 代码编辑 | ✅ Diff 查看/编辑 | ❌ 仅文本展示 |
| 文件操作 | ✅ 完整工具支持 | ❌ 通过权限审批间接操作 |
| 终端 | ✅ node-pty 集成 | ❌ |
| 模型切换 | ✅ ModelSelector | ❌ |
| Provider 管理 | ✅ 完整 CRUD | ❌ |
| 适配器配置 | ✅ UI 配置+登录 | ❌ |
| 定时任务 | ✅ 完整管理 | ❌ |
| Agent 团队 | ✅ 团队管理 | ❌ |
| 技能管理 | ✅ 技能列表/详情 | ❌ |
| 代码 Diff | ✅ react-diff-viewer | ❌ |
| Markdown 渲染 | ✅ marked + DOMPurify + Mermaid | ⚠️ 基础文本 |
| 权限审批 | ✅ Allow/Deny/Always | ✅ Allow/Deny |
| 会话管理 | ✅ 完整 CRUD | ✅ 基本 CRUD |
| 自动更新 | ✅ electron-updater | ❌（需重新构建） |

### 10.3 状态管理差异

| 维度 | Windows Desktop | Android |
|------|----------------|---------|
| Store 数量 | 12 个（按领域拆分） | 2 个（精简核心） |
| 持久化方案 | localStorage + 服务器 JSONL | AsyncStorage |
| 消息处理 | 多组件订阅（chat/tab/stat） | 单一 Reducer（sessionStore） |
| 乐观更新 | ✅ | ✅（用户消息先本地显示） |
| WebSocket 管理 | 随 Store 生命周期 | 页面 useEffect 连接/断开 |

### 10.4 架构设计哲学

**Windows Desktop**：全功能工作站
- 面向深度开发工作流
- Electron 提供完整原生能力
- 三层架构确保进程隔离和稳定性
- 丰富的 UI 组件覆盖各种交互场景

**Android**：轻量远程终端
- 面向移动场景的快速访问
- React Native 跨平台快速迭代
- 精简功能集，聚焦聊天+权限审批
- 手动配置连接，灵活适配网络环境

**IM 适配器**：无界面桥梁
- 面向日常 IM 工作流集成
- 无 UI 进程，纯消息转发
- 利用 IM 平台原生交互（按钮、卡片）
- 后台常驻，消息即时可达

---

## 十一、网络安全注意事项

### 局域网连接安全（Android 使用场景）

1. **Access Token 配置**：当服务器绑定 `0.0.0.0` 时，务必设置 `SERVER_ACCESS_TOKEN` 环境变量
2. **防火墙配置**：仅在可信局域网内开放 3456 端口
3. **HTTPS 支持**：当前为 HTTP 明文传输，建议在可信网络环境使用
4. **Token 传递**：Android 通过 URL Query 传递 Token（WS 限制），注意不要在公共网络泄露 URL

### 本地连接安全（Desktop 使用场景）

1. **回环绑定**：默认仅绑定 `127.0.0.1`，外部无法访问
2. **文件权限**：`adapters.json` 等配置文件权限为 `0o600`
3. **敏感信息脱敏**：API 返回配置时自动 mask Token/Secret
4. **路径白名单**：Shell 打开路径时做 scheme/path allowlist 校验
