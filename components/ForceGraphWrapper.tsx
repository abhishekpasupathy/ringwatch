"use client";

/**
 * RingWatch — Force Graph Wrapper
 *
 * SSR-disabled wrapper for react-force-graph-2d.
 * react-force-graph requires browser APIs (canvas, window) and cannot
 * run on the server. dynamic() with ssr: false ensures it only renders
 * after hydration.
 *
 * Node color coding:
 *   🔴 Red     — illicit account in a flagged cluster (ring member)
 *   🟠 Amber   — licit account in a flagged cluster ("exposed merchant")
 *   🔵 Blue    — licit account in an unflagged cluster (safe)
 *   ⬜ Gray    — unlabeled / singleton account
 */

import dynamic from "next/dynamic";
import { useCallback, useRef } from "react";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center w-full h-full text-slate-400">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-teal-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm font-medium">Loading graph engine…</p>
      </div>
    </div>
  ),
});

export interface GraphNode {
  id: string;
  isIllicit: boolean;
  isExposed: boolean;
  clusterId: number;
  isFlagged: boolean;
  suspicionTier: "HIGH" | "MEDIUM" | "SAFE";
}

export interface GraphLink {
  source: string;
  target: string;
}

interface ForceGraphWrapperProps {
  nodes: GraphNode[];
  links: GraphLink[];
  onNodeClick: (node: GraphNode) => void;
  selectedClusterId?: number;
}

function getNodeColor(node: GraphNode, selectedClusterId?: number): string {
  const isSelected = selectedClusterId !== undefined && node.clusterId === selectedClusterId;
  const alpha = isSelected ? "ff" : "cc";

  if (!node.isFlagged) return `#3b82f6${alpha}`; // blue — safe
  if (node.isIllicit) return `#ef4444${alpha}`;   // red — ring member
  if (node.isExposed) return `#f59e0b${alpha}`;   // amber — exposed merchant
  return `#8b5cf6${alpha}`;                        // purple — flagged, type unclear
}

function getNodeSize(node: GraphNode, selectedClusterId?: number): number {
  const isSelected = selectedClusterId !== undefined && node.clusterId === selectedClusterId;
  if (!node.isFlagged) return isSelected ? 5 : 3;
  if (node.suspicionTier === "HIGH") return isSelected ? 10 : 7;
  return isSelected ? 8 : 5;
}

export default function ForceGraphWrapper({
  nodes,
  links,
  onNodeClick,
  selectedClusterId,
}: ForceGraphWrapperProps) {
  const fgRef = useRef<any>(null);

  const handleNodeClick = useCallback(
    (node: any) => {
      onNodeClick(node as GraphNode);
      // Zoom into clicked node
      fgRef.current?.centerAt(node.x, node.y, 800);
      fgRef.current?.zoom(4, 800);
    },
    [onNodeClick]
  );

  const nodeCanvasObject = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const size = getNodeSize(node as GraphNode, selectedClusterId);
      const color = getNodeColor(node as GraphNode, selectedClusterId);

      ctx.beginPath();
      ctx.arc(node.x, node.y, size / globalScale, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();

      // Glow effect for flagged nodes
      if (node.isFlagged) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, (size + 3) / globalScale, 0, 2 * Math.PI);
        ctx.strokeStyle = color.slice(0, 7) + "44";
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      // Label at high zoom
      if (globalScale > 3) {
        const label = node.id.split("_").slice(-1)[0].substring(0, 8);
        ctx.font = `${10 / globalScale}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillStyle = "#e2e8f0";
        ctx.fillText(label, node.x, node.y + (size + 5) / globalScale);
      }
    },
    [selectedClusterId]
  );

  return (
    <ForceGraph2D
      ref={fgRef}
      graphData={{ nodes, links }}
      nodeId="id"
      nodeCanvasObject={nodeCanvasObject}
      nodeCanvasObjectMode={() => "replace"}
      linkColor={() => "rgba(100,116,139,0.3)"}
      linkWidth={0.5}
      backgroundColor="#0a0b0f"
      onNodeClick={handleNodeClick}
      cooldownTicks={150}
      d3AlphaDecay={0.02}
      d3VelocityDecay={0.3}
    />
  );
}
