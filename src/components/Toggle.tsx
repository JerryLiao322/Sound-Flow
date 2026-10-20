import { cx } from '../lib/cx';

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** 胶囊里显示的短文字 */
  label: string;
  /** 给读屏用的完整名称 */
  ariaLabel: string;
}

/** 参考图里「展示 ●」那种胶囊开关：开时金色圆钮在右，关时灰色圆钮在左 */
export function Toggle({ checked, onChange, label, ariaLabel }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={cx('toggle', checked && 'is-on')}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
    >
      <span className="toggle-label" aria-hidden>
        {label}
      </span>
      <span className="toggle-knob" aria-hidden />
    </button>
  );
}
