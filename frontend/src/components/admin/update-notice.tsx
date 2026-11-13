import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";

export function UpdateNotice({ token }: { token: string }) {
  const { data } = useQuery({ queryKey: ["panel-update", token], queryFn: () => api.getPanelUpdate(token), refetchInterval: 60000, retry: false });
  if (!data?.connected || !data.status?.available || !["ready", "failed"].includes(data.status.phase)) return null;
  return <Link to="/admin/settings?tab=updates" role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm"><span>Доступно обновление {data.status.version} · {data.status.target?.slice(0, 7)}</span><span className="font-medium text-primary">Посмотреть обновление →</span></Link>;
}
