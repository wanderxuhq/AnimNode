import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ProjectState, Node, Command } from '../types';
import { renderSVG, evaluateProperty } from '../services/engine';
import { audioController } from '../services/audio';
import { webgpuRenderer } from '../services/webgpu';
import { PathPoint, pointsToSvgPath, svgPathToPoints } from '../services/path';
import { Commands } from '../services/commands';
import { MousePointer2, Move, ZoomIn, ZoomOut, Maximize } from 'lucide-react';

interface ViewportProps {
  projectRef: React.MutableRefObject<ProjectState>;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, propKey: string, updates: any) => void;
  onCommit: (cmd: Command) => void; 
  selection: string | null;
  onAddNode: (type: 'rect' | 'circle' | 'vector' | 'value') => string;
}

// Helper to convert hex to normalized rgb
const hexToRgb = (hex: string) => {
    if (!hex || hex === 'transparent' || hex === 'none') return [0, 0, 0, 0];
    if (hex.includes('gradient') || hex.includes('url')) return [0, 0, 0, 0];

    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
        parseInt(result[1], 16) / 255,
        parseInt(result[2], 16) / 255,
        parseInt(result[3], 16) / 255,
        1
    ] : [0, 0, 0, 1];
};

// Helper: Transform Point
function transformPointToLocal(
    px: number, py: number, 
    nx: number, ny: number, 
    rotationDeg: number, 
    scale: number
) {
    let dx = px - nx;
    let dy = py - ny;
    const rad = (-rotationDeg * Math.PI) / 180;
    const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
    return { x: rx / scale, y: ry / scale };
}

// Calculate distance from point (lx, ly) to line segment (p1, p2)
function distToSegment(lx: number, ly: number, p1: PathPoint, p2: PathPoint) {
    const x = lx, y = ly;
    const x1 = p1.x, y1 = p1.y;
    const x2 = p2.x, y2 = p2.y;

    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const len_sq = C * C + D * D;
    let param = -1;
    if (len_sq !== 0) param = dot / len_sq;

    let xx, yy;

    if (param < 0) { xx = x1; yy = y1; }
    else if (param > 1) { xx = x2; yy = y2; }
    else { xx = x1 + param * C; yy = y1 + param * D; }

    const dx = x - xx;
    const dy = y - yy;
    return Math.sqrt(dx * dx + dy * dy);
}

// Helper: Create Evaluation Context
const createEvalContext = (project: ProjectState) => {
    const audioData = audioController.getAudioData();
    const ctx: any = { 
        audio: audioData || {},
        project: project, 
        get: (nodeId: string, propKey: string, depth: number = 0) => {
            const node = project.nodes[nodeId];
            if (!node) return 0;
            const prop = node.properties[propKey];
            return evaluateProperty(prop, project.meta.currentTime, ctx, depth, { nodeId, propKey });
        }
    };
    return ctx;
};

export const Viewport: React.FC<ViewportProps> = ({ projectRef, onSelect, onUpdate, onCommit, selection, onAddNode }) => {
  const canvasWebGpuRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null); // The actual canvas area (Stage)
  const workspaceRef = useRef<HTMLDivElement>(null); // The infinite pan/zoom area (Backstage)
  
  const rAF = useRef<number>(0);
  const [svgContent, setSvgContent] = useState<React.ReactNode>(null);
  const [rendererMode, setRendererMode] = useState<'svg' | 'webgpu'>('webgpu');
  const [gpuReady, setGpuReady] = useState(false);
  
  // Viewport Transform State (Pan/Zoom)
  // x, y are translation offsets from center. k is scale.
  const [view, setView] = useState({ x: 0, y: 0, k: 0.8 });
  const [isPanning, setIsPanning] = useState(false);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const [workspaceSize, setWorkspaceSize] = useState({ width: 0, height: 0 });

  // Interaction State (Tools)
  const [isDraggingNode, setIsDraggingNode] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragStartSnapshot, setDragStartSnapshot] = useState<{ id: string, x: number, y: number } | null>(null);
  
  // Pen Tool
  const [pathPoints, setPathPoints] = useState<PathPoint[]>([]);
  const [isPathClosed, setIsPathClosed] = useState(false);
  const [editingPathId, setEditingPathId] = useState<string | null>(null);
  const [dragPointIndex, setDragPointIndex] = useState<number | null>(null);
  const [dragHandleType, setDragHandleType] = useState<'none' | 'in' | 'out'>('none');
  const [penDragStart, setPenDragStart] = useState<{x:number, y:number} | null>(null);
  const [hoverStartPoint, setHoverStartPoint] = useState(false); 
  const [vectorStartSnapshot, setVectorStartSnapshot] = useState<{ id: string, path: string } | null>(null);

  // Initial Fit
  useEffect(() => {
     handleFitView();
     // Observe workspace resize
     const ro = new ResizeObserver(entries => {
         for (let entry of entries) {
             setWorkspaceSize({ width: entry.contentRect.width, height: entry.contentRect.height });
         }
     });
     if (workspaceRef.current) ro.observe(workspaceRef.current);
     return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const newMode = projectRef.current.meta.renderer;
    setRendererMode(newMode);
    
    if (newMode === 'webgpu' && !gpuReady && canvasWebGpuRef.current) {
        webgpuRenderer.init(canvasWebGpuRef.current).then((success) => {
            if(success) setGpuReady(true);
            else {
                console.error("Failed to init WebGPU");
                setGpuReady(false);
            }
        });
    }
  }, [projectRef.current.meta.renderer]);

  useEffect(() => {
      if (selection) {
          const node = projectRef.current.nodes[selection];
          if (node && node.type === 'vector') {
              if (node.properties.path.type === 'expression') {
                  setEditingPathId(null);
                  setPathPoints([]);
                  setIsPathClosed(false);
              } else {
                  setEditingPathId(selection);
                  const dProp = node.properties.path;
                  const d = dProp.type === 'string' ? String(dProp.value) : (evaluateProperty(dProp, 0) as string);
                  const { points, closed } = svgPathToPoints(d);
                  setPathPoints(points);
                  setIsPathClosed(closed);
              }
              return;
          }
      }
      
      if (!selection || (projectRef.current.nodes[selection]?.type !== 'vector')) {
        setEditingPathId(null);
        setPathPoints([]);
        setIsPathClosed(false);
      }
  }, [selection]); 

  // Render Loop
  useEffect(() => {
    let rAFId = 0;

    const loop = () => {
      const project = projectRef.current;
      const audioData = audioController.getAudioData();

      const canvasEl = canvasWebGpuRef.current;
      const isWebGPUMode = project.meta.renderer === 'webgpu' && gpuReady && !!canvasEl;

      if (isWebGPUMode && canvasEl && workspaceSize.width > 0) {
          const nodes = [...project.rootNodeIds].reverse();
          const evalContext = createEvalContext(project);
          
          const maxNodes = nodes.length;
          const data = new Float32Array(maxNodes * 16);
          let instanceCount = 0;

          for(const id of nodes) {
              const node = project.nodes[id];
              if (!node || node.type === 'value') continue;

              const v = (key: string, def: any) => 
                  evaluateProperty(node.properties[key], project.meta.currentTime, evalContext, 0, {nodeId: id, propKey: key}) ?? def;

              const fill = String(v('fill', '#ffffff'));
              const stroke = String(v('stroke', 'none'));
              
              const isVector = node.type === 'vector';
              const isComplexFill = fill.includes('gradient') || fill.includes('url');
              const isComplexStroke = stroke.includes('gradient') || stroke.includes('url');

              if (isVector || isComplexFill || isComplexStroke) {
                  continue; 
              }

              const x = Number(v('x', 0));
              const y = Number(v('y', 0)); 
              const rot = Number(v('rotation', 0));
              const scale = Number(v('scale', 1));
              const opacity = Number(v('opacity', 1));
              
              const rgb = hexToRgb(fill);
              const color = [rgb[0], rgb[1], rgb[2], opacity];

              let w = 100, h = 100, type = 0;

              if (node.type === 'rect') {
                  w = Number(v('width', 100)) * scale;
                  h = Number(v('height', 100)) * scale;
                  type = 0;
              } else if (node.type === 'circle') {
                  const r = Number(v('radius', 50));
                  w = r * 2 * scale;
                  h = r * 2 * scale;
                  type = 1;
              }

              const offset = instanceCount * 16; 
              data[offset + 0] = x;
              data[offset + 1] = y;
              data[offset + 2] = w;
              data[offset + 3] = h;
              data[offset + 4] = color[0];
              data[offset + 5] = color[1];
              data[offset + 6] = color[2];
              data[offset + 7] = color[3];
              data[offset + 8] = rot;
              data[offset + 9] = type;
              data[offset + 10] = 0;
              data[offset + 11] = 0;
              
              instanceCount++;
          }
          
          // Render with Full Viewport Transform
          webgpuRenderer.render(
              data, 
              instanceCount, 
              workspaceSize.width, 
              workspaceSize.height,
              view, // {x, y, k}
              project.meta.width, // Stage Width
              project.meta.height, // Stage Height
              canvasEl
          );
      } 
      
      const svgTree = renderSVG(project, audioData, isWebGPUMode);
      setSvgContent(svgTree);
      
      rAFId = requestAnimationFrame(loop);
      rAF.current = rAFId;
    };
    
    rAFId = requestAnimationFrame(loop);
    rAF.current = rAFId;

    return () => {
      cancelAnimationFrame(rAFId);
    };
  }, [gpuReady, view, workspaceSize]); // Re-bind loop if view changes (though rAF handles it usually, deps help React sync)

  // --- VIEWPORT NAVIGATION ---

  const handleFitView = () => {
      if (!workspaceRef.current) return;
      const rect = workspaceRef.current.getBoundingClientRect();
      const pWidth = projectRef.current.meta.width;
      const pHeight = projectRef.current.meta.height;
      
      // Calculate scale to fit with margin
      const margin = 50;
      const scaleX = (rect.width - margin * 2) / pWidth;
      const scaleY = (rect.height - margin * 2) / pHeight;
      const k = Math.min(scaleX, scaleY, 1); // Don't zoom in past 100% by default
      
      setView({ x: 0, y: 0, k });
  };

  const handleResetZoom = () => {
      // Zoom to 100% while maintaining the center of the viewport
      setView(prev => ({
          k: 1,
          x: prev.x * (1 / prev.k),
          y: prev.y * (1 / prev.k)
      }));
  };

  const handleZoom = (factor: number, center?: { x: number, y: number }) => {
      setView(prev => {
          const newK = Math.max(0.1, Math.min(10, prev.k * factor));
          
          if (center && workspaceRef.current) {
               // Zoom towards the mouse/center point
               const rect = workspaceRef.current.getBoundingClientRect();
               const centerX = rect.width / 2;
               const centerY = rect.height / 2;
               
               // World position of the zoom center currently
               const worldX = (center.x - centerX - prev.x) / prev.k;
               const worldY = (center.y - centerY - prev.y) / prev.k;
               
               // New view position to match that world position
               // MousePos = Center + NewX + World * NewK
               // NewX = MousePos - Center - World * NewK
               const newX = center.x - centerX - worldX * newK;
               const newY = center.y - centerY - worldY * newK;
               
               return { x: newX, y: newY, k: newK };
          }

          return { ...prev, k: newK };
      });
  };

  const handleWheel = (e: React.WheelEvent) => {
      // Standard AE/Houdini behavior:
      // Wheel = Zoom (centered on cursor)
      // Middle Mouse / Alt+Left = Pan
      
      e.preventDefault();
      
      const rect = workspaceRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Determine Zoom direction and factor
      const zoomStep = e.deltaY < 0 ? 1.1 : 0.9;
      
      handleZoom(zoomStep, { x: mouseX, y: mouseY });
  };

  const getMouseWorldPos = (e: React.MouseEvent) => {
      if (!stageRef.current) return { x: 0, y: 0 };
      
      const rect = stageRef.current.getBoundingClientRect();
      const pWidth = projectRef.current.meta.width;
      const pHeight = projectRef.current.meta.height;
      
      // Calculate Scale Factor based on rendered size vs actual size
      // This handles the view.k scaling automatically
      // Note: rect.left/top includes the transform, so this math works even for points outside the stage div
      const scaleX = pWidth / rect.width;
      const scaleY = pHeight / rect.height;
      
      return { 
          x: (e.clientX - rect.left) * scaleX, 
          y: (e.clientY - rect.top) * scaleY 
      };
  };

  // --- INTERACTION HANDLERS ---

  const hitTestPathPoints = (wx: number, wy: number, node: Node, points: PathPoint[]) => {
      const project = projectRef.current;
      const ctx = createEvalContext(project);
      
      const nx = evaluateProperty(node.properties.x, project.meta.currentTime, ctx) as number;
      const ny = evaluateProperty(node.properties.y, project.meta.currentTime, ctx) as number;
      const rot = evaluateProperty(node.properties.rotation, project.meta.currentTime, ctx) as number;
      const scale = evaluateProperty(node.properties.scale, project.meta.currentTime, ctx) as number;

      const lx = transformPointToLocal(wx, wy, nx, ny, rot, scale).x;
      const ly = transformPointToLocal(wx, wy, nx, ny, rot, scale).y;

      const HIT_RADIUS = 10 / scale;
      let hitIndex = -1;
      let handleType: 'none' | 'in' | 'out' = 'none';

      for(let i=0; i<points.length; i++) {
          const p = points[i];
          if (Math.hypot(p.x - lx, p.y - ly) < HIT_RADIUS) {
              hitIndex = i;
              handleType = 'none';
              break;
          }
          if (Math.hypot((p.x + p.inX) - lx, (p.y + p.inY) - ly) < HIT_RADIUS) {
              hitIndex = i;
              handleType = 'in';
              break;
          }
          if (Math.hypot((p.x + p.outX) - lx, (p.y + p.outY) - ly) < HIT_RADIUS) {
              hitIndex = i;
              handleType = 'out';
              break;
          }
      }
      return { hitIndex, handleType, lx, ly };
  };

  const handlePenDown = (e: React.MouseEvent, wx: number, wy: number) => {
      if (!editingPathId) {
          const newId = onAddNode('vector');
          onUpdate(newId, 'x', { type: 'number', value: wx });
          onUpdate(newId, 'y', { type: 'number', value: wy });
          const newPoint: PathPoint = { x: 0, y: 0, inX: 0, inY: 0, outX: 0, outY: 0, cmd: 'M' };
          const newPoints = [newPoint];
          const d = pointsToSvgPath(newPoints, false);
          onUpdate(newId, 'path', { type: 'string', value: d });

          setEditingPathId(newId);
          setPathPoints(newPoints);
          setIsPathClosed(false);
          setDragPointIndex(0);
          setDragHandleType('out'); 
          setPenDragStart({ x: 0, y: 0 });
          setVectorStartSnapshot({ id: newId, path: d });
          onSelect(newId); 
          return;
      }
      const project = projectRef.current;
      const node = project.nodes[editingPathId];
      if (!node || node.properties.path.type === 'expression') return;
      
      const dProp = node.properties.path;
      const currentD = dProp.type === 'string' ? String(dProp.value) : (evaluateProperty(dProp, 0) as string);
      setVectorStartSnapshot({ id: editingPathId, path: currentD });

      const { hitIndex, handleType, lx, ly } = hitTestPathPoints(wx, wy, node, pathPoints);

      if (hitIndex !== -1) {
          if (handleType === 'none' && hitIndex === 0 && pathPoints.length > 2) {
              const newPoints = [...pathPoints];
              const d = pointsToSvgPath(newPoints, true); 
              onUpdate(editingPathId, 'path', { type: 'string', value: d });
              setPathPoints(svgPathToPoints(d).points); 
              setIsPathClosed(true); 
          } else {
              setDragPointIndex(hitIndex);
              setDragHandleType(handleType);
              setPenDragStart({ x: lx, y: ly });
          }
      } else {
          const newPoint: PathPoint = { x: lx, y: ly, inX: 0, inY: 0, outX: 0, outY: 0, cmd: pathPoints.length === 0 ? 'M' : 'L' };
          const newPoints = [...pathPoints, newPoint];
          setPathPoints(newPoints);
          setDragPointIndex(newPoints.length - 1);
          setDragHandleType('out');
          setPenDragStart({ x: lx, y: ly });
          const d = pointsToSvgPath(newPoints, isPathClosed);
          onUpdate(editingPathId, 'path', { type: 'string', value: d });
      }
  };

  const handlePointDragMove = (e: React.MouseEvent, wx: number, wy: number) => {
      if (dragPointIndex === null || !editingPathId || !penDragStart) return;
      const node = projectRef.current.nodes[editingPathId];
      if (!node) return;
      const { lx, ly } = hitTestPathPoints(wx, wy, node, []);
      const newPoints = [...pathPoints];
      const p = { ...newPoints[dragPointIndex] };
      if (dragHandleType === 'none') { p.x = lx; p.y = ly; }
      else if (dragHandleType === 'out') { p.outX = lx - p.x; p.outY = ly - p.y; p.inX = -p.outX; p.inY = -p.outY; p.cmd = 'C'; }
      else if (dragHandleType === 'in') { p.inX = lx - p.x; p.inY = ly - p.y; p.outX = -p.inX; p.outY = -p.inY; p.cmd = 'C'; }
      newPoints[dragPointIndex] = p;
      setPathPoints(newPoints);
      const d = pointsToSvgPath(newPoints, isPathClosed);
      onUpdate(editingPathId, 'path', { type: 'string', value: d });
  };
  
  const handlePenUp = () => {
      setDragPointIndex(null);
      setDragHandleType('none');
      setPenDragStart(null);
      if (vectorStartSnapshot && editingPathId) {
          const node = projectRef.current.nodes[editingPathId];
          if (node) {
              const startD = vectorStartSnapshot.path;
              const dProp = node.properties.path;
              const endD = dProp.type === 'string' ? String(dProp.value) : '';
              if (startD !== endD) {
                   onCommit(Commands.set(projectRef.current, editingPathId, 'path', { type: 'string', value: endD }, { type: 'string', value: startD }, "Edit Path"));
              }
          }
      }
      setVectorStartSnapshot(null);
  };

  // --- MOUSE HANDLERS (Workspace vs Stage) ---

  const handleMouseDown = (e: React.MouseEvent) => {
      // 0. Ignore clicks on UI buttons (Zoom controls etc) that might bubble up
      if ((e.target as HTMLElement).closest('button')) return;

      // 1. Pan Check (Middle Mouse or Alt+Left)
      if (e.button === 1 || e.altKey) {
          e.preventDefault();
          setIsPanning(true);
          lastMousePos.current = { x: e.clientX, y: e.clientY };
          return;
      }

      // 2. Calculate World Pos (works outside stage bounds correctly due to getBoundingClientRect logic)
      const { x: wx, y: wy } = getMouseWorldPos(e);
      const activeTool = projectRef.current.meta.activeTool;

      // 3. Pen Tool
      if (activeTool === 'pen') {
          handlePenDown(e, wx, wy);
          return;
      }

      // 4. Hit Test Logic (Math-based, ignores DOM bounds)
      const project = projectRef.current;
      const ctx = createEvalContext(project);
      
      const nodes = project.rootNodeIds; 
      let hitId: string | null = null;

      // Reverse iteration for front-to-back hit test
      for (let i = 0; i < nodes.length; i++) {
          const id = nodes[i];
          const node = project.nodes[id];
          if (node.type === 'value') continue; 

          const nx = evaluateProperty(node.properties.x, project.meta.currentTime, ctx) as number;
          const ny = evaluateProperty(node.properties.y, project.meta.currentTime, ctx) as number;
          const rot = evaluateProperty(node.properties.rotation, project.meta.currentTime, ctx) as number;
          const scale = evaluateProperty(node.properties.scale, project.meta.currentTime, ctx) as number;
          
          const local = transformPointToLocal(wx, wy, nx, ny, rot, scale);
          let isHit = false;
          
          const fill = evaluateProperty(node.properties.fill, project.meta.currentTime, ctx) as string;
          const isTransparent = !fill || fill === 'transparent' || fill === 'none';
          
          if (node.type === 'rect') {
              const w = evaluateProperty(node.properties.width, project.meta.currentTime, ctx) as number;
              const h = evaluateProperty(node.properties.height, project.meta.currentTime, ctx) as number;
              const halfW = w / 2;
              const halfH = h / 2;
              
              if (local.x >= -halfW && local.x <= halfW && local.y >= -halfH && local.y <= halfH) {
                  if (isTransparent) {
                       const t = 5 / scale; // Tolerance
                       const onEdge = (local.x < -halfW + t) || (local.x > halfW - t) || (local.y < -halfH + t) || (local.y > halfH - t);
                       if (onEdge) isHit = true;
                  } else {
                       isHit = true;
                  }
              }
          } else if (node.type === 'circle') {
              const r = evaluateProperty(node.properties.radius, project.meta.currentTime, ctx) as number;
              const dist = Math.sqrt(local.x*local.x + local.y*local.y);
              if (dist <= r) {
                  if (isTransparent) {
                      const t = 5 / scale;
                      if (dist >= r - t) isHit = true;
                  } else {
                      isHit = true;
                  }
              }
          } else if (node.type === 'vector') {
             // ... existing vector hit test logic ...
             const d = evaluateProperty(node.properties.path, project.meta.currentTime, ctx) as string;
             const { points } = svgPathToPoints(d);
             if (points.length === 0) {
                 if (Math.abs(local.x) < 20 && Math.abs(local.y) < 20) isHit = true;
             } else {
                 const STROKE_HIT_THRESHOLD = 8 / scale;
                 let minDistance = Infinity;
                 for(let k=0; k<points.length; k++) {
                     const p1 = points[k];
                     if (k < points.length - 1) {
                         const dist = distToSegment(local.x, local.y, p1, points[k+1]);
                         if (dist < minDistance) minDistance = dist;
                     }
                 }
                 if (minDistance < STROKE_HIT_THRESHOLD) isHit = true;
             }
          }

          if (isHit) {
              hitId = id;
              setDragOffset({ x: wx - nx, y: wy - ny });
              break;
          }
      }

      // 5. Action
      if (hitId) {
          onSelect(hitId);
          setIsDraggingNode(true);
          const n = project.nodes[hitId];
          const sx = evaluateProperty(n.properties.x, project.meta.currentTime, ctx) as number;
          const sy = evaluateProperty(n.properties.y, project.meta.currentTime, ctx) as number;
          setDragStartSnapshot({ id: hitId, x: sx, y: sy });
      } else {
          onSelect(null);
      }
  };

  const handleGlobalMouseMove = (e: React.MouseEvent) => {
      // Pan Logic
      if (isPanning) {
          const dx = e.clientX - lastMousePos.current.x;
          const dy = e.clientY - lastMousePos.current.y;
          setView(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
          lastMousePos.current = { x: e.clientX, y: e.clientY };
          return;
      }

      // Tool Logic
      const { x: wx, y: wy } = getMouseWorldPos(e);
      
      if (dragPointIndex !== null) {
          handlePointDragMove(e, wx, wy);
          return;
      }

      if (!isDraggingNode || !selection) return;
      
      const node = projectRef.current.nodes[selection];
      if (!node || node.type === 'value') return;

      const targetX = wx - dragOffset.x;
      const targetY = wy - dragOffset.y;
      
      if (node.properties.x.type === 'number') onUpdate(selection, 'x', { type: 'number', value: targetX });
      if (node.properties.y.type === 'number') onUpdate(selection, 'y', { type: 'number', value: targetY });
  };

  const handleGlobalMouseUp = () => {
      setIsPanning(false);

      if (dragPointIndex !== null) { handlePenUp(); return; }
      
      if (isDraggingNode && dragStartSnapshot && selection) {
          const project = projectRef.current;
          const node = project.nodes[selection];
          if (node && node.type !== 'value') {
              const ctx = createEvalContext(project);
              const currentX = evaluateProperty(node.properties.x, project.meta.currentTime, ctx) as number;
              const currentY = evaluateProperty(node.properties.y, project.meta.currentTime, ctx) as number;
              const cmds: Command[] = [];
              const EPSILON = 0.001;

              if (node.properties.x.type === 'number' && Math.abs(currentX - dragStartSnapshot.x) > EPSILON) {
                   cmds.push(Commands.set(project, selection, 'x', { type: 'number', value: currentX }, { type: 'number', value: dragStartSnapshot.x }, 'Move X'));
              }
              if (node.properties.y.type === 'number' && Math.abs(currentY - dragStartSnapshot.y) > EPSILON) {
                   cmds.push(Commands.set(project, selection, 'y', { type: 'number', value: currentY }, { type: 'number', value: dragStartSnapshot.y }, 'Move Y'));
              }

              if (cmds.length > 0) {
                  if (cmds.length === 1) onCommit(cmds[0]);
                  else onCommit(Commands.batch(cmds, `Move ${selection}`));
              }
          }
      }
      setIsDraggingNode(false);
      setDragStartSnapshot(null);
  };

  const renderGizmo = () => {
      if (!selection) return null;
      const project = projectRef.current;
      const node = project.nodes[selection];
      if (!node) return null;
      if (node.type === 'value') return null; 

      const isVector = node.type === 'vector';
      const isCircle = node.type === 'circle';
      const isPathExpression = isVector && node.properties.path.type === 'expression';
      
      const showPointEditor = (project.meta.activeTool === 'pen' || isVector) && !isPathExpression;
      const showBoundingBox = !isVector || isPathExpression;

      const ctx = createEvalContext(project);
      const t = project.meta.currentTime;

      const x = evaluateProperty(node.properties.x, t, ctx, 0, { nodeId: selection, propKey: 'x' }) as number;
      const y = evaluateProperty(node.properties.y, t, ctx, 0, { nodeId: selection, propKey: 'y' }) as number;
      const rot = evaluateProperty(node.properties.rotation, t, ctx, 0, { nodeId: selection, propKey: 'rotation' }) as number;
      const scale = evaluateProperty(node.properties.scale, t, ctx, 0, { nodeId: selection, propKey: 'scale' }) as number;
      
      let width = 100, height = 100;
      let minX = 0, minY = 0, maxX = 0, maxY = 0;

      if (node.type === 'rect') {
          width = evaluateProperty(node.properties.width, t, ctx, 0, { nodeId: selection, propKey: 'width' }) as number;
          height = evaluateProperty(node.properties.height, t, ctx, 0, { nodeId: selection, propKey: 'height' }) as number;
          minX = -width/2; maxX = width/2;
          minY = -height/2; maxY = height/2;
      } else if (isCircle) {
          const r = evaluateProperty(node.properties.radius, t, ctx, 0, { nodeId: selection, propKey: 'radius' }) as number;
          width = r * 2; height = r * 2;
          minX = -r; maxX = r;
          minY = -r; maxY = r;
      } else if (node.type === 'vector') {
          const dProp = node.properties.path;
          const d = dProp.type === 'string' ? String(dProp.value) : (evaluateProperty(dProp, t, ctx) as string);
          const { points } = svgPathToPoints(d);
          if (points.length > 0) {
               minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
               for(const p of points) {
                   if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
                   if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
               }
          }
      }

      const transform = `translate(${x}, ${y}) rotate(${rot}) scale(${scale})`;
      const boxW = maxX - minX;
      const boxH = maxY - minY;
      
      const cx = Math.round(x);
      const cy = Math.round(y);

      return (
        <>
          <g transform={transform}>
              {showBoundingBox && (
                <>
                    {isCircle ? (
                        <circle cx={0} cy={0} r={boxW/2} fill="none" stroke="#3b82f6" strokeWidth={2 / scale} strokeDasharray="4 2" shapeRendering="geometricPrecision" />
                    ) : (
                        <rect x={minX} y={minY} width={boxW} height={boxH} fill="none" stroke="#3b82f6" strokeWidth={2 / scale} strokeDasharray="4 2" shapeRendering="crispEdges"/>
                    )}
                    {/* Handles omitted for brevity in pan/zoom refactor, relying on box stroke */}
                </>
              )}

              {showPointEditor && (
                  <g className="pen-editor-overlay">
                      {pathPoints.map((p, i) => (
                          <g key={i}>
                              {(p.inX !== 0 || p.inY !== 0) && ( <line x1={p.x} y1={p.y} x2={p.x + p.inX} y2={p.y + p.inY} stroke="#3b82f6" strokeWidth={1/scale} /> )}
                              {(p.outX !== 0 || p.outY !== 0) && ( <line x1={p.x} y1={p.y} x2={p.x + p.outX} y2={p.y + p.outY} stroke="#3b82f6" strokeWidth={1/scale} /> )}
                          </g>
                      ))}
                      {pathPoints.map((p, i) => {
                          const isStart = i === 0;
                          return (
                          <g key={i}>
                              <circle cx={p.x} cy={p.y} r={4/scale} fill={isStart && pathPoints.length > 0 ? "#10b981" : "white"} stroke="#3b82f6" strokeWidth={2/scale} />
                              {(p.inX !== 0 || p.inY !== 0) && ( <circle cx={p.x + p.inX} cy={p.y + p.inY} r={3/scale} fill="#3b82f6" /> )}
                              {(p.outX !== 0 || p.outY !== 0) && ( <circle cx={p.x + p.outX} cy={p.y + p.outY} r={3/scale} fill="#3b82f6" /> )}
                          </g>
                      )})}
                  </g>
              )}
          </g>

          <path 
            d={`M ${cx-6} ${cy} L ${cx+6} ${cy} M ${cx} ${cy-6} L ${cx} ${cy+6}`} 
            stroke="#ef4444" 
            strokeWidth={1} 
            shapeRendering="crispEdges"
            vectorEffect="non-scaling-stroke" 
            filter="drop-shadow(0 0 1px rgba(0,0,0,0.8))"
          />
        </>
      );
  };

  return (
    <div 
        ref={workspaceRef}
        className={`flex-1 bg-zinc-950 relative overflow-hidden flex items-center justify-center ${isPanning ? 'cursor-grabbing' : projectRef.current.meta.activeTool === 'pen' ? 'cursor-crosshair' : 'cursor-default'}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleGlobalMouseMove}
        onMouseUp={handleGlobalMouseUp}
        onMouseLeave={handleGlobalMouseUp}
        onContextMenu={(e) => e.preventDefault()}
    >
        {/* WebGPU Layer - FULL SCREEN */}
        <canvas 
            ref={canvasWebGpuRef} 
            className={`absolute inset-0 pointer-events-none w-full h-full ${rendererMode === 'webgpu' ? 'block' : 'hidden'}`}
        />

        {/* Infinite Grid Background (Backstage) */}
        <div 
            className="absolute inset-0 pointer-events-none opacity-20" 
            style={{ 
                backgroundImage: 'radial-gradient(#52525b 1px, transparent 1px)', 
                backgroundSize: '20px 20px',
                backgroundPosition: `${view.x}px ${view.y}px` 
            }} 
        />
        
        {/* Transform Root: Centered in container, moved by Pan/Zoom */}
        {/* We use a zero-size div centered in the viewport as the origin for our transforms */}
        <div 
            className="absolute top-1/2 left-1/2 w-0 h-0"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
        >
             {/* THE STAGE (Canvas Area) */}
             <div 
                ref={stageRef}
                className="absolute"
                style={{ 
                    width: projectRef.current.meta.width, 
                    height: projectRef.current.meta.height,
                    // Center the stage on the transform origin
                    left: -projectRef.current.meta.width / 2, 
                    top: -projectRef.current.meta.height / 2,
                    boxShadow: '0 0 0 1px #3f3f46, 0 20px 50px -12px rgba(0, 0, 0, 0.5)',
                    backgroundColor: rendererMode === 'svg' ? 'black' : 'transparent' // Transparent in WebGPU mode so grid shows through
                }}
             >
                
                {/* SVG Layer */}
                <div className="absolute inset-0 pointer-events-none block">
                    {svgContent}
                </div>

                {/* Gizmo Layer */}
                <svg 
                    className="absolute inset-0 w-full h-full pointer-events-none z-20 overflow-visible"
                    viewBox={`0 0 ${projectRef.current.meta.width} ${projectRef.current.meta.height}`}
                >
                    {renderGizmo()}
                </svg>
             </div>
             
             {/* Stage Label/Dimensions */}
             <div 
                className="absolute text-[10px] text-zinc-600 font-mono -top-[calc(50%_+_20px)] left-0 w-full text-center pointer-events-none"
                style={{ top: -(projectRef.current.meta.height / 2) - 20 }}
             >
                 {projectRef.current.meta.width} x {projectRef.current.meta.height}
             </div>
        </div>

        {/* View Controls HUD */}
        <div className="absolute bottom-4 right-4 flex items-center gap-2 bg-zinc-900 border border-zinc-800 p-1 rounded-lg shadow-lg z-50" onMouseDown={e => e.stopPropagation()}>
            <button onClick={() => handleZoom(0.9)} className="p-1.5 hover:bg-zinc-800 rounded text-zinc-400" title="Zoom Out">
                <ZoomOut size={14} />
            </button>
            <span className="text-xs font-mono w-12 text-center text-zinc-300 select-none">
                {Math.round(view.k * 100)}%
            </span>
             <button onClick={() => handleZoom(1.1)} className="p-1.5 hover:bg-zinc-800 rounded text-zinc-400" title="Zoom In">
                <ZoomIn size={14} />
            </button>
            <div className="w-px h-4 bg-zinc-800 mx-1"></div>
            <button onClick={handleResetZoom} className="p-1.5 hover:bg-zinc-800 rounded text-zinc-400 text-[10px] font-mono font-bold" title="Actual Size (100%)">
                1:1
            </button>
            <button onClick={handleFitView} className="p-1.5 hover:bg-zinc-800 rounded text-zinc-400" title="Fit to Screen">
                <Maximize size={14} />
            </button>
        </div>
        
        {/* Help Toast for Navigation */}
        <div className="absolute bottom-4 left-4 text-[10px] text-zinc-600 font-mono pointer-events-none opacity-50 select-none">
            Middle Click / Alt+Drag to Pan • Scroll to Zoom
        </div>
    </div>
  );
};