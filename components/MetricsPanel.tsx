"use client";

import { AlertTriangle, Info } from "lucide-react";

interface MetricsPanelProps {
  metrics: {
    tp: number;
    fp: number;
    fn: number;
    tn: number;
    precision: number;
    recall: number;
    f1: number;
    fpCostNote: string;
    computedAt: string;
  } | null;
  loading?: boolean;
}

function StatCard({
  label,
  value,
  subtitle,
  color,
}: {
  label: string;
  value: string;
  subtitle?: string;
  color: string;
}) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center">
      <div className={`text-3xl font-bold font-mono ${color}`}>{value}</div>
      <div className="text-slate-400 text-xs font-medium mt-1 uppercase tracking-wider">
        {label}
      </div>
      {subtitle && (
        <div className="text-slate-600 text-xs mt-0.5">{subtitle}</div>
      )}
    </div>
  );
}

function ConfusionCell({
  label,
  value,
  color,
  description,
}: {
  label: string;
  value: number;
  color: string;
  description: string;
}) {
  return (
    <div className={`rounded-lg p-3 border ${color} text-center`}>
      <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className="text-2xl font-bold font-mono text-white">{value}</div>
      <div className="text-xs text-slate-600 mt-1">{description}</div>
    </div>
  );
}

export default function MetricsPanel({ metrics, loading }: MetricsPanelProps) {
  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
          <h2 className="text-slate-300 font-semibold uppercase tracking-wider text-xs">
            Detection Metrics
          </h2>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-slate-900/60 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle size={14} className="text-amber-400" />
          <span className="text-amber-400 text-xs font-medium">
            No metrics available
          </span>
        </div>
        <p className="text-slate-500 text-xs leading-relaxed">
          Run the evaluation scripts to generate metrics:
        </p>
        <pre className="mt-2 text-xs text-teal-400 bg-slate-900 rounded p-2 overflow-x-auto">
          {`npx tsx scripts/04-evaluate.ts`}
        </pre>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-5 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-teal-400" />
          <h2 className="text-slate-300 font-semibold uppercase tracking-wider text-xs">
            Detection Metrics
          </h2>
        </div>
        <span className="text-slate-600 text-xs">Held-out TEST set</span>
      </div>

      {/* Primary Metrics */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard
          label="Precision"
          value={`${(metrics.precision * 100).toFixed(1)}%`}
          color="text-teal-400"
        />
        <StatCard
          label="Recall"
          value={`${(metrics.recall * 100).toFixed(1)}%`}
          color="text-teal-400"
        />
        <StatCard
          label="F1 Score"
          value={`${(metrics.f1 * 100).toFixed(1)}%`}
          color="text-teal-300"
        />
      </div>

      {/* Louvain variance note */}
      <div className="flex items-start gap-2 bg-slate-900/40 rounded-lg p-2.5 border border-slate-800">
        <Info size={12} className="text-slate-500 mt-0.5 flex-shrink-0" />
        <p className="text-slate-500 text-xs leading-relaxed">
          Louvain algorithm variance: ±1–2% across runs.{" "}
          <span className="text-slate-600">
            See eval-report.md for details.
          </span>
        </p>
      </div>

      {/* Confusion Matrix */}
      <div>
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">
          Confusion Matrix
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <ConfusionCell
            label="TP"
            value={metrics.tp}
            color="border-teal-500/30 bg-teal-500/5"
            description="Correctly flagged"
          />
          <ConfusionCell
            label="FP"
            value={metrics.fp}
            color="border-amber-500/30 bg-amber-500/5"
            description="False alarm"
          />
          <ConfusionCell
            label="FN"
            value={metrics.fn}
            color="border-red-500/30 bg-red-500/5"
            description="Missed ring"
          />
          <ConfusionCell
            label="TN"
            value={metrics.tn}
            color="border-slate-700 bg-slate-900/60"
            description="Correctly safe"
          />
        </div>
      </div>

      {/* False-Positive Cost */}
      <div>
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">
          False-Positive Cost
        </h3>
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
          <p className="text-amber-200/80 text-xs leading-relaxed">
            {metrics.fpCostNote}
          </p>
        </div>
      </div>

      {/* Computed timestamp */}
      <p className="text-slate-700 text-xs text-right">
        Computed:{" "}
        {new Date(metrics.computedAt).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
    </div>
  );
}
