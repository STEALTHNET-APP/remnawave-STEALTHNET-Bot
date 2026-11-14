export async function copyText(text: string): Promise<void> {
  if (!text) throw new Error("Empty clipboard value");
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {}
  const focused = document.activeElement;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const input = document.createElement("textarea");
  input.value = text;
  input.readOnly = true;
  input.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px;";
  document.body.appendChild(input);
  try {
    input.focus({ preventScroll: true });
    input.select();
    input.setSelectionRange(0, text.length);
    if (!document.execCommand("copy")) throw new Error("Clipboard unavailable");
  } finally {
    input.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    selection?.removeAllRanges();
    for (const range of ranges) selection?.addRange(range);
  }
}
