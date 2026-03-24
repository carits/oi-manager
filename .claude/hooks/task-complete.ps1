$root = $env:CLAUDE_PROJECT_DIR
if (-not $root) {
    exit 0
}

function Stop-PortProcess($port) {
    try {
        $cons = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if ($cons) {
            $pids = $cons | Select-Object -ExpandProperty OwningProcess -Unique
            foreach ($pid in $pids) {
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {
        # 忽略端口不存在等错误
    }
}

# 1. 记录日志
$logFile = Join-Path $root "docs\change-log.md"
$time = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

if (!(Test-Path $logFile)) {
    New-Item -ItemType File -Path $logFile -Force | Out-Null
}

Add-Content -Path $logFile -Value "`n- $time Claude Code 会话结束或任务完成"

# 2. 杀掉 3000 和 3001
Stop-PortProcess 3000
Stop-PortProcess 3001

# 3. 重启项目
# 这里一定改成你项目真实的启动命令
Start-Process powershell.exe -WindowStyle Hidden -WorkingDirectory $root `
    -ArgumentList '-Command', 'pnpm dev'

Start-Process powershell.exe -WindowStyle Hidden -WorkingDirectory $root `
    -ArgumentList '-Command', 'pnpm dev:api'