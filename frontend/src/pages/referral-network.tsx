import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { Network, RefreshCw, ZoomIn, ZoomOut, Maximize, Target, GitBranch, Globe } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Node = {
  id: string;
  name: string;
  status: string;
  referralsCount: number;
  subscriptionIncome: number;
  referralIncome: number;
  campaign: string | null;
};
type Link = { source: string; target: string };

const STATUS_COLORS: Record<string, string> = {
  top_referrer: "#22c55e",
  active_referrer: "#0ea5e9",
  paid: "#a855f7",
  campaign: "#f59e0b",
  trial: "#94a3b8",
  no_sub: "#64748b",
};

const STATUS_LABELS: Record<string, string> = {
  top_referrer: "Топ-реферер",
  active_referrer: "Активный реферер",
  paid: "Платная подписка",
  campaign: "Рекламная кампания",
  trial: "Триал",
  no_sub: "Без подписки",
};

export function ReferralNetworkPage() {
  const token = useAuth().state.accessToken!;
  const fgRef = useRef<ForceGraphMethods<Node, Link>>();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState({ width: window.innerWidth, height: window.innerHeight - 56 });
  const [data, setData] = useState<{ nodes: Node[]; links: Link[]; stats?: any } | null>(null);
  const [loading, setLoading] = useState(true);
  // «только связанные» — скрывает одиночные узлы
  // (без реферера/рефералов), чтобы реальные цепочки не терялись среди тысяч точек.
  const [onlyLinked, setOnlyLinked] = useState(true);

  const load = async () => {
    setLoading(true);
    const res = await api.getReferralNetwork(token);
    setData({ nodes: res.nodes, links: res.links, stats: res.stats });
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const measure = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return;
      if (r.width > 0 && r.height > 0) setDims({ width: Math.floor(r.width), height: Math.floor(r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const graph = useMemo(() => {
    if (!data) return { nodes: [] as Node[], links: [] as Link[] };
    if (!onlyLinked) return { nodes: data.nodes, links: data.links };
    // Оставляем только узлы участвующие хотя бы в одной связи.
    const linkedIds = new Set<string>();
    for (const l of data.links) {
      linkedIds.add(typeof l.source === "string" ? l.source : (l.source as { id: string }).id);
      linkedIds.add(typeof l.target === "string" ? l.target : (l.target as { id: string }).id);
    }
    return { nodes: data.nodes.filter((n) => linkedIds.has(n.id)), links: data.links };
  }, [data, onlyLinked]);

  const hiddenCount = (data?.nodes.length ?? 0) - graph.nodes.length;

  const handleZoomIn = () => {
    if (!fgRef.current) return;
    const currentZoom = fgRef.current.zoom();
    fgRef.current.zoom(currentZoom * 1.5, 400);
  };

  const handleZoomOut = () => {
    if (!fgRef.current) return;
    const currentZoom = fgRef.current.zoom();
    fgRef.current.zoom(currentZoom / 1.5, 400);
  };

  const handleCenter = () => {
    if (!fgRef.current) return;
    fgRef.current.centerAt(0, 0, 400);
  };

  const handleFit = () => {
    if (!fgRef.current) return;
    fgRef.current.zoomToFit(400, 40);
  };

      useEffect(() => {
        if (fgRef.current) {
          fgRef.current.d3Force('charge')?.strength(-200);
          fgRef.current.d3Force('link')?.distance(50);
        }
      }, [graph]);

      return (
        <div ref={wrapRef} className="relative -m-4 md:-m-6 overflow-hidden bg-card" style={{ height: "calc(100dvh - 3.5rem)" }}>
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-md bg-card border shadow-sm px-3 py-2 text-sm font-medium">
        <Network className="h-4 w-4 text-primary" /> Реферальная сеть
      </div>
      
      <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
        <Button
          variant={onlyLinked ? "default" : "secondary"}
          size="sm"
          className="shadow-sm gap-2"
          onClick={() => setOnlyLinked((v) => !v)}
          title={onlyLinked ? "Показать всех (включая без связей)" : "Показать только связанных"}
        >
          {onlyLinked ? <GitBranch className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
          {onlyLinked ? "Только связанные" : "Все клиенты"}
        </Button>
        <Button variant="secondary" size="sm" className="shadow-sm" onClick={load}>
          <RefreshCw className="h-4 w-4 mr-2" />Обновить
        </Button>
      </div>

      {/* Статистика слева внизу */}
      {data?.stats && (
        <div className="absolute left-3 bottom-3 z-10 w-64 rounded-xl bg-card border p-4 text-sm pointer-events-none">
          <h3 className="font-semibold mb-3">Сводная статистика</h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Пользователей:</span>
              <span className="font-medium">{data.stats.totalUsers}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Рефереров:</span>
              <span className="font-medium">{data.stats.totalReferrers}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Кампаний:</span>
              <span className="font-medium">{data.stats.totalCampaigns}</span>
            </div>
            <div className="pt-2 border-t mt-2">
              <div className="flex justify-between text-emerald-500">
                <span>Доход с подписок:</span>
                <span className="font-semibold">{data.stats.totalSubscriptionIncome} ₽</span>
              </div>
              <div className="flex justify-between text-blue-500 mt-1">
                <span>Реферальный доход:</span>
                <span className="font-semibold">{data.stats.totalReferralIncome} ₽</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Управление камерой по центру внизу */}
      <div className="absolute left-1/2 bottom-4 -translate-x-1/2 z-10 flex items-center gap-1 rounded-full bg-card border p-1">
        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={handleZoomIn} title="Увеличить">
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={handleZoomOut} title="Уменьшить">
          <ZoomOut className="h-4 w-4" />
        </Button>
        <div className="w-px h-4 bg-border mx-1" />
        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={handleCenter} title="Центрировать">
          <Target className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={handleFit} title="Вместить всё">
          <Maximize className="h-4 w-4" />
        </Button>
      </div>

      {/* Легенда справа внизу */}
      <div className="absolute right-3 bottom-3 z-10 rounded-xl bg-card border p-4 text-sm pointer-events-none">
        <h3 className="font-semibold mb-3">Легенда</h3>
        <div className="space-y-2">
          {Object.entries(STATUS_COLORS).map(([status, color]) => (
            <div key={status} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-muted-foreground">{STATUS_LABELS[status] ?? status}</span>
            </div>
          ))}
        </div>
      </div>

      {/* T-network-filter: счётчик скрытых одиночных узлов */}
      {!loading && onlyLinked && hiddenCount > 0 && (
        <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-card border shadow-sm px-3 py-1 text-xs text-muted-foreground pointer-events-none">
          Скрыто {hiddenCount} без связей · показаны {graph.nodes.length}
        </div>
      )}

      {loading ? (
        <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Загрузка…</div>
      ) : graph.nodes.length === 0 ? (
        <div className="h-full flex items-center justify-center p-4">
          <Card className="max-w-md"><CardContent className="pt-6 text-center text-sm text-muted-foreground">
            {onlyLinked
              ? "Пока нет связанных рефералов. Привяжи реферера в разделе «Рефералка» или нажми «Все клиенты» чтобы увидеть всю базу."
              : "Нет данных по клиентам"}
          </CardContent></Card>
        </div>
      ) : (
        <ForceGraph2D
          ref={fgRef}
          graphData={graph}
          width={dims.width}
          height={dims.height}
          nodeRelSize={6}
          linkColor={() => "rgba(148,163,184,0.6)"}
          linkWidth={1.5}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          nodeColor={(n) => STATUS_COLORS[n.status] ?? "#64748b"}
          nodeLabel={(n) => `${n.name}\nРефералов: ${n.referralsCount}\nПодписки: ${n.subscriptionIncome} ₽\nРеф. доход: ${n.referralIncome} ₽`}
          nodePointerAreaPaint={(node: any, color: any, ctx: any) => {
            const radius = 5 + Math.min(node.referralsCount * 1.5, 15);
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x!, node.y!, radius + 4, 0, 2 * Math.PI);
            ctx.fill();
          }}
          nodeCanvasObject={(node: any, ctx: any, globalScale: any) => {
            const label = node.name || String(node.id).slice(0, 8);
            const fontSize = 12 / globalScale;
            const radius = 5 + Math.min(node.referralsCount * 1.5, 15);
            
            ctx.beginPath();
            ctx.arc(node.x!, node.y!, radius, 0, 2 * Math.PI);
            ctx.fillStyle = STATUS_COLORS[node.status] ?? "#64748b";
            ctx.fill();
            
            ctx.lineWidth = 1.5 / globalScale;
            ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
            ctx.stroke();

            ctx.font = `${fontSize}px sans-serif`;
            const textWidth = ctx.measureText(label).width;
            const bckgDimensions = [textWidth, fontSize].map((n: any) => n + fontSize * 0.4);

            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(
              node.x! + radius + 3, 
              node.y! - bckgDimensions[1] / 2, 
              bckgDimensions[0], 
              bckgDimensions[1]
            );

            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
            ctx.fillText(label, node.x! + radius + 3 + fontSize * 0.2, node.y!);
          }}
          onEngineStop={() => fgRef.current?.zoomToFit(400, 40)}
        />
      )}
    </div>
  );
}
