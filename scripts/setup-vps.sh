#!/usr/bin/env bash
# Nexus VPS 一键安装（Ubuntu 22.04+ / Debian 12+）
# 用法：把整个项目上传到服务器后执行：
#   bash scripts/setup-vps.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "[setup] 安装 Node.js 22 ..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "[setup] 需要 Node >= 22，当前 $(node -v)"
  exit 1
fi

echo "[setup] npm install ..."
npm install --omit=dev

# 生成内部令牌
if [ ! -f .env.production ]; then
  TOKEN=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
  cat > .env.production <<EOF
GATEWAY_HOST=0.0.0.0
CORS_ORIGIN=https://nexus.ycwang.com
NEXUS_INTERNAL_TOKEN=$TOKEN
EOF
  echo "[setup] 已写入 .env.production"
fi

set -a
# shellcheck disable=SC1091
source .env.production
set +a

# systemd 服务
SERVICE_FILE=/etc/systemd/system/nexus.service
sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=Nexus API Gateway + Microservices
After=network.target

[Service]
Type=simple
WorkingDirectory=$(pwd)
EnvironmentFile=$(pwd)/.env.production
ExecStart=$(command -v node) $(pwd)/scripts/prod-vps.mjs
Restart=always
RestartSec=5
User=$USER

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable nexus
sudo systemctl restart nexus
sleep 2
sudo systemctl --no-pager status nexus || true

echo ""
echo "[setup] 完成。"
echo "  健康检查: curl http://127.0.0.1:8080/health"
echo "  请在云厂商安全组放行 TCP 8080"
echo "  然后把 EdgeOne 的 /api /ws 回源到: http://<服务器公网IP>:8080"
