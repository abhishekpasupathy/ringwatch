"use client";

/**
 * RingWatch — Account Lookup Bar Component (Redesigned)
 *
 * Prominent tactical search input + glowing pill demo chips:
 *   🔴 101_20    — Confirmed Ring Member
 *   🟠 201_500   — Exposed Merchant
 *   🔵 300_1000  — Safe Account
 */

import { useEffect, useState } from "react";
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

const DEMO_CHIP_CONFIG = [
  { key: "ringMember", label: "Ring Member", color: "bg-red-500/10 text-red-400 border-red-500/40 hover:bg-red-500/20 shadow-sm shadow-red-500/10" },
  { key: "exposedMerchant", label: "Exposed Merchant", color: "bg-amber-500/10 text-amber-400 border-amber-500/40 hover:bg-amber-500/20 shadow-sm shadow-amber-500/10" },
  { key: "safeAccount", label: "Safe Account", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/20 shadow-sm shadow-emerald-500/10" },
] as const;

type DemoAccounts = Record<(typeof DEMO_CHIP_CONFIG)[number]["key"], string | null>;

interface AccountLookupBarProps {
  onAccountFocus?: (accountId: string) => void;
}

export default function AccountLookupBar({ onAccountFocus }: AccountLookupBarProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [demoAccounts, setDemoAccounts] = useState<DemoAccounts | null>(null);

  useEffect(() => {
    fetch("/api/demo-accounts")
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (data && !data.error) setDemoAccounts(data);
      })
      .catch(() => undefined);
  }, []);

  async function handleSearch(targetId?: string) {
    const searchId = (targetId ?? query).trim();
    if (!searchId) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch(`/api/lookup?account_id=${encodeURIComponent(searchId)}`);
      const data = await res.json();
      setResult(data);
      // Focus graph and open inspector panel when account is found in graph
      if (data.found && onAccountFocus) {
        onAccountFocus(searchId);
      }
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
    <div className="bg-[#0b0f19]/95 border-b border-white/10 p-4">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search input + Demo Chips */}
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Lookup account ID (e.g. 101_20, 201_500, 300_1000)..."
                className="w-full bg-[#131b2e] border border-slate-700/80 rounded-xl pl-10 pr-9 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400 font-mono transition-all"
              />
              {query && (
                <button
                  onClick={() => { setQuery(""); setResult(null); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X size={15} />
                </button>
              )}
            </div>
            <button
              onClick={() => handleSearch()}
              disabled={loading || !query.trim()}
              className="px-5 py-2.5 bg-teal-400 hover:bg-teal-300 text-slate-950 font-bold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center gap-1.5 shadow-lg shadow-teal-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  Inspect <ArrowRight size={14} />
                </>
              )}
            </button>
          </div>

          {/* Quick Demo Chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Live Demo Chips:</span>
            {DEMO_CHIP_CONFIG.map((chip) => {
              const accountId = demoAccounts?.[chip.key];
              if (!accountId) return null;
              return (
              <button
                key={chip.key}
                onClick={() => {
                  setQuery(accountId);
                  handleSearch(accountId);
                }}
                className={`text-xs px-3 py-1 rounded-full border transition-all flex items-center gap-1.5 font-medium ${chip.color}`}
              >
                <span className="font-mono font-bold">{accountId}</span>
                <span className="opacity-80">({chip.label})</span>
              </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Loading Skeleton */}
      {loading && (
        <div className="max-w-6xl mx-auto mt-3 h-20 bg-[#131b2e] border border-slate-800 rounded-xl animate-shimmer" />
      )}

      {/* Result Display Panel */}
      {result && !loading && (
        <div className="max-w-6xl mx-auto mt-3 transition-all duration-300">
          {result.status === "NOT_FOUND" && (
            <div className="bg-[#141b2d] border border-slate-700/60 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle size={20} className="text-slate-400 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="text-slate-200 font-bold text-sm">Account Not Found</h4>
                <p className="text-slate-400 text-xs mt-1 font-mono">{result.message}</p>
              </div>
            </div>
          )}

          {result.status === "SAFE" && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex items-start gap-3">
              <ShieldCheck size={24} className="text-emerald-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="bg-emerald-500/20 text-emerald-400 text-xs font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider border border-emerald-500/30">
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
              className={`rounded-xl p-4 border glass-panel ${
                result.status === "RING_MEMBER"
                  ? "bg-red-500/10 border-red-500/40"
                  : "bg-amber-500/10 border-amber-500/40"
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
                        ? "bg-red-500/20 text-red-400 border border-red-500/30"
                        : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                    }`}
                  >
                    {result.statusLabel}
                  </span>
                  <span className="text-slate-300 text-xs font-mono font-bold">ID: {result.accountId}</span>
                  {result.clusterId !== undefined && (
                    <span className="text-slate-400 text-xs font-mono">· Cluster #{result.clusterId}</span>
                  )}
                </div>
                {result.suspicionTier && (
                  <span className="text-xs font-bold text-slate-300 border border-slate-700 bg-slate-900 px-2.5 py-0.5 rounded-full">
                    Tier: {result.suspicionTier}
                  </span>
                )}
              </div>

              <p className="text-slate-200 text-xs mt-2.5 font-medium">{result.message}</p>

              {result.explanation && (
                <div className="mt-3 bg-[#0a0e17] border border-slate-800 rounded-xl p-3.5">
                  <div className="flex items-center gap-1.5 text-xs text-teal-400 font-bold mb-1">
                    <Sparkles size={14} /> AI Analysis Summary (Groq)
                  </div>
                  <p className="text-slate-300 text-xs leading-relaxed font-sans">{result.explanation}</p>
                </div>
              )}

              {result.structuralEvidence && (
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div className="bg-[#0e131f] p-2.5 rounded-lg border border-slate-800 text-center">
                    <div className="text-slate-400 text-[10px] uppercase font-semibold">Cluster Size</div>
                    <div className="text-white font-bold font-mono text-sm">{result.structuralEvidence.clusterSize} accounts</div>
                  </div>
                  <div className="bg-[#0e131f] p-2.5 rounded-lg border border-slate-800 text-center">
                    <div className="text-slate-400 text-[10px] uppercase font-semibold">Exposed Merchants</div>
                    <div className="text-amber-400 font-bold font-mono text-sm">{result.structuralEvidence.exposedMerchants} accounts</div>
                  </div>
                  <div className="bg-[#0e131f] p-2.5 rounded-lg border border-slate-800 text-center">
                    <div className="text-slate-400 text-[10px] uppercase font-semibold">Density</div>
                    <div className="text-teal-400 font-bold font-mono text-sm">{result.structuralEvidence.internalEdgeDensity}</div>
                  </div>
                  <div className="bg-[#0e131f] p-2.5 rounded-lg border border-slate-800 text-center">
                    <div className="text-slate-400 text-[10px] uppercase font-semibold">Time Bursts</div>
                    <div className={result.structuralEvidence.timeBurstPresent ? "text-red-400 font-bold font-mono text-sm" : "text-emerald-400 font-bold font-mono text-sm"}>
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
