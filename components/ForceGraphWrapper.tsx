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
 *   - Shows account ID tooltip on hover
 */

import dynamic from "next/dynamic";
import {
  useCallback,
  useRef,
  useState,
  useMemo,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

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
  fx?: number;
  fy?: number;
}

export interface GraphLink {
  source: string | { id: string };
  target: string | { id: string };
}

export interface ForceGraphHandle {
  focusNode: (nodeId: string) => void;
  resetView: () => void;
}

interface ForceGraphWrapperProps {
  nodes: GraphNode[];
  links: GraphLink[];
  onNodeClick: (node: GraphNode) => void;
  selectedNodeId?: string;
}

const ForceGraphWrapper = forwardRef<ForceGraphHandle, ForceGraphWrapperProps>(
  function ForceGraphWrapper({ nodes, links, onNodeClick, selectedNodeId }, ref) {
    const fgRef = useRef<any>();
    const containerRef = useRef<HTMLDivElement>(null);
    const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);
    const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
    const [simulationFrozen, setSimulationFrozen] = useState(false);
    const [currentZoom, setCurrentZoom] = useState(1);
    const pulseTimeRef = useRef(0);
    const animFrameRef = useRef<number>();

    // Continuous redraw for ring-member pulse animation
    useEffect(() => {
      const hasIllicit = nodes.some((n) => n.isIllicit);
      if (!hasIllicit) return;

      const tick = (time: number) => {
        pulseTimeRef.current = time;
        fgRef.current?.refresh();
        animFrameRef.current = requestAnimationFrame(tick);
      };
      animFrameRef.current = requestAnimationFrame(tick);

      return () => {
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      };
    }, [nodes]);

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

    const focusNodeById = useCallback(
      (nodeId: string) => {
        const node = nodes.find((n) => n.id === nodeId);
        if (node && typeof node.x === "number" && typeof node.y === "number") {
          fgRef.current?.centerAt(node.x, node.y, 600);
          fgRef.current?.zoom(3.5, 600);
        }
      },
      [nodes]
    );

    useImperativeHandle(ref, () => ({
      focusNode: focusNodeById,
      resetView: () => {
        fgRef.current?.zoomToFit(600, 80);
        setCurrentZoom(fgRef.current?.zoom() ?? 1);
      },
    }));

    const handleEngineStop = useCallback(() => {
      // Pin every node so the simulation never re-heats on interaction
      for (const node of nodes) {
        if (typeof node.x === "number" && typeof node.y === "number") {
          node.fx = node.x;
          node.fy = node.y;
        }
      }
      setSimulationFrozen(true);
      // Fit both clusters into view on first settle
      fgRef.current?.zoomToFit(800, 60);
      setCurrentZoom(fgRef.current?.zoom() ?? 1);
    }, [nodes]);

    const handleNodeClick = useCallback(
      (node: Record<string, unknown>) => {
        const gNode = node as unknown as GraphNode;
        onNodeClick(gNode);
        // Pan camera only — node position stays pinned via fx/fy
        if (typeof gNode.x === "number" && typeof gNode.y === "number") {
          fgRef.current?.centerAt(gNode.x, gNode.y, 600);
          fgRef.current?.zoom(3.5, 600);
        }
      },
      [onNodeClick]
    );

    const handleNodeHover = useCallback((node: Record<string, unknown> | null) => {
      setHoverNode(node ? (node as unknown as GraphNode) : null);
      if (!node) setMousePos(null);
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setMousePos({
        x: e.clientX - rect.left + 12,
        y: e.clientY - rect.top - 28,
      });
    }, []);

    const handleZoomIn = useCallback(() => {
      const z = fgRef.current?.zoom() ?? 1;
      const next = Math.min(z * 1.4, 20);
      fgRef.current?.zoom(next, 300);
      setCurrentZoom(next);
    }, []);

    const handleZoomOut = useCallback(() => {
      const z = fgRef.current?.zoom() ?? 1;
      const next = Math.max(z / 1.4, 0.1);
      fgRef.current?.zoom(next, 300);
      setCurrentZoom(next);
    }, []);

    const handleResetView = useCallback(() => {
      fgRef.current?.zoomToFit(600, 60);
      setTimeout(() => setCurrentZoom(fgRef.current?.zoom() ?? 1), 650);
    }, []);

    const nodeCanvasObject = useCallback(
      (node: Record<string, unknown>, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const gNode = node as unknown as GraphNode;
        const x = gNode.x ?? 0;
        const y = gNode.y ?? 0;

        const isSelected = selectedNodeId === gNode.id;
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

        // Animated pulse glow for ring members
        if (gNode.isIllicit) {
          const phase = (pulseTimeRef.current % 2000) / 2000;
          const pulseScale = 1 + 0.45 * Math.sin(phase * 2 * Math.PI);
          const pulseRadius = r * 4 * pulseScale;
          const pulseGradient = ctx.createRadialGradient(x, y, r * 0.3, x, y, pulseRadius);
          pulseGradient.addColorStop(0, `rgba(239, 68, 68, ${0.55 * pulseScale})`);
          pulseGradient.addColorStop(0.5, `rgba(239, 68, 68, ${0.2 * pulseScale})`);
          pulseGradient.addColorStop(1, "rgba(0, 0, 0, 0)");
          ctx.beginPath();
          ctx.arc(x, y, pulseRadius, 0, 2 * Math.PI);
          ctx.fillStyle = pulseGradient;
          ctx.fill();
        }

        // Outer glowing radial halo for flagged nodes or hovered nodes
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
      [selectedNodeId, hoverNode, neighborSet]
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
      <div
        ref={containerRef}
        className="w-full h-full relative radar-grid overflow-hidden"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setMousePos(null)}
      >
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
          onEngineStop={handleEngineStop}
          enableNodeDrag={false}
          enablePanInteraction={true}
          enableZoomInteraction={true}
          cooldownTicks={200}
          d3AlphaDecay={0.08}
          d3VelocityDecay={0.75}
          d3AlphaMin={0.001}
          autoPauseRedraw={false}
        />

        {/* Hover tooltip */}
        {hoverNode && mousePos && (
          <div
            className="absolute pointer-events-none z-20 px-2.5 py-1.5 rounded-lg glass-panel border border-teal-500/30 text-teal-300 text-xs font-mono font-bold shadow-lg shadow-teal-500/10"
            style={{ left: mousePos.x, top: mousePos.y }}
          >
            {hoverNode.id}
          </div>
        )}

        {/* Zoom controls */}
        <div className="absolute bottom-4 right-4 z-10 flex flex-col gap-1.5">
          <button
            onClick={handleZoomIn}
            className="w-9 h-9 glass-panel border border-white/10 rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:border-teal-500/40 transition-all"
            aria-label="Zoom in"
          >
            <ZoomIn size={16} />
          </button>
          <button
            onClick={handleZoomOut}
            className="w-9 h-9 glass-panel border border-white/10 rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:border-teal-500/40 transition-all"
            aria-label="Zoom out"
          >
            <ZoomOut size={16} />
          </button>
          <button
            onClick={handleResetView}
            className="w-9 h-9 glass-panel border border-white/10 rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:border-teal-500/40 transition-all"
            aria-label="Reset view"
            title="Reset view"
          >
            <Maximize2 size={16} />
          </button>
        </div>

        {/* Simulation status indicator */}
        {simulationFrozen && (
          <div className="absolute bottom-4 left-4 z-10 text-[9px] font-mono text-slate-500 uppercase tracking-widest">
            Layout locked · {Math.round(currentZoom * 100)}%
          </div>
        )}
      </div>
    );
  }
);

export default ForceGraphWrapper;
