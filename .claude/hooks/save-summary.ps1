$logFile = Join-Path $env:CLAUDE_PROJECT_DIR "docs\change-log.md"
$time = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

if (!(Test-Path $logFile)) {
    New-Item -ItemType File -Path $logFile -Force | Out-Null
}

Add-Content -Path $logFile -Value "`n- $time Claude Code 会话结束或任务完成"