"use client";

import { useState, useEffect } from "react";
import { Activity, Shield, AlertTriangle, Eye } from "lucide-react";
import ForceGraphWrapper, {
  GraphNode,
  GraphLink,
} from "@/components/ForceGraphWrapper";
import ClusterPanel from "@/components/ClusterPanel";
import MetricsPanel from "@/components/MetricsPanel";

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
  const [selectedCluster, setSelectedCluster] = useState<ClusterData | null>(
    null
  );
  const [graphError, setGraphError] = useState<string | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [graphLoading, setGraphLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"graph" | "metrics">("graph");

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
    if (!graphData) return;
    const cluster = graphData.clusters.find((c) => c.id === node.clusterId);
    if (cluster) setSelectedCluster(cluster);
  }

  const flaggedCount = graphData?.clusters.filter((c) => c.isFlagged).length ?? 0;
  const highRiskCount =
    graphData?.clusters.filter((c) => c.suspicionTier === "HIGH").length ?? 0;
  const exposedCount = graphData?.nodes.filter((n) => n.isExposed).length ?? 0;

  return (
    <div className="flex flex-col h-screen bg-[#0a0b0f] text-white font-sans">
      {/* ── Top Nav ───────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 flex items-center justify-between px-6 py-3 border-b border-slate-800/80 bg-[#0a0b0f]/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-8 h-8 bg-teal-500/20 rounded-lg flex items-center justify-center">
              <Eye size={16} className="text-teal-400" />
            </div>
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-teal-400 rounded-full animate-pulse" />
          </div>
          <div>
            <h1 className="text-white font-bold text-sm tracking-tight">
              RingWatch
            </h1>
            <p className="text-slate-500 text-xs">
              Abuse-Ring Sentinel · IBM AML HI-Small
            </p>
          </div>
        </div>

        {/* Summary stats bar */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={13} className="text-red-400" />
            <span className="text-red-400 font-semibold text-sm">
              {flaggedCount}
            </span>
            <span className="text-slate-500 text-xs">Rings Detected</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Activity size={13} className="text-amber-400" />
            <span className="text-amber-400 font-semibold text-sm">
              {highRiskCount}
            </span>
            <span className="text-slate-500 text-xs">High Risk</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Shield size={13} className="text-amber-300" />
            <span className="text-amber-300 font-semibold text-sm">
              {exposedCount}
            </span>
            <span className="text-slate-500 text-xs">Merchants Protected</span>
          </div>
          {metrics && (
            <div className="flex items-center gap-3 ml-4 pl-4 border-l border-slate-800">
              <div className="text-center">
                <div className="text-teal-400 font-bold text-sm font-mono">
                  {(metrics.precision * 100).toFixed(0)}%
                </div>
                <div className="text-slate-600 text-xs">Prec</div>
              </div>
              <div className="text-center">
                <div className="text-teal-400 font-bold text-sm font-mono">
                  {(metrics.recall * 100).toFixed(0)}%
                </div>
                <div className="text-slate-600 text-xs">Rec</div>
              </div>
              <div className="text-center">
                <div className="text-teal-300 font-bold text-sm font-mono">
                  {(metrics.f1 * 100).toFixed(0)}%
                </div>
                <div className="text-slate-600 text-xs">F1</div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Graph or Metrics panel (tabs on mobile, side-by-side desktop) */}
        <div className="flex flex-1 overflow-hidden">
          {/* Force Graph */}
          <div className="flex-1 relative">
            {graphLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#0a0b0f]">
                <div className="text-center">
                  <div className="w-10 h-10 border-2 border-teal-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-slate-400 text-sm">Loading transaction graph…</p>
                </div>
              </div>
            )}

            {graphError && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center max-w-sm">
                  <AlertTriangle className="text-amber-400 mx-auto mb-3" size={32} />
                  <p className="text-slate-300 font-medium mb-2">No Graph Data</p>
                  <p className="text-slate-500 text-sm">{graphError}</p>
                  <p className="text-slate-600 text-xs mt-3">
                    Run the ingestion + evaluation scripts, then reload.
                  </p>
                </div>
              </div>
            )}

            {graphData && !graphLoading && (
              <>
                {/* Legend */}
                <div className="absolute top-4 left-4 z-10 flex flex-col gap-1.5 bg-[#0d0e14]/90 backdrop-blur-sm border border-slate-800 rounded-lg p-3">
                  <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">
                    Legend
                  </p>
                  {[
                    { color: "bg-red-500", label: "Ring Member (Illicit)" },
                    { color: "bg-amber-500", label: "Exposed Merchant (Licit)" },
                    { color: "bg-blue-500", label: "Safe Account" },
                  ].map(({ color, label }) => (
                    <div key={label} className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
                      <span className="text-slate-400 text-xs">{label}</span>
                    </div>
                  ))}
                  <p className="text-slate-600 text-xs mt-1 italic">
                    Click a node to inspect
                  </p>
                </div>

                <ForceGraphWrapper
                  nodes={graphData.nodes}
                  links={graphData.links}
                  onNodeClick={handleNodeClick}
                  selectedClusterId={selectedCluster?.id}
                />
              </>
            )}
          </div>

          {/* Right: Metrics panel (always visible, fixed width) */}
          <div className="w-80 border-l border-slate-800 overflow-y-auto flex-shrink-0">
            <MetricsPanel metrics={metrics} loading={metricsLoading} />
          </div>
        </div>

        {/* Cluster detail panel (slides in on node click) */}
        {selectedCluster && (
          <div className="w-72 flex-shrink-0 border-l border-slate-800 overflow-hidden">
            <ClusterPanel
              cluster={selectedCluster}
              onClose={() => setSelectedCluster(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
