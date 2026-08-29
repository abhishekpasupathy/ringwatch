"use client";

import { useState } from "react";
import { AlertTriangle, Shield, Users, Zap, CreditCard, MessageSquare, X, RefreshCw, AlertCircle } from "lucide-react";

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

interface ClusterPanelProps {
  cluster: ClusterData;
  onClose: () => void;
}

const tierConfig = {
  HIGH: {
    label: "HIGH RISK CLUSTER",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    text: "text-red-400",
    dot: "bg-red-500",
    icon: AlertTriangle,
  },
  MEDIUM: {
    label: "MEDIUM RISK CLUSTER",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    text: "text-amber-400",
    dot: "bg-amber-500",
    icon: AlertTriangle,
  },
  SAFE: {
    label: "LOW RISK CLUSTER",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    text: "text-emerald-400",
    dot: "bg-emerald-500",
    icon: Shield,
  },
};

const densityLabels = {
  LOW: { label: "Low", color: "text-emerald-400", bar: "w-1/4" },
  MEDIUM: { label: "Medium", color: "text-amber-400", bar: "w-2/4" },
  HIGH: { label: "High", color: "text-orange-400", bar: "w-3/4" },
  VERY_HIGH: { label: "Very High", color: "text-red-400", bar: "w-full" },
};

export default function ClusterPanel({ cluster, onClose }: ClusterPanelProps) {
  const [explanation, setExplanation] = useState<string | null>(null);
  const [loadingExplanation, setLoadingExplanation] = useState(false);
  const [errorExplanation, setErrorExplanation] = useState(false);

  const tier = tierConfig[cluster.suspicionTier];
  const density = densityLabels[cluster.internalEdgeDensity];
  const TierIcon = tier.icon;
  const exposedMerchantCount = cluster.licitMemberCount;

  async function fetchExplanation() {
    if (!cluster.isFlagged) return;
    setLoadingExplanation(true);
    setErrorExplanation(false);

    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clusterId: cluster.id }),
      });
      const data = await res.json();
      if (data.explanation && typeof data.explanation === "string") {
        setExplanation(data.explanation);
      } else {
        setErrorExplanation(true);
      }
    } catch {
      setErrorExplanation(true);
    } finally {
      setLoadingExplanation(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#07090e] border-l border-white/10 slide-in-right">
      {/* Header */}
      <div className={`p-4 border-b border-white/10 ${tier.bg}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${tier.dot} animate-pulse`} />
            <TierIcon size={14} className={tier.text} />
            <span className={`text-[10px] font-bold tracking-widest uppercase ${tier.text}`}>
              {tier.label}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
            aria-label="Close cluster panel"
          >
            <X size={16} />
          </button>
        </div>
        <h2 className="text-white font-bold text-base mt-2 tracking-tight">
          Cluster #{cluster.communityId}
        </h2>
        <p className="text-slate-400 text-xs mt-0.5 font-mono">
          {cluster.memberCount} total accounts in graph cluster
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Structural Evidence */}
        <section>
          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">
            Structural Evidence
          </h3>
          <div className="space-y-2.5">
            {/* Density */}
            <div className="glass-card rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-400 text-xs flex items-center gap-1.5 font-medium">
                  <Zap size={13} className="text-teal-400" />
                  Internal Connection Density
                </span>
                <span className={`text-xs font-bold font-mono ${density.color}`}>
                  {density.label}
                </span>
              </div>
              <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden">
                <div
                  className={`h-full ${density.color.replace("text-", "bg-")} rounded-full transition-all duration-700 ${density.bar}`}
                />
              </div>
            </div>

            {/* Time bursts */}
            <div className="glass-card rounded-xl p-3 flex items-center justify-between">
              <span className="text-slate-400 text-xs flex items-center gap-1.5 font-medium">
                <Zap size={13} className="text-teal-400" />
                Synchronized Bursts (&lt;1hr)
              </span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full font-mono ${
                  cluster.timeBurstPresent
                    ? "bg-red-500/20 text-red-400 border border-red-500/30"
                    : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                }`}
              >
                {cluster.timeBurstPresent ? "DETECTED" : "NONE"}
              </span>
            </div>

            {/* Formats */}
            <div className="glass-card rounded-xl p-3 flex items-center justify-between">
              <span className="text-slate-400 text-xs flex items-center gap-1.5 font-medium">
                <CreditCard size={13} className="text-teal-400" />
                Payment Formats Used
              </span>
              <span className="text-white text-xs font-bold font-mono">
                {cluster.paymentFormatCount}
              </span>
            </div>

            {/* Breakdown */}
            <div className="glass-card rounded-xl p-3">
              <span className="text-slate-400 text-xs flex items-center gap-1.5 mb-2 font-medium">
                <Users size={13} className="text-teal-400" />
                Account Breakdown
              </span>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <div className="text-center bg-red-500/10 border border-red-500/20 rounded-lg p-2">
                  <div className="text-red-400 font-bold text-base font-mono">
                    {cluster.illicitMemberCount}
                  </div>
                  <div className="text-slate-400 text-[10px] uppercase font-semibold">Ring Members</div>
                </div>
                <div className="text-center bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
                  <div className="text-amber-400 font-bold text-base font-mono">
                    {cluster.licitMemberCount}
                  </div>
                  <div className="text-slate-400 text-[10px] uppercase font-semibold">Exposed Merchants</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Merchant Exposure */}
        {cluster.isFlagged && exposedMerchantCount > 0 && (
          <section>
            <h3 className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-2 flex items-center gap-1">
              <Shield size={12} /> Merchant Protection Notice
            </h3>
            <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-3.5">
              <p className="text-amber-200 text-xs leading-relaxed">
                <span className="font-bold text-white">{exposedMerchantCount} legitimate merchant{exposedMerchantCount !== 1 ? "s" : ""}</span>{" "}
                transacted directly with members of this ring. RingWatch issued proactive warnings before chargebacks land.
              </p>
            </div>
          </section>
        )}

        {/* LLM Explanation Layer */}
        {cluster.isFlagged && (
          <section>
            <h3 className="text-[10px] font-bold text-teal-400 uppercase tracking-widest mb-2 flex items-center gap-1">
              <MessageSquare size={12} /> AI Analysis (Groq Boundary)
            </h3>
            <div className="glass-card rounded-xl p-3.5 border border-slate-700/50">
              {loadingExplanation && (
                <div className="space-y-2">
                  <div className="h-4 bg-slate-800 rounded animate-shimmer w-full" />
                  <div className="h-4 bg-slate-800 rounded animate-shimmer w-5/6" />
                  <div className="h-4 bg-slate-800 rounded animate-shimmer w-4/6" />
                </div>
              )}

              {!loadingExplanation && explanation && (
                <p className="text-slate-200 text-xs leading-relaxed font-sans">
                  {explanation}
                </p>
              )}

              {!loadingExplanation && errorExplanation && (
                <div className="bg-slate-900/90 border border-slate-700 rounded-lg p-3 text-center">
                  <AlertCircle size={18} className="text-amber-400 mx-auto mb-1.5" />
                  <p className="text-slate-300 text-xs font-medium mb-2">Explanation unavailable</p>
                  <button
                    onClick={fetchExplanation}
                    className="inline-flex items-center gap-1.5 text-xs text-teal-400 hover:text-teal-300 font-semibold"
                  >
                    <RefreshCw size={12} /> Retry Analysis
                  </button>
                </div>
              )}

              {!loadingExplanation && !explanation && !errorExplanation && (
                <button
                  onClick={fetchExplanation}
                  className="w-full py-2.5 px-4 bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/30 rounded-xl text-teal-300 text-xs font-semibold tracking-wide transition-all flex items-center justify-center gap-2"
                >
                  <MessageSquare size={14} /> Generate Plain-English Explanation
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
