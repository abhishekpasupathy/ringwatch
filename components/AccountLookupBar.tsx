"use client";

/**
 * RingWatch — Account Lookup Bar Component
 *
 * Live "Check an account" feature for the dashboard.
 * Supports manual text search + 3 instant demo chips:
 *   🔴 101_20    — Confirmed Ring Member
 *   🟠 201_500   — Exposed Merchant
 *   🔵 300_1000  — Safe Account
 */

import { useState } from "react";
import { Search, AlertTriangle, ShieldCheck, AlertCircle, X, Sparkles, ArrowRight } from "lucide-react";

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

const DEMO_CHIPS = [
  { id: "101_20", label: "Ring Member", color: "bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20" },
  { id: "201_500", label: "Exposed Merchant", color: "bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20" },
  { id: "300_1000", label: "Safe Account", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20" },
];

export default function AccountLookupBar() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);

  async function handleSearch(targetId?: string) {
    const searchId = (targetId ?? query).trim();
    if (!searchId) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch(`/api/lookup?account_id=${encodeURIComponent(searchId)}`);
      const data = await res.json();
      setResult(data);
    } catch {
      setResult({
        found: false,
        accountId: searchId,
        status: "NOT_FOUND",
        message: "Failed to connect to account lookup service.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-[#0d0e14]/90 border-b border-slate-800 p-4">
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        {/* Search input + Demo Chips */}
        <div className="flex-1 w-full space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Check account ID (e.g. 101_20, 201_500, 300_1000)..."
                className="w-full bg-[#111218] border border-slate-700/60 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 transition-colors"
              />
              {query && (
                <button
                  onClick={() => { setQuery(""); setResult(null); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              onClick={() => handleSearch()}
              disabled={loading || !query.trim()}
              className="px-4 py-2 bg-teal-500 hover:bg-teal-400 text-slate-950 font-semibold text-sm rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  Check <ArrowRight size={14} />
                </>
              )}
            </button>
          </div>

          {/* Quick Demo Chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-slate-500 text-xs font-medium">Demo Chips:</span>
            {DEMO_CHIPS.map((chip) => (
              <button
                key={chip.id}
                onClick={() => {
                  setQuery(chip.id);
                  handleSearch(chip.id);
                }}
                className={`text-xs px-2.5 py-1 rounded-full border transition-all flex items-center gap-1.5 ${chip.color}`}
              >
                <span className="font-mono font-bold">{chip.id}</span>
                <span className="opacity-80">({chip.label})</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Result Display Panel */}
      {result && (
        <div className="max-w-5xl mx-auto mt-4 transition-all duration-300">
          {result.status === "NOT_FOUND" && (
            <div className="bg-slate-900/80 border border-slate-700/50 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle size={20} className="text-slate-400 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="text-slate-200 font-semibold text-sm">Account Not Found</h4>
                <p className="text-slate-400 text-xs mt-1">{result.message}</p>
              </div>
            </div>
          )}

          {result.status === "SAFE" && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex items-start gap-3">
              <ShieldCheck size={22} className="text-emerald-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="bg-emerald-500/20 text-emerald-400 text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                    Safe Account
                  </span>
                  <span className="text-slate-400 text-xs font-mono">ID: {result.accountId}</span>
                </div>
                <p className="text-emerald-200 text-xs mt-2 leading-relaxed">{result.message}</p>
              </div>
            </div>
          )}

          {(result.status === "RING_MEMBER" || result.status === "EXPOSED_MERCHANT") && (
            <div
              className={`rounded-xl p-4 border ${
                result.status === "RING_MEMBER"
                  ? "bg-red-500/10 border-red-500/30"
                  : "bg-amber-500/10 border-amber-500/30"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle
                    size={20}
                    className={result.status === "RING_MEMBER" ? "text-red-400" : "text-amber-400"}
                  />
                  <span
                    className={`text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                      result.status === "RING_MEMBER"
                        ? "bg-red-500/20 text-red-400"
                        : "bg-amber-500/20 text-amber-400"
                    }`}
                  >
                    {result.statusLabel}
                  </span>
                  <span className="text-slate-400 text-xs font-mono">ID: {result.accountId}</span>
                  {result.clusterId !== undefined && (
                    <span className="text-slate-500 text-xs">· Cluster #{result.clusterId}</span>
                  )}
                </div>
                {result.suspicionTier && (
                  <span className="text-xs font-semibold text-slate-400 border border-slate-700 px-2 py-0.5 rounded">
                    Tier: {result.suspicionTier}
                  </span>
                )}
              </div>

              <p className="text-slate-200 text-xs mt-2 font-medium">{result.message}</p>

              {result.explanation && (
                <div className="mt-3 bg-slate-950/60 border border-slate-800 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 text-xs text-teal-400 font-semibold mb-1">
                    <Sparkles size={13} /> AI Explanation (Groq)
                  </div>
                  <p className="text-slate-300 text-xs leading-relaxed">{result.explanation}</p>
                </div>
              )}

              {result.structuralEvidence && (
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div className="bg-slate-900/60 p-2 rounded border border-slate-800 text-center">
                    <div className="text-slate-500">Cluster Size</div>
                    <div className="text-white font-bold font-mono">{result.structuralEvidence.clusterSize} accounts</div>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded border border-slate-800 text-center">
                    <div className="text-slate-500">Exposed Merchants</div>
                    <div className="text-amber-400 font-bold font-mono">{result.structuralEvidence.exposedMerchants} accounts</div>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded border border-slate-800 text-center">
                    <div className="text-slate-500">Density</div>
                    <div className="text-teal-400 font-bold font-mono">{result.structuralEvidence.internalEdgeDensity}</div>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded border border-slate-800 text-center">
                    <div className="text-slate-500">Time Bursts</div>
                    <div className={result.structuralEvidence.timeBurstPresent ? "text-red-400 font-bold" : "text-emerald-400 font-bold"}>
                      {result.structuralEvidence.timeBurstPresent ? "DETECTED" : "NONE"}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
