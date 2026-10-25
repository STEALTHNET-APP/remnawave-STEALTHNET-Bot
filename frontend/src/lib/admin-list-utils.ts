export function listPage(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function clientListUrl(id: string): string {
  return `/admin/clients?${new URLSearchParams({ search: id })}`;
}

export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
