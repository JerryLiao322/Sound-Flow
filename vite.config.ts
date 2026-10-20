import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // 相对路径，方便之后直接塞进 Tauri / Electron 的本地页面
  base: './',
  test: {
    environment: 'node',
  },
});
