type AdminAccess = { role: string; allowedSections?: string[] };
type NavigationAccess = { to: string; section: string; requiredAction?: string };

export function canAccessSection(role: string, allowedSections: string[] | undefined, section: string, requiredAction?: string): boolean {
  if (role === "ADMIN") return true;
  if (section === "admins") return false;
  const permission = requiredAction ? `action:${requiredAction}` : section;
  return Array.isArray(allowedSections) && allowedSections.includes(permission);
}

export function isNavActive(pathname: string, to: string): boolean {
  return pathname === to || (to !== "/admin" && pathname.startsWith(`${to}/`));
}

export function getManagerRedirect(admin: AdminAccess | null, pathname: string, items: NavigationAccess[]): string | undefined {
  if (!admin || admin.role !== "MANAGER" || pathname === "/admin/change-password") return;
  if (pathname === "/admin/api-docs" && admin.allowedSections?.includes("api-keys")) return;
  const current = items.find((item) => isNavActive(pathname, item.to));
  const allowed = (item: NavigationAccess) => canAccessSection(admin.role, admin.allowedSections, item.section, item.requiredAction);
  if (current && allowed(current)) return;
  return items.find(allowed)?.to;
}
