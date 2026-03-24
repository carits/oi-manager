$contextFile = Join-Path $env:CLAUDE_PROJECT_DIR "docs\context.md"
$taskFile = Join-Path $env:CLAUDE_PROJECT_DIR "docs\current-task.md"

Write-Output "以下是项目启动时需要优先参考的上下文："

if (Test-Path $contextFile) {
    Write-Output "`n[docs/context.md]"
    Get-Content $contextFile -Raw
} else {
    Write-Output "`n[docs/context.md 不存在]"
}

if (Test-Path $taskFile) {
    Write-Output "`n[docs/current-task.md]"
    Get-Content $taskFile -Raw
} else {
    Write-Output "`n[docs/current-task.md 不存在]"
}