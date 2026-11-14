import React, { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getPublicConfigCached } from "@/lib/public-config";
import type { PublicConfig } from "@/lib/api";

const CabinetConfigContext = createContext<PublicConfig | null>(null);

export function CabinetConfigProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["cabinet-public-config"],
    queryFn: getPublicConfigCached,
    staleTime: Infinity,
    retry: 2,
    retryDelay: 2500,
  });
  return <CabinetConfigContext.Provider value={query.data ?? null}>
    {query.isError && <div role="alert" className="relative z-50 flex flex-wrap items-center justify-center gap-3 border-b border-destructive/30 bg-background p-3 text-sm"><span>{t("cabinet.workspace.config_error")}</span><button type="button" className="rounded-md border border-border px-3 py-1.5" disabled={query.isFetching} onClick={() => query.refetch()}>{t("cabinet.wallet.retry")}</button></div>}
    {children}
  </CabinetConfigContext.Provider>;
}

export function useCabinetConfig() {
  return useContext(CabinetConfigContext);
}
