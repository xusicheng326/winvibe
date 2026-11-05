Write-Host "[WinVibe] 正在清洗冲突环境变量 (NODE_OPTIONS, SOCKS5 PROXY) 并启动灵动岛..." -ForegroundColor Cyan
$env:NODE_OPTIONS = ""
$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""
$env:ALL_PROXY = ""
npm start
