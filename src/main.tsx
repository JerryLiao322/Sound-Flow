import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, readTheme } from './lib/theme';
import './styles/base.css';
import './styles/board.css';
import './styles/inspector.css';
import './styles/themes.css';

// 首帧之前就套上主题，避免先闪一下默认配色
applyTheme(readTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
