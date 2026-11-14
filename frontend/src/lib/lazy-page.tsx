import { Component, lazy, Suspense, type ComponentProps, type ComponentType, type ReactNode } from "react";
import { forceApplicationReload, recoverFromStaleBundle } from "./sw-recovery";

const CHUNK_ERROR_PATTERNS = [
  /ChunkLoadError/i,
  /Failed to fetch dynamically imported module/i,
  /Loading chunk [\w-]+ failed/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
];

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return CHUNK_ERROR_PATTERNS.some(pattern => pattern.test(message));
}

function withChunkRecovery<C extends ComponentType<any>>(load: () => Promise<{ default: C }>) {
  return () => load().catch(async (error: unknown) => {
    if (!isChunkLoadError(error)) throw error;
    const recovered = await recoverFromStaleBundle();
    if (!recovered) throw error;
    return new Promise<{ default: C }>(() => {});
  });
}

type PageLoadState = { failed: boolean; chunk: boolean };

class PageLoadBoundary extends Component<{ children: ReactNode }, PageLoadState> {
  state: PageLoadState = { failed: false, chunk: false };

  static getDerivedStateFromError(error: unknown): PageLoadState {
    return { failed: true, chunk: isChunkLoadError(error) };
  }

  private retry = () => this.setState({ failed: false, chunk: false });

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.state.chunk) {
      return (
        <div role="alert" className="p-6">
          <p>Приложение обновилось. Перезагрузите его, чтобы продолжить.</p>
          <button type="button" className="mt-4 underline" onClick={() => { void forceApplicationReload(); }}>Перезагрузить приложение</button>
        </div>
      );
    }
    return (
      <div role="alert" className="p-6">
        <p>Не удалось открыть раздел. Проверьте соединение и попробуйте ещё раз.</p>
        <button type="button" className="mt-4 underline" onClick={this.retry}>Повторить</button>
      </div>
    );
  }
}

export function lazyPage<C extends ComponentType<any>>(load: () => Promise<{ default: C }>) {
  const Page = lazy(withChunkRecovery(load));
  return function DeferredPage(props: ComponentProps<C>) {
    return <PageLoadBoundary><Suspense fallback={<div role="status" className="p-6 text-sm text-muted-foreground">Открываем раздел…</div>}><Page {...props} /></Suspense></PageLoadBoundary>;
  };
}
