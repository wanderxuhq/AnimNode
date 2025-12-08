import { ProjectState } from '../types';

// --- WebGPU Type Shims ---
declare global {
  interface Navigator {
    gpu: any;
  }
  // Define missing interfaces as any to prevent TS errors
  type GPUDevice = any;
  type GPURenderPipeline = any;
  type GPUBuffer = any;
  type GPUCanvasContext = any;
  type GPURenderPassDescriptor = any;
  type GPUCanvasConfiguration = any;
  type GPUTextureFormat = any;
  type GPUAdapter = any;
  type GPUQueue = any;
  type GPUCommandEncoder = any;
  type GPUBindGroup = any;
  type GPUPipelineLayout = any;
  type GPUShaderModule = any;
  type GPUBindGroupLayout = any;
}

// --- SAFE CONSTANTS ---
// We hardcode these to avoid "GPUBufferUsage is not defined" runtime errors
const USAGE = {
  COPY_DST: 8,
  VERTEX: 32,
  UNIFORM: 64,
};

// --- SHADERS (WGSL) ---
const SHADER_CODE = `
struct Uniforms {
  resolution : vec2<f32>,
}
@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct VertexInput {
  @location(0) position : vec2<f32>,       // 0..1 Quad
  @location(1) instancePos : vec2<f32>,    
  @location(2) instanceSize : vec2<f32>,   
  @location(3) instanceRot : f32,          
  @location(4) instanceColor : vec4<f32>,  
  @location(5) instanceType : f32,         
}

struct VertexOutput {
  @builtin(position) Position : vec4<f32>,
  @location(0) uv : vec2<f32>,
  @location(1) color : vec4<f32>,
  @location(2) shapeType : f32,  // Renamed from 'type' to avoid keyword conflict
}

@vertex
fn vs_main(input : VertexInput) -> VertexOutput {
  let rad = input.instanceRot * 3.14159 / 180.0;
  let c = cos(rad);
  let s = sin(rad);
  let rotMat = mat2x2<f32>(c, s, -s, c); // Standard rotation

  // Vertices are 0..1
  // We want to transform them such that 0,0 is the anchor (Top Left)
  // Since scaling and rotation happen around the anchor 0,0 in local space,
  // we do NOT subtract 0.5.
  
  // Scale -> Rotate -> Translate
  // posWorld is in "Canvas Pixels"
  // input.position is 0..1, instanceSize scales it to w,h
  // This effectively means the vertex (0,0) stays at 0,0 local, which becomes instancePos world.
  let posWorld = (rotMat * (input.position * input.instanceSize)) + input.instancePos;
  
  // Project to Clip Space
  // Canvas Coords: (0,0) Top-Left, (W,H) Bottom-Right
  // WebGPU Clip Space: (-1,1) Top-Left, (1,-1) Bottom-Right (Standard normalized Y-up)
  
  // Map X [0..W] -> [-1..1]
  let clipX = (posWorld.x / uniforms.resolution.x) * 2.0 - 1.0;
  
  // Map Y [0..H] -> [1..-1] (Inverted)
  let clipY = 1.0 - (posWorld.y / uniforms.resolution.y) * 2.0;

  var output : VertexOutput;
  output.Position = vec4<f32>(clipX, clipY, 0.0, 1.0);
  output.uv = input.position;
  output.color = input.instanceColor;
  output.shapeType = input.instanceType;
  return output;
}

@fragment
fn fs_main(input : VertexOutput) -> @location(0) vec4<f32> {
  // Type 0: Rect
  // Type 1: Circle
  
  if (input.shapeType > 0.5) {
    // Circle Logic
    // UVs are 0..1, Center is 0.5, 0.5
    let dist = distance(input.uv, vec2<f32>(0.5, 0.5));
    if (dist > 0.5) {
      discard;
    }
    // Anti-aliasing
    let alpha = 1.0 - smoothstep(0.48, 0.5, dist);
    return vec4<f32>(input.color.rgb, input.color.a * alpha);
  }
  
  return input.color;
}
`;

export class WebGPURenderer {
  device: GPUDevice | null = null;
  pipeline: GPURenderPipeline | null = null;
  uniformBuffer: GPUBuffer | null = null;
  instanceBuffer: GPUBuffer | null = null;
  vertexBuffer: GPUBuffer | null = null;
  
  // State tracking
  instanceCount = 0;
  maxInstances = 2000;
  instanceStride = 10 * 4; // 10 floats (40 bytes)
  
  // Resize tracking
  currentWidth = 0;
  currentHeight = 0;

  async init(canvas: HTMLCanvasElement) {
    if (!(navigator as any).gpu) {
      console.error("WebGPU not supported.");
      return false;
    }

    try {
        const adapter = await (navigator as any).gpu.requestAdapter();
        if (!adapter) {
          console.error("No WebGPU adapter found.");
          return false;
        }

        this.device = await adapter.requestDevice();
        if (!this.device) return false;

        // --- PIPELINE SETUP ---
        const module = this.device.createShaderModule({
          label: 'Main Shader',
          code: SHADER_CODE,
        });

        // 1. Static Quad Vertices (0..1)
        // Order: TL, BL, TR, BR (Strip)
        const vertexData = new Float32Array([
          0, 1, // BL (Actually, Y=1 is down in Canvas but usually up in UVs... let's stick to standard strip logic)
                // Wait, Y-down canvas means 0 is top, 1 is bottom.
                // Vertex Shader assumes 0,0 input maps to top-left.
                // Let's use 0..1 for standard Y-down mapping logic in Vertex Shader.
          0, 1, // BL (x=0, y=1) -> Bottom Left
          0, 0, // TL (x=0, y=0) -> Top Left
          1, 1, // BR (x=1, y=1) -> Bottom Right
          1, 0, // TR (x=1, y=0) -> Top Right
        ]);
        // Revised Vertex Data for Triangle Strip to make a Quad 0,0 to 1,1
        // P0 (0,0), P1 (0,1), P2 (1,0), P3 (1,1) -> Z pattern strip
        const simpleVertexData = new Float32Array([
            0, 0, // Top-Left
            0, 1, // Bottom-Left
            1, 0, // Top-Right
            1, 1  // Bottom-Right
        ]);

        this.vertexBuffer = this.device.createBuffer({
          size: simpleVertexData.byteLength,
          usage: USAGE.VERTEX | USAGE.COPY_DST,
          mappedAtCreation: true,
        });
        new Float32Array(this.vertexBuffer.getMappedRange()).set(simpleVertexData);
        this.vertexBuffer.unmap();

        // 2. Instance Buffer
        this.instanceBuffer = this.device.createBuffer({
          size: this.maxInstances * this.instanceStride,
          usage: USAGE.VERTEX | USAGE.COPY_DST,
        });

        // 3. Uniform Buffer (Resolution)
        // ALIGNMENT NOTE: Uniform bindings usually require 16-byte alignment.
        // vec2<f32> is 8 bytes, but we allocate 16 bytes to be safe.
        this.uniformBuffer = this.device.createBuffer({
          size: 16, 
          usage: USAGE.UNIFORM | USAGE.COPY_DST,
        });

        const pipelineLayout = this.device.createPipelineLayout({
          bindGroupLayouts: [
            this.device.createBindGroupLayout({
              entries: [{
                binding: 0,
                visibility: 1, // VERTEX stage (1)
                buffer: { type: 'uniform' }
              }]
            })
          ]
        });

        const presentationFormat = (navigator as any).gpu.getPreferredCanvasFormat();

        this.pipeline = this.device.createRenderPipeline({
          label: 'Shape Pipeline',
          layout: pipelineLayout,
          vertex: {
            module,
            entryPoint: 'vs_main',
            buffers: [
              // 0: Quad
              {
                arrayStride: 2 * 4,
                attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }]
              },
              // 1: Instances
              {
                arrayStride: this.instanceStride,
                stepMode: 'instance',
                attributes: [
                  { shaderLocation: 1, offset: 0, format: 'float32x2' }, // Pos
                  { shaderLocation: 2, offset: 8, format: 'float32x2' }, // Size
                  { shaderLocation: 3, offset: 16, format: 'float32' },  // Rot
                  { shaderLocation: 4, offset: 20, format: 'float32x4' },// Color
                  { shaderLocation: 5, offset: 36, format: 'float32' },  // Type
                ]
              }
            ]
          },
          fragment: {
            module,
            entryPoint: 'fs_main',
            targets: [{
                format: presentationFormat,
                blend: {
                  color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                }
            }],
          },
          primitive: {
            topology: 'triangle-strip',
          },
        });

        // Initial config
        this.configureContext(canvas, presentationFormat);

        return true;
    } catch (e) {
        console.error("WebGPU Init Error:", e);
        return false;
    }
  }

  configureContext(canvas: HTMLCanvasElement, format: GPUTextureFormat) {
      const context = canvas.getContext('webgpu') as any;
      if (context) {
          context.configure({
            device: this.device,
            format: format,
            alphaMode: 'premultiplied',
          });
          this.currentWidth = canvas.width;
          this.currentHeight = canvas.height;
      }
  }

  render(instanceData: Float32Array, count: number, width: number, height: number, canvas: HTMLCanvasElement) {
    if (!this.device || !this.pipeline || !this.uniformBuffer || !this.instanceBuffer) return;

    // Auto-resize / Re-configure check
    if (canvas.width !== this.currentWidth || canvas.height !== this.currentHeight) {
        const format = (navigator as any).gpu.getPreferredCanvasFormat();
        this.configureContext(canvas, format);
    }

    const context = canvas.getContext('webgpu') as any;
    if (!context) return;

    // 1. Update Uniforms (Resolution)
    // Pad to 4 floats (16 bytes) for alignment safety
    this.device.queue.writeBuffer(this.uniformBuffer, 0, new Float32Array([width, height, 0, 0]));

    // 2. Update Instances
    if (count > 0) {
        this.device.queue.writeBuffer(
            this.instanceBuffer, 
            0, 
            instanceData.buffer, 
            instanceData.byteOffset, 
            count * this.instanceStride
        );
    }

    // 3. Render Pass
    const commandEncoder = this.device.createCommandEncoder();
    const textureView = context.getCurrentTexture().createView();

    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0.09, g: 0.09, b: 0.1, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    passEncoder.setPipeline(this.pipeline);
    
    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }]
    });

    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.setVertexBuffer(0, this.vertexBuffer);
    passEncoder.setVertexBuffer(1, this.instanceBuffer);
    
    passEncoder.draw(4, count);
    passEncoder.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }
}

export const webgpuRenderer = new WebGPURenderer();