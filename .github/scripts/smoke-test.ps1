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

# 打开 WebView2 的调试端口，下面直接读页面里渲染出来的文字
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
$app = Start-Process $exe.FullName -PassThru
Start-Sleep -Seconds 15
if ($app.HasExited) { throw "Sound Flow 启动后退出了，退出码 $($app.ExitCode)" }
Write-Host "app is running (pid $($app.Id))"

function Invoke-PageScript([string] $expression) {
    $page = Invoke-RestMethod http://127.0.0.1:9222/json/list | Where-Object type -eq 'page' | Select-Object -First 1
    if (-not $page) { throw '没找到 Sound Flow 的页面（WebView2 调试端口里没有 page）' }
    $ws = [System.Net.WebSockets.ClientWebSocket]::new()
    $ws.ConnectAsync([Uri] $page.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
    $request = @{ id = 1; method = 'Runtime.evaluate'; params = @{ expression = $expression; returnByValue = $true } } | ConvertTo-Json -Depth 5 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($request)
    $ws.SendAsync([ArraySegment[byte]]::new($bytes), 'Text', $true, [Threading.CancellationToken]::None).Wait()
    $buffer = [byte[]]::new(1MB)
    $message = [IO.MemoryStream]::new()
    do {
        $part = $ws.ReceiveAsync([ArraySegment[byte]]::new($buffer), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        $message.Write($buffer, 0, $part.Count)
    } until ($part.EndOfMessage)
    $ws.Dispose()
    ([Text.Encoding]::UTF8.GetString($message.ToArray()) | ConvertFrom-Json).result.result.value
}

$text = Invoke-PageScript 'document.body.innerText'
Write-Host '----- 页面文字 -----'
$text -split "`n" | Where-Object { $_.Trim() } | ForEach-Object { Write-Host "  $_" }
Write-Host '--------------------'
if ($text -notmatch '声音流管理') { throw '页面没有渲染出来（可能是脚本被拦截或加载失败）' }
if ($text -notmatch 'Windows 音频') { throw '没有用上原生音频引擎（Tauri 接口不可用？）' }
if ($text -match '正在读取系统里的应用') { throw '15 秒后还停在加载中：读取系统音频的命令没有返回' }
$state = if ($text -match '没能连接到系统音频') { '连接系统音频失败（错误页）' }
    elseif ($text -match '还没有应用在使用声音') { '已连接，系统里暂时没有在用声音的应用' }
    elseif ($text -match '本机输出') { '已连接，显示路由面板' }
    else { '未知' }
Write-Host "page state: $state"

# 截图存成文件，作为产物上传，方便人工查看
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$shot = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
[System.Drawing.Graphics]::FromImage($shot).CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$shot.Save($ScreenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)

Stop-Process -Id $app.Id -Force
Stop-Process -Id $player.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

if ($uninstaller) {
    $un = Start-Process $uninstaller.FullName -ArgumentList '/S' -Wait -PassThru
    Write-Host "uninstaller exit code: $($un.ExitCode)"
}
Write-Host 'SMOKE_TEST_OK'
