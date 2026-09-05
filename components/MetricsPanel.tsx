"use client";

import { AlertTriangle, Info, BarChart2, ShieldAlert } from "lucide-react";

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
    modelName?: string;
    evaluationProtocol?: string;
    evaluationLevel?: string;
    note?: string;
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
    <div className="glass-card rounded-xl p-3.5 text-center border border-white/5 relative overflow-hidden">
      <div className="text-slate-400 text-[10px] font-semibold uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className={`text-2xl font-bold font-mono-stat ${color}`}>
        {value}
      </div>
      {subtitle && (
        <div className="text-slate-500 text-[10px] mt-0.5">{subtitle}</div>
      )}
    </div>
  );
}

function ConfusionCell({
  label,
  value,
  color,
  valueColor,
  description,
}: {
  label: string;
  value: number;
  color: string;
  valueColor: string;
  description: string;
}) {
  return (
    <div className={`rounded-xl p-3 border ${color} text-center`}>
      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className={`text-xl font-bold font-mono-stat ${valueColor}`}>{value}</div>
      <div className="text-[10px] text-slate-400 mt-0.5">{description}</div>
    </div>
  );
}

export default function MetricsPanel({ metrics, loading }: MetricsPanelProps) {
  if (loading) {
    return (
      <div className="p-5 space-y-4">
        <div className="h-4 w-32 bg-slate-800 rounded animate-shimmer" />
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-slate-800/60 rounded-xl animate-shimmer" />
          ))}
        </div>
        <div className="h-32 bg-slate-800/40 rounded-xl animate-shimmer" />
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={15} className="text-amber-400" />
          <span className="text-amber-400 text-xs font-semibold uppercase tracking-wider">
            No Evaluation Metrics
          </span>
        </div>
        <p className="text-slate-400 text-xs leading-relaxed">
          Run evaluation scripts to calculate held-out test metrics:
        </p>
        <pre className="mt-3 text-xs text-teal-400 bg-[#07090e] border border-slate-800 rounded-lg p-2.5 font-mono">
          npm run evaluate
        </pre>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-5 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 pb-3">
        <div className="flex items-center gap-2">
          <BarChart2 size={15} className="text-teal-400" />
          <h2 className="text-slate-200 font-bold text-xs uppercase tracking-wider">
            {metrics.modelName ?? "Test Set Evaluation"}
          </h2>
        </div>
        <span className="text-[10px] text-teal-400 font-mono bg-teal-500/10 border border-teal-500/20 px-2 py-0.5 rounded-full">
          {metrics.evaluationProtocol ?? "20% Temporal Holdout"}
        </span>
      </div>

      {/* Primary Stat Cards — F1 is the headline blended metric, so it gets
          visual priority (glow + brighter border) over its two inputs. */}
      <div className="grid grid-cols-3 gap-2.5">
        <StatCard
          label="Precision"
          value={`${(metrics.precision * 100).toFixed(1)}%`}
          color="text-slate-200"
        />
        <StatCard
          label="Recall"
          value={`${(metrics.recall * 100).toFixed(1)}%`}
          color="text-slate-200"
        />
        <div className="glass-card glow-teal-sm rounded-xl p-3.5 text-center border border-teal-500/35 relative overflow-hidden">
          <div className="text-teal-300/80 text-[10px] font-semibold uppercase tracking-wider mb-1">
            F1 Score
          </div>
          <div className="text-2xl font-bold font-mono-stat text-teal-300">
            {`${(metrics.f1 * 100).toFixed(1)}%`}
          </div>
        </div>
      </div>

      {/* Algorithm Variance Note */}
      <div className="flex items-start gap-2 bg-[#090d16] rounded-xl p-3 border border-slate-800/80">
        <Info size={14} className="text-slate-400 mt-0.5 flex-shrink-0" />
        <p className="text-slate-400 text-[11px] leading-relaxed">
          {metrics.note ?? "Louvain variance can change results slightly across runs. See eval-report.md for details."}
        </p>
      </div>

      {/* Confusion Matrix Grid */}
      <section>
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">
          Confusion Matrix ({metrics.evaluationLevel ?? "Account"})
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <ConfusionCell
            label="True Positive"
            value={metrics.tp}
            color="border-teal-500/30 bg-teal-500/5"
            valueColor="text-teal-300"
            description="Correctly identified risk"
          />
          <ConfusionCell
            label="False Positive"
            value={metrics.fp}
            color="border-amber-500/30 bg-amber-500/5"
            valueColor="text-amber-300"
            description="Legitimate item reviewed"
          />
          <ConfusionCell
            label="False Negative"
            value={metrics.fn}
            color="border-red-500/30 bg-red-500/5"
            valueColor="text-red-300"
            description="Missed risky item"
          />
          <ConfusionCell
            label="True Negative"
            value={metrics.tn}
            color="border-slate-800 bg-slate-900/60"
            valueColor="text-slate-300"
            description="Correctly safe"
          />
        </div>
      </section>

      {/* False-Positive Cost Narrative */}
      <section>
        <div className="flex items-center gap-1.5 mb-2">
          <ShieldAlert size={13} className="text-amber-400" />
          <h3 className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">
            False-Positive Cost Analysis
          </h3>
        </div>
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3.5">
          <p className="text-amber-200/90 text-[11px] leading-relaxed">
            {metrics.fpCostNote}
          </p>
        </div>
      </section>
    </div>
  );
}
