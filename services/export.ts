
import { ProjectState } from '../types';
import { evaluateProperty, parseCssGradient, GradientDef } from './engine';
import { audioController } from './audio';

export const generateSVGString = (project: ProjectState): string => {
  const { width, height, currentTime } = project.meta;
  const audioData = audioController.getAudioData();

  // 1. Create Context
  const evalContext: any = { 
      audio: audioData || {},
      project: project, 
      get: (nodeId: string, propKey: string, depth: number = 0) => {
          const node = project.nodes[nodeId];
          if (!node) return 0;
          const prop = node.properties[propKey];
          return evaluateProperty(prop, currentTime, evalContext, depth, { nodeId, propKey });
      }
  };

  let elements = '';
  const gradients: GradientDef[] = [];

  // 2. Render Nodes
  const renderOrder = [...project.rootNodeIds].reverse();

  renderOrder.forEach(nodeId => {
    const node = project.nodes[nodeId];
    if (!node) return;

    const v = (key: string, def: any = 0) => 
        evaluateProperty(node.properties[key], currentTime, evalContext, 0, { nodeId, propKey: key }) ?? def;

    const x = v('x', 0);
    const y = v('y', 0);
    const rotation = v('rotation', 0);
    const scale = v('scale', 1);
    const opacity = v('opacity', 1);
    let fill = v('fill', 'none');
    let stroke = v('stroke', 'none');
    const strokeWidth = v('strokeWidth', 0);
    
    // Gradient Handling
    if (typeof fill === 'string' && (fill.startsWith('linear-gradient') || fill.startsWith('radial-gradient'))) {
        const gradId = `grad_fill_${nodeId}`;
        const def = parseCssGradient(fill, gradId);
        if (def) {
            gradients.push(def);
            fill = `url(#${gradId})`;
        }
    }
    if (typeof stroke === 'string' && (stroke.startsWith('linear-gradient') || stroke.startsWith('radial-gradient'))) {
        const gradId = `grad_stroke_${nodeId}`;
        const def = parseCssGradient(stroke, gradId);
        if (def) {
            gradients.push(def);
            stroke = `url(#${gradId})`;
        }
    }
    
    // Transform is applied first: Translate to (x,y), then Rotate, then Scale.
    // Inside this transform, (0,0) is the center of the object.
    const transform = `translate(${x}, ${y}) rotate(${rotation}) scale(${scale})`;
    
    if (node.type === 'rect') {
      const w = v('width', 100);
      const h = v('height', 100);
      // To draw a centered rect in SVG (where x,y is Top-Left), we draw at -w/2, -h/2
      elements += `<rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}" transform="${transform}" />\n`;
    } 
    else if (node.type === 'circle') {
      const r = v('radius', 50);
      // Circle cx,cy is the center. Since we translated to center, these are 0,0.
      elements += `<circle cx="0" cy="0" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}" transform="${transform}" />\n`;
    } 
    else if (node.type === 'vector') {
        const path = v('path', '');
        elements += `<path d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}" transform="${transform}" />\n`;
    }
  });

  // 3. Construct Defs String
  let defsString = '';
  if (gradients.length > 0) {
      defsString += '<defs>\n';
      gradients.forEach(g => {
          const attrs = Object.entries(g.attrs).map(([k,v]) => `${k}="${v}"`).join(' ');
          defsString += `<${g.type} id="${g.id}" ${attrs}>\n`;
          g.stops.forEach(s => {
              defsString += `  <stop offset="${s.offset}" stop-color="${s.color}" />\n`;
          });
          defsString += `</${g.type}>\n`;
      });
      defsString += '</defs>\n';
  }

  // 4. Construct Final SVG
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background-color: transparent;" xmlns="http://www.w3.org/2000/svg">
    ${defsString}
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
  img.crossOrigin = "anonymous";
  
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = project.meta.width;
    canvas.height = project.meta.height;
    
    const ctx = canvas.getContext('2d', { alpha: true });
    
    if (ctx) {
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