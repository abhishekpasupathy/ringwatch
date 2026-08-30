"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ShieldCheck, AlertTriangle, Eye, Zap, Activity, Search, Network, Target } from "lucide-react";
import ForceGraphWrapper, { GraphNode, GraphLink, ForceGraphHandle } from "@/components/ForceGraphWrapper";
import NodeInspectorPanel from "@/components/NodeInspectorPanel";
import MetricsPanel from "@/components/MetricsPanel";
import AccountLookupBar from "@/components/AccountLookupBar";

interface GraphData { nodes: GraphNode[]; links: GraphLink[]; clusters: ClusterData[]; }
interface ClusterData {
  id: number; communityId: number; isFlagged: boolean; suspicionTier: "HIGH" | "MEDIUM" | "SAFE";
  memberCount: number; illicitMemberCount: number; licitMemberCount: number;
  internalEdgeDensity: "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH"; timeBurstPresent: boolean; paymentFormatCount: number;
}
interface MetricsData { tp: number; fp: number; fn: number; tn: number; precision: number; recall: number; f1: number; fpCostNote: string; computedAt: string; }

export default function DashboardClient() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [graphLoading, setGraphLoading] = useState(true);
  const graphRef = useRef<ForceGraphHandle>(null);

  useEffect(() => {
    async function loadDashboard() {
      try {
        // The graph route can seed an empty database. Wait for it before
        // requesting metrics so a first visit does not show a false 404.
        const graphResponse = await fetch("/api/graph");
        const graph = await graphResponse.json();
        if (graph.error) setGraphError(graph.error);
        else setGraphData(graph);
      } catch {
        setGraphError("Failed to load graph data");
      } finally {
        setGraphLoading(false);
      }

      try {
        const metricsResponse = await fetch("/api/metrics");
        const metricsData = await metricsResponse.json();
        if (!metricsData.error) setMetrics(metricsData);
      } finally {
        setMetricsLoading(false);
      }
    }

    void loadDashboard();
  }, []);

  const handleAccountFocus = useCallback((accountId: string) => {
    if (!graphData) return;
    const node = graphData.nodes.find(n => n.id === accountId);
    if (node) { setSelectedNode(node); setTimeout(() => graphRef.current?.focusNode(accountId), 100); }
  }, [graphData]);

  const flaggedCount = graphData?.clusters.filter(c => c.isFlagged).length ?? 0;
  const highRiskCount = graphData?.clusters.filter(c => c.suspicionTier === "HIGH").length ?? 0;
  const exposedCount = graphData?.nodes.filter(n => n.isExposed).length ?? 0;
  const accountCount = graphData?.nodes.length ?? 0;

  return (
    <div className="dashboard-shell flex flex-col h-screen text-white overflow-hidden">
      <header className="flex-shrink-0 border-b border-white/[.07] bg-[#070a0f]/95 backdrop-blur-xl z-30">
        <div className="h-[58px] px-5 lg:px-7 flex items-center justify-between gap-5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative w-9 h-9 rounded-xl border border-teal-400/25 bg-teal-400/[.07] flex items-center justify-center">
              <Eye size={18} className="text-teal-300" />
              <span className="absolute -right-0.5 -top-0.5 w-2 h-2 rounded-full bg-teal-300 pulse-indicator" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-extrabold text-[15px] tracking-tight">RingWatch</h1>
                <span className="hidden sm:inline text-[9px] font-mono font-bold tracking-[.16em] text-teal-300/90 uppercase">Fraud intelligence</span>
              </div>
              <p className="text-[10px] text-slate-500 font-mono truncate">NETWORK ANALYSIS / IBM AML HI-SMALL</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-mono">
            <div className="hidden md:flex items-center gap-2 text-slate-500"><Activity size={13} className="text-teal-400" /> ANALYSIS ENGINE <span className="text-teal-300">ONLINE</span></div>
            <div className="h-5 w-px bg-white/[.08] hidden md:block" />
            <div className="flex items-center gap-2 text-slate-400"><span className="w-1.5 h-1.5 rounded-full bg-teal-400" /> LIVE</div>
          </div>
        </div>
        <div className="px-5 lg:px-7 pb-3 pt-1 grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <Metric label="Accounts analyzed" value={accountCount.toLocaleString()} icon={<Network size={14} />} />
          <Metric label="Rings flagged" value={flaggedCount.toLocaleString()} icon={<AlertTriangle size={14} />} tone="red" />
          <Metric label="High-risk communities" value={highRiskCount.toLocaleString()} icon={<Zap size={14} />} tone="amber" />
          <Metric label="Exposed accounts" value={exposedCount.toLocaleString()} icon={<ShieldCheck size={14} />} />
        </div>
      </header>

      <div className="flex-shrink-0 px-5 lg:px-7 py-2 border-b border-white/[.06] bg-[#080b11] flex items-center gap-3">
        <div className="section-label hidden sm:flex items-center gap-2 whitespace-nowrap"><Search size={12} /> ACCOUNT SEARCH</div>
        <div className="flex-1"><AccountLookupBar onAccountFocus={handleAccountFocus} /></div>
      </div>

      <main className="flex-1 min-h-0 p-3 lg:p-4 flex gap-3 overflow-hidden">
        <section className="flex-1 min-w-0 min-h-0 rounded-2xl border border-white/[.08] bg-[#080c12] overflow-hidden relative shadow-2xl">
          <div className="absolute inset-x-0 top-0 h-14 z-10 pointer-events-none bg-gradient-to-b from-[#080c12] to-transparent" />
          <div className="absolute top-4 left-4 z-20 glass-panel rounded-xl px-3 py-2.5 pointer-events-none">
            <div className="flex items-center gap-2 mb-2"><Target size={13} className="text-teal-300" /><span className="section-label">Network map</span></div>
            <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[10px] text-slate-400">
              <Legend color="bg-red-400" label="Illicit" glow="glow-red-sm" />
              <Legend color="bg-amber-400" label="Exposed" glow="glow-amber-sm" />
              <Legend color="bg-slate-500" label="Safe" />
            </div>
          </div>
          <div className="absolute top-4 right-4 z-20 glass-panel rounded-xl px-3 py-2 text-right pointer-events-none">
            <div className="section-label">Detection mode</div>
            <div className="text-[11px] text-teal-300 font-mono mt-1">LOUVAIN / RISK SCORING</div>
          </div>

          {graphLoading && <div className="absolute inset-0 flex items-center justify-center bg-[#080c12] z-20"><div className="text-center"><div className="w-9 h-9 border-2 border-teal-300 border-t-transparent rounded-full animate-spin mx-auto mb-3" /><p className="text-slate-500 text-[10px] font-mono tracking-[.18em]">INITIALIZING NETWORK</p></div></div>}
          {graphError && <div className="absolute inset-0 flex items-center justify-center bg-[#080c12] z-20"><div className="glass-panel rounded-2xl p-7 text-center max-w-sm"><AlertTriangle className="text-amber-300 mx-auto mb-3" size={28} /><p className="font-semibold text-slate-200 mb-1">Network unavailable</p><p className="text-slate-500 text-xs">{graphError}</p></div></div>}
          {graphData && !graphLoading && <ForceGraphWrapper ref={graphRef} nodes={graphData.nodes} links={graphData.links} onNodeClick={setSelectedNode} selectedNodeId={selectedNode?.id} />}
        </section>

        <aside className="hidden xl:flex w-[330px] 2xl:w-[360px] flex-shrink-0 flex-col gap-3 min-h-0">
          <div className="rounded-2xl border border-white/[.08] bg-[#0a0e14] overflow-hidden flex-1 min-h-0"><MetricsPanel metrics={metrics} loading={metricsLoading} /></div>
          <div className="rounded-2xl border border-white/[.08] bg-[#0a0e14] p-4 flex-shrink-0">
            <div className="flex items-center justify-between mb-3"><span className="section-label">Model health</span><span className="text-[9px] font-mono text-teal-300">RUNNING</span></div>
            <div className="grid grid-cols-3 gap-2">
              <Health label="PRECISION" value={metrics ? `${(metrics.precision * 100).toFixed(0)}%` : "—"} />
              <Health label="RECALL" value={metrics ? `${(metrics.recall * 100).toFixed(0)}%` : "—"} />
              <Health label="F1" value={metrics ? `${(metrics.f1 * 100).toFixed(0)}%` : "—"} />
            </div>
          </div>
        </aside>

        {selectedNode && <div className="absolute inset-y-3 right-3 z-30 w-[min(330px,calc(100%-24px))] rounded-2xl overflow-hidden border border-white/[.1] shadow-2xl slide-in-right"><NodeInspectorPanel node={selectedNode} onClose={() => setSelectedNode(null)} /></div>}
      </main>
    </div>
  );
}

function Metric({ label, value, icon, tone = "teal" }: { label: string; value: string; icon: React.ReactNode; tone?: "teal" | "red" | "amber" }) {
  const text = tone === "red" ? "text-red-300" : tone === "amber" ? "text-amber-300" : "text-teal-300";
  return <div className="glass-card rounded-xl px-3.5 py-2.5 flex items-center gap-3"><div className={`${text} opacity-90`}>{icon}</div><div className="min-w-0"><div className="section-label mb-1">{label}</div><div className={`metric-number text-[15px] font-bold ${text}`}>{value}</div></div></div>;
}
function Legend({ color, label, glow = "" }: { color: string; label: string; glow?: string }) { return <div className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${color} ${glow}`} />{label}</div>; }
function Health({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-white/[.025] border border-white/[.06] p-2"><div className="text-[8px] font-mono text-slate-500 tracking-wider">{label}</div><div className="metric-number text-xs text-slate-200 mt-1">{value}</div></div>; }
