import React, { createContext, useContext, useEffect, useState } from "react";
import { getPublicConfigCached } from "@/lib/public-config";
import type { PublicConfig } from "@/lib/api";

type CabinetConfigValue = PublicConfig | null;

const CabinetConfigContext = createContext<CabinetConfigValue>(null);

export function CabinetConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<CabinetConfigValue>(null);

  useEffect(() => {
    let cancelled = false;
    getPublicConfigCached().then((c) => {
      if (!cancelled) setConfig(c);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <CabinetConfigContext.Provider value={config}>
      {children}
    </CabinetConfigContext.Provider>
  );
}

export function useCabinetConfig() {
  return useContext(CabinetConfigContext);
}
