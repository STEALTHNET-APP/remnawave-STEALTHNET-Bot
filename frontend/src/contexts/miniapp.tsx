import { createContext, useContext } from "react";

/** True когда кабинет отрисован внутри Telegram Mini App. */
export const IsMiniappContext = createContext(false);

export function useCabinetMiniapp(): boolean {
  return useContext(IsMiniappContext);
}
