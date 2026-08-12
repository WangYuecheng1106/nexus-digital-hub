# EdgeOne 部署指南

## 前置条件

- EdgeOne 账户（已开通）
- 域名（已备案）
- SSL 证书

## 1. 前端构建

```bash
cd d:\NEXUS\client
npm run build
# 产物输出至 d:\NEXUS\client\dist\
```

## 2. EdgeOne 站点配置

### 2.1 创建站点

1. 登录 EdgeOne 控制台
2. 创建站点，绑定域名（如 `nexus.example.com`）
3. 接入方式：NS 接入

### 2.2 配置加速

1. **静态资源加速**:
   - 源站类型：对象存储 / 自建源站
   - 上传 `client/dist/` 目录所有文件
   - 缓存规则：`.js/.css` 缓存 30 天，`index.html` 不缓存

2. **回源配置**:
   - 回源地址：后端服务器 IP
   - 回源端口：8080
   - 回源协议：HTTP

### 2.3 WebSocket 代理

配置 WebSocket 代理规则（用于 IM/会议实时通信）：

| 路径 | 转发目标 | 说明 |
|------|---------|------|
| `/ws/im` | `http://后端IP:8083/ws` | IM WebSocket |
| `/ws/meeting` | `http://后端IP:8084/ws` | 会议信令 |
| `/ws/document` | `http://后端IP:8085/ws` | 文档协同 |

### 2.4 HTTPS 配置

1. 上传 SSL 证书
2. 开启强制 HTTPS 跳转
3. 配置 HSTS

### 2.5 安全配置

- **WAF**: 开启基础防护
- **DDoS**: 开启基础防护
- **限流**: API 接口 100 req/min/IP
- **Bot 防护**: 开启

## 3. 后端部署

### 3.1 服务器准备

```bash
# 安装 Node.js 24
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# 克隆项目
git clone <repo-url> /opt/nexus
cd /opt/nexus
npm install
```

### 3.2 PM2 进程管理

```bash
npm install -g pm2

# 启动所有服务
pm2 start scripts/dev.js --name nexus-backend

# 保存并设置开机自启
pm2 save
pm2 startup
```

### 3.3 Nginx 反向代理（可选）

```nginx
upstream nexus_gateway {
    server 127.0.0.1:8080;
}

server {
    listen 80;
    server_name nexus.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name nexus.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://nexus_gateway;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /ws/ {
        proxy_pass http://nexus_gateway;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## 4. 域名解析

在 EdgeOne 控制台添加 DNS 记录：

| 类型 | 主机记录 | 记录值 | TTL |
|------|---------|--------|-----|
| CNAME | nexus | nexus.example.com.edgeone.cn | 600 |

## 5. 验证

```bash
# 检查 HTTPS
curl -I https://nexus.example.com

# 检查 WebSocket
wscat -c wss://nexus.example.com/ws/im

# 检查 API
curl https://nexus.example.com/api/services/health
```

## 6. 监控

- EdgeOne 控制台：流量、带宽、请求量监控
- PM2 监控：`pm2 monit`
- 日志：`/opt/nexus/data/*.log`
