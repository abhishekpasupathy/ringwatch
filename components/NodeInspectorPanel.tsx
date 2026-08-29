"use client";

import { useEffect, useState } from "react";
import {
  X,
  AlertTriangle,
  ShieldCheck,
  Zap,
  CreditCard,
  Users,
  Sparkles,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { GraphNode } from "@/components/ForceGraphWrapper";

interface LookupResult {
  found: boolean;
  accountId: string;
  status: "RING_MEMBER" | "EXPOSED_MERCHANT" | "SAFE" | "NOT_FOUND";
  statusLabel?: string;
  clusterId?: number;
  suspicionTier?: "HIGH" | "MEDIUM" | "SAFE";
  message: string;
  explanation?: string;
  structuralEvidence?: {
    clusterSize: number;
    illicitMembers: number;
    exposedMerchants: number;
    internalEdgeDensity: string;
    timeBurstPresent: boolean;
    paymentFormatCount: number;
  };
}

interface NodeInspectorPanelProps {
  node: GraphNode;
  onClose: () => void;
}

const statusConfig = {
  RING_MEMBER: {
    label: "Ring Member",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    badge: "bg-red-500/20 text-red-400 border-red-500/30",
    dot: "bg-red-500",
    icon: AlertTriangle,
  },
  EXPOSED_MERCHANT: {
    label: "Exposed Merchant",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    badge: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    dot: "bg-amber-500",
    icon: AlertTriangle,
  },
  SAFE: {
    label: "Safe Account",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    badge: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    dot: "bg-blue-500",
    icon: ShieldCheck,
  },
  NOT_FOUND: {
    label: "Unknown",
    bg: "bg-slate-500/10",
    border: "border-slate-500/30",
    badge: "bg-slate-500/20 text-slate-400 border-slate-500/30",
    dot: "bg-slate-500",
    icon: AlertCircle,
  },
};

function nodeToStatus(node: GraphNode): keyof typeof statusConfig {
  if (node.isIllicit) return "RING_MEMBER";
  if (node.isExposed) return "EXPOSED_MERCHANT";
  return "SAFE";
}

export default function NodeInspectorPanel({ node, onClose }: NodeInspectorPanelProps) {
  const [result, setResult] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setResult(null);

    fetch(`/api/lookup?account_id=${encodeURIComponent(node.id)}`)
      .then((r) => r.json())
      .then((data: LookupResult) => {
        if (!cancelled) {
          setResult(data);
          if (!data.found && data.status !== "NOT_FOUND") setError(true);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [node.id]);

  const status = result?.status ?? nodeToStatus(node);
  const config = statusConfig[status] ?? statusConfig.SAFE;
  const StatusIcon = config.icon;

  return (
    <div className="flex flex-col h-full bg-[#07090e] border-l border-white/10 slide-in-right">
      {/* Header */}
      <div className={`p-4 border-b border-white/10 ${config.bg}`}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Node Inspector
          </span>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/5"
            aria-label="Close inspector"
          >
            <X size={16} />
          </button>
        </div>

        {/* Account ID — prominent for demo readout */}
        <h2 className="text-white font-extrabold text-2xl font-mono tracking-tight leading-none">
          {node.id}
        </h2>

        <div className="flex items-center gap-2 mt-3">
          <div className={`w-2 h-2 rounded-full ${config.dot}`} />
          <StatusIcon size={14} className={config.badge.split(" ")[1]} />
          <span
            className={`text-[10px] font-bold tracking-widest uppercase px-2.5 py-0.5 rounded-full border ${config.badge}`}
          >
            {result?.statusLabel ?? config.label}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && (
          <div className="space-y-3">
            <div className="h-4 bg-slate-800 rounded animate-shimmer w-full" />
            <div className="h-4 bg-slate-800 rounded animate-shimmer w-5/6" />
            <div className="h-20 bg-slate-800 rounded animate-shimmer w-full" />
          </div>
        )}

        {error && !loading && (
          <div className="glass-card rounded-xl p-4 text-center">
            <AlertCircle size={20} className="text-amber-400 mx-auto mb-2" />
            <p className="text-slate-300 text-xs">Failed to load account details.</p>
          </div>
        )}

        {!loading && result && (
          <>
            {/* Cluster ID */}
            {(result.clusterId !== undefined || node.clusterId !== undefined) && (
              <section>
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                  Cluster
                </h3>
                <div className="glass-card rounded-xl p-3">
                  <span className="text-white font-bold font-mono text-sm">
                    Cluster #{result.clusterId ?? node.clusterId}
                  </span>
                  {result.suspicionTier && result.suspicionTier !== "SAFE" && (
                    <span className="ml-2 text-[10px] font-bold text-slate-300 border border-slate-700 bg-slate-900 px-2 py-0.5 rounded-full">
                      {result.suspicionTier} RISK
                    </span>
                  )}
                </div>
              </section>
            )}

            {/* Status message */}
            <section>
              <p className="text-slate-300 text-xs leading-relaxed">{result.message}</p>
            </section>

            {/* Structural evidence */}
            {result.structuralEvidence && (
              <section>
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                  Structural Evidence
                </h3>
                <div className="space-y-2.5">
                  <div className="glass-card rounded-xl p-3 flex items-center justify-between">
                    <span className="text-slate-400 text-xs flex items-center gap-1.5 font-medium">
                      <Users size={13} className="text-teal-400" />
                      Cluster Size
                    </span>
                    <span className="text-white text-xs font-bold font-mono">
                      {result.structuralEvidence.clusterSize} accounts
                    </span>
                  </div>

                  <div className="glass-card rounded-xl p-3 flex items-center justify-between">
                    <span className="text-slate-400 text-xs flex items-center gap-1.5 font-medium">
                      <Zap size={13} className="text-teal-400" />
                      Internal Connection Density
                    </span>
                    <span className="text-teal-400 text-xs font-bold font-mono">
                      {result.structuralEvidence.internalEdgeDensity}
                    </span>
                  </div>

                  <div className="glass-card rounded-xl p-3 flex items-center justify-between">
                    <span className="text-slate-400 text-xs flex items-center gap-1.5 font-medium">
                      <Zap size={13} className="text-teal-400" />
                      Synchronized Bursts (&lt;1hr)
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full font-mono ${
                        result.structuralEvidence.timeBurstPresent
                          ? "bg-red-500/20 text-red-400 border border-red-500/30"
                          : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      }`}
                    >
                      {result.structuralEvidence.timeBurstPresent ? "DETECTED" : "NONE"}
                    </span>
                  </div>

                  <div className="glass-card rounded-xl p-3 flex items-center justify-between">
                    <span className="text-slate-400 text-xs flex items-center gap-1.5 font-medium">
                      <CreditCard size={13} className="text-teal-400" />
                      Payment Formats Used
                    </span>
                    <span className="text-white text-xs font-bold font-mono">
                      {result.structuralEvidence.paymentFormatCount}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="text-center bg-red-500/10 border border-red-500/20 rounded-lg p-2">
                      <div className="text-red-400 font-bold text-base font-mono">
                        {result.structuralEvidence.illicitMembers}
                      </div>
                      <div className="text-slate-400 text-[10px] uppercase font-semibold">
                        Ring Members
                      </div>
                    </div>
                    <div className="text-center bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
                      <div className="text-amber-400 font-bold text-base font-mono">
                        {result.structuralEvidence.exposedMerchants}
                      </div>
                      <div className="text-slate-400 text-[10px] uppercase font-semibold">
                        Exposed Merchants
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Safe account reassurance */}
            {status === "SAFE" && (
              <section>
                <div className="bg-blue-500/10 border border-blue-500/25 rounded-xl p-3.5">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldCheck size={16} className="text-blue-400" />
                    <span className="text-blue-300 text-xs font-bold uppercase tracking-wider">
                      No Suspicious Pattern
                    </span>
                  </div>
                  <p className="text-blue-100/80 text-xs leading-relaxed">
                    This account shows no coordinated ring activity. Transaction patterns are
                    consistent with normal merchant behavior and present zero chargeback exposure.
                  </p>
                </div>
              </section>
            )}

            {/* Groq explanation for flagged accounts */}
            {result.explanation && status !== "SAFE" && (
              <section>
                <h3 className="text-[10px] font-bold text-teal-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                  <Sparkles size={12} /> AI Analysis (Groq)
                </h3>
                <div className="glass-card rounded-xl p-3.5 border border-slate-700/50">
                  <p className="text-slate-200 text-xs leading-relaxed font-sans">
                    {result.explanation}
                  </p>
                </div>
              </section>
            )}

            {/* Retry if flagged but no explanation */}
            {!result.explanation && status !== "SAFE" && status !== "NOT_FOUND" && (
              <section>
                <button
                  onClick={() => {
                    setLoading(true);
                    fetch(`/api/lookup?account_id=${encodeURIComponent(node.id)}`)
                      .then((r) => r.json())
                      .then((data: LookupResult) => setResult(data))
                      .finally(() => setLoading(false));
                  }}
                  className="w-full py-2.5 px-4 bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/30 rounded-xl text-teal-300 text-xs font-semibold tracking-wide transition-all flex items-center justify-center gap-2"
                >
                  <RefreshCw size={14} /> Reload Analysis
                </button>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
