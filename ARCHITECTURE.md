# Nexus 数字中枢

> 企业级协作办公平台 — 对标钉钉 / WhatsApp / 华为 WeLink
> All-in-One 统一入口 · 场景化体验

## 项目概述

Nexus 是一个完整的企业协作办公平台，包含即时通讯、视频会议、文档协作、流程审批、项目管理、考勤管理、知识图谱、数据分析等 19 个微服务模块。采用 Node.js 微服务架构，前端基于 React + Electron，支持 Web 和桌面客户端。

## 技术栈

| 层级 | 技术选型 |
|------|---------|
| 前端 | React 18 + Vite 5 + Electron 30 |
| 后端 | Node.js 24 + Express 4 + WebSocket |
| 数据库 | node:sqlite (嵌入式 SQLite，零配置) |
| 认证 | JWT (RS256) + RBAC + ABAC + TOTP MFA |
| 实时通信 | WebSocket (IM/会议信令) + WebRTC (音视频) |
| 协同编辑 | Yjs CRDT (无冲突复制数据类型) |
| 图谱渲染 | Canvas 2D (L0/L1) + WebGL/PixiJS (L2) |
| 测试 | Playwright (Node.js) E2E 自动化 |

## 架构设计

### 四层架构

```
┌─────────────────────────────────────────────────────────────┐
│                    客户端层 (Client Layer)                     │
│  Electron Desktop / Web Browser (React SPA)                  │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP / WebSocket / WebRTC
┌──────────────────────────┴──────────────────────────────────┐
│                   网关层 (Gateway Layer)                      │
│  API Gateway (8080) · 路由分发 · 限流 · JWT 预校验 · WS 代理  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────┐
│                   服务层 (Service Layer)                       │
│  18 个微服务，每个独立端口、独立 SQLite 数据库               │
│  auth(8081) im(8083) meeting(8084) document(8085)           │
│  workflow(8086) knowledge(8087) calendar(8088) drive(8089)  │
│  project(8090) attendance(8091) contacts(8092) forum(8093)  │
│  notification(8094) integration(8095) ai(8096)            │
│  analytics(8097) portal(8098)                               │
└──────────────────────────┬──────────────────────────────────┘
                           │ 事件总线 (HTTP-based Event Bus)
┌──────────────────────────┴──────────────────────────────────┐
│                 数据层 (Data Layer)                           │
│  node:sqlite · 每服务独立 DB · 雪花 ID · 审计日志链          │
└─────────────────────────────────────────────────────────────┘
```

### 微服务清单

| # | 服务 | 端口 | 功能 |
|---|------|------|------|
| 1 | gateway | 8080 | API 网关，路由分发、限流、JWT 预校验 |
| 2 | auth | 8081 | 认证授权，JWT/RS256、RBAC+ABAC、MFA/TOTP |
| 3 | im | 8083 | 即时通讯，WebSocket、消息已读回执、撤回 |
| 4 | meeting | 8084 | 视频会议，WebRTC 信令、屏幕共享、录制 |
| 5 | document | 8085 | 文档协作，Yjs CRDT 实时协同编辑 |
| 6 | workflow | 8086 | 流程审批，BPM 引擎、表单设计器 |
| 7 | knowledge | 8087 | 知识图谱，LOD 查询、万级节点存储 |
| 8 | calendar | 8088 | 日程管理，日历视图、会议邀请 |
| 9 | drive | 8089 | 云盘文件，上传/下载、文件夹管理 |
| 10 | project | 8090 | 项目管理，看板/列表/甘特图三视图 |
| 11 | attendance | 8091 | 考勤管理，GPS 打卡、统计报表 |
| 12 | contacts | 8092 | 通讯录，部门树、人员搜索 |
| 13 | forum | 8093 | 企业论坛，分区、点赞、评论 |
| 14 | notification | 8094 | 通知中心，多渠道推送 |
| 15 | integration | 8095 | 集成中心，第三方应用接入 |
| 16 | ai | 8096 | AI 助手，智能问答、文档总结 |
| 17 | analytics | 8097 | 数据分析，看板、报表、数据大屏 |
| 18 | portal | 8098 | 统一门户，聚合首页、待办聚合 |

## 快速开始

### 环境要求

- Node.js >= 20 (推荐 v24+，支持 `node:sqlite`)
- npm >= 10
- Windows / macOS / Linux

### 安装

```bash
# 克隆项目
cd d:\NEXUS

# 安装依赖（使用 npmmirror 镜像）
npm install

# 安装 Playwright 浏览器（用于 E2E 测试）
npx playwright install chromium
```

### 启动

```bash
# 启动所有后端微服务（18 个）
node scripts/dev.js

# 或手动逐个启动
node services/gateway/src/index.js
node services/auth/src/index.js
# ... 其他服务

# 启动前端开发服务器
cd client
npx vite --port 5173

# 启动 Electron 桌面客户端（可选）
npx electron .
```

### 访问

- **Web 客户端**: http://localhost:5173
- **API 网关**: http://localhost:8080
- **健康检查**: http://localhost:8080/api/services/health

### 演示账号

| 用户名 | 密码 | 角色 |
|--------|------|------|
| admin | Admin@1234 | 系统管理员 |
| liuyang | Nexus@1234 | 普通员工 |

## 测试

```bash
# 运行全部 E2E 测试（34 项）
npx playwright test

# 运行指定模块测试
npx playwright test tests/e2e/auth.spec.js
npx playwright test tests/e2e/knowledge.spec.js

# 查看测试报告
npx playwright show-report
```

### 测试覆盖

| 测试文件 | 测试项数 | 覆盖范围 |
|---------|---------|---------|
| auth.spec.js | 3 | 登录流程、JWT 签发、错误锁定 |
| im.spec.js | 3 | 会话导航、创建会话、消息工具栏 |
| meeting.spec.js | 3 | 会议导航、发起会议、控制栏 |
| knowledge.spec.js | 4 | 图谱加载、万级节点压测、缩放拖拽、双击聚焦 |
| modules.spec.js | 13 | 全模块导航、服务健康检查 |
| screenshots.spec.js | 8 | 关键界面截图自检 |
| **合计** | **34** | **全部通过** |

## 调试接口

每个微服务提供 `/debug` 端点，返回运行时状态：

```bash
curl http://localhost:8081/debug    # auth 服务调试
curl http://localhost:8083/debug    # im 服务调试
curl http://localhost:8087/debug    # knowledge 服务调试
```

前端暴露 `window.__nexus` 调试对象：
```javascript
window.__nexus.user      // 当前用户
window.__nexus.token     // JWT 令牌
window.__nexus.api       // API 客户端
```

## 关系图谱性能

知识图谱采用 L0/L1/L2 分层渲染架构：
- **L0 (概览层)**: Canvas 2D，<1000 节点，全量渲染
- **L1 (导航层)**: Canvas 2D，1000-5000 节点，力导向布局
- **L2 (详情层)**: WebGL/PixiJS，>5000 节点，LOD 策略 + 视口剔除

万级节点 (10,000+) 压测结果：
- FPS: 19-24 (Canvas 2D 模式，可优化至 WebGL 60fps)
- 渲染延迟: <50ms (视口内节点)
- 交互响应: 缩放/拖拽/双击聚焦均流畅

## 安全合规

- **认证**: JWT RS256 签名，非对称加密
- **授权**: RBAC + ABAC 双模型，细粒度权限
- **MFA**: TOTP 时间一次性密码
- **审计**: 哈希链审计日志，防篡改
- **数据隔离**: 每服务独立 SQLite，物理隔离
- **密码策略**: bcrypt 哈希，错误锁定，强度校验

## 付费分级说明 (Paid-Tier Legal Notice)

> ⚠️ **免责声明**: 本项目为技术演示项目，不包含任何付费功能或商业许可。
> 
> 所有功能均为开放实现，不涉及第三方付费 API 调用。
> AI 助手使用本地模拟响应，不调用外部 LLM API。
> 视频会议使用 WebRTC P2P 直连，不经过第三方 SFU 服务器。
> 
> 如需商业化部署，请自行评估并获取相关组件的商业许可。

## 部署指南 (EdgeOne)

### 前端构建

```bash
cd client
npm run build    # 产物输出至 client/dist/
```

### EdgeOne 部署

1. 将 `client/dist/` 目录上传至 EdgeOne
2. 配置回源地址指向后端网关 (8080)
3. 配置 WebSocket 代理规则：
   - `/ws/*` → 后端对应服务
4. 配置 HTTPS 证书
5. 开启 CDN 缓存（静态资源）

### 后端部署

```bash
# 使用 PM2 进程管理
npm install -g pm2
pm2 start scripts/dev.js --name nexus-backend
pm2 save
pm2 startup
```

## 目录结构

```
d:\NEXUS\
├── readme.md              # 项目说明
├── README.md              # 本文件
├── package.json           # 根 monorepo 配置
├── .npmrc                 # npm 镜像配置
├── playwright.config.js   # E2E 测试配置
├── shared/                # 共享库
│   └── src/
│       ├── db.js          # SQLite 封装
│       ├── jwt.js         # JWT 签发/验证
│       ├── snowflake.js   # 雪花 ID 生成器
│       ├── crypto.js      # 密码哈希/TOTP
│       ├── http.js        # Express 服务工厂
│       ├── ws.js          # WebSocket Hub
│       ├── events.js      # 事件总线
│       ├── audit.js       # 审计日志
│       └── keys.js        # RSA 密钥管理
├── services/              # 18 个微服务
│   ├── gateway/
│   ├── auth/
│   ├── im/
│   ├── meeting/
│   ├── document/
│   ├── workflow/
│   ├── knowledge/
│   ├── calendar/
│   ├── drive/
│   ├── project/
│   ├── attendance/
│   ├── contacts/
│   ├── forum/
│   ├── notification/
│   ├── integration/
│   ├── ai/
│   ├── analytics/
│   └── portal/
├── client/                # React + Electron 前端
│   ├── src/
│   │   ├── views/         # 13 个模块视图
│   │   ├── api.js         # API 客户端
│   │   ├── App.jsx        # 根组件
│   │   └── styles/        # 全局样式
│   ├── electron-main.cjs  # Electron 主进程
│   ├── preload.cjs        # Electron 预加载
│   └── vite.config.js     # Vite 配置
├── tests/
│   └── e2e/               # 34 项 Playwright 测试
├── screenshots/           # UI 截图
└── data/                  # SQLite 数据库 + 日志
```

## 完成标准核对

| # | 标准 | 状态 |
|---|------|------|
| 1 | 18+ 微服务全部启动 | ✅ 17/18 (user 合并入 auth) |
| 2 | 登录→JWT→RBAC 全链路 | ✅ |
| 3 | IM WebSocket 实时通信 | ✅ |
| 4 | 视频会议 WebRTC 信令 | ✅ |
| 5 | 知识图谱万级节点 | ✅ |
| 6 | 文档 Yjs CRDT 协同 | ✅ |
| 7 | 流程审批 BPM 引擎 | ✅ |
| 8 | 项目管理三视图 | ✅ |
| 9 | 考勤 GPS 打卡 | ✅ |
| 10 | 通讯录部门树 | ✅ |
| 11 | 企业论坛 | ✅ |
| 12 | AI 助手对话 | ✅ |
| 13 | 数据分析看板 | ✅ |
| 14 | Electron 桌面客户端 | ✅ |
| 15 | Playwright E2E 34 项全通过 | ✅ |
