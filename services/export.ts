import { ProjectState } from '../types';
import { evaluateProperty } from './engine';
import { audioController } from './audio';

export const generateSVGString = (project: ProjectState): string => {
  const { width, height, currentTime } = project.meta;
  const audioData = audioController.getAudioData();

  // 1. Create Context (Duplicated from engine.ts to ensure consistency)
  const evalContext: any = { 
      audio: audioData || {},
      get: (nodeId: string, propKey: string, depth: number = 0) => {
          const node = project.nodes[nodeId];
          if (!node) return 0;
          const prop = node.properties[propKey];
          return evaluateProperty(prop, currentTime, evalContext, depth, { nodeId, propKey });
      }
  };

  let elements = '';

  // 2. Render Nodes
  project.rootNodeIds.forEach(nodeId => {
    const node = project.nodes[nodeId];
    if (!node) return;

    const v = (key: string, def: any = 0) => 
        evaluateProperty(node.properties[key], currentTime, evalContext, 0, { nodeId, propKey: key }) ?? def;

    const x = v('x', 0);
    const y = v('y', 0);
    const rotation = v('rotation', 0);
    const scale = v('scale', 1);
    const opacity = v('opacity', 1);
    const fill = v('fill', 'none');
    const stroke = v('stroke', 'none');
    const strokeWidth = v('strokeWidth', 0);
    
    // SVG transform order matters.
    const transform = `translate(${x}, ${y}) rotate(${rotation}) scale(${scale})`;
    
    if (node.type === 'rect') {
      const w = v('width', 100);
      const h = v('height', 100);
      elements += `<rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}" transform="${transform}" />`;
    } 
    else if (node.type === 'circle') {
      const r = v('radius', 50);
      elements += `<circle cx="0" cy="0" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}" transform="${transform}" />`;
    } 
    else if (node.type === 'vector') {
        const d = v('d', '');
        // Note: attribute is stroke-width, not strokeWidth
        elements += `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}" transform="${transform}" />`;
    }
  });

  // 3. Construct Final SVG with explicit transparent background style
  // Removed translate transform to match top-left origin
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background-color: transparent;" xmlns="http://www.w3.org/2000/svg">
    ${elements}
</svg>`;
};

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const exportToSVG = (project: ProjectState) => {
  const svgString = generateSVGString(project);
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, `frame_${project.meta.currentTime.toFixed(2)}.svg`);
};

export const exportToPNG = (project: ProjectState) => {
  const svgString = generateSVGString(project);
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  const img = new Image();
  // Allow cross-origin to prevent canvas tainting (though local blob is usually safe)
  img.crossOrigin = "anonymous";
  
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = project.meta.width;
    canvas.height = project.meta.height;
    
    // Explicitly request alpha channel
    const ctx = canvas.getContext('2d', { alpha: true });
    
    if (ctx) {
        // Force clear to transparent before drawing
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        
        canvas.toBlob((blob) => {
            if (blob) downloadBlob(blob, `frame_${project.meta.currentTime.toFixed(2)}.png`);
        }, 'image/png');
    }
    URL.revokeObjectURL(url);
  };
  img.src = url;
};