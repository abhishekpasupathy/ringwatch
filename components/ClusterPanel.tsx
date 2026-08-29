"use client";

import { useState } from "react";
import { AlertTriangle, Shield, Users, Zap, CreditCard, MessageSquare, X } from "lucide-react";

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
    label: "HIGH RISK",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    text: "text-red-400",
    dot: "bg-red-500",
    icon: AlertTriangle,
  },
  MEDIUM: {
    label: "MEDIUM RISK",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    text: "text-amber-400",
    dot: "bg-amber-500",
    icon: AlertTriangle,
  },
  SAFE: {
    label: "LOW RISK",
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

  const tier = tierConfig[cluster.suspicionTier];
  const density = densityLabels[cluster.internalEdgeDensity];
  const TierIcon = tier.icon;

  const exposedMerchantCount = cluster.licitMemberCount;

  async function fetchExplanation() {
    if (!cluster.isFlagged) return;
    setLoadingExplanation(true);
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clusterId: cluster.id }),
      });
      const data = await res.json();
      setExplanation(data.explanation ?? "Unable to generate explanation.");
    } catch {
      setExplanation("Failed to connect to the explanation service.");
    } finally {
      setLoadingExplanation(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#0d0e14] border-l border-slate-800">
      {/* Header */}
      <div className={`p-4 border-b border-slate-800 ${tier.bg}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${tier.dot} animate-pulse`} />
            <TierIcon size={14} className={tier.text} />
            <span className={`text-xs font-bold tracking-widest ${tier.text}`}>
              {tier.label}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 transition-colors"
            aria-label="Close cluster panel"
          >
            <X size={16} />
          </button>
        </div>
        <h2 className="text-white font-semibold mt-2">
          Cluster #{cluster.communityId}
        </h2>
        <p className="text-slate-400 text-xs mt-0.5">
          {cluster.memberCount} accounts in ring structure
        </p>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Structural Evidence */}
        <section>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
            Structural Evidence
          </h3>
          <div className="space-y-3">
            {/* Internal connectivity */}
            <div className="bg-slate-900/60 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-400 text-xs flex items-center gap-1.5">
                  <Zap size={12} className="text-teal-400" />
                  Internal Connectivity
                </span>
                <span className={`text-xs font-medium ${density.color}`}>
                  {density.label}
                </span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full ${density.color.replace("text-", "bg-")} rounded-full transition-all duration-700 ${density.bar}`}
                />
              </div>
            </div>

            {/* Time burst */}
            <div className="bg-slate-900/60 rounded-lg p-3 flex items-center justify-between">
              <span className="text-slate-400 text-xs flex items-center gap-1.5">
                <Zap size={12} className="text-teal-400" />
                Synchronized Bursts
              </span>
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  cluster.timeBurstPresent
                    ? "bg-red-500/20 text-red-400"
                    : "bg-emerald-500/20 text-emerald-400"
                }`}
              >
                {cluster.timeBurstPresent ? "DETECTED" : "NOT DETECTED"}
              </span>
            </div>

            {/* Payment formats */}
            <div className="bg-slate-900/60 rounded-lg p-3 flex items-center justify-between">
              <span className="text-slate-400 text-xs flex items-center gap-1.5">
                <CreditCard size={12} className="text-teal-400" />
                Payment Formats Used
              </span>
              <span className="text-white text-xs font-medium">
                {cluster.paymentFormatCount}
              </span>
            </div>

            {/* Account breakdown */}
            <div className="bg-slate-900/60 rounded-lg p-3">
              <span className="text-slate-400 text-xs flex items-center gap-1.5 mb-2">
                <Users size={12} className="text-teal-400" />
                Account Breakdown
              </span>
              <div className="flex gap-2 mt-1">
                <div className="flex-1 text-center bg-red-500/10 rounded p-2">
                  <div className="text-red-400 font-bold text-lg">
                    {cluster.illicitMemberCount}
                  </div>
                  <div className="text-slate-500 text-xs">Ring Members</div>
                </div>
                <div className="flex-1 text-center bg-amber-500/10 rounded p-2">
                  <div className="text-amber-400 font-bold text-lg">
                    {cluster.licitMemberCount}
                  </div>
                  <div className="text-slate-500 text-xs">Exposed</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Protected Merchant Framing */}
        {cluster.isFlagged && exposedMerchantCount > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
              ⚠ Merchant Exposure
            </h3>
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
              <p className="text-amber-300 text-xs leading-relaxed">
                <span className="font-semibold">{exposedMerchantCount} legitimate account{exposedMerchantCount !== 1 ? "s" : ""}</span>{" "}
                transacted directly with members of this ring. Without this flag,
                each of these accounts would have absorbed chargeback liability
                when the real cardholder disputed the transaction — after goods
                were already shipped.
              </p>
              <p className="text-slate-500 text-xs mt-2 italic">
                Accounts shown in amber on the graph. Framing note: IBM AML
                schema maps accounts → merchants for this analysis.
              </p>
            </div>
          </section>
        )}

        {/* LLM Explanation */}
        {cluster.isFlagged && (
          <section>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
              AI Explanation
            </h3>
            <div className="bg-slate-900/60 border border-slate-700/50 rounded-lg p-3">
              <p className="text-slate-500 text-xs mb-3 italic">
                Plain-English summary generated by Groq LLM from structural
                evidence only. The LLM does not make fraud determinations —
                detection is entirely deterministic (graph algorithms).
              </p>
              {explanation ? (
                <p className="text-slate-200 text-sm leading-relaxed">
                  {explanation}
                </p>
              ) : (
                <button
                  onClick={fetchExplanation}
                  disabled={loadingExplanation}
                  className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/30 rounded-lg text-teal-400 text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loadingExplanation ? (
                    <>
                      <div className="w-3.5 h-3.5 border border-teal-400 border-t-transparent rounded-full animate-spin" />
                      Generating…
                    </>
                  ) : (
                    <>
                      <MessageSquare size={14} />
                      Get Plain-English Explanation
                    </>
                  )}
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
