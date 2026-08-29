"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ShieldCheck, AlertTriangle, Eye, Zap } from "lucide-react";
import ForceGraphWrapper, {
  GraphNode,
  GraphLink,
  ForceGraphHandle,
} from "@/components/ForceGraphWrapper";
import NodeInspectorPanel from "@/components/NodeInspectorPanel";
import MetricsPanel from "@/components/MetricsPanel";
import AccountLookupBar from "@/components/AccountLookupBar";

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  clusters: ClusterData[];
}

interface ClusterData {
  id: number;
  communityId: number;
  isFlagged: boolean;
  suspicionTier: "HIGH" | "MEDIUM" | "SAFE";
  memberCount: number;
  illicitMemberCount: number;
  licitMemberCount: number;
  internalEdgeDensity: "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
  timeBurstPresent: boolean;
  paymentFormatCount: number;
}

interface MetricsData {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  f1: number;
  fpCostNote: string;
  computedAt: string;
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
    fetch("/api/graph")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setGraphError(data.error);
        } else {
          setGraphData(data);
        }
      })
      .catch(() => setGraphError("Failed to load graph data"))
      .finally(() => setGraphLoading(false));

    fetch("/api/metrics")
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) setMetrics(data);
      })
      .catch(() => {})
      .finally(() => setMetricsLoading(false));
  }, []);

  function handleNodeClick(node: GraphNode) {
    setSelectedNode(node);
  }

  const handleAccountFocus = useCallback(
    (accountId: string) => {
      if (!graphData) return;
      const node = graphData.nodes.find((n) => n.id === accountId);
      if (node) {
        setSelectedNode(node);
        // Small delay to ensure graph ref is ready after layout
        setTimeout(() => graphRef.current?.focusNode(accountId), 100);
      }
    },
    [graphData]
  );

  const flaggedCount = graphData?.clusters.filter((c) => c.isFlagged).length ?? 0;
  const highRiskCount =
    graphData?.clusters.filter((c) => c.suspicionTier === "HIGH").length ?? 0;
  const exposedCount = graphData?.nodes.filter((n) => n.isExposed).length ?? 0;

  return (
    <div className="flex flex-col h-screen bg-[#07090e] text-white font-sans overflow-hidden">
      {/* ── Top Tactical Header & Stat Bar ───────────────────────────────── */}
      <header className="flex-shrink-0 flex flex-col md:flex-row items-stretch md:items-center justify-between px-6 py-3 border-b border-white/10 bg-[#090d16]/90 backdrop-blur-md z-10 gap-3">
        {/* Brand Title */}
        <div className="flex items-center gap-3">
          <div className="relative flex-shrink-0">
            <div className="w-9 h-9 bg-teal-500/15 border border-teal-500/30 rounded-xl flex items-center justify-center glow-teal-sm">
              <Eye size={18} className="text-teal-400" />
            </div>
            <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-teal-400 rounded-full pulse-indicator" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-white font-extrabold text-base tracking-tight font-heading">
                RingWatch
              </h1>
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-teal-400 bg-teal-500/10 border border-teal-500/25 px-2 py-0.5 rounded-full">
                Sentinel v1.0
              </span>
            </div>
            <p className="text-slate-400 text-xs font-mono">
              Abuse-Ring Fraud Sentinel · IBM AML HI-Small
            </p>
          </div>
        </div>

        {/* Top Summary Stat Cards Bar */}
        <div className="flex items-center gap-2 flex-wrap md:flex-nowrap">
          {/* Rings Detected */}
          <div className="glass-card px-3.5 py-1.5 rounded-xl flex items-center gap-2 border-red-500/30">
            <AlertTriangle size={15} className="text-red-400" />
            <div>
              <div className="text-slate-400 text-[9px] font-bold uppercase tracking-wider">Rings Flagged</div>
              <div className="text-red-400 font-extrabold text-sm font-mono-stat">{flaggedCount}</div>
            </div>
          </div>

          {/* High Risk */}
          <div className="glass-card px-3.5 py-1.5 rounded-xl flex items-center gap-2 border-amber-500/30">
            <Zap size={15} className="text-amber-400" />
            <div>
              <div className="text-slate-400 text-[9px] font-bold uppercase tracking-wider">High Risk</div>
              <div className="text-amber-400 font-extrabold text-sm font-mono-stat">{highRiskCount}</div>
            </div>
          </div>

          {/* Merchants Protected */}
          <div className="glass-card px-3.5 py-1.5 rounded-xl flex items-center gap-2 border-teal-500/30">
            <ShieldCheck size={15} className="text-teal-400" />
            <div>
              <div className="text-slate-400 text-[9px] font-bold uppercase tracking-wider">Merchants Protected</div>
              <div className="text-teal-400 font-extrabold text-sm font-mono-stat">{exposedCount}</div>
            </div>
          </div>

          {/* Evaluation Stat Pills */}
          {metrics && (
            <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
              <div className="glass-card px-2.5 py-1.5 rounded-xl text-center min-w-[55px]">
                <div className="text-slate-400 text-[9px] font-bold uppercase">Prec</div>
                <div className="text-teal-400 font-bold text-xs font-mono-stat">
                  {(metrics.precision * 100).toFixed(0)}%
                </div>
              </div>
              <div className="glass-card px-2.5 py-1.5 rounded-xl text-center min-w-[55px]">
                <div className="text-slate-400 text-[9px] font-bold uppercase">Rec</div>
                <div className="text-teal-400 font-bold text-xs font-mono-stat">
                  {(metrics.recall * 100).toFixed(0)}%
                </div>
              </div>
              <div className="glass-card px-2.5 py-1.5 rounded-xl text-center min-w-[55px]">
                <div className="text-slate-400 text-[9px] font-bold uppercase">F1</div>
                <div className="text-teal-300 font-bold text-xs font-mono-stat">
                  {(metrics.f1 * 100).toFixed(0)}%
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* ── Live Account Lookup Bar ────────────────────────────────────────── */}
      <AccountLookupBar onAccountFocus={handleAccountFocus} />

      {/* ── Main Dashboard Workspace ───────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Force Graph Visualization */}
        <div className="flex-1 relative bg-[#07090e] min-w-0">
          {graphLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#07090e] z-20">
              <div className="text-center">
                <div className="w-10 h-10 border-2 border-teal-400 border-t-transparent rounded-full animate-spin mx-auto mb-3 glow-teal-sm" />
                <p className="text-slate-400 text-xs font-mono tracking-wider">LOADING GRAPH ENGINE…</p>
              </div>
            </div>
          )}

          {graphError && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#07090e] z-20">
              <div className="text-center max-w-sm glass-panel p-6 rounded-2xl border border-slate-800">
                <AlertTriangle className="text-amber-400 mx-auto mb-3" size={32} />
                <p className="text-slate-200 font-bold mb-1">Graph Data Unavailable</p>
                <p className="text-slate-400 text-xs leading-relaxed">{graphError}</p>
              </div>
            </div>
          )}

          {graphData && !graphLoading && (
            <>
              {/* Tactical Legend Overlay */}
              <div className="absolute top-4 left-4 z-10 glass-panel border border-white/10 rounded-xl p-3 shadow-2xl space-y-2">
                <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">
                  Live Network Legend
                </p>
                {[
                  { color: "bg-red-500 glow-red-sm ring-pulse-dot", label: "Ring Member (Illicit)" },
                  { color: "bg-amber-500 glow-amber-sm", label: "Exposed Merchant (Licit)" },
                  { color: "bg-blue-500 glow-teal-sm", label: "Safe Account" },
                ].map(({ color, label }) => (
                  <div key={label} className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
                    <span className="text-slate-300 text-xs font-medium">{label}</span>
                  </div>
                ))}
                <p className="text-slate-400 text-[10px] pt-1 border-t border-white/5 italic">
                  Hover to preview · Click to inspect
                </p>
              </div>

              <ForceGraphWrapper
                ref={graphRef}
                nodes={graphData.nodes}
                links={graphData.links}
                onNodeClick={handleNodeClick}
                selectedNodeId={selectedNode?.id}
              />
            </>
          )}
        </div>

        {/* Node Inspector Panel (slides in on node click) */}
        {selectedNode && (
          <div className="w-80 flex-shrink-0 border-l border-white/10 z-20 overflow-hidden">
            <NodeInspectorPanel
              node={selectedNode}
              onClose={() => setSelectedNode(null)}
            />
          </div>
        )}

        {/* Right: Metrics Panel */}
        <div className="w-80 border-l border-white/10 bg-[#090d16]/95 flex-shrink-0 overflow-hidden">
          <MetricsPanel metrics={metrics} loading={metricsLoading} />
        </div>
      </div>
    </div>
  );
}
