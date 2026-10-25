import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';

// iOS Safari ігнорує user-scalable=no: блокуємо жести масштабування вручну.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener(
  'touchmove',
  (e) => {
    const t = e.target as HTMLElement | null;
    if (!t?.closest('.scrollable')) e.preventDefault();
  },
  { passive: false },
);
document.addEventListener('contextmenu', (e) => {
  if ((e.target as HTMLElement | null)?.closest('.no-menu, canvas')) e.preventDefault();
});

createRoot(document.getElementById('root')!).render(<App />);
