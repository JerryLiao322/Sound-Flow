/**
 * 卡片方块里的缩写：「Harman Kardon Aura Studio 4」→ HK，「Spotify」→ SP，「扬声器 (Realtek)」→ 扬声
 */
export function abbreviate(name: string): string {
  const trimmed = name.trim();
  if (/^[㐀-鿿]/.test(trimmed)) {
    return [...trimmed.replace(/\s+/g, '')].slice(0, 2).join('');
  }
  // 单个字母的词（如 Realtek(R) 里的 R）不算
  const words = (trimmed.match(/[A-Za-z0-9]+/g) ?? []).filter((w) => w.length > 1);
  const [first, second] = words;
  if (first && second) return (first[0]! + second[0]!).toUpperCase();
  if (first) return first.slice(0, 2).toUpperCase();
  return [...trimmed].slice(0, 2).join('').toUpperCase() || '?';
}
