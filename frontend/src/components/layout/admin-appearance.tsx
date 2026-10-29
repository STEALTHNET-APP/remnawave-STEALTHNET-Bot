import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import { useState } from "react";
import { useTheme, ACCENT_PALETTES, type ThemeAccent, type ThemeMode } from "@/contexts/theme";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function AdminAppearanceChoice() {
  const { adminAppearance, setAdminAppearance } = useTheme();
  return <fieldset className="mb-5 min-w-0">
    <legend className="mb-3 text-sm font-medium">Интерфейс администратора</legend>
    <div className="grid grid-cols-2 gap-2">
      {([['modern', 'Новый'], ['legacy', 'Old classic']] as const).map(([value, label]) =>
        <button key={value} type="button" aria-pressed={adminAppearance === value}
          onClick={() => setAdminAppearance(value)}
          className={`flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 text-sm ${adminAppearance === value ? 'border-foreground bg-muted text-foreground' : 'border-border text-muted-foreground'}`}>
          {label}{adminAppearance === value && <Check className="h-4 w-4" aria-hidden="true" />}
        </button>)}
    </div>
  </fieldset>;
}

export function AdminAppearanceMenu() {
  const [open, setOpen] = useState(false);
  const { config, setMode, setAccent } = useTheme();
  const modes: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: 'system', label: 'Системная', icon: Monitor },
    { value: 'dark', label: 'Тёмная', icon: Moon },
    { value: 'light', label: 'Светлая', icon: Sun },
  ];
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant="ghost" size="icon" aria-label="Оформление админки" title="Оформление админки"><Palette /></Button></DialogTrigger>
    <DialogContent className="admin-appearance-dialog">
      <DialogTitle>Оформление</DialogTitle>
      <DialogDescription>Ваш выбор сохраняется в этом браузере. Дизайн клиентского кабинета настраивается отдельно.</DialogDescription>
      <AdminAppearanceChoice />
      <fieldset>
        <legend>Цветовая схема</legend>
        <div className="admin-mode-options">
          {modes.map(({ value, label, icon: Icon }) => <button type="button" key={value} aria-pressed={config.mode === value} onClick={() => setMode(value)}><Icon aria-hidden="true" />{label}</button>)}
        </div>
      </fieldset>
      <fieldset>
        <legend>Акцент</legend>
        <div className="admin-accent-options">
          {(Object.entries(ACCENT_PALETTES) as [ThemeAccent, typeof ACCENT_PALETTES.default][]).map(([value, palette]) =>
            <button type="button" key={value} aria-label={palette.label} title={palette.label} aria-pressed={config.accent === value} onClick={() => setAccent(value)}>
              <span style={{ backgroundColor: palette.swatch }} />
              {config.accent === value && <Check aria-hidden="true" />}
            </button>)}
        </div>
      </fieldset>
      <Button variant="outline" onClick={() => setOpen(false)}>Готово</Button>
    </DialogContent>
  </Dialog>;
}
