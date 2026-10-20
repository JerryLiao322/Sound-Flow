import { useLevel } from '../hooks/useLevel';

/** 卡片上的金色「播放中」徽标，三根小柱跟着电平跳 */
export function LiveBadge({ sourceId }: { sourceId: string }) {
  const ref = useLevel<HTMLSpanElement>(sourceId, (el, level) => {
    el.style.setProperty('--b1', (0.25 + level * 0.75).toFixed(3));
    el.style.setProperty('--b2', (0.25 + level * (0.45 + Math.random() * 0.55)).toFixed(3));
    el.style.setProperty('--b3', (0.25 + level * (0.3 + Math.random() * 0.5)).toFixed(3));
  });
  return (
    <span className="live-badge" ref={ref}>
      <span className="live-bars" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <span className="live-text">播放中</span>
    </span>
  );
}

/** 分段式电平条 */
export function LevelBar({ sourceId }: { sourceId: string }) {
  const ref = useLevel<HTMLSpanElement>(sourceId, (el, level) => {
    el.style.setProperty('--level', level.toFixed(3));
  });
  return <span className="level-bar" ref={ref} role="presentation" />;
}
