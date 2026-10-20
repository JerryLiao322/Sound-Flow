# 安装冒烟测试：静默安装 → 放一段测试音（让系统里有真实的音频会话）→ 启动 Sound Flow →
# 确认它没崩、读出窗口里的文字、截一张图 → 关闭并卸载。
param(
    [Parameter(Mandatory)] [string] $InstallerDir,
    [string] $ScreenshotPath = (Join-Path $env:RUNNER_TEMP 'sound-flow.png')
)

$ErrorActionPreference = 'Stop'

$setup = Get-ChildItem $InstallerDir -Filter '*-setup.exe' | Select-Object -First 1
if (-not $setup) { throw "在 $InstallerDir 里没找到安装包" }
Write-Host "installer: $($setup.Name) ($([math]::Round($setup.Length / 1MB, 2)) MB)"

$install = Start-Process $setup.FullName -ArgumentList '/S' -Wait -PassThru
Write-Host "installer exit code: $($install.ExitCode)"
if ($install.ExitCode -ne 0) { throw '安装失败' }

$candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Sound Flow'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Sound Flow')
)
$dir = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $dir) { throw "没找到安装目录（找过：$($candidates -join '、')）" }
Get-ChildItem $dir | ForEach-Object { Write-Host "  installed: $($_.Name) $($_.Length)" }
$exe = Get-ChildItem $dir -Filter *.exe | Where-Object Name -notmatch 'uninstall' | Select-Object -First 1
$uninstaller = Get-ChildItem $dir -Filter 'uninstall*.exe' | Select-Object -First 1

# 一段 440Hz 的测试音，由单独的进程循环播放，这样 Sound Flow 能看到一路真实的声音流
$wav = Join-Path $env:RUNNER_TEMP 'tone.wav'
$rate = 44100; $seconds = 2; $samples = $rate * $seconds
$stream = [System.IO.File]::Create($wav)
$w = New-Object System.IO.BinaryWriter $stream
$w.Write([Text.Encoding]::ASCII.GetBytes('RIFF')); $w.Write([int](36 + $samples * 2))
$w.Write([Text.Encoding]::ASCII.GetBytes('WAVEfmt ')); $w.Write([int]16); $w.Write([int16]1); $w.Write([int16]1)
$w.Write([int]$rate); $w.Write([int]($rate * 2)); $w.Write([int16]2); $w.Write([int16]16)
$w.Write([Text.Encoding]::ASCII.GetBytes('data')); $w.Write([int]($samples * 2))
for ($i = 0; $i -lt $samples; $i++) { $w.Write([int16](6000 * [math]::Sin(2 * [math]::PI * 440 * $i / $rate))) }
$w.Close()
$player = Start-Process powershell.exe -PassThru -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-Command', "while (`$true) { try { (New-Object System.Media.SoundPlayer '$wav').PlaySync() } catch { Start-Sleep 1 } }"
)
Start-Sleep -Seconds 3

$app = Start-Process $exe.FullName -PassThru
Start-Sleep -Seconds 15
if ($app.HasExited) { throw "Sound Flow 启动后退出了，退出码 $($app.ExitCode)" }
Write-Host "app is running (pid $($app.Id))"

# 通过 UI 自动化读出窗口里的文字（WebView2 会把网页内容暴露成无障碍树）
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$byPid = New-Object System.Windows.Automation.PropertyCondition($A::ProcessIdProperty, $app.Id)
$window = $A::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $byPid)
if ($window) {
    Write-Host "window title: $($window.Current.Name)"
    $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) |
        ForEach-Object { $_.Current.Name } | Where-Object { $_ } | Select-Object -Unique -First 80 |
        ForEach-Object { Write-Host "  text: $_" }
} else {
    Write-Warning '没找到 Sound Flow 的窗口'
}

# 截图：完整的存成文件（作为产物上传），缩小的 JPEG 以 base64 打进日志
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$shot = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
[System.Drawing.Graphics]::FromImage($shot).CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$shot.Save($ScreenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
$scale = [math]::Min(1.0, 960 / $bounds.Width)
$small = New-Object System.Drawing.Bitmap $shot, ([int]($bounds.Width * $scale)), ([int]($bounds.Height * $scale))
$jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
$quality = New-Object System.Drawing.Imaging.EncoderParameters 1
$quality.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]60)
$buffer = New-Object System.IO.MemoryStream
$small.Save($buffer, $jpeg, $quality)
$b64 = [Convert]::ToBase64String($buffer.ToArray())
Write-Host "screen: $($bounds.Width)x$($bounds.Height), log copy $($b64.Length) chars"
for ($i = 0; $i -lt $b64.Length; $i += 6000) {
    Write-Host ('SHOT:' + $b64.Substring($i, [math]::Min(6000, $b64.Length - $i)))
}

Stop-Process -Id $app.Id -Force
Stop-Process -Id $player.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

if ($uninstaller) {
    $un = Start-Process $uninstaller.FullName -ArgumentList '/S' -Wait -PassThru
    Write-Host "uninstaller exit code: $($un.ExitCode)"
}
Write-Host 'SMOKE_TEST_OK'
