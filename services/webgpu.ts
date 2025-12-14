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
  // Instance Attributes (Buffer 0)
  @location(0) instancePosSize : vec4<f32>, // x, y, w, h
  @location(1) instanceColor : vec4<f32>,   // r, g, b, a
  @location(2) instanceParams : vec4<f32>,  // rot, type, pad, pad
}

struct VertexOutput {
  @builtin(position) Position : vec4<f32>,
  @location(0) uv : vec2<f32>,
  @location(1) color : vec4<f32>,
  @location(2) shapeType : f32,
}

@vertex
fn vs_main(
  @builtin(vertex_index) vIdx : u32,
  input : VertexInput
) -> VertexOutput {
  // Standard Quad UVs (Triangle List)
  // 0: TL, 1: BL, 2: TR
  // 3: TR, 4: BL, 5: BR
  var uvs = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), // TL
    vec2<f32>(0.0, 1.0), // BL
    vec2<f32>(1.0, 0.0), // TR
    vec2<f32>(1.0, 0.0), // TR
    vec2<f32>(0.0, 1.0), // BL
    vec2<f32>(1.0, 1.0)  // BR
  );
  let uv = uvs[vIdx];

  // Unpack Input
  let centerPos = input.instancePosSize.xy;   // CENTER World Position
  let size = input.instancePosSize.zw;        // Width, Height
  let rotDeg = input.instanceParams.x;
  
  // 1. Calculate Local Position relative to Center
  // UV is 0..1
  // We want local space to be -0.5..0.5
  // So a 100px wide box goes from -50 to 50
  let centeredUV = uv - vec2<f32>(0.5, 0.5);
  let localPos = centeredUV * size;
  
  // 2. Rotate Local Position around (0,0) [The Center]
  let rad = radians(rotDeg);
  let c = cos(rad);
  let s = sin(rad);
  
  // Standard 2D Rotation Matrix
  // x' = x*cos - y*sin
  // y' = x*sin + y*cos
  let rotatedLocal = vec2<f32>(
    localPos.x * c - localPos.y * s,
    localPos.x * s + localPos.y * c
  );

  // 3. Translate to World Position
  let worldPos = centerPos + rotatedLocal;
  
  // 4. Project to Clip Space
  // Screen X: 0..W  => NDC X: -1..1
  // Screen Y: 0..H  => NDC Y:  1..-1 (Y-Up in WebGPU Clip Space)
  
  let clipX = (worldPos.x / uniforms.resolution.x) * 2.0 - 1.0;
  let clipY = 1.0 - (worldPos.y / uniforms.resolution.y) * 2.0;

  var output : VertexOutput;
  output.Position = vec4<f32>(clipX, clipY, 0.0, 1.0);
  output.uv = uv;
  output.color = input.instanceColor;
  output.shapeType = input.instanceParams.y;
  return output;
}

@fragment
fn fs_main(input : VertexOutput) -> @location(0) vec4<f32> {
  var finalColor = input.color;

  // Circle Logic (Type 1)
  if (input.shapeType > 0.5) {
    // UV is 0..1, Center is 0.5, 0.5
    let dist = distance(input.uv, vec2<f32>(0.5, 0.5));
    if (dist > 0.5) {
      discard;
    }
    // Simple AA
    let alpha = 1.0 - smoothstep(0.48, 0.5, dist);
    finalColor.a = finalColor.a * alpha;
  }
  
  // Premultiply Alpha for correct blending
  return vec4<f32>(finalColor.rgb * finalColor.a, finalColor.a);
}
`;

export class WebGPURenderer {
  device: GPUDevice | null = null;
  pipeline: GPURenderPipeline | null = null;
  uniformBuffer: GPUBuffer | null = null;
  instanceBuffer: GPUBuffer | null = null;
  
  // State
  instanceCount = 0;
  maxInstances = 2000;
  instanceStride = 16 * 4; // 64 bytes
  
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

        const module = this.device.createShaderModule({
          label: 'Shape Shader vCenter',
          code: SHADER_CODE,
        });

        this.instanceBuffer = this.device.createBuffer({
          size: this.maxInstances * this.instanceStride,
          usage: USAGE.VERTEX | USAGE.COPY_DST,
        });

        this.uniformBuffer = this.device.createBuffer({
          size: 16, 
          usage: USAGE.UNIFORM | USAGE.COPY_DST,
        });

        const pipelineLayout = this.device.createPipelineLayout({
          bindGroupLayouts: [
            this.device.createBindGroupLayout({
              entries: [{
                binding: 0,
                visibility: 1, // VERTEX
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
              {
                arrayStride: this.instanceStride,
                stepMode: 'instance',
                attributes: [
                  { shaderLocation: 0, offset: 0, format: 'float32x4' },  // Pos + Size
                  { shaderLocation: 1, offset: 16, format: 'float32x4' }, // Color
                  { shaderLocation: 2, offset: 32, format: 'float32x4' }, // Params
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
                  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                }
            }],
          },
          primitive: {
            topology: 'triangle-list', 
            cullMode: 'none',
          },
        });

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

    if (canvas.width !== this.currentWidth || canvas.height !== this.currentHeight) {
        const format = (navigator as any).gpu.getPreferredCanvasFormat();
        this.configureContext(canvas, format);
    }

    const context = canvas.getContext('webgpu') as any;
    if (!context) return;

    // Update Uniforms
    this.device.queue.writeBuffer(this.uniformBuffer, 0, new Float32Array([width, height, 0, 0]));

    // Update Instances
    if (count > 0) {
        this.device.queue.writeBuffer(
            this.instanceBuffer, 
            0, 
            instanceData.buffer, 
            instanceData.byteOffset, 
            count * this.instanceStride
        );
    }

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
    passEncoder.setVertexBuffer(0, this.instanceBuffer);
    passEncoder.draw(6, count);
    passEncoder.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }
}

export const webgpuRenderer = new WebGPURenderer();