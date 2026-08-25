# Nexus 关系图谱（钉钉 H5 微应用）

> 独立开发者大改革后的产物：原来 16 个模块的「Nexus 数字中枢」砍到只剩一个功能——**组织关系图谱**，并把它接入钉钉，做成企业工作台里的一个 H5 微应用。

把钉钉通讯录同步成一幅可交互的组织关系图谱：部门树、人员归属、双向检索。在钉钉内免登即用，未配置钉钉时可载入演示数据体验。

---

## 为什么只剩这一个功能

独立开发者维护 16 个微服务（IM/会议/审批/文档/云盘…）是不现实的——每个模块都要和钉钉/飞书对着抄，深度做不动，全是「框架空壳」。而**关系图谱**是全项目里最独特、竞品（钉钉/飞书/WeLink）都做得最弱、也最容易单点做深的功能：

- 钉钉没有万级关系图谱；WeLink 的「连接」是营销词
- 组织架构 + 人员关系是每个企业都有的高频心智模型
- 数据源现成：钉钉通讯录 OpenAPI（部门 + 员工）
- 单页应用，一个人完全能维护

> 改革记录：`严重问题.md`（前身问题全清单）/ `report.md`（22 个服务时代的报告）。

---

## 架构（3 个微服务 + 1 个 Vite 前端）

| 组件 | 端口 | 职责 |
|------|------|------|
| `services/gateway` | 8080 | 反向代理 /api/{service}，CORS（钉钉端内 Webview 需要） |
| `services/knowledge` | 8087 | 图谱数据层（SQLite），L0 鹰眼 / L1 视口 LOD / L2 子图；组织数据导入 |
| `services/dingtalk` | 8099 | 钉钉对接：免登（authCode→用户）、通讯录同步（部门树+员工→knowledge）、配置管理 |
| `client` | 5173 | React 单页：组织树视图 / 关系图视图、搜索、图例、同步、接入配置 |

前端代码量：一个 `GraphApp.jsx` 承载全部交互（组织树 tidy 布局 + Canvas 力导向 LOD + 搜索/详情/同步）。

---

## 快速开始

```bash
npm install
npm run dev          # 三个服务 + Vite 一起起
# 打开 http://localhost:5173
```

首次打开若图谱为空会自动载入演示组织数据（`/knowledge/graph/seed-demo`），未配钉钉时标签显示「演示态」，可正常体验组织树 / 关系图 / 搜索。

---

## 生产部署（不用 SSH 的路线）

这个项目设计成**同域部署**：前端页面和 `/api` 共用同一个域名（默认 `https://nexus.ycwang.com`），前端静态资源由云托管平台承载，`/api/**` 由平台回源到 VPS 网关 `82.156.154.115:8080`。CORS 已放行 `https://nexus.ycwang.com`，钉钉端内 Webview 可用。

```
浏览器 / 钉钉 Webview
        │
        ▼
https://nexus.ycwang.com（EdgeOne / 云托管，自动 HTTPS）
   ├── /            → 静态站点（client/dist）
   └── /api/**      → 回源 http://82.156.154.115:8080（VPS 网关）
                           ├── knowledge :8087
                           └── dingtalk  :8099
```

### 1. 前端上线（EdgeOne Pages，控制台操作）

1. 本机构建：`npm run build:client`（产物在 `client/dist`，最终地 `build & deploy`）
2. 打开腾讯云 EdgeOne → **Pages / 静态托管** → 关联 GitHub 仓库或直接上传 `client/dist`
3. 绑定域名 `nexus.ycwang.com`，开启**自动 HTTPS 证书**（或按选择的腾讯云免费证书）
4. 完成域名 CNAME 接入，等待生效

### 2. /api 回源（EdgeOne控制台规则）

新建一条**回源规则**：请求路径前缀匹配 `/api` → 回源到 `http://82.156.154.115:8080`（保留原路径与请求方法）。
前端 `public/config.js` 会识别 `nexus.ycwang.com` 自动走同域 `/api`，无需改代码。

### 3. VPS 更新到最新代码（腾讯云控制台网页终端）

没有本机 SSH 密钥时，用腾讯云控制台自带的**网页登录（Workbench/一键登录）**即可：

```bash
# 1) 找到项目目录（两种常见位置，取存在者）
ls ~/NEXUS  2>/dev/null || ls /root/NEXUS
cd $(ls -d ~/NEXUS 2>/dev/null || ls -d /root/NEXUS 2>/dev/null)

# 2) 更新代码：若仓库是 git clone 的，直接拉取；手动上传的则覆盖解压
git pull  2>/dev/null || echo "非 git 仓库：请把 d:\NEXUS 压缩后经 Workbench 上传覆盖"

# 3) 装依赖 + 重启服务（systemd 单服务，跑的是 scripts/prod-vps.mjs）
npm install --omit=dev
bash scripts/setup-vps.sh     # 幂等：会重新生成 systemd 服务并重启

# 4) 验证
curl http://127.0.0.1:8080/health
curl http://127.0.0.1:8080/api/knowledge/graph/succession | head -c 120
```

> 改域名后记得同步 `data/` 下的 `dingtalk-config.json` 或 `.env.production` 里的 `CORS_ORIGIN`。

### 4. 填钉钉凭证（无需 SSH）

网页终端里即使完全没权限，也可直接打开部署好的页面 → 点「接入钉钉」弹窗 → 填 AppKey/Secret/CorpId/AgentId → 保存（服务端写入 `data/dingtalk-config.json`）。浏览器路径绕开了服务器目录写入。

### 5. 验收

1. 浏览器打开 `https://nexus.ycwang.com` → 演示数据图谱正常渲染
2. 顶栏「继任风险」→ 部门三态着色 + 右侧风险面板正常
3. 钉钉工作台打开 H5 应用 → 自动免登拿姓名 → 「同步钉钉通讯录」→ 图谱变成真实组织
4. 再进「继任风险」→ 真实组织的关键岗位/继任梯队风险一目了然

---

## 接入钉钉（H5 微应用）

### 1. 创建应用

1. 登录 [钉钉开发者后台](https://open-dev.dingtalk.com/)
2. **应用开发 → 企业内部应用 → 钉钉应用 → 创建应用**，选 **H5 微应用 / 企业自助开发**
3. 在 **应用能力 → 添加应用能力 → 网页应用(H5)**，配置：
   - 应用首页地址（移动端）：`https://你的域名/`
   - PC 端首页地址：同上
4. 记下 **凭证与基础信息** 里的 Client ID(AppKey) / Client Secret(AppSecret) / CorpId / AgentId

### 2. 本插件填配置

在应用顶栏点 **「接入钉钉」**，填入四项保存；或写环境变量：

```
DINGTALK_APP_KEY=...
DINGTALK_APP_SECRET=...
DINGTALK_CORP_ID=...
DINGTALK_AGENT_ID=...
```

### 3. 同步通讯录

点 **「同步钉钉通讯录」** → 服务端拉部门树 + 员工（BFS + 分页），写入 knowledge 图谱：
- 节点：部门(`dept`) / 员工(`employee`)；边：`contains`(部门父子) / `belongs_to`(员工→部门)
- 完成后图谱即时刷新为真实组织数据

### 4. 免登（钉钉端内自动）

前端加载 `dingtalk-jsapi`（index.html CDN），应用在钉钉 Webview 里打开时调用：
`dd.requestAuthCode({corpId, clientId, onSuccess})` → 拿 authCode → 后端
`POST /api/dingtalk/auth/code` → 换员工 userId/姓名/部门，签发 RS256 JWT。
浏览器直接访问时优雅降级为匿名演示态，无需账号。

---

## 核心 API

**knowledge**

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/knowledge/graph/overview` | L0 全量坐标（id/type/x/y/size） |
| GET | `/api/knowledge/graph/org` | 组织数据（部门/员工，带 label+properties）供组织树 |
| GET | `/api/knowledge/graph/viewport` | L1 视口节点+边（缩放/边界框分页，limit≤500） |
| GET | `/api/knowledge/graph/subgraph/:nodeId` | L2 子图（BFS depth 1-3） |
| GET | `/api/knowledge/graph/search?q=` | 关键词搜索（name/label LIKE） |
| GET | `/api/knowledge/graph/stats` | 总节点/边数 |
| POST | `/api/knowledge/graph/import-org` | 导入部门树+员工（钉钉同步的落点） |
| POST | `/api/knowledge/graph/seed-demo` | 载入演示组织数据 |

**dingtalk**

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/dingtalk/config` | 是否已配置（configured/corpId/agentId） |
| POST | `/api/dingtalk/config` | 保存 AppKey/Secret/CorpId/AgentId |
| POST | `/api/dingtalk/auth/code` | 免登：authCode → 用户信息 + JWT |
| POST | `/api/dingtalk/sync/org` | 同步通讯录 → 写入图谱 |

---

## 开发与验收

```bash
npm run experience      # Playwright 体验门禁（P0/P1/ok + 截图）
npx playwright test     # e2e：初始化/视图切换/搜索/钉钉引导
```

体验门禁走查：应用壳渲染 → 图谱数据加载（无数据自动 seed-demo）→ 组织树/关系图切换 → 搜索命中 → 钉钉接入入口。P0/P1 必须归零才算完成。

---

## 布局与渲染

- **组织树视图**：垂直 tidy tree（父上子下），部门带 label，点击任意节点弹出详情（部门/职位/电话/邮箱）；搜索可下拉命中
- **关系图视图**：Canvas 力导向 LOD——鹰眼全量画小点（≤3px），缩放提升后画圆+标签，视口内边只画两端都在窗内的，万级节点保持 60 FPS
- 切换视图、适应画布、FPS 面板、图例常驻左下角

---

## 拆分说明

原服务的代码仍在 `archive/`（打包/竞品调研脚本）与本仓库 git 历史中。已删除的服务：auth, im, meeting, document, workflow, calendar, drive, project, attendance, contacts, forum, notification, integration, ai, analytics, portal。