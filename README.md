# RingWatch

**Fraud-ring detection dashboard for Razorpay Buildathon — Track 02: AI Risk Manager**

RingWatch is a defense-only detector that protects legitimate merchants from being unknowingly used as a channel by fraud rings. Fraud rings deliberately spray transactions across multiple unrelated merchants to stay under any single merchant's radar — the merchant who unknowingly processes one of these transactions eats the chargeback weeks later when the real cardholder disputes it, having already shipped the goods.

RingWatch surfaces the hidden network structure (shared accounts, synchronized timing, dense internal connectivity) **before** the chargeback lands, so the merchant gets a warning instead of a loss.

---

## Architecture

```
IBM AML HI-Small CSV
        │
        ▼
01-ingest.ts ──► Neon Postgres
        │         (accounts + transactions)
        ▼
02-split.ts  ──► Temporal 80/20 split (TRAIN/TEST by timestamp)
        │
        ▼
03-detect-train.ts
  ├── graphology Graph (weighted, sorted nodes/edges)
  ├── Louvain community detection × 5 runs (max modularity)
  ├── Suspicion score (4 structural metrics)
  ├── Threshold sweep → optimal threshold on TRAIN only
  └── Persist: DetectionRun + Cluster + ClusterMember
        │
        ▼
04-evaluate.ts
  ├── Apply TRAIN threshold to TEST graph
  ├── Confusion matrix (TP/FP/FN/TN at account level)
  ├── Precision / Recall / F1
  ├── False-positive cost note
  └── Write eval-report.md ◄── Stage 3 deliverable
        │
        ▼
Next.js Dashboard
  ├── /api/graph   ── precomputed cluster data (no raw scores)
  ├── /api/metrics ── eval metrics (precision/recall/FP cost)
  └── /api/explain ── Groq LLM explanation (structural evidence ONLY)
```

### The LLM Boundary (Design Choice for Pitch)

```
Detection decision:  lib/detector.ts        ← 100% deterministic graph metrics
                                               NO LLM involved
                           │
                           ▼ (decision already made)
Plain-English summary: lib/llm-boundary.ts  ← Groq LLM (explanation ONLY)
                                               receives: qualitative structural labels
                                               does NOT receive: raw scores, thresholds,
                                               account IDs, or transaction data
```

This separation is enforced at runtime by a validator in `lib/llm-boundary.ts` that throws if any forbidden field is present.

---

## Prerequisites

- Node.js 20+
- A [Neon](https://neon.tech) Postgres database (free tier works)
- A [Groq](https://console.groq.com) API key (free tier works)
- The IBM AML HI-Small dataset (see below)
- (Optional) Kaggle CLI for automated download

---

## Dataset Download

### Option A: Kaggle CLI (automated)

1. Create a Kaggle account and generate an API token at https://www.kaggle.com/settings
2. Place `kaggle.json` at `~/.kaggle/kaggle.json`
3. The ingestion script will download automatically when it doesn't find the file

### Option B: Manual download

1. Go to: https://www.kaggle.com/datasets/ealtman2019/ibm-transactions-for-anti-money-laundering-aml
2. Download **HI-Small_Trans.csv**
3. Place it at `./data/HI-Small_Trans.csv`

> **Why HI-Small?** The Large variants have hundreds of millions of rows — unusable within a hackathon timeline. HI-Small (~5M rows) is large enough to produce meaningful graph structure while remaining manageable.

---

## Setup

```bash
# 1. Clone and install
git clone https://github.com/abhishekpasupathy/ringwatch.git
cd ringwatch
npm install

# 2. Set up environment variables
cp .env.local.example .env.local
# Edit .env.local — add DATABASE_URL and GROQ_API_KEY

# 3. Push Prisma schema to Neon
npm run db:push

# 4. Generate Prisma client
npm run db:generate
```

---

## Running the Pipeline

Run the scripts in order. Each script prints its own sanity checks.

```bash
# Stage 1a: Ingest CSV → Postgres
npm run ingest

# Stage 1b: Temporal train/test split (80%/20% by timestamp)
npm run split

# Stage 2: Build graph, tune threshold on TRAIN
npm run detect

# Stage 3: Evaluate on held-out TEST set, write eval-report.md
npm run evaluate

# Or run all stages in sequence:
npm run pipeline
```

After the pipeline completes:
- `eval-report.md` is written to the project root — **read this first**
- The dashboard reads precomputed data from the DB

```bash
# Start the dashboard
npm run dev
# → http://localhost:3000
```

---

## How to Reproduce the Evaluation Numbers

The evaluation is fully reproducible from the database state after running the pipeline:

```bash
# Re-run evaluation against the already-ingested data:
npm run evaluate
```

**Expected output** (HI-Small, ~5M rows):
```
── Confusion Matrix (TEST, Account Level) ──
  TP: [varies]  |  FP: [varies]
  FN: [varies]  |  TN: [varies]

── Metrics (TEST) ──
  Precision : XX.X%
  Recall    : XX.X%
  F1        : XX.X%
```

> **Variance note**: Louvain is a heuristic greedy algorithm. Even with sorted node/edge insertion, results can vary ±1–2% between runs due to JS engine internal ordering. This variance is explicitly reported in `eval-report.md`.
>
> To see the exact numbers for this submission, use the metrics persisted in the DB (`eval_metrics` table, most recent TEST row).

### Verifying the train/test boundary

```sql
-- Confirm no test data was used during threshold tuning:
SELECT split, COUNT(*) FROM transactions GROUP BY split;

-- Confirm threshold was tuned on TRAIN run only:
SELECT id, split, run_at FROM detection_runs ORDER BY run_at;
-- The TRAIN run should predate the TEST run.
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | Neon Postgres connection string |
| `GROQ_API_KEY` | ✅ | Groq API key for LLM explanations |
| `KAGGLE_USERNAME` | Optional | For automated dataset download |
| `KAGGLE_KEY` | Optional | Kaggle API token |

---

## Deployment (Vercel + Neon)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables in Vercel dashboard:
# DATABASE_URL, GROQ_API_KEY
```

> **Important**: Run the full pipeline scripts locally before deploying. The Vercel functions serve precomputed data — they do not build the graph at request time (which would OOM on Vercel's 1GB function limit with ~5M rows).

---

## Known Honest Failure Points

These are real limitations, not smoothed-over rough edges. They are documented here because they are legitimate technical trade-offs worth discussing.

### 1. Louvain Non-Determinism
**Problem**: `graphology-communities-louvain` has no seed parameter. Results are stable-but-not-bit-identical across runs.  
**Mitigation**: Sort all nodes/edges alphabetically before insertion; run 5× and select max-modularity partition.  
**Remaining variance**: ±1–2% on precision/recall.  
**Production fix**: Consensus ensemble, or switch to Label Propagation (deterministic).

### 2. Temporal Split Class Imbalance Shift
**Problem**: If illicit transactions are clustered in time (likely in synthetic data), the TEST set illicit ratio may differ from TRAIN.  
**Mitigation**: `02-split.ts` prints the class balance per split explicitly. The delta is documented in `eval-report.md`.

### 3. Graph Build Memory
**Problem**: HI-Small has ~5M transactions. A full in-memory graphology graph can approach 2–4 GB RSS.  
**Mitigation**: Graph build runs as an offline script (not in a Vercel function). The dashboard reads precomputed community assignments from the DB.  
**Implication**: The dashboard shows the last computed snapshot, not a live graph.

### 4. "Protected Merchant" Schema Projection
**Problem**: IBM AML schema has accounts, not merchants. The "exposed merchant" framing maps licit accounts adjacent to flagged rings as merchants.  
**Mitigation**: Every occurrence of this framing (code, README, dashboard) includes an explicit schematic note.  
**Honest statement**: This is a storytelling projection, not a ground-truth label in the dataset.

### 5. Groq Latency
**Problem**: Free-tier Groq API calls take 2–5 seconds.  
**Mitigation**: Explanation is lazy-loaded (click to generate, not pre-fetched). Loading state shown.

---

## Dataset Schema Mapping

| IBM AML Field | RingWatch Field | Notes |
|---------------|-----------------|-------|
| `Account` (from) | `fromAccountId` | Prefixed with `FromBank_` for global uniqueness |
| `Account.1` (to) | `toAccountId` | Prefixed with `ToBank_` |
| `From Bank` | `account.bank` | — |
| `Amount Paid` | `amountPaid` | Used for edge weight normalization |
| `Amount Received` | `amountReceived` | Stored, not used in graph weight |
| `Payment Format` | `paymentFormat` | Used for format diversity score |
| `Timestamp` | `timestamp` | Used for temporal split + burst detection |
| `Is Laundering` | `isLaunderingLabel` | Ground truth label for evaluation only |

---

## Stack

- **Next.js 14** (App Router) + TypeScript
- **Neon** (serverless Postgres) + **Prisma**
- **graphology** + **graphology-communities-louvain** — deterministic graph detection
- **react-force-graph-2d** — force-directed visualization (SSR-disabled)
- **Groq API** (llama3-8b-8192) — explanation only, not detection
- **Vercel** — deployment

---

## Track Compliance

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Precision/Recall on held-out test set | ✅ | `04-evaluate.ts` → `eval-report.md` |
| Temporal/row split before tuning | ✅ | `02-split.ts` (80/20 by timestamp) |
| Honest false-positive cost | ✅ | Quantified in `eval-report.md` + MetricsPanel |
| Defense-only (no threshold exposure) | ✅ | Threshold server-side only; LLM boundary enforced |
| Deterministic detection core | ✅ | `lib/detector.ts` — no LLM in decision path |
| LLM for explanation only | ✅ | `lib/llm-boundary.ts` with runtime assertion |
