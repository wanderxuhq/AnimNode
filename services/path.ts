
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
 * A helper class to construct SVG paths using a Canvas-like API.
 * This abstracts away the string manipulation.
 */
export class PathBuilder {
    private _d: string = "";

    constructor(initialD?: string) {
        if (initialD) this._d = initialD;
    }

    /** Move pen to (x, y) without drawing */
    moveTo(x: number, y: number) {
        this._d += `M ${this.fmt(x)} ${this.fmt(y)} `;
        return this;
    }

    /** Draw line to (x, y) */
    lineTo(x: number, y: number) {
        this._d += `L ${this.fmt(x)} ${this.fmt(y)} `;
        return this;
    }

    /** Cubic Bezier Curve (c1x, c1y, c2x, c2y, x, y) */
    bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number) {
        this._d += `C ${this.fmt(cp1x)} ${this.fmt(cp1y)}, ${this.fmt(cp2x)} ${this.fmt(cp2y)}, ${this.fmt(x)} ${this.fmt(y)} `;
        return this;
    }

    /** Quadratic Bezier Curve (cx, cy, x, y) */
    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number) {
        this._d += `Q ${this.fmt(cpx)} ${this.fmt(cpy)}, ${this.fmt(x)} ${this.fmt(y)} `;
        return this;
    }

    /** Close the current sub-path */
    close() {
        this._d += `Z `;
        return this;
    }

    // --- High Level Shapes ---

    /** Draw a rectangle */
    rect(x: number, y: number, w: number, h: number) {
        this.moveTo(x, y);
        this.lineTo(x + w, y);
        this.lineTo(x + w, y + h);
        this.lineTo(x, y + h);
        this.close();
        return this;
    }

    /** Draw a circle */
    circle(cx: number, cy: number, r: number) {
        // Two arcs to make a circle
        this.moveTo(cx - r, cy);
        this._d += `A ${this.fmt(r)} ${this.fmt(r)} 0 1 1 ${this.fmt(cx + r)} ${this.fmt(cy)} `;
        this._d += `A ${this.fmt(r)} ${this.fmt(r)} 0 1 1 ${this.fmt(cx - r)} ${this.fmt(cy)} `;
        return this;
    }

    /** Draw an ellipse */
    ellipse(cx: number, cy: number, rx: number, ry: number) {
        this.moveTo(cx - rx, cy);
        this._d += `A ${this.fmt(rx)} ${this.fmt(ry)} 0 1 1 ${this.fmt(cx + rx)} ${this.fmt(cy)} `;
        this._d += `A ${this.fmt(rx)} ${this.fmt(ry)} 0 1 1 ${this.fmt(cx - rx)} ${this.fmt(cy)} `;
        return this;
    }

    /** Clear the path */
    clear() {
        this._d = "";
        return this;
    }

    /** Returns the SVG path string */
    toString() {
        return this._d.trim();
    }

    /** Helper to format numbers to avoid excessive decimals */
    private fmt(n: number): string {
        return Math.round(n * 100) / 100 + "";
    }
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
 * Supports M, L, C, Q, Z.
 * Converts Q (Quadratic) to C (Cubic) for internal consistency.
 */
export function svgPathToPoints(d: string): { points: PathPoint[], closed: boolean } {
  const points: PathPoint[] = [];
  
  // Guard against empty path
  if (!d || !d.trim()) {
      return { points: [], closed: false };
  }
  
  // Regex to tokenize commands
  const commands: string[] = d.match(/[a-df-z][^a-df-z]*/ig) || [];
  
  let closed = false;
  
  commands.forEach(cmdStr => {
      const type = cmdStr[0].toUpperCase();
      const args = cmdStr.slice(1).trim().split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));
      
      if (type === 'M') {
          const x = args[0] || 0;
          const y = args[1] || 0;
          points.push({ x, y, inX: 0, inY: 0, outX: 0, outY: 0, cmd: 'L' });
          // Handle subsequent implicit L commands if any
          for (let i = 2; i < args.length; i += 2) {
              points.push({ x: args[i], y: args[i+1], inX: 0, inY: 0, outX: 0, outY: 0, cmd: 'L' });
          }
      } else if (type === 'L') {
          for (let i = 0; i < args.length; i += 2) {
              points.push({ x: args[i], y: args[i+1], inX: 0, inY: 0, outX: 0, outY: 0, cmd: 'L' });
          }
      } else if (type === 'C') {
          // C cp1x cp1y cp2x cp2y x y
          for (let i = 0; i < args.length; i += 6) {
              const cp1x = args[i];
              const cp1y = args[i+1];
              const cp2x = args[i+2];
              const cp2y = args[i+3];
              const x = args[i+4];
              const y = args[i+5];
              
              if (points.length > 0) {
                  const prev = points[points.length - 1];
                  prev.outX = cp1x - prev.x;
                  prev.outY = cp1y - prev.y;
              }
              
              points.push({
                  x, y,
                  inX: cp2x - x,
                  inY: cp2y - y,
                  outX: 0, outY: 0,
                  cmd: 'C'
              });
          }
      } else if (type === 'Q') {
          // Q qx qy x y
          // Convert Quadratic to Cubic
          // CP1 = P0 + 2/3 * (Q - P0)
          // CP2 = P1 + 2/3 * (Q - P1)
          for (let i = 0; i < args.length; i += 4) {
              const qx = args[i];
              const qy = args[i+1];
              const x = args[i+2];
              const y = args[i+3];
              
              if (points.length > 0) {
                  const prev = points[points.length - 1];
                  
                  // Calculate CP1
                  const cp1x = prev.x + (2.0/3.0) * (qx - prev.x);
                  const cp1y = prev.y + (2.0/3.0) * (qy - prev.y);
                  
                  // Update Prev OUT
                  prev.outX = cp1x - prev.x;
                  prev.outY = cp1y - prev.y;
                  
                  // Calculate CP2
                  const cp2x = x + (2.0/3.0) * (qx - x);
                  const cp2y = y + (2.0/3.0) * (qy - y);
                  
                  points.push({
                      x, y,
                      inX: cp2x - x,
                      inY: cp2y - y,
                      outX: 0, outY: 0,
                      cmd: 'C'
                  });
              } else {
                   points.push({ x, y, inX: 0, inY: 0, outX: 0, outY: 0, cmd: 'M' });
              }
          }
      } else if (type === 'Z') {
          closed = true;
      }
  });
  
  if (points.length > 0) points[0].cmd = 'M';

  return { points, closed };
}
