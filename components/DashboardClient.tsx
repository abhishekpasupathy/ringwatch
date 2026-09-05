"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ShieldCheck, AlertTriangle, Eye, Zap, Activity, Network, Target, ChevronRight } from "lucide-react";
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
interface MetricsData {
  tp: number; fp: number; fn: number; tn: number; precision: number; recall: number; f1: number;
  fpCostNote: string; computedAt: string; modelName?: string; evaluationProtocol?: string;
  evaluationLevel?: string; note?: string;
}

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
        const graphResponse = await fetch("/api/graph", { cache: "no-store" });
        const graph = await graphResponse.json();
        if (graph.error) setGraphError(graph.error);
        else setGraphData(graph);
      } catch {
        setGraphError("Failed to load graph data");
      } finally {
        setGraphLoading(false);
      }

      try {
        const metricsResponse = await fetch("/api/metrics", { cache: "no-store" });
        const metricsData = await metricsResponse.json();
        if (!metricsData.error) setMetrics(metricsData);
      } catch {
        // Metrics are supplementary; keep the graph usable if they fail.
      } finally {
        setMetricsLoading(false);
      }
    }

    void loadDashboard();
  }, []);

  const handleAccountFocus = useCallback((accountId: string) => {
    if (!graphData) return;
    const node = graphData.nodes.find((n) => n.id === accountId);
    if (node) {
      setSelectedNode(node);
      setTimeout(() => graphRef.current?.focusNode(accountId), 100);
    }
  }, [graphData]);

  const flaggedCount = graphData?.clusters.filter((c) => c.isFlagged).length ?? 0;
  const highRiskCount = graphData?.clusters.filter((c) => c.suspicionTier === "HIGH").length ?? 0;
  const exposedCount = graphData?.nodes.filter((n) => n.isExposed).length ?? 0;
  const accountCount = graphData?.nodes.length ?? 0;

  return (
    <div className="dashboard-shell flex flex-col h-screen text-white overflow-hidden">
      <header className="flex-shrink-0 border-b border-white/[.06] bg-[#05080d]/90 backdrop-blur-2xl z-30">
        <div className="h-[64px] px-5 lg:px-8 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="relative w-10 h-10 rounded-xl border border-teal-300/20 bg-gradient-to-br from-teal-400/[.14] to-transparent flex items-center justify-center shadow-[0_0_28px_rgba(40,224,179,.08)]">
              <Eye size={19} className="text-teal-200" />
              <span className="absolute -right-0.5 -top-0.5 w-2 h-2 rounded-full bg-teal-300 pulse-indicator shadow-[0_0_10px_rgba(40,224,179,.9)]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="font-extrabold text-[17px] tracking-[-.02em]">RingWatch</h1>
                <span className="hidden sm:inline rounded-full border border-teal-400/15 bg-teal-400/[.06] px-2 py-1 text-[8px] font-mono font-bold tracking-[.15em] text-teal-300/90 uppercase">Fraud Intelligence</span>
              </div>
              <p className="text-[9px] text-slate-500 font-mono tracking-[.08em] truncate mt-0.5">NETWORK ANALYSIS <span className="text-slate-700">/</span> IBM AML HI-SMALL <span className="text-slate-700">/</span> LIVE RISK OPS</p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-[9px] font-mono tracking-[.08em]">
            <div className="hidden md:flex items-center gap-2 text-slate-500"><Activity size={13} className="text-teal-400" /> ENGINE <span className="text-teal-300">ONLINE</span></div>
            <div className="h-5 w-px bg-white/[.08] hidden md:block" />
            <div className="flex items-center gap-2 rounded-full border border-teal-400/10 bg-teal-400/[.035] px-2.5 py-1.5 text-slate-400"><span className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_rgba(40,224,179,.9)]" /> LIVE</div>
          </div>
        </div>
        <div className="px-5 lg:px-8 pb-3.5 grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <Metric label="Accounts analyzed" value={accountCount.toLocaleString()} icon={<Network size={14} />} />
          <Metric label="Rings flagged" value={flaggedCount.toLocaleString()} icon={<AlertTriangle size={14} />} tone="red" />
          <Metric label="High-risk communities" value={highRiskCount.toLocaleString()} icon={<Zap size={14} />} tone="amber" />
          <Metric label="Exposed accounts" value={exposedCount.toLocaleString()} icon={<ShieldCheck size={14} />} />
        </div>
      </header>

      <div className="flex-shrink-0 px-5 lg:px-8 py-2.5 border-b border-white/[.055] bg-[#070a10]/90 flex items-center gap-3">
        <div className="section-label hidden sm:flex items-center gap-2 whitespace-nowrap"><Target size={12} className="text-teal-400/80" /> INVESTIGATE ACCOUNT</div>
        <div className="flex-1"><AccountLookupBar onAccountFocus={handleAccountFocus} /></div>
        <div className="hidden lg:flex items-center gap-1 text-[9px] font-mono text-slate-600 whitespace-nowrap"><span>SEARCH</span><ChevronRight size={11} /></div>
      </div>

      <main className="flex-1 min-h-0 p-3 lg:p-4 flex gap-3 overflow-hidden">
        <section className="flex-1 min-w-0 min-h-0 rounded-[20px] border border-white/[.08] bg-[#070b11] overflow-hidden relative shadow-[0_24px_80px_rgba(0,0,0,.32)] ring-1 ring-white/[.02]">
          <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_55%,rgba(40,224,179,.035),transparent_42%)]" />
          <div className="absolute inset-x-0 top-0 h-20 z-10 pointer-events-none bg-gradient-to-b from-[#070b11] via-[#070b11]/80 to-transparent" />
          <div className="absolute top-4 left-4 z-20 glass-panel rounded-xl px-3.5 py-3 pointer-events-none shadow-xl shadow-black/20">
            <div className="flex items-center gap-2 mb-2.5"><Target size={13} className="text-teal-300" /><span className="section-label text-slate-400">Network map</span><span className="ml-1 text-[8px] font-mono text-slate-600">LIVE</span></div>
            <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[10px] text-slate-400">
              <Legend color="bg-red-400" label="Ring member" glow="glow-red-sm" />
              <Legend color="bg-amber-400" label="Exposed" glow="glow-amber-sm" />
              <Legend color="bg-slate-500" label="Safe" />
            </div>
          </div>
          <div className="absolute top-4 right-4 z-20 glass-panel rounded-xl px-3.5 py-3 text-right pointer-events-none shadow-xl shadow-black/20">
            <div className="section-label">Detection engine</div>
            <div className="text-[10px] text-teal-300 font-mono mt-1.5 tracking-wide">LOUVAIN <span className="text-slate-600">+</span> RISK SCORE</div>
          </div>

          {graphLoading && <div className="absolute inset-0 flex items-center justify-center bg-[#070b11] z-20"><div className="text-center"><div className="w-9 h-9 border-2 border-teal-300 border-t-transparent rounded-full animate-spin mx-auto mb-3" /><p className="text-slate-500 text-[9px] font-mono tracking-[.2em]">INITIALIZING NETWORK</p></div></div>}
          {graphError && <div className="absolute inset-0 flex items-center justify-center bg-[#070b11] z-20"><div className="glass-panel rounded-2xl p-7 text-center max-w-sm"><AlertTriangle className="text-amber-300 mx-auto mb-3" size={28} /><p className="font-semibold text-slate-200 mb-1">Network unavailable</p><p className="text-slate-500 text-xs">{graphError}</p></div></div>}
          {graphData && !graphLoading && <ForceGraphWrapper ref={graphRef} nodes={graphData.nodes} links={graphData.links} onNodeClick={setSelectedNode} selectedNodeId={selectedNode?.id} />}
        </section>

        <aside className="hidden xl:flex w-[348px] 2xl:w-[370px] flex-shrink-0 flex-col gap-3 min-h-0">
          <div className="rounded-[20px] border border-white/[.08] bg-[#090d13] overflow-hidden flex-1 min-h-0 shadow-[0_20px_60px_rgba(0,0,0,.22)]"><MetricsPanel metrics={metrics} loading={metricsLoading} /></div>
          <div className="rounded-[20px] border border-white/[.08] bg-[#090d13] p-4 flex-shrink-0 shadow-[0_20px_60px_rgba(0,0,0,.18)]">
            <div className="flex items-center justify-between mb-3"><span className="section-label">Model health</span><span className="inline-flex items-center gap-1.5 text-[8px] font-mono text-teal-300"><span className="w-1.5 h-1.5 rounded-full bg-teal-400" /> RUNNING</span></div>
            <div className="grid grid-cols-3 gap-2">
              <Health label="PRECISION" value={metrics ? `${(metrics.precision * 100).toFixed(0)}%` : "—"} />
              <Health label="RECALL" value={metrics ? `${(metrics.recall * 100).toFixed(0)}%` : "—"} />
              <Health label="F1" value={metrics ? `${(metrics.f1 * 100).toFixed(0)}%` : "—"} />
            </div>
          </div>
        </aside>

        {selectedNode && <div className="absolute inset-y-3 right-3 z-30 w-[min(348px,calc(100%-24px))] rounded-[20px] overflow-hidden border border-white/[.12] shadow-[0_30px_90px_rgba(0,0,0,.55)] slide-in-right"><NodeInspectorPanel node={selectedNode} onClose={() => setSelectedNode(null)} /></div>}
      </main>
    </div>
  );
}

function Metric({ label, value, icon, tone = "teal" }: { label: string; value: string; icon: React.ReactNode; tone?: "teal" | "red" | "amber" }) {
  const text = tone === "red" ? "text-red-300" : tone === "amber" ? "text-amber-300" : "text-teal-300";
  const chip = tone === "red" ? "bg-red-500/[.07] border-red-500/15" : tone === "amber" ? "bg-amber-500/[.07] border-amber-500/15" : "bg-teal-500/[.07] border-teal-500/15";
  return (
    <div className="glass-card glass-card-hover rounded-[14px] px-3.5 py-3 flex items-center gap-3">
      <div className={`${text} ${chip} border rounded-[10px] p-2 flex items-center justify-center`}>{icon}</div>
      <div className="min-w-0">
        <div className="section-label mb-1.5">{label}</div>
        <div className={`metric-number text-[19px] font-bold ${text}`}>{value}</div>
      </div>
    </div>
  );
}
function Legend({ color, label, glow = "" }: { color: string; label: string; glow?: string }) { return <div className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${color} ${glow}`} />{label}</div>; }
function Health({ label, value }: { label: string; value: string }) { return <div className="rounded-[11px] bg-white/[.025] border border-white/[.06] p-2.5"><div className="text-[8px] font-mono text-slate-500 tracking-wider">{label}</div><div className="metric-number text-sm font-semibold text-slate-200 mt-1">{value}</div></div>; }
