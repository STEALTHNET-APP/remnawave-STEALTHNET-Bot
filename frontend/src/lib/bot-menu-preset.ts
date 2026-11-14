import type { AdminSettings } from './api';

export function compactBotMenu(settings: AdminSettings, defaults: NonNullable<AdminSettings['botButtons']>): AdminSettings {
  const buttons = (settings.botButtons ?? defaults).map(button => ({ ...button }));
  const main = ['vpn', 'renew', 'tariffs', 'profile', 'support'];
  const labels: Record<string, string> = { vpn: 'Подключиться', renew: 'Продлить подписку', tariffs: 'Тарифы', profile: 'Профиль', support: 'Поддержка' };
  for (const id of main) {
    if (!buttons.some(button => button.id === id)) {
      const fallback = defaults.find(button => button.id === id);
      if (fallback) buttons.push({ ...fallback });
    }
  }
  return {
    ...settings,
    botGroupCabinet: true,
    botGroupCabinetItems: buttons.filter(button => !main.includes(button.id)).map(button => button.id),
    botButtonsPerRow: 2,
    botButtons: buttons.map(button => main.includes(button.id)
      ? { ...button, visible: true, label: labels[button.id], order: main.indexOf(button.id), style: button.id === 'vpn' ? 'primary' : '', onePerRow: button.id === 'vpn' }
      : button),
    botMenuTexts: {
      ...settings.botMenuTexts,
      welcomeGreeting: '', welcomeTitlePrefix: '', balancePrefix: 'Баланс: ',
      tariffPrefix: 'Тариф: ', subscriptionPrefix: 'Подписка: ', expirePrefix: 'Действует до: ',
      devicesLabel: 'Устройства: ', trafficPrefix: 'Трафик: ',
      statusInactive: 'Не подключена', statusActive: 'Активна', statusExpired: 'Истекла',
      statusLimited: 'Лимит трафика исчерпан', statusDisabled: 'Отключена',
    },
    botMenuLineVisibility: {
      ...settings.botMenuLineVisibility,
      welcomeGreeting: true, welcomeTitlePrefix: true, balancePrefix: true,
      tariffPrefix: true, subscriptionPrefix: true, expirePrefix: true,
      devicesLabel: true, trafficPrefix: true, telegramIdPrefix: false,
      daysLeftPrefix: false, linkLabel: false, chooseAction: false,
    },
  };
}
