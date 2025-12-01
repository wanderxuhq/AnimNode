
import React, { useRef, useEffect, useState } from 'react';
import { ProjectState } from '../types';
import { renderCanvas, renderSVG } from '../services/engine';
import { audioController } from '../services/audio';

interface ViewportProps {
  projectRef: React.MutableRefObject<ProjectState>;
}

export const Viewport: React.FC<ViewportProps> = ({ projectRef }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rAF = useRef<number>(0);
  const [svgContent, setSvgContent] = useState<React.ReactNode>(null);
  const [rendererMode, setRendererMode] = useState<'canvas' | 'svg'>('canvas');

  // Sync internal mode state with project state periodically or on render
  useEffect(() => {
    setRendererMode(projectRef.current.meta.renderer);
  }, [projectRef.current.meta.renderer]);

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
        // SVG Render Loop (React state update)
        // Note: Updating React state 60fps is heavy, but necessary for SVG preview
        setSvgContent(renderSVG(project, audioData));
      }
      rAF.current = requestAnimationFrame(loop);
    };
    
    rAF.current = requestAnimationFrame(loop);
    
    return () => {
      if (rAF.current) cancelAnimationFrame(rAF.current);
    };
  }, []);

  return (
    <div className="flex-1 bg-black relative flex items-center justify-center overflow-hidden">
        <div className="absolute top-4 left-4 text-xs font-mono text-zinc-600 z-10 pointer-events-none select-none">
            {rendererMode.toUpperCase()} Output ({projectRef.current.meta.width}x{projectRef.current.meta.height})
        </div>
        <div className="relative shadow-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
             {/* We stack them but hide based on mode */}
             <canvas 
                ref={canvasRef} 
                width={800} 
                height={600}
                className={rendererMode === 'canvas' ? 'block' : 'hidden'}
                style={{ width: 800, height: 600 }}
            />
            <div 
              className={rendererMode === 'svg' ? 'block' : 'hidden'}
              style={{ width: 800, height: 600 }}
            >
              {svgContent}
            </div>
        </div>
    </div>
  );
};
