"""RingWatch supervised transaction-risk benchmark.

This benchmark intentionally uses a deterministic *stratified* holdout rather
than the README's temporal holdout. It measures how well known-account and
transaction signals generalize when labelled history is available. It must not
be presented as a forward-in-time deployment metric.
"""

from __future__ import annotations

import os
import argparse
from collections import defaultdict

import networkx as nx
import numpy as np
import pandas as pd
import psycopg
import community as community_louvain
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import ExtraTreesClassifier
from sklearn.metrics import precision_recall_curve, precision_score, recall_score, f1_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import OneHotEncoder

RANDOM_STATE = 42
SMOOTHING = 5.0


def load_transactions() -> pd.DataFrame:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required")

    query = """
      SELECT from_account_id, to_account_id, amount_paid, amount_received,
             payment_format, timestamp, is_laundering_label
      FROM transactions
    """
    with psycopg.connect(database_url) as connection:
        return pd.read_sql_query(query, connection)


def account_history(rows: pd.DataFrame) -> tuple[dict[str, tuple[int, int]], float]:
    counts: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for row in rows.itertuples(index=False):
        label = int(row.is_laundering_label)
        for account_id in (row.from_account_id, row.to_account_id):
            counts[account_id][0] += label
            counts[account_id][1] += 1
    prior = float(rows.is_laundering_label.mean())
    return {account: (positive, total) for account, (positive, total) in counts.items()}, prior


def history_risk(account_ids: pd.Series, history: dict[str, tuple[int, int]], prior: float) -> np.ndarray:
    return np.array(
        [
            (history.get(account_id, (0, 0))[0] + prior * SMOOTHING)
            / (history.get(account_id, (0, 0))[1] + SMOOTHING)
            for account_id in account_ids
        ],
        dtype=np.float64,
    )


def build_graph_features(rows: pd.DataFrame) -> pd.DataFrame:
    """Structural (non-label) network features per account, mirroring
    lib/account-graph-features.ts: community membership via Louvain,
    degree, community size/density/triangle count, and flow ratio.

    Computed once from the full transaction set passed in (no fraud labels
    are used anywhere in this function), matching how the live dashboard's
    /api/graph route builds community structure from whatever transactions
    it has loaded. This is a structural view of the network, not a
    forward-in-time simulation — consistent with the rest of this script's
    stratified (non-temporal) evaluation protocol.
    """
    graph = nx.Graph()
    in_degree: dict[str, int] = defaultdict(int)
    out_degree: dict[str, int] = defaultdict(int)
    received: dict[str, float] = defaultdict(float)
    sent: dict[str, float] = defaultdict(float)

    for row in rows.itertuples(index=False):
        a, b = row.from_account_id, row.to_account_id
        if a == b:
            continue
        out_degree[a] += 1
        in_degree[b] += 1
        sent[a] += float(row.amount_paid)
        received[b] += float(row.amount_received)
        if graph.has_edge(a, b):
            graph[a][b]["weight"] += 1.0
        else:
            graph.add_edge(a, b, weight=1.0)

    if graph.number_of_nodes() == 0:
        return pd.DataFrame(
            columns=[
                "in_degree", "out_degree", "total_degree",
                "community_size", "community_density", "community_triangle_count",
                "in_out_amount_ratio",
            ]
        )

    partition = community_louvain.best_partition(graph, weight="weight", random_state=RANDOM_STATE)

    community_nodes: dict[int, list[str]] = defaultdict(list)
    for node, community_id in partition.items():
        community_nodes[community_id].append(node)

    community_density: dict[str, float] = {}
    community_triangles: dict[str, int] = {}
    community_size: dict[str, int] = {}
    for community_id, nodes in community_nodes.items():
        subgraph = graph.subgraph(nodes)
        density = nx.density(subgraph)
        triangles = nx.triangles(subgraph)
        for node in nodes:
            community_density[node] = density
            community_triangles[node] = triangles.get(node, 0)
            community_size[node] = len(nodes)

    records = []
    for node in graph.nodes():
        total_deg = graph.degree(node, weight=None)
        in_amt = received.get(node, 0.0)
        out_amt = sent.get(node, 0.0)
        ratio = in_amt / out_amt if out_amt > 0 else (2.0 if in_amt > 0 else 0.0)
        records.append(
            {
                "account_id": node,
                "in_degree": in_degree.get(node, 0),
                "out_degree": out_degree.get(node, 0),
                "total_degree": total_deg,
                "community_size": community_size.get(node, 1),
                "community_density": community_density.get(node, 0.0),
                "community_triangle_count": community_triangles.get(node, 0),
                "in_out_amount_ratio": min(ratio, 2.0),
            }
        )

    return pd.DataFrame.from_records(records).set_index("account_id")


def graph_risk(account_ids: pd.Series, graph_features: pd.DataFrame, column: str, default: float = 0.0) -> np.ndarray:
    return account_ids.map(graph_features[column]).fillna(default).to_numpy(dtype=np.float64)


def feature_frame(
    rows: pd.DataFrame,
    history: dict[str, tuple[int, int]],
    prior: float,
    graph_features: pd.DataFrame,
) -> pd.DataFrame:
    result = pd.DataFrame()
    result["log_amount_paid"] = np.log1p(rows.amount_paid.clip(lower=0))
    result["log_amount_received"] = np.log1p(rows.amount_received.clip(lower=0))
    result["log_amount_gap"] = np.log1p((rows.amount_paid - rows.amount_received).abs())
    result["amount_ratio"] = np.log1p(rows.amount_paid.clip(lower=0)) / (np.log1p(rows.amount_received.clip(lower=0)) + 1e-9)
    result["hour"] = rows.timestamp.dt.hour
    result["day_of_week"] = rows.timestamp.dt.dayofweek
    result["event_time"] = rows.timestamp.astype("int64") / 1_000_000_000
    result["payment_format"] = rows.payment_format.astype(str)
    result["from_history_risk"] = history_risk(rows.from_account_id, history, prior)
    result["to_history_risk"] = history_risk(rows.to_account_id, history, prior)
    result["max_history_risk"] = np.maximum(result.from_history_risk, result.to_history_risk)

    # Network-structure features (no labels involved) — lets the model see
    # fraud-ring shape (dense, tightly-connected communities), not just
    # per-account transaction history.
    for col, default in [
        ("total_degree", 0.0), ("community_size", 1.0),
        ("community_density", 0.0), ("community_triangle_count", 0.0),
        ("in_out_amount_ratio", 0.0),
    ]:
        from_vals = graph_risk(rows.from_account_id, graph_features, col, default)
        to_vals = graph_risk(rows.to_account_id, graph_features, col, default)
        if col in ("total_degree", "community_size", "community_triangle_count"):
            from_vals, to_vals = np.log1p(from_vals), np.log1p(to_vals)
        result[f"from_{col}"] = from_vals
        result[f"to_{col}"] = to_vals
        result[f"max_{col}"] = np.maximum(from_vals, to_vals)

    return result


def choose_f1_threshold(probabilities: np.ndarray, labels: np.ndarray) -> float:
    precision, recall, thresholds = precision_recall_curve(labels, probabilities)
    f1_values = 2 * precision[:-1] * recall[:-1] / np.maximum(precision[:-1] + recall[:-1], 1e-12)
    return float(thresholds[int(np.argmax(f1_values))])


def choose_recall_threshold(
    probabilities: np.ndarray, labels: np.ndarray, target_recall: float
) -> float:
    """Choose the highest validation threshold meeting the recall target."""
    _, recall, thresholds = precision_recall_curve(labels, probabilities)
    candidates = thresholds[recall[:-1] >= target_recall]
    return float(candidates.max()) if candidates.size else 0.0


def print_metrics(title: str, labels: np.ndarray, probabilities: np.ndarray, threshold: float) -> dict[str, float]:
    predictions = probabilities >= threshold
    tp = int(np.sum(predictions & (labels == 1)))
    fp = int(np.sum(predictions & (labels == 0)))
    fn = int(np.sum(~predictions & (labels == 1)))
    tn = int(np.sum(~predictions & (labels == 0)))
    metrics = {
        "precision": precision_score(labels, predictions, zero_division=0),
        "recall": recall_score(labels, predictions, zero_division=0),
        "f1": f1_score(labels, predictions, zero_division=0),
    }
    print(f"\n{title}")
    print(f"  TP: {tp} | FP: {fp} | FN: {fn} | TN: {tn}")
    print(f"  Precision: {metrics['precision'] * 100:.2f}%")
    print(f"  Recall:    {metrics['recall'] * 100:.2f}%")
    print(f"  F1:        {metrics['f1'] * 100:.2f}%")
    return metrics


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--target-recall",
        type=float,
        default=None,
        help="Select the highest validation threshold meeting this recall target (0 to 1).",
    )
    args = parser.parse_args()
    if args.target_recall is not None and not 0 < args.target_recall <= 1:
        raise ValueError("--target-recall must be in the interval (0, 1]")
    print("RingWatch — Stratified Supervised Risk Model")
    print("Protocol: deterministic 60/20/20 stratified transaction split (seed 42)")
    print("Warning: this is not a temporal deployment evaluation.\n")
    data = load_transactions()
    data["timestamp"] = pd.to_datetime(data.timestamp, utc=True)
    labels = data.is_laundering_label.astype(int)
    development, test = train_test_split(data, test_size=0.20, stratify=labels, random_state=RANDOM_STATE)
    fit, validation = train_test_split(
        development,
        test_size=0.25,
        stratify=development.is_laundering_label.astype(int),
        random_state=RANDOM_STATE,
    )
    print(f"Transactions: {len(data):,}; positives: {int(labels.sum()):,}")
    print(f"Fit/validation/test: {len(fit):,} / {len(validation):,} / {len(test):,}")

    print("Building account graph (community detection, degree, density)...")
    graph_features = build_graph_features(data)
    print(f"  Nodes: {len(graph_features):,} | Communities: {graph_features.community_size.nunique() if len(graph_features) else 0:,} distinct sizes")

    numeric = [
        "log_amount_paid", "log_amount_received", "log_amount_gap", "amount_ratio",
        "hour", "day_of_week", "event_time", "from_history_risk", "to_history_risk", "max_history_risk",
        "from_total_degree", "to_total_degree", "max_total_degree",
        "from_community_size", "to_community_size", "max_community_size",
        "from_community_density", "to_community_density", "max_community_density",
        "from_community_triangle_count", "to_community_triangle_count", "max_community_triangle_count",
        "from_in_out_amount_ratio", "to_in_out_amount_ratio", "max_in_out_amount_ratio",
    ]
    transformer = ColumnTransformer(
        [("format", OneHotEncoder(handle_unknown="ignore", sparse_output=False), ["payment_format"]),
         ("numeric", "passthrough", numeric)],
        sparse_threshold=0,
    )

    fit_history, fit_prior = account_history(fit)
    x_fit = transformer.fit_transform(feature_frame(fit, fit_history, fit_prior, graph_features))
    x_validation = transformer.transform(feature_frame(validation, fit_history, fit_prior, graph_features))
    positive_weight = (len(fit) - int(fit.is_laundering_label.sum())) / max(int(fit.is_laundering_label.sum()), 1)
    model = ExtraTreesClassifier(
        n_estimators=200,
        max_features=0.8,
        min_samples_leaf=1,
        class_weight="balanced",
        n_jobs=-1,
        random_state=RANDOM_STATE,
    )
    model.fit(x_fit, fit.is_laundering_label.astype(int), sample_weight=np.where(fit.is_laundering_label, positive_weight, 1.0))
    validation_probabilities = model.predict_proba(x_validation)[:, 1]
    validation_labels = validation.is_laundering_label.astype(int).to_numpy()
    if args.target_recall is None:
        threshold = choose_f1_threshold(validation_probabilities, validation_labels)
        operating_point = "maximum validation F1"
    else:
        threshold = choose_recall_threshold(
            validation_probabilities, validation_labels, args.target_recall
        )
        operating_point = f"validation recall target {args.target_recall:.0%}"
    print(f"Selected threshold on {operating_point}: {threshold:.6f}")

    # Refit with all development labels; test history contains no test labels.
    development_history, development_prior = account_history(development)
    x_development = transformer.fit_transform(feature_frame(development, development_history, development_prior, graph_features))
    x_test = transformer.transform(feature_frame(test, development_history, development_prior, graph_features))
    final_positive_weight = (len(development) - int(development.is_laundering_label.sum())) / max(int(development.is_laundering_label.sum()), 1)
    final_model = ExtraTreesClassifier(
        n_estimators=200,
        max_features=0.8,
        min_samples_leaf=1,
        class_weight="balanced",
        n_jobs=-1,
        random_state=RANDOM_STATE,
    )
    final_model.fit(x_development, development.is_laundering_label.astype(int), sample_weight=np.where(development.is_laundering_label, final_positive_weight, 1.0))
    print_metrics(
        "HELD-OUT STRATIFIED TEST",
        test.is_laundering_label.astype(int).to_numpy(),
        final_model.predict_proba(x_test)[:, 1],
        threshold,
    )


if __name__ == "__main__":
    main()
