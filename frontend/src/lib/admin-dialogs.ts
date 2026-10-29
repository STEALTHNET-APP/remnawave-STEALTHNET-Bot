export type DialogKind = "confirm" | "alert" | "prompt";
export type DialogRequest = { id: number; kind: DialogKind; message: string; initial: string };
type Result = boolean | string | null;
export function createDialogStore() {
  let current: DialogRequest | null = null;
  let resolve: ((value: Result) => void) | null = null;
  let nextId = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot() { return current; },
    request(kind: DialogKind, message: string, initial = ""): Promise<Result> {
      if (current) return Promise.resolve(kind === "confirm" ? false : null);
      return new Promise(done => {
        resolve = done;
        current = { id: ++nextId, kind, message, initial };
        emit();
      });
    },
    settle(value: Result) {
      const done = resolve;
      resolve = null;
      current = null;
      emit();
      done?.(value);
    },
    cancel() { this.settle(current?.kind === "confirm" ? false : null); },
  };
}
export const adminDialogStore = createDialogStore();
export async function adminConfirm(message: string) { return (await adminDialogStore.request("confirm", message)) === true; }
export async function adminAlert(message: string) { await adminDialogStore.request("alert", message); }
export async function adminPrompt(message: string, initial = "") {
  const result = await adminDialogStore.request("prompt", message, initial);
  return typeof result === "string" ? result : null;
}
