# 在 GitHub 的 Windows 运行器上准备音频环境：开启音频服务，装一块虚拟声卡（Scream）。
# 运行器默认没开音频服务、也没有声卡。尽力而为：任何一步失败都只打印警告，不让任务失败。

$ErrorActionPreference = 'Continue'

try {
    Set-Service -Name Audiosrv -StartupType Automatic
    Start-Service -Name Audiosrv
    Write-Host "Audiosrv: $((Get-Service Audiosrv).Status)"
} catch {
    Write-Warning "启动音频服务失败：$_"
}

try {
    $work = Join-Path $env:RUNNER_TEMP 'scream'
    Invoke-WebRequest https://github.com/duncanthrax/scream/releases/download/4.0/Scream4.0.zip -OutFile "$work.zip"
    Expand-Archive "$work.zip" -DestinationPath $work -Force

    $sys = Get-ChildItem -Recurse $work -Filter Scream.sys | Where-Object FullName -match 'x64' | Select-Object -First 1
    if (-not $sys) {
        Get-ChildItem -Recurse $work | ForEach-Object { Write-Host "  $($_.FullName)" }
        throw '压缩包里没找到 x64 的 Scream.sys'
    }
    $inf = Get-ChildItem $sys.DirectoryName -Filter *.inf | Select-Object -First 1

    # 驱动是自签名的：先信任它的发布者证书，安装时才不会弹确认
    $cert = (Get-AuthenticodeSignature $sys.FullName).SignerCertificate
    $store = [System.Security.Cryptography.X509Certificates.X509Store]::new('TrustedPublisher', 'LocalMachine')
    $store.Open('ReadWrite')
    $store.Add($cert)
    $store.Close()

    $devcon = Get-ChildItem -Recurse $work -Filter 'devcon*.exe' | Where-Object Name -match 'x64' | Select-Object -First 1
    if (-not $devcon) { throw '压缩包里没找到 devcon' }
    & $devcon.FullName install $inf.FullName '*Scream'
    Start-Sleep -Seconds 5
} catch {
    Write-Warning "安装虚拟声卡失败：$_"
}

Get-CimInstance Win32_SoundDevice | ForEach-Object { Write-Host "sound device: $($_.Name) [$($_.Status)]" }
