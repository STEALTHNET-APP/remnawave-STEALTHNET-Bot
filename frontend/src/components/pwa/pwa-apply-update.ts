export function applyWorkerUpdate(
  update: () => Promise<void>,
  registration: ServiceWorkerRegistration | undefined,
  worker: ServiceWorkerContainer | undefined,
  reload = () => window.location.reload(),
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const clean = () => {
      clearTimeout(fallback);
      clearTimeout(timeout);
      worker?.removeEventListener("controllerchange", complete);
    };
    const complete = () => {
      if (settled) return;
      settled = true;
      clean();
      reload();
      resolve();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clean();
      reject(error);
    };
    const fallback = setTimeout(complete, 1500);
    const timeout = setTimeout(() => fail(new Error("Обновление не ответило. Попробуйте ещё раз.")), 8000);
    worker?.addEventListener("controllerchange", complete, { once: true });
    try {
      registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
      void Promise.resolve().then(update).catch(fail);
    } catch (error) { fail(error); }
  });
}
