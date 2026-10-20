# Sound Flow · 声音流管理

把每个应用的声音分别送到不同的输出设备：Spotify 走 Harman Kardon 音响，游戏和语音走耳机，
每一路都能单独调音量和声音曲线（十段均衡）。

界面是连线式的路由面板：左边是正在用声音的应用，中间是本机的输出设备，两者之间的线就是声音的去向；
右边的「控制单元」调当前选中这一路的音量、声音曲线，以及它所连设备的主音量。

## 下载安装（Windows）

到 [Releases](https://github.com/JerryLiao322/Sound-Flow/releases/latest) 下载 `Sound.Flow_<版本>_x64-setup.exe`，双击安装。

- 支持 Windows 10 1803 及以上、Windows 11（64 位）
- 不需要管理员权限，装在当前用户下，开始菜单和桌面会有快捷方式
- 安装包暂时没有数字签名，Windows 可能提示「Windows 已保护你的电脑」：点 **更多信息 → 仍要运行**

## 能做什么

| 功能 | 状态 |
| --- | --- |
| 自动列出正在用声音的应用（按程序归并）和所有输出设备，插拔设备、开关应用实时更新 | ✅ |
| 把某个应用的声音切到指定设备 | ✅ 由 Windows 记住，关掉 Sound Flow 也一直有效 |
| 每个应用的音量、静音；每个设备的主音量 | ✅ 和 Windows 混音器双向同步 |
| 实时电平 | ✅ |
| 每个应用单独的声音曲线（十段均衡） | ✅ 需要先装免费的虚拟声卡 VB-CABLE（见下文） |
| 关窗口后在托盘里继续运行、开机启动 | ✅ |

几点说明：

- 连到标着「默认」的设备，等于让这个应用**跟随系统默认输出**；以后在 Windows 里换默认设备，它会跟着换。
- 系统声音只能跟随默认设备，不能单独路由。
- 大多数应用（浏览器、Spotify、Discord、多数游戏）会立刻切过去；少数自己选定了设备的程序要重开一次才生效。

### 关于声音曲线

Windows 没有「给某个应用加均衡」的系统接口，所以 Sound Flow 自己处理：

1. 把这个应用的原声送进一块没人听的虚拟声卡（[VB-CABLE](https://vb-audio.com/Cable/)，免费）
2. 从这块虚拟声卡把声音录下来（回环录音），按你画的曲线处理
3. 再送到你选的输出设备

所以：

- **要先装 VB-CABLE**，装好后重启电脑。没装时曲线照样保存，界面上会提示。
- **每块虚拟声卡同时只能给一个应用用。** 免费的 VB-CABLE 只有一块，所以同时只能给一个应用开曲线；
  想同时给更多应用开，可以再装 VB-CABLE A+B 等（Sound Flow 会自动认出所有虚拟声卡）。
- 曲线不是平直时才处理；调回「平直」就恢复直出，没有任何额外延迟。
- 处理会增加约 30 毫秒延迟。听音乐、看视频察觉不到；对延迟特别敏感的竞技游戏可以只给音乐开曲线。
- 曲线生效后，下面会显示「已处理 N 秒声音」：数字在涨就说明声音确实在流动。
- 处理出错（比如目标设备被拔掉）时会**立刻恢复直接输出**并显示原因，不会让应用一直没声音；点「重试」可以再试。
- 开了曲线的应用要靠 Sound Flow 一直运行。关掉窗口只是收进托盘；真正退出（托盘菜单 →「退出 Sound Flow」）时，
  这些应用会被切回原来的设备。**建议打开右上角的「开机启动」**。
- 如果 Sound Flow 没在运行时某个应用没声音：打开 Sound Flow 就会自动恢复；也可以在 Windows
  「设置 → 声音 → 音量合成器」里把这个应用的输出设备改回来。
- 虚拟声卡本身不会出现在设备列表里（它只用来接住原声）。

## 操作

| 想做的事 | 怎么做 |
| --- | --- |
| 改某个应用的输出设备 | 从卡片右侧的端口拖线到设备行上松手；或者先选中应用，再点设备行 |
| 取消正在拖的线 | 拖到空白处松手，或按 Esc |
| 静音 / 恢复某一路 | 卡片上的「输出」开关 |
| 调整卡片顺序 | 按住 ☰ 上下拖；或让 ☰ 获得焦点后按 ↑ ↓ |
| 调声音曲线 | 在曲线图上按住任意位置上下拖（会抓住最近的频段）；节点聚焦后可用 ↑ ↓ / PageUp PageDown；也可以直接点预设 |
| 全部恢复默认 | 「重置路由」点两次：所有应用改回跟随默认设备、曲线恢复平直，音量不变 |

## 开发

需要 Node.js 22 和 Rust（stable）。

```bash
npm install
npm run dev          # 只开界面（浏览器里，用模拟数据），任何系统都行
npm test             # 前端单元测试
npm run app:dev      # 桌面版开发模式（Windows）
npm run app:build    # 打安装包（Windows），产物在 src-tauri/target/release/bundle/nsis/

cd src-tauri
cargo test -p soundflow-audio                       # 音频库单元测试
cargo run -p soundflow-audio --example diagnose     # 在这台 Windows 上检查音频后端是否正常
```

### 发布新版本

1. 改 `package.json` 里的 `version`
2. 在 GitHub 的 Actions 页运行 **Release**（或推送 `v<版本>` 标签）

工作流会在 Windows 上打包，并把安装包发布到 Releases。每次推送也会跑 CI，安装包可以在对应运行的 Artifacts 里下载试用。

## 结构

```
src/                    界面（React + TypeScript）
  engine/               音频引擎抽象；MockAudioEngine（浏览器）/ TauriAudioEngine（安装版）；状态→引擎增量同步
  state/                reducer、系统快照合并、本地设置的保存与校验
  model/ geometry/      类型、均衡预设、缩写；连线与曲线的几何计算
  hooks/ components/    端口测量、拖线、排序、电平；各个界面组件
src-tauri/              桌面外壳（Tauri 2）
  src/worker.rs         音频线程：处理界面指令，定时推送电平和系统变化
  audio/                Windows Core Audio 封装（soundflow-audio）
    src/win/policy.rs   按应用指定输出设备（未公开的 AudioPolicyConfig 接口）
.github/workflows/      CI 与发布
```

安装版里路由、音量、静音**以 Windows 为准**：打开 Sound Flow 不会用上次保存的值去覆盖系统，
只会恢复卡片顺序、选中项和声音曲线。

声音曲线的处理在 `src-tauri/audio/src/dsp.rs`（十段峰值均衡、自动前级防削波，有单元测试）和
`src-tauri/audio/src/win/eq_stream.rs`（从虚拟声卡回环录音 → 均衡 → 输出到目标设备）。
