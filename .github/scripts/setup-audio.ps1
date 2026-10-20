# 在 GitHub 的 Windows 运行器上开启音频服务（默认是关着的）。
# 运行器没有声卡；虚拟声卡驱动装不上（会卡在看不见的驱动签名确认框），所以这里只开服务。
# 尽力而为：失败只打印警告，不让任务失败。

$ErrorActionPreference = 'Continue'

try {
    Set-Service -Name Audiosrv -StartupType Automatic
    Start-Service -Name Audiosrv
    Write-Host "Audiosrv: $((Get-Service Audiosrv).Status)"
} catch {
    Write-Warning "启动音频服务失败：$_"
}
