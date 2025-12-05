



export interface PathPoint {
  x: number;
  y: number;
  // Control point 1 (incoming handle), relative to x,y
  inX: number; 
  inY: number;
  // Control point 2 (outgoing handle), relative to x,y
  outX: number;
  outY: number;
  cmd: 'M' | 'L' | 'C' | 'Z';
}

/**
 * Converts internal Point structure to SVG Path String
 */
export function pointsToSvgPath(points: PathPoint[], closed: boolean): string {
  if (points.length === 0) return '';
  
  let d = `M ${points[0].x} ${points[0].y}`;
  
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const prev = points[i-1];
    
    // If current is Curve or previous had an outgoing handle, use Cubic Bezier
    if (p.cmd === 'C' || (prev.outX !== 0 || prev.outY !== 0)) {
        // Logic: 
        // Start Handle = Prev Point + Prev Out Handle
        // End Handle = Curr Point + Curr In Handle
        const cp1x = prev.x + prev.outX;
        const cp1y = prev.y + prev.outY;
        const cp2x = p.x + p.inX;
        const cp2y = p.y + p.inY;
        
        d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p.x} ${p.y}`;
    } else {
        d += ` L ${p.x} ${p.y}`;
    }
  }

  if (closed) d += ' Z';
  return d;
}

/**
 * Parses a subset of SVG Path D strings back to Points.
 * NOTE: This is a simplified parser for M, L, C, Z commands.
 * It assumes absolute coordinates (uppercase commands).
 */
export function svgPathToPoints(d: string): { points: PathPoint[], closed: boolean } {
  const points: PathPoint[] = [];
  
  // Guard against empty path
  if (!d || !d.trim()) {
      return { points: [], closed: false };
  }
  
  // Re-implementation with simpler regex approach
  // Explicitly type commands as string[] to avoid 'never' inference from TS when using || []
  const commands: string[] = d.match(/[a-df-z][^a-df-z]*/ig) || [];
  
  let closed = false;
  
  commands.forEach(cmdStr => {
      const type = cmdStr[0].toUpperCase();
      const args = cmdStr.slice(1).trim().split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));
      
      if (type === 'M' || type === 'L') {
          const x = args[0] || 0;
          const y = args[1] || 0;
          points.push({ x, y, inX: 0, inY: 0, outX: 0, outY: 0, cmd: 'L' }); // Force M to act like a point, we handle M vs L in reconstruction
      } else if (type === 'C') {
          // C cp1x cp1y cp2x cp2y x y
          const cp1x = args[0];
          const cp1y = args[1];
          const cp2x = args[2];
          const cp2y = args[3];
          const x = args[4];
          const y = args[5];
          
          // Update previous point's OUT handle based on cp1
          if (points.length > 0) {
              const prev = points[points.length - 1];
              prev.outX = cp1x - prev.x;
              prev.outY = cp1y - prev.y;
          }
          
          // Add current point with IN handle
          points.push({
              x, y,
              inX: cp2x - x,
              inY: cp2y - y,
              outX: 0, outY: 0,
              cmd: 'C'
          });
      } else if (type === 'Z') {
          closed = true;
      }
  });
  
  // Fix first point command
  if (points.length > 0) points[0].cmd = 'M';

  return { points, closed };
}