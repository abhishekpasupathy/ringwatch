# RingWatch

**An explainable transaction-risk workbench for finding coordinated account activity and investigating potentially exposed counterparties.**

RingWatch combines two complementary views of risk:

- A **graph baseline** maps transaction communities and highlights exposure paths between accounts.
- A **supervised transaction model** ranks individual payments using amount, timing, payment format, and prior account-history signals.

The dashboard makes the graph navigable, provides live account lookups, and uses an LLM only to explain a detector decision already made by code.

[![Next.js 14](https://img.shields.io/badge/Next.js-14-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-336791?logo=postgresql)](https://neon.tech/)
[![Python](https://img.shields.io/badge/Python-scikit--learn-3776AB?logo=python)](https://scikit-learn.org/)

## Why it exists

A single merchant may see only one ordinary-looking payment. The risk emerges when many accounts coordinate activity across a network, often before delayed feedback such as a dispute or chargeback arrives. RingWatch is designed to make those relationships inspectable and to separate a reversible review hold from an irreversible downstream loss.

## End-to-end flow

```mermaid
flowchart LR
    Source["Transaction data"] --> Ingest["Ingest and normalize"]
    Ingest --> Store[("Postgres")]
    Store --> Graph["Graph baseline: Graphology and Louvain"]
    Graph --> Clusters["Communities and exposure paths"]
    Store --> Model["Supervised risk model: ExtraTrees"]
    Model --> Scores["Transaction risk scores"]
    Clusters --> API["Next.js API"]
    Scores --> API
    API --> Dashboard["Investigation dashboard"]
    Dashboard --> Lookup["Account lookup and graph focus"]
    Dashboard --> Explain["Bounded LLM explanation"]
```

### Chargeback prevention timeline

```mermaid
timeline
    title Chargeback prevention timeline
    Day 1 : Coordinated accounts distribute payments across merchants
          : RingWatch builds a shared transaction graph
    Day 2 : Analyst reviews graph evidence and risk context
          : Merchant can pause fulfilment or settlement
    Day 14-30 : Cardholder disputes the payment
          : Unprotected merchant faces a chargeback and product loss
```

### Original pipeline view

```mermaid
flowchart TD
    subgraph Data_Layer["1. Dataset and ingestion"]
        IBM["IBM AML transaction data"] -->|"01-ingest.ts"| PG[("Neon Postgres")]
        PG -->|"02-split.ts"| Train["TRAIN: earliest 80%"]
        PG -->|"02-split.ts"| Test["TEST: latest 20%"]
    end
    subgraph Graph_Baseline["2. Graph baseline"]
        Train -->|"03-detect-train.ts"| Builder["Weighted graph builder"]
        Builder --> Louvain["Louvain communities"]
        Louvain --> GraphScore["Structural risk scoring"]
        GraphScore --> GraphRun[("Persisted clusters")]
    end
    subgraph Supervised_Benchmark["3. Supervised benchmark"]
        PG --> Features["Transaction and history features"]
        Features --> Trees["ExtraTrees classifier"]
        Trees --> Validation["Validation threshold selection"]
        Validation --> Benchmark["Held-out benchmark"]
    end
    subgraph Product["4. Investigation product"]
        GraphRun --> API["Graph, lookup, metrics APIs"]
        Benchmark --> API
        API --> Dashboard["Next.js dashboard"]
        Dashboard --> Explain["Bounded explanation layer"]
    end
```

### What happens during an investigation

```mermaid
sequenceDiagram
    participant Analyst
    participant UI as RingWatch dashboard
    participant API as Next.js API
    participant DB as Postgres
    participant LLM as Groq

    Analyst->>UI: Select an account or a live demo chip
    UI->>API: Request account and cluster context
    API->>DB: Read latest persisted detection run
    DB-->>API: Structural evidence only
    API-->>UI: Status, cluster context, and graph focus
    UI->>API: Request explanation for a flagged cluster
    API->>LLM: Qualitative structural evidence only
    LLM-->>API: Plain-language explanation
    API-->>UI: Explanation; decision remains unchanged
```

## Product capabilities

- **Network investigation:** Louvain community detection over a weighted transaction graph, with exposed-counterparty markers.
- **Supervised risk benchmark:** ExtraTrees classifier using payment, time, payment-format, and smoothed account-history features.
- **Account lookup:** `SAFE`, `EXPOSED_MERCHANT`, `RING_MEMBER`, or `NOT_FOUND` responses with graph focus when available.
- **Live demo chips:** the UI fetches valid current account IDs; unavailable categories are hidden instead of showing fake placeholder IDs.
- **Explainability boundary:** the LLM receives qualitative graph evidence, not account IDs, raw amounts, scores, or thresholds.
- **Operational resilience:** database operations in ingestion retry transient Prisma connection failures; large evaluation writes are batched.

## Evaluation

The data currently loaded in the benchmark has 500,000 transactions and 193 positive laundering labels. The project reports two distinct operating points; they answer different questions and must not be conflated.

| Operating point | Precision | Recall | F1 | Use case |
|---|---:|---:|---:|---|
| Balanced default | **65.00%** | **66.67%** | **65.82%** | Prioritized review queue |
| Recall-first | 0.04% | **100.00%** | 0.08% | Catch-all manual review queue |

The balanced score is a deterministic **stratified 60/20/20** transaction benchmark (seed 42), with the threshold selected on validation only. The recall-first command selects the highest validation threshold meeting 100% recall; on this sparse dataset that threshold is zero, so every transaction is sent to review. It guarantees recall but is not an economical production setting.

The full protocol, confusion matrices, and limitations are in [BENCHMARK.md](BENCHMARK.md). The original forward-in-time Louvain graph baseline is retained for network investigation but currently scores 0.0% F1 on this dataset; it is not represented as the supervised model's result.

## Architecture decisions

```mermaid
flowchart TD
    Decision["Detector decision"] --> Rule["Threshold and policy check"]
    Rule --> Status["Persisted account or cluster status"]
    Status --> Boundary{"Explanation boundary"}
    Boundary -->|"Qualitative metrics only"| Prompt["LLM prompt"]
    Boundary -->|"Raw IDs, amounts, scores, thresholds"| Block["Blocked"]
    Prompt --> Summary["Plain-language summary"]
    Summary --> Analyst["Human review"]
```

### Decision and explanation boundary

```mermaid
gantt
    title Decision versus explanation boundary
    dateFormat X
    axisFormat %s
    section Deterministic and supervised scoring
    Build features and graph :active, d1, 0, 3
    Score and apply policy :crit, active, d2, 3, 5
    section Explanation
    Validate qualitative evidence :milestone, m1, 5, 5
    Generate plain-language summary :done, d3, 5, 8
```

The detector remains auditable because the explanation layer cannot change a score, a threshold, or an account status. The dashboard deliberately exposes qualitative tiers and structural evidence rather than a recipe for evasion.

## Quickstart

### Prerequisites

- Node.js 20+
- Python 3.11+
- PostgreSQL or Neon connection string
- Groq API key (optional; deterministic fallback explanations work without it)

### Install and configure

```bash
git clone https://github.com/abhishekpasupathy/ringwatch.git
cd ringwatch
npm install
python3 -m pip install -r requirements.txt

cp .env.local.example .env.local
# Add DATABASE_URL and, optionally, GROQ_API_KEY.
```

### Initialize the database

```bash
npm run db:push
npm run db:generate
```

### Load data and build the graph baseline

```bash
# Downloads or reads the IBM AML HI-Small CSV, then runs the temporal pipeline.
npm run pipeline
```

For a smaller development run, set `RINGWATCH_MAX_ROWS` before ingestion.

### Run the supervised benchmarks

```bash
# Balanced F1 operating point.
npm run ml:stratified

# Recall-first operating point; on the current data, this reaches 100% recall.
npm run ml:recall-first
```

### Start the dashboard

```bash
npm run dev
# http://localhost:3000
```

An empty database is seeded with representative graph data on first dashboard request, allowing the UI to be explored before a full ingestion.

## API surface

| Endpoint | Purpose |
|---|---|
| `GET /api/graph` | Precomputed graph nodes, links, and cluster metadata |
| `GET /api/metrics` | Latest persisted temporal graph-evaluation metrics |
| `GET /api/lookup?account_id=...` | Account investigation result and evidence |
| `POST /api/explain` | Bounded explanation for a flagged cluster |
| `GET /api/demo-accounts` | Live account IDs for available demo categories |

## Repository map

```text
app/                 Next.js pages and API routes
components/          Dashboard, graph, lookup, and inspector UI
lib/                 Graph, detector, database, and LLM-boundary modules
prisma/              Postgres schema
scripts/             Ingestion, graph evaluation, and ML benchmarks
BENCHMARK.md         Reproducible benchmark protocol and outcomes
```

## Development checks

```bash
npm run build
npm run lint
npm run test:detector
npm run test:ml
npm run test:gb
npm run test:graph-features
```

## Limits and next steps

- The available labels are extremely sparse, so metrics should be interpreted with confidence intervals before any production decision.
- The supervised benchmark is stratified, not a simulation of future-only deployment. A stronger production evaluation needs more historical labels and a rolling temporal-validation design.
- The graph baseline and supervised score are complementary today; a production system should persist calibrated supervised scores and combine them with graph evidence behind a human review workflow.

## Technology

Next.js 14, TypeScript, Prisma, Neon/Postgres, Graphology, Louvain community detection, scikit-learn, react-force-graph-2d, and Groq.
