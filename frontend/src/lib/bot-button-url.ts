export function isBotButtonUrl(value: string): boolean {
  if (!value || value.length > 1000 || /[\s\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return ["https:", "http:", "tg:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}
