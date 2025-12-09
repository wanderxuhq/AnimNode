import React, { useRef, useEffect, useState } from 'react';
import { ProjectState, Node, Command, Property } from '../types';
import { renderSVG, evaluateProperty } from '../services/engine';
import { audioController } from '../services/audio';
import { webgpuRenderer } from '../services/webgpu';
import { Zap, Cpu, Layers, Activity } from 'lucide-react';
import { PathPoint, pointsToSvgPath, svgPathToPoints } from '../services/path';
import { Commands } from '../services/commands';

interface ViewportProps {
  projectRef: React.MutableRefObject<ProjectState>;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, propKey: string, updates: any) => void;
  onCommit: (cmd: Command) => void; // New prop for history
  selection: string | null;
  onAddNode: (type: 'rect' | 'circle' | 'vector' | 'value') => string;
}

// Helper to convert hex to normalized rgb
const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
        parseInt(result[1], 16) / 255,
        parseInt(result[2], 16) / 255,
        parseInt(result[3], 16) / 255,
        1
    ] : [1, 0, 1, 1];
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
  const containerRef = useRef<HTMLDivElement>(null);
  
  const rAF = useRef<number>(0);
  const [svgContent, setSvgContent] = useState<React.ReactNode>(null);
  const [rendererMode, setRendererMode] = useState<'svg' | 'webgpu'>('webgpu');
  const [gpuReady, setGpuReady] = useState(false);
  
  // Stats
  const [realFps, setRealFps] = useState(0);
  const [instanceCount, setInstanceCount] = useState(0);
  
  // Interaction State
  const [isDragging, setIsDragging] = useState(false);
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

  const [tick, setTick] = useState(0); 

  useEffect(() => {
    const newMode = projectRef.current.meta.renderer;
    setRendererMode(newMode);
    
    if (newMode === 'webgpu' && !gpuReady && canvasWebGpuRef.current) {
        webgpuRenderer.init(canvasWebGpuRef.current).then((success) => {
            if(success) {
                setGpuReady(true);
            } else {
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
              setEditingPathId(selection);
              // Safe access via evaluateProperty for initial display?
              // Actually we need the raw value to edit points.
              // If expression mode, this might be tricky. Pen tool usually forces static path value.
              const dProp = node.properties.path;
              const d = dProp.type === 'string' ? String(dProp.value) : (evaluateProperty(dProp, 0) as string);
              
              const { points, closed } = svgPathToPoints(d);
              setPathPoints(points);
              setIsPathClosed(closed);
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
    let frameCount = 0;
    let lastTime = performance.now();
    let rAFId = 0;

    const loop = () => {
      const now = performance.now();
      frameCount++;
      
      if (now - lastTime >= 1000) {
          setRealFps(frameCount);
          frameCount = 0;
          lastTime = now;
      }

      const project = projectRef.current;
      const audioData = audioController.getAudioData();

      if (project.meta.renderer === 'webgpu' && gpuReady && canvasWebGpuRef.current) {
          // REVERSE RENDER ORDER: Last Index (Bottom) -> First Index (Top)
          // We want Index 0 drawn LAST.
          const nodes = [...project.rootNodeIds].reverse();
          
          let renderableCount = 0;
          for(const id of nodes) {
              const node = project.nodes[id];
              if(node && node.type !== 'value') renderableCount++;
          }
          setInstanceCount(renderableCount);

          const floatCount = renderableCount * 10;
          const data = new Float32Array(floatCount);
          
          const evalContext: any = { 
            audio: audioData || {},
            project: project,
            get: (nodeId: string, propKey: string, depth: number = 0) => {
                const node = project.nodes[nodeId];
                if (!node) return 0;
                const prop = node.properties[propKey];
                return evaluateProperty(prop, project.meta.currentTime, evalContext, depth, { nodeId, propKey });
            }
          };

          let index = 0;
          for(const id of nodes) {
              const node = project.nodes[id];
              if(!node) continue;
              if(node.type === 'value') continue; 
              
              const v = (key: string, def: any) => 
                  evaluateProperty(node.properties[key], project.meta.currentTime, evalContext, 0, {nodeId: id, propKey: key}) ?? def;

              const x = Number(v('x', 0));
              const y = Number(v('y', 0)); 
              const rot = Number(v('rotation', 0));
              const scale = Number(v('scale', 1));
              const opacity = Number(v('opacity', 1));
              
              let w = 100, h = 100, type = 0, color = [1,1,1,1];
              const fillHex = String(v('fill', '#ffffff'));
              const rgb = hexToRgb(fillHex);
              color = [rgb[0], rgb[1], rgb[2], opacity];

              if (node.type === 'rect') {
                  w = Number(v('width', 100)) * scale;
                  h = Number(v('height', 100)) * scale;
                  type = 0;
              } else if (node.type === 'circle') {
                  const r = Number(v('radius', 50));
                  w = r * 2 * scale;
                  h = r * 2 * scale;
                  type = 1;
              } else if (node.type === 'vector') {
                  type = -1; 
              }

              const offset = index * 10;
              data[offset + 0] = x;
              data[offset + 1] = y;
              data[offset + 2] = w;
              data[offset + 3] = h;
              data[offset + 4] = rot;
              data[offset + 5] = color[0];
              data[offset + 6] = color[1];
              data[offset + 7] = color[2];
              data[offset + 8] = color[3];
              data[offset + 9] = type;

              index++;
          }
          webgpuRenderer.render(data, renderableCount, project.meta.width, project.meta.height, canvasWebGpuRef.current);
      } 
      
      const svgTree = renderSVG(project, audioData);
      setSvgContent(svgTree);

      if (project.meta.renderer === 'svg') {
         setInstanceCount(project.rootNodeIds.filter(id => project.nodes[id]?.type !== 'value').length);
      }
      
      setTick(t => t + 1);
      rAFId = requestAnimationFrame(loop);
      rAF.current = rAFId;
    };
    
    rAFId = requestAnimationFrame(loop);
    rAF.current = rAFId;

    return () => {
      cancelAnimationFrame(rAFId);
    };
  }, [gpuReady]);

  const getMouseWorldPos = (e: React.MouseEvent) => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;
      return { x: clientX, y: clientY };
  };

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
          
          // Move node to mouse position (Start Origin)
          onUpdate(newId, 'x', { type: 'number', value: wx });
          onUpdate(newId, 'y', { type: 'number', value: wy });

          // Start Path at Local 0,0
          const newPoint: PathPoint = { x: 0, y: 0, inX: 0, inY: 0, outX: 0, outY: 0, cmd: 'M' };
          const newPoints = [newPoint];
          const d = pointsToSvgPath(newPoints, false);

          // Force 'string' mode when drawing
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
      if (!node) return; 

      // Retrieve current D. Use evaluated if linked/expression, but really Pen works best on static values.
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
              return;
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
      const project = projectRef.current;
      const ctx = createEvalContext(project);

      if (editingPathId && pathPoints.length > 2 && dragPointIndex === null) {
          const node = project.nodes[editingPathId];
          if(node) {
             const { lx, ly } = hitTestPathPoints(wx, wy, node, []); 
             const startP = pathPoints[0];
             const scale = evaluateProperty(node.properties.scale, project.meta.currentTime, ctx) as number;
             const HIT_RADIUS = 12 / scale;
             const dist = Math.hypot(startP.x - lx, startP.y - ly);
             setHoverStartPoint(dist < HIT_RADIUS);
          }
      } else {
          setHoverStartPoint(false);
      }

      if (dragPointIndex === null || !editingPathId || !penDragStart) return;

      const node = project.nodes[editingPathId];
      if (!node) return;
      
      const { lx, ly } = hitTestPathPoints(wx, wy, node, []);

      const newPoints = [...pathPoints];
      const p = { ...newPoints[dragPointIndex] };

      if (dragHandleType === 'none') {
          p.x = lx; p.y = ly;
      } else if (dragHandleType === 'out') {
          p.outX = lx - p.x; p.outY = ly - p.y;
          p.inX = -p.outX; p.inY = -p.outY;
          p.cmd = 'C'; 
      } else if (dragHandleType === 'in') {
          p.inX = lx - p.x; p.inY = ly - p.y;
          p.outX = -p.inX; p.outY = -p.inY;
          p.cmd = 'C';
      }

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
                   onCommit(Commands.set(
                       projectRef.current,
                       editingPathId,
                       'path',
                       { type: 'string', value: endD },
                       { type: 'string', value: startD },
                       "Edit Path"
                   ));
              }
          }
      }
      setVectorStartSnapshot(null);
  };


  // --- MAIN HANDLERS ---

  const handleMouseDown = (e: React.MouseEvent) => {
      const { x: wx, y: wy } = getMouseWorldPos(e);
      const activeTool = projectRef.current.meta.activeTool;

      if (activeTool === 'pen') {
          handlePenDown(e, wx, wy);
          return;
      }

      const project = projectRef.current;
      const ctx = createEvalContext(project);
      
      if (selection && project.nodes[selection]?.type === 'vector') {
          const node = project.nodes[selection];
          const { hitIndex, handleType, lx, ly } = hitTestPathPoints(wx, wy, node, pathPoints);
          
          if (hitIndex !== -1) {
              const dProp = node.properties.path;
              const d = dProp.type === 'string' ? String(dProp.value) : (evaluateProperty(dProp, 0) as string);
              setVectorStartSnapshot({ id: selection, path: d });
              setDragPointIndex(hitIndex);
              setDragHandleType(handleType);
              setPenDragStart({ x: lx, y: ly });
              return;
          }
      }

      // Hit Test in Reverse Render Order (Top to Bottom)
      // Index 0 is Top. Index N is Bottom.
      // So we iterate 0 to N.
      const nodes = project.rootNodeIds; 
      let hitId: string | null = null;

      for (const id of nodes) {
          const node = project.nodes[id];
          if (node.type === 'value') continue; 

          const nx = evaluateProperty(node.properties.x, project.meta.currentTime, ctx) as number;
          const ny = evaluateProperty(node.properties.y, project.meta.currentTime, ctx) as number;
          const rot = evaluateProperty(node.properties.rotation, project.meta.currentTime, ctx) as number;
          const scale = evaluateProperty(node.properties.scale, project.meta.currentTime, ctx) as number;
          
          const local = transformPointToLocal(wx, wy, nx, ny, rot, scale);
          let isHit = false;

          if (node.type === 'rect') {
              const w = evaluateProperty(node.properties.width, project.meta.currentTime, ctx) as number;
              const h = evaluateProperty(node.properties.height, project.meta.currentTime, ctx) as number;
              // Rect is 0..w, 0..h
              if (local.x >= 0 && local.x <= w && local.y >= 0 && local.y <= h) isHit = true;
          } else if (node.type === 'circle') {
              const r = evaluateProperty(node.properties.radius, project.meta.currentTime, ctx) as number;
              // Circle center is (r, r)
              const dx = local.x - r;
              const dy = local.y - r;
              const dist = Math.sqrt(dx*dx + dy*dy);
              if (dist <= r) isHit = true;
          } else if (node.type === 'vector') {
              const d = evaluateProperty(node.properties.path, project.meta.currentTime, ctx) as string;
              const { points } = svgPathToPoints(d);
              if (points.length === 0) {
                   if (Math.abs(local.x) < 20 && Math.abs(local.y) < 20) isHit = true;
              } else {
                   // Crude bounding box for hit test
                   let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                   for(const p of points) {
                       if (p.x < minX) minX = p.x;
                       if (p.x > maxX) maxX = p.x;
                       if (p.y < minY) minY = p.y;
                       if (p.y > maxY) maxY = p.y;
                   }
                   const pad = 10 / scale;
                   if (local.x >= minX - pad && local.x <= maxX + pad && local.y >= minY - pad && local.y <= maxY + pad) {
                       isHit = true;
                   }
              }
          }

          if (isHit) {
              hitId = id;
              setDragOffset({ x: wx - nx, y: wy - ny });
              break;
          }
      }

      if (hitId) {
          onSelect(hitId);
          setIsDragging(true);
          const n = project.nodes[hitId];
          const sx = evaluateProperty(n.properties.x, project.meta.currentTime, ctx) as number;
          const sy = evaluateProperty(n.properties.y, project.meta.currentTime, ctx) as number;
          setDragStartSnapshot({ id: hitId, x: sx, y: sy });
      } else {
          onSelect(null);
      }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      const { x: wx, y: wy } = getMouseWorldPos(e);
      const activeTool = projectRef.current.meta.activeTool;

      if (dragPointIndex !== null) {
          handlePointDragMove(e, wx, wy);
          return;
      }
      
      if (activeTool === 'pen') {
          handlePointDragMove(e, wx, wy);
          return;
      }

      if (!isDragging || !selection) return;
      
      const node = projectRef.current.nodes[selection];
      if (!node || node.type === 'value') return;

      const targetX = wx - dragOffset.x;
      const targetY = wy - dragOffset.y;
      
      if (node.properties.x.type === 'number') {
        onUpdate(selection, 'x', { type: 'number', value: targetX });
      }
      if (node.properties.y.type === 'number') {
        onUpdate(selection, 'y', { type: 'number', value: targetY });
      }
  };

  const handleMouseUp = () => {
      if (dragPointIndex !== null) {
          handlePenUp();
          return;
      }
      
      if (isDragging && dragStartSnapshot && selection) {
          const project = projectRef.current;
          const node = project.nodes[selection];
          
          if (node && node.type !== 'value') {
              const ctx = createEvalContext(project);
              const currentX = evaluateProperty(node.properties.x, project.meta.currentTime, ctx) as number;
              const currentY = evaluateProperty(node.properties.y, project.meta.currentTime, ctx) as number;

              const cmds: Command[] = [];
              const EPSILON = 0.001;

              // Check X
              if (node.properties.x.type === 'number' && Math.abs(currentX - dragStartSnapshot.x) > EPSILON) {
                   cmds.push(Commands.set(
                       project, selection, 'x', 
                       { type: 'number', value: currentX },
                       { type: 'number', value: dragStartSnapshot.x },
                       'Move X'
                   ));
              }

              // Check Y
              if (node.properties.y.type === 'number' && Math.abs(currentY - dragStartSnapshot.y) > EPSILON) {
                   cmds.push(Commands.set(
                       project, selection, 'y', 
                       { type: 'number', value: currentY },
                       { type: 'number', value: dragStartSnapshot.y },
                       'Move Y'
                   ));
              }

              if (cmds.length > 0) {
                  if (cmds.length === 1) onCommit(cmds[0]);
                  else onCommit(Commands.batch(cmds, `Move ${selection}`));
              }
          }
      }

      setIsDragging(false);
      setDragStartSnapshot(null);
  };

  const renderGizmo = () => {
      if (!selection) return null;
      const project = projectRef.current;
      const node = project.nodes[selection];
      if (!node) return null;
      if (node.type === 'value') return null; 

      const isVector = node.type === 'vector';
      const showPointEditor = project.meta.activeTool === 'pen' || isVector;
      const showBoundingBox = !isVector; 

      const ctx = createEvalContext(project);
      const t = project.meta.currentTime;

      const x = evaluateProperty(node.properties.x, t, ctx, 0, { nodeId: selection, propKey: 'x' }) as number;
      const y = evaluateProperty(node.properties.y, t, ctx, 0, { nodeId: selection, propKey: 'y' }) as number;
      const rot = evaluateProperty(node.properties.rotation, t, ctx, 0, { nodeId: selection, propKey: 'rotation' }) as number;
      const scale = evaluateProperty(node.properties.scale, t, ctx, 0, { nodeId: selection, propKey: 'scale' }) as number;
      
      let width = 100, height = 100;
      if (node.type === 'rect') {
          width = evaluateProperty(node.properties.width, t, ctx, 0, { nodeId: selection, propKey: 'width' }) as number;
          height = evaluateProperty(node.properties.height, t, ctx, 0, { nodeId: selection, propKey: 'height' }) as number;
      } else if (node.type === 'circle') {
          const r = evaluateProperty(node.properties.radius, t, ctx, 0, { nodeId: selection, propKey: 'radius' }) as number;
          width = r * 2; height = r * 2;
      }

      const transform = `translate(${x}, ${y}) rotate(${rot}) scale(${scale})`;

      // Gizmo is drawn in local space
      // If Top-Left alignment: Local 0,0 is Top-Left. Box goes from 0,0 to w,h.
      return (
          <g transform={transform}>
              {showBoundingBox && (
                <>
                    <rect x={0} y={0} width={width} height={height} fill="none" stroke="#3b82f6" strokeWidth={2 / scale} strokeDasharray="4 2"/>
                    <rect x={-4} y={-4} width={8} height={8} fill="#3b82f6" stroke="white" strokeWidth={1} />
                    <rect x={width - 4} y={height - 4} width={8} height={8} fill="#3b82f6" stroke="white" strokeWidth={1} />
                    <rect x={width - 4} y={-4} width={8} height={8} fill="#3b82f6" stroke="white" strokeWidth={1} />
                    <rect x={-4} y={height - 4} width={8} height={8} fill="#3b82f6" stroke="white" strokeWidth={1} />
                </>
              )}

              {showPointEditor && (
                  <g className="pen-editor-overlay">
                      {pathPoints.map((p, i) => (
                          <g key={i}>
                              {(p.inX !== 0 || p.inY !== 0) && (
                                  <line x1={p.x} y1={p.y} x2={p.x + p.inX} y2={p.y + p.inY} stroke="#3b82f6" strokeWidth={1/scale} />
                              )}
                              {(p.outX !== 0 || p.outY !== 0) && (
                                  <line x1={p.x} y1={p.y} x2={p.x + p.outX} y2={p.y + p.outY} stroke="#3b82f6" strokeWidth={1/scale} />
                              )}
                          </g>
                      ))}
                      
                      {pathPoints.map((p, i) => {
                          const isStart = i === 0;
                          const showCloseHint = isStart && hoverStartPoint && pathPoints.length > 2;

                          return (
                          <g key={i}>
                              <circle 
                                cx={p.x} cy={p.y} 
                                r={showCloseHint ? (8/scale) : (4/scale)} 
                                fill={isStart && pathPoints.length > 0 ? "#10b981" : "white"} 
                                stroke="#3b82f6" 
                                strokeWidth={2/scale} 
                                style={{ transition: 'all 0.2s' }}
                              />
                              {showCloseHint && (
                                  <circle cx={p.x} cy={p.y} r={12/scale} fill="none" stroke="#10b981" strokeWidth={2/scale} opacity={0.5} />
                              )}
                              
                              {(p.inX !== 0 || p.inY !== 0) && (
                                  <circle cx={p.x + p.inX} cy={p.y + p.inY} r={3/scale} fill="#3b82f6" />
                              )}
                              {(p.outX !== 0 || p.outY !== 0) && (
                                  <circle cx={p.x + p.outX} cy={p.y + p.outY} r={3/scale} fill="#3b82f6" />
                              )}
                          </g>
                      )})}
                  </g>
              )}
          </g>
      );
  };

  return (
    <div className="flex-1 bg-black relative flex items-center justify-center overflow-hidden">
        <div 
            ref={containerRef}
            className={`relative shadow-2xl border border-zinc-800 bg-zinc-900 overflow-hidden ${projectRef.current.meta.activeTool === 'pen' ? 'cursor-crosshair' : 'cursor-default'}`}
            style={{ width: projectRef.current.meta.width, height: projectRef.current.meta.height }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        >
             <canvas 
                ref={canvasWebGpuRef} 
                width={projectRef.current.meta.width} 
                height={projectRef.current.meta.height}
                className={`absolute inset-0 pointer-events-none ${rendererMode === 'webgpu' ? 'block' : 'hidden'}`}
                style={{ width: '100%', height: '100%' }}
            />

            <div 
              className={`absolute inset-0 pointer-events-none block`}
              style={{ width: '100%', height: '100%' }}
            >
              {svgContent}
            </div>

            <svg 
                className="absolute inset-0 w-full h-full pointer-events-none z-20"
                viewBox={`0 0 ${projectRef.current.meta.width} ${projectRef.current.meta.height}`}
            >
                {renderGizmo()}
            </svg>
        </div>
    </div>
  );
};