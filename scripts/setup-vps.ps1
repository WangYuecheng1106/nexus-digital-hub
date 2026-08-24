# Nexus — 腾讯云 Lighthouse Windows 一键安装
# 用法（PowerShell 管理员）：
#   cd D:\NEXUS   # 或你的项目路径
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\scripts\setup-vps.ps1
param(
  [string]$CorsOrigin = 'https://nexus.ycwang.com',
  [string]$ProjectRoot = ''
)

$ErrorActionPreference = 'Stop'
if (-not $ProjectRoot) { $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
Set-Location $ProjectRoot

Write-Host "[setup] 项目目录: $ProjectRoot"

# ---- Node.js ----
$nodeOk = $false
try {
  $v = (node -v) -replace '^v',''
  $major = [int]($v.Split('.')[0])
  if ($major -ge 22) { $nodeOk = $true; Write-Host "[setup] Node $v OK" }
  else { Write-Host "[setup] Node $v 过旧，需要 >= 22" }
} catch { Write-Host '[setup] 未检测到 Node' }

if (-not $nodeOk) {
  Write-Host '[setup] 请先安装 Node.js 22 LTS：https://nodejs.org/zh-cn/download'
  Write-Host '        安装后重新打开管理员 PowerShell，再运行本脚本。'
  exit 1
}

# ---- 依赖 ----
Write-Host '[setup] npm install ...'
$env:npm_config_proxy = 'false'
$env:npm_config_https_proxy = 'false'
npm install --omit=dev
if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }

# ---- 环境文件 ----
$envFile = Join-Path $ProjectRoot '.env.production'
if (-not (Test-Path $envFile)) {
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $token = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  @"
GATEWAY_HOST=0.0.0.0
CORS_ORIGIN=$CorsOrigin
NEXUS_INTERNAL_TOKEN=$token
"@ | Set-Content -Path $envFile -Encoding utf8
  Write-Host "[setup] 已写入 $envFile"
} else {
  Write-Host "[setup] 使用已有 $envFile"
}

# ---- 防火墙 8080 ----
Write-Host '[setup] 放行 Windows 防火墙 TCP 8080 ...'
try {
  $rule = Get-NetFirewallRule -DisplayName 'Nexus Gateway 8080' -ErrorAction SilentlyContinue
  if (-not $rule) {
    New-NetFirewallRule -DisplayName 'Nexus Gateway 8080' -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow | Out-Null
  }
} catch {
  Write-Host '[setup] 防火墙规则失败（可稍后在「高级安全 Windows 防火墙」手动放行 8080）'
}

# ---- 启动脚本包装（带环境变量）----
$runner = Join-Path $ProjectRoot 'scripts\run-prod-vps.cmd'
$nodeExe = (Get-Command node).Source
@"
@echo off
cd /d "$ProjectRoot"
for /f "usebackq tokens=1,* delims==" %%A in (".env.production") do (
  if not "%%A"=="" if not "%%A:~0,1%"=="#" set "%%A=%%B"
)
"$nodeExe" "$ProjectRoot\scripts\prod-vps.mjs"
"@ | Set-Content -Path $runner -Encoding ascii

# ---- 计划任务：开机自启 + 立即启动 ----
$taskName = 'NexusProd'
Write-Host "[setup] 注册计划任务 $taskName ..."
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
$action = New-ScheduledTaskAction -Execute $runner
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Start-Sleep -Seconds 4
Write-Host '[setup] 健康检查...'
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/health' -UseBasicParsing -TimeoutSec 8
  Write-Host "[setup] OK $($r.StatusCode) $($r.Content)"
} catch {
  Write-Host '[setup] 暂未就绪，请稍等 10 秒后手动: curl http://127.0.0.1:8080/health'
  Write-Host "        或查看任务: Get-ScheduledTask -TaskName $taskName"
}

Write-Host ''
Write-Host '[setup] 完成。请确认腾讯云 Lighthouse 防火墙也放行了 TCP 8080'
Write-Host '        然后把公网 IP 发给助手，继续 EdgeOne 前端部署。'
