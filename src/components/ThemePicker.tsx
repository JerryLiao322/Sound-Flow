import { cx } from '../lib/cx';
import { THEMES, useTheme } from '../lib/theme';

/** 顶栏里的主题切换：一排色块，选中的显示名字 */
export function ThemePicker() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="theme-picker" role="radiogroup" aria-label="界面主题">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={theme === t.id}
          className={cx('theme-option', theme === t.id && 'is-on')}
          title={t.label}
          onClick={() => setTheme(t.id)}
        >
          <span
            className="theme-swatch"
            style={{ background: `linear-gradient(135deg, ${t.swatch[0]} 0 50%, ${t.swatch[1]} 50% 100%)` }}
            aria-hidden
          />
          <span className="theme-name">{t.label}</span>
        </button>
      ))}
    </div>
  );
}
