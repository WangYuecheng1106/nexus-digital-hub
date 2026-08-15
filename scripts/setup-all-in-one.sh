#!/usr/bin/env bash
# 可直接粘贴到云服务器网页终端的精简版（不依赖 GitHub 上是否已有新脚本）
# 用法：把本文件内容保存为 /tmp/aio.sh 后 bash /tmp/aio.sh
# 或：在已有 ~/NEXUS 仓库内执行下面逻辑的在线版见用户消息
set -euo pipefail
DOMAIN=nexus.ycwang.com
IP=82.156.154.115
ROOT=${1:-$HOME/NEXUS}
cd "$ROOT"
echo "[aio] $ROOT"

# Node
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//;s/\..*//')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

npm install
npm run build -w @nexus/client
sudo mkdir -p /var/www/nexus
sudo rsync -a --delete client/dist/ /var/www/nexus/
sudo cp -f /var/www/nexus/index.html /var/www/nexus/404.html || true

TOKEN=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
cat > .env.production <<EOF
GATEWAY_HOST=127.0.0.1
CORS_ORIGIN=https://${DOMAIN},http://${DOMAIN},http://${IP}
NEXUS_INTERNAL_TOKEN=$TOKEN
EOF

NODE_BIN=$(command -v node)
sudo tee /etc/systemd/system/nexus.service >/dev/null <<EOF
[Unit]
Description=Nexus API
After=network.target
[Service]
Type=simple
WorkingDirectory=$ROOT
EnvironmentFile=$ROOT/.env.production
ExecStart=$NODE_BIN $ROOT/scripts/prod-vps.mjs
Restart=always
RestartSec=5
User=root
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now nexus

sudo apt-get install -y nginx rsync
sudo tee /etc/nginx/sites-available/nexus >/dev/null <<EOF
server {
  listen 80 default_server;
  listen [::]:80 default_server;
  server_name $DOMAIN _;
  root /var/www/nexus;
  index index.html;
  client_max_body_size 50m;
  location /api/ {
    proxy_pass http://127.0.0.1:8080/api/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_read_timeout 300s;
  }
  location /ws/ {
    proxy_pass http://127.0.0.1:8080/ws/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_read_timeout 3600s;
  }
  location /health { proxy_pass http://127.0.0.1:8080/health; }
  location / { try_files \$uri \$uri/ /index.html; }
}
EOF
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sfn /etc/nginx/sites-available/nexus /etc/nginx/sites-enabled/nexus
sudo nginx -t && sudo systemctl enable --now nginx && sudo systemctl reload nginx

for i in $(seq 1 40); do curl -fsS http://127.0.0.1:8080/health && break; sleep 1; done
echo "---"
curl -sS http://127.0.0.1:8080/health || true
curl -sS -o /dev/null -w "web:%{http_code}\n" http://127.0.0.1/
echo "Open: http://${IP}/  (only need firewall TCP 80)"
