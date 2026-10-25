export interface Toast {
  id: number;
  tone: 'warn' | 'info';
  title?: string;
  text: string;
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast glass ${t.tone}`}>
          {t.title && <strong>{t.title}</strong>}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
