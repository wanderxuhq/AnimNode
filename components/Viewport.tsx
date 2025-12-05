import React, { useRef, useEffect, useState } from 'react';
import { ProjectState } from '../types';
import { renderCanvas, renderSVG, evaluateProperty } from '../services/engine';
import { audioController } from '../services/audio';

interface ViewportProps {
  projectRef: React.MutableRefObject<ProjectState>;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, propKey: string, updates: any) => void;
  selection: string | null;
}

// Helper: Inverse transform point from World to Local Node space
// This handles rotation and scale to check if a point is inside a shape
function transformPointToLocal(
    px: number, py: number, 
    nx: number, ny: number, 
    rotationDeg: number, 
    scale: number
) {
    // 1. Translate
    let dx = px - nx;
    let dy = py - ny;

    // 2. Rotate (Inverse)
    const rad = (-rotationDeg * Math.PI) / 180;
    const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ry = dx * Math.sin(rad) + dy * Math.cos(rad);

    // 3. Scale (Inverse)
    return { x: rx / scale, y: ry / scale };
}

export const Viewport: React.FC<ViewportProps> = ({ projectRef, onSelect, onUpdate, selection }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rAF = useRef<number>(0);
  const [svgContent, setSvgContent] = useState<React.ReactNode>(null);
  const [rendererMode, setRendererMode] = useState<'canvas' | 'svg'>('canvas');
  
  // Interaction State
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  
  // Force re-render for Gizmo updates
  const [tick, setTick] = useState(0); 

  // Sync internal mode state
  useEffect(() => {
    setRendererMode(projectRef.current.meta.renderer);
  }, [projectRef.current.meta.renderer]);

  // Render Loop
  useEffect(() => {
    const loop = () => {
      const project = projectRef.current;
      const audioData = audioController.getAudioData();

      if (project.meta.renderer === 'canvas') {
        if (canvasRef.current) {
          const ctx = canvasRef.current.getContext('2d');
          if (ctx) {
            renderCanvas(ctx, project, audioData);
          }
        }
      } else {
        setSvgContent(renderSVG(project, audioData));
      }
      
      // Update tick to refresh Gizmo position
      setTick(t => t + 1);
      
      rAF.current = requestAnimationFrame(loop);
    };
    
    rAF.current = requestAnimationFrame(loop);
    return () => {
      if (rAF.current) cancelAnimationFrame(rAF.current);
    };
  }, []);

  // --- INTERACTION LOGIC ---

  const getMouseWorldPos = (e: React.MouseEvent) => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;
      
      // Center origin
      return {
          x: clientX - rect.width / 2,
          y: clientY - rect.height / 2
      };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
      const { x: wx, y: wy } = getMouseWorldPos(e);
      const project = projectRef.current;
      
      // Hit Testing (Reverse order: Top nodes first)
      const nodes = [...project.rootNodeIds].reverse();
      let hitId: string | null = null;

      // Eval context for checking current positions
      const dummyCtx = { audio: {}, get: () => 0 }; 

      for (const id of nodes) {
          const node = project.nodes[id];
          
          // Get current evaluated transform
          const nx = evaluateProperty(node.properties.x, project.meta.currentTime, dummyCtx) as number;
          const ny = evaluateProperty(node.properties.y, project.meta.currentTime, dummyCtx) as number;
          const rot = evaluateProperty(node.properties.rotation, project.meta.currentTime, dummyCtx) as number;
          const scale = evaluateProperty(node.properties.scale, project.meta.currentTime, dummyCtx) as number;
          
          const local = transformPointToLocal(wx, wy, nx, ny, rot, scale);

          let isHit = false;
          if (node.type === 'rect') {
              const w = evaluateProperty(node.properties.width, project.meta.currentTime, dummyCtx) as number;
              const h = evaluateProperty(node.properties.height, project.meta.currentTime, dummyCtx) as number;
              if (local.x >= -w/2 && local.x <= w/2 && local.y >= -h/2 && local.y <= h/2) {
                  isHit = true;
              }
          } else if (node.type === 'circle') {
              const r = evaluateProperty(node.properties.radius, project.meta.currentTime, dummyCtx) as number;
              const dist = Math.sqrt(local.x*local.x + local.y*local.y);
              if (dist <= r) isHit = true;
          } else if (node.type === 'vector') {
              // Simple bounding box approximation for vector for now
              if (Math.abs(local.x) < 50 && Math.abs(local.y) < 50) isHit = true;
          }

          if (isHit) {
              hitId = id;
              
              // Calculate drag offset (Where inside the shape did we click?)
              // We want to maintain this offset relative to the center
              setDragOffset({ x: wx - nx, y: wy - ny });
              break;
          }
      }

      if (hitId) {
          onSelect(hitId);
          setIsDragging(true);
      } else {
          onSelect(null);
      }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      if (!isDragging || !selection) return;

      const { x: wx, y: wy } = getMouseWorldPos(e);
      const node = projectRef.current.nodes[selection];
      
      // Apply offset so the node doesn't snap its center to the mouse
      const targetX = wx - dragOffset.x;
      const targetY = wy - dragOffset.y;

      // Only update if property is capable of accepting values
      // If it's pure code, this updates the underlying value, but expression might override it.
      onUpdate(selection, 'x', { value: targetX });
      onUpdate(selection, 'y', { value: targetY });
  };

  const handleMouseUp = () => {
      setIsDragging(false);
  };

  // --- GIZMO RENDERER ---
  // Renders a box around the selected item
  const renderGizmo = () => {
      if (!selection) return null;
      const project = projectRef.current;
      const node = project.nodes[selection];
      if (!node) return null;

      const dummyCtx = { audio: {}, get: () => 0 }; 
      const t = project.meta.currentTime;

      // Get current Visual State
      const x = evaluateProperty(node.properties.x, t, dummyCtx) as number;
      const y = evaluateProperty(node.properties.y, t, dummyCtx) as number;
      const rot = evaluateProperty(node.properties.rotation, t, dummyCtx) as number;
      const scale = evaluateProperty(node.properties.scale, t, dummyCtx) as number;
      
      let width = 100;
      let height = 100;

      if (node.type === 'rect') {
          width = evaluateProperty(node.properties.width, t, dummyCtx) as number;
          height = evaluateProperty(node.properties.height, t, dummyCtx) as number;
      } else if (node.type === 'circle') {
          const r = evaluateProperty(node.properties.radius, t, dummyCtx) as number;
          width = r * 2;
          height = r * 2;
      }

      // Convert Center Center to Top Left for SVG Rect
      const transform = `translate(${x}, ${y}) rotate(${rot}) scale(${scale})`;

      return (
          <g transform={`translate(${project.meta.width/2}, ${project.meta.height/2})`}>
              <g transform={transform}>
                  {/* Bounding Box */}
                  <rect 
                      x={-width/2} 
                      y={-height/2} 
                      width={width} 
                      height={height} 
                      fill="none" 
                      stroke="#3b82f6" 
                      strokeWidth={2 / scale} // Keep stroke constant visually
                      strokeDasharray="4 2"
                  />
                  {/* Center Point */}
                  <circle cx={0} cy={0} r={4 / scale} fill="#3b82f6" />
                  
                  {/* Corner Handles (Visual only for now) */}
                  <rect x={-width/2 - 4} y={-height/2 - 4} width={8} height={8} fill="#3b82f6" stroke="white" strokeWidth={1} />
                  <rect x={width/2 - 4} y={height/2 - 4} width={8} height={8} fill="#3b82f6" stroke="white" strokeWidth={1} />
                  <rect x={width/2 - 4} y={-height/2 - 4} width={8} height={8} fill="#3b82f6" stroke="white" strokeWidth={1} />
                  <rect x={-width/2 - 4} y={height/2 - 4} width={8} height={8} fill="#3b82f6" stroke="white" strokeWidth={1} />
              </g>
          </g>
      );
  };

  return (
    <div className="flex-1 bg-black relative flex items-center justify-center overflow-hidden">
        <div className="absolute top-4 left-4 text-xs font-mono text-zinc-600 z-10 pointer-events-none select-none">
            {rendererMode.toUpperCase()} Output ({projectRef.current.meta.width}x{projectRef.current.meta.height})
        </div>
        
        <div 
            ref={containerRef}
            className="relative shadow-2xl border border-zinc-800 bg-zinc-900 overflow-hidden cursor-crosshair"
            // Explicit dimensions to prevent collapse since children are absolute
            style={{ 
                width: projectRef.current.meta.width, 
                height: projectRef.current.meta.height 
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        >
             {/* 1. Rendering Layer */}
             <canvas 
                ref={canvasRef} 
                width={projectRef.current.meta.width} 
                height={projectRef.current.meta.height}
                className={`absolute inset-0 pointer-events-none ${rendererMode === 'canvas' ? 'block' : 'hidden'}`}
                style={{ width: '100%', height: '100%' }}
            />
            <div 
              className={`absolute inset-0 pointer-events-none ${rendererMode === 'svg' ? 'block' : 'hidden'}`}
              style={{ width: '100%', height: '100%' }}
            >
              {svgContent}
            </div>

            {/* 2. Interaction & Gizmo Layer (SVG Overlay) */}
            <svg 
                className="absolute inset-0 w-full h-full pointer-events-none z-20"
                viewBox={`0 0 ${projectRef.current.meta.width} ${projectRef.current.meta.height}`}
            >
                {/* We render the Gizmo here. Pointer events are handled by the parent div events, visual only here */}
                {renderGizmo()}
            </svg>
        </div>
    </div>
  );
};
