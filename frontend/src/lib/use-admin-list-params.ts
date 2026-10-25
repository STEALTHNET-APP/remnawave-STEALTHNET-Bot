import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { listPage } from "./admin-list-utils";

export function useAdminListParams() {
  const [params, setParams] = useSearchParams();
  const update = useCallback((changes: Record<string, string | number | undefined>, replace = false) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const [key, value] of Object.entries(changes)) {
        if (value == null || value === "" || (key === "page" && value === 1)) next.delete(key);
        else next.set(key, String(value));
      }
      return next;
    }, { replace });
  }, [setParams]);
  return { params, update, page: listPage(params.get("page")) };
}
