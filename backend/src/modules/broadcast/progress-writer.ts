export function createProgressWriter<T>(write: (value: T) => Promise<unknown>, intervalMs = 1000) {
  let latest: T | undefined;
  let chain = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const flush = () => {
    const value = latest;
    latest = undefined;
    if (value !== undefined) chain = chain.then(async () => { await write(value); });
    return chain;
  };
  return {
    report(value: T) {
      if (closed) return;
      latest = { ...value };
      if (!timer) {
        timer = setTimeout(() => { timer = undefined; void flush(); }, intervalMs);
      }
    },
    async finish() {
      closed = true;
      if (timer) clearTimeout(timer);
      await flush();
    },
  };
}
