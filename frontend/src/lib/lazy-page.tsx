import { Component, lazy, Suspense, type ComponentType, type ReactNode } from "react";

class PageLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div role="alert" className="p-6"><p>Не удалось открыть раздел. Проверьте соединение и обновите страницу.</p><button className="mt-4 underline" onClick={() => location.reload()}>Обновить страницу</button></div>;
    return this.props.children;
  }
}

export function lazyPage(load: () => Promise<{ default: ComponentType }>) {
  const Page = lazy(load);
  return function DeferredPage() {
    return <PageLoadBoundary><Suspense fallback={<div role="status" className="p-6 text-sm text-muted-foreground">Открываем раздел…</div>}><Page /></Suspense></PageLoadBoundary>;
  };
}
