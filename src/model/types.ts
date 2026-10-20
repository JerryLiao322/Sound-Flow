export type SourceKind = 'app' | 'music' | 'game' | 'voice' | 'browser' | 'system';
export type DeviceKind = 'speaker' | 'headphones' | 'monitor' | 'virtual';

export type EqPresetId = 'flat' | 'bass' | 'vocal' | 'footsteps' | 'night' | 'custom';

/** 一路声音流：某个应用（或系统）发出的声音 */
export interface AudioSource {
  id: string;
  name: string;
  /** 卡片方块里的缩写，如 SP */
  code: string;
  kind: SourceKind;
  /** 引擎报告的会话状态：此刻是否正在发声 */
  active: boolean;
  /** 输出开关：关闭后这一路被静音，连线断开 */
  enabled: boolean;
  /** 应用音量 0–100 */
  volume: number;
  /** 输出到哪个设备 */
  deviceId: string;
  /** 能否单独指定输出设备（系统声音只能跟随默认设备） */
  routable: boolean;
  /** 声音曲线正在实际处理这一路（只有原生引擎会报告） */
  eqActive?: boolean;
  /** 声音曲线处理出错时的说明 */
  eqError?: string | null;
  /** 每个频段的增益（dB），与 EQ_BANDS 一一对应 */
  eq: number[];
  eqPreset: EqPresetId;
}

export interface OutputDevice {
  id: string;
  name: string;
  code: string;
  kind: DeviceKind;
  /** 连接方式等补充信息，如「蓝牙 · 立体声」 */
  detail: string;
  /** 设备主音量 0–100 */
  volume: number;
}

/** 声音曲线能不能真正作用到声音上 */
export interface EqStatus {
  available: boolean;
  /** 用来接住原声的虚拟声卡名称 */
  sinkName: string | null;
}

export interface Point {
  x: number;
  y: number;
}
