#!/usr/bin/env bash
# 在服务器上执行（已进入项目根目录 /root/NEXUS 或 /home/ubuntu/NEXUS）：
#   curl -fsSL 不可用时直接用仓库内脚本： bash scripts/setup-vps.sh
set -euo pipefail
cd "$(dirname "$0")/.." 2>/dev/null || cd /root/NEXUS || cd ~/NEXUS

echo "[remote] pwd=$(pwd)"
bash scripts/setup-vps.sh
curl -sS http://127.0.0.1:8080/health || true
