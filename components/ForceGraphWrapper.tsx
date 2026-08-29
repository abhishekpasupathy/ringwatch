"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * RingWatch — Force Graph Wrapper (Tactical Radar Aesthetic)
 *
 * Custom canvas rendering with radial glowing halos for nodes:
 *   🔴 Red Pulse Halo   — Ring Member (Illicit)
 *   🟠 Amber Pulse Halo — Exposed Merchant (Licit account transacting with ring)
 *   🔵 Blue Glow        — Safe Account
 *
 * Interactive Hover State:
 *   - Highlights connected edges in bright electric teal (#00d4aa)
 *   - Highlights neighbor nodes
 *   - Dims non-connected network paths
 */

import dynamic from "next/dynamic";
import { useCallback, useRef, useState, useMemo } from "react";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center w-full h-full text-slate-400 bg-[#07090e]">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-teal-400 border-t-transparent rounded-full animate-spin mx-auto mb-3 glow-teal-sm" />
        <p className="text-sm font-medium font-mono tracking-wide text-slate-300">
          INITIALIZING TACTICAL GRAPH ENGINE…
        </p>
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
  x?: number;
  y?: number;
}

export interface GraphLink {
  source: string | { id: string };
  target: string | { id: string };
}

interface ForceGraphWrapperProps {
  nodes: GraphNode[];
  links: GraphLink[];
  onNodeClick: (node: GraphNode) => void;
  selectedClusterId?: number;
}

export default function ForceGraphWrapper({
  nodes,
  links,
  onNodeClick,
  selectedClusterId,
}: ForceGraphWrapperProps) {
  const fgRef = useRef<any>();
  const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);

  // Build adjacency map for instant hover highlight lookup
  const neighborSet = useMemo(() => {
    const neighbors = new Set<string>();
    const connectedEdges = new Set<string>();

    if (!hoverNode) return { neighbors, connectedEdges };

    neighbors.add(hoverNode.id);

    for (const link of links) {
      const sId = typeof link.source === "object" ? link.source.id : link.source;
      const tId = typeof link.target === "object" ? link.target.id : link.target;

      if (sId === hoverNode.id) {
        neighbors.add(tId);
        connectedEdges.add(`${sId}|||${tId}`);
        connectedEdges.add(`${tId}|||${sId}`);
      } else if (tId === hoverNode.id) {
        neighbors.add(sId);
        connectedEdges.add(`${sId}|||${tId}`);
        connectedEdges.add(`${tId}|||${sId}`);
      }
    }

    return { neighbors, connectedEdges };
  }, [hoverNode, links]);

  const handleNodeClick = useCallback(
    (node: Record<string, unknown>) => {
      const gNode = node as unknown as GraphNode;
      onNodeClick(gNode);
      if (typeof gNode.x === "number" && typeof gNode.y === "number") {
        fgRef.current?.centerAt(gNode.x, gNode.y, 800);
        fgRef.current?.zoom(4, 800);
      }
    },
    [onNodeClick]
  );

  const handleNodeHover = useCallback((node: Record<string, unknown> | null) => {
    setHoverNode(node ? (node as unknown as GraphNode) : null);
  }, []);

  const nodeCanvasObject = useCallback(
    (node: Record<string, unknown>, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const gNode = node as unknown as GraphNode;
      const x = gNode.x ?? 0;
      const y = gNode.y ?? 0;

      const isSelected = selectedClusterId !== undefined && gNode.clusterId === selectedClusterId;
      const isHovered = hoverNode?.id === gNode.id;
      const isNeighbor = neighborSet.neighbors.has(gNode.id);

      // Node sizing
      let baseRadius = 4;
      if (gNode.isFlagged) {
        baseRadius = gNode.suspicionTier === "HIGH" ? 7 : 5.5;
      }
      if (isSelected) baseRadius += 2.5;
      if (isHovered) baseRadius += 3;

      const r = baseRadius / globalScale;

      // Color selection
      let coreColor = "#3b82f6"; // Safe blue
      let glowColor = "rgba(59, 130, 246, 0.35)";

      if (gNode.isIllicit) {
        coreColor = "#ef4444"; // Red ring member
        glowColor = "rgba(239, 68, 68, 0.4)";
      } else if (gNode.isExposed) {
        coreColor = "#f59e0b"; // Amber exposed merchant
        glowColor = "rgba(245, 158, 11, 0.4)";
      }

      // Dim non-neighbor nodes when hovering
      const isDimmed = hoverNode && !isNeighbor;
      const opacity = isDimmed ? 0.2 : 1.0;

      ctx.save();
      ctx.globalAlpha = opacity;

      // Outer glowing radial pulse halo for flagged nodes or hovered nodes
      if (gNode.isFlagged || isHovered || isSelected) {
        const glowRadius = r * (isHovered ? 3.5 : 2.5);
        const gradient = ctx.createRadialGradient(x, y, r * 0.5, x, y, glowRadius);
        gradient.addColorStop(0, glowColor);
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

        ctx.beginPath();
        ctx.arc(x, y, glowRadius, 0, 2 * Math.PI);
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      // Core node circle
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = coreColor;
      ctx.fill();

      // Sharp white ring for selected / hovered nodes
      if (isSelected || isHovered) {
        ctx.lineWidth = 1.5 / globalScale;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      }

      // Label at high zoom or on hover
      if (globalScale > 2.8 || isHovered) {
        const label = gNode.id.split("_").slice(-1)[0];
        ctx.font = `${Math.max(9 / globalScale, 2)}px 'JetBrains Mono', monospace`;
        ctx.textAlign = "center";
        ctx.fillStyle = isHovered ? "#00d4aa" : "#cbd5e1";
        ctx.fillText(label, x, y + r + 10 / globalScale);
      }

      ctx.restore();
    },
    [selectedClusterId, hoverNode, neighborSet]
  );

  const linkColor = useCallback(
    (link: any) => {
      if (!hoverNode) return "rgba(71, 85, 105, 0.25)";

      const sId = typeof link.source === "object" ? link.source.id : link.source;
      const tId = typeof link.target === "object" ? link.target.id : link.target;

      const isConnected =
        neighborSet.connectedEdges.has(`${sId}|||${tId}`) ||
        neighborSet.connectedEdges.has(`${tId}|||${sId}`);

      return isConnected ? "rgba(0, 212, 170, 0.9)" : "rgba(30, 41, 59, 0.15)";
    },
    [hoverNode, neighborSet]
  );

  const linkWidth = useCallback(
    (link: any) => {
      if (!hoverNode) return 0.6;
      const sId = typeof link.source === "object" ? link.source.id : link.source;
      const tId = typeof link.target === "object" ? link.target.id : link.target;

      const isConnected =
        neighborSet.connectedEdges.has(`${sId}|||${tId}`) ||
        neighborSet.connectedEdges.has(`${tId}|||${sId}`);

      return isConnected ? 2.5 : 0.4;
    },
    [hoverNode, neighborSet]
  );

  return (
    <div className="w-full h-full relative radar-grid overflow-hidden">
      <ForceGraph2D
        ref={fgRef as any}
        graphData={{ nodes, links }}
        nodeId="id"
        nodeCanvasObject={nodeCanvasObject}
        nodeCanvasObjectMode={() => "replace"}
        linkColor={linkColor}
        linkWidth={linkWidth}
        backgroundColor="#07090e"
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        cooldownTicks={150}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
      />
    </div>
  );
}
