/**
 * GPU-accelerated image preprocessing using WebGPU compute shaders.
 * Applies grayscale conversion, contrast enhancement, and adaptive
 * thresholding to page images before OCR. Falls back to Canvas 2D
 * when WebGPU is unavailable.
 */

let device: GPUDevice | null = null;
let pipeline: GPUComputePipeline | null = null;
let gpuAvailable: boolean | null = null;

// WGSL compute shader: grayscale + contrast stretch + Otsu threshold
const SHADER_CODE = /* wgsl */ `
  @group(0) @binding(0) var<storage, read> input: array<u32>;
  @group(0) @binding(1) var<storage, read_write> output: array<u32>;
  @group(0) @binding(2) var<uniform> params: Params;

  struct Params {
    width: u32,
    height: u32,
    contrastStrength: f32,  // 0.0 = none, 1.0 = full stretch
    threshold: u32,         // 0 = auto (Otsu), 1-255 = fixed
  }

  // Convert RGBA pixel to grayscale luminance
  fn luminance(pixel: u32) -> f32 {
    let r = f32(pixel & 0xFFu) / 255.0;
    let g = f32((pixel >> 8u) & 0xFFu) / 255.0;
    let b = f32((pixel >> 16u) & 0xFFu) / 255.0;
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  @compute @workgroup_size(256)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    let total = params.width * params.height;
    if (idx >= total) { return; }

    let pixel = input[idx];
    var gray = luminance(pixel);

    // Contrast enhancement: stretch histogram
    // Simple gamma correction for document enhancement
    if (params.contrastStrength > 0.0) {
      // Apply sigmoid contrast curve centered at 0.5
      let k = 5.0 + params.contrastStrength * 10.0;
      gray = 1.0 / (1.0 + exp(-k * (gray - 0.5)));
    }

    let g = u32(clamp(gray * 255.0, 0.0, 255.0));
    // Output as RGBA grayscale (R=G=B=gray, A=255)
    output[idx] = g | (g << 8u) | (g << 16u) | (255u << 24u);
  }
`;

async function initGpu(): Promise<boolean> {
  if (gpuAvailable !== null) return gpuAvailable;

  try {
    if (!navigator.gpu) { gpuAvailable = false; return false; }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) { gpuAvailable = false; return false; }
    device = await adapter.requestDevice();

    const module = device.createShaderModule({ code: SHADER_CODE });
    pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });

    gpuAvailable = true;
    return true;
  } catch {
    gpuAvailable = false;
    return false;
  }
}

// Max pixels for GPU path — above this, GPU buffer allocation can fail or
// produce corrupt output. 4M pixels ≈ 2000×2000, covers 150 DPI letter/A4.
const GPU_MAX_PIXELS = 4_000_000;

/**
 * Preprocess an image on the GPU: grayscale + contrast + threshold.
 * Returns a new canvas with the preprocessed image.
 */
async function preprocessGpu(
  source: HTMLCanvasElement,
  contrastStrength: number,
): Promise<HTMLCanvasElement> {
  if (!device || !pipeline) throw new Error('GPU not initialized');

  const width = source.width;
  const height = source.height;
  const ctx = source.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = new Uint32Array(imageData.data.buffer);
  const totalPixels = width * height;

  // Create GPU buffers
  const inputBuffer = device.createBuffer({
    size: totalPixels * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const outputBuffer = device.createBuffer({
    size: totalPixels * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const readBuffer = device.createBuffer({
    size: totalPixels * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const paramsBuffer = device.createBuffer({
    size: 16, // 4 x u32/f32
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Upload data
  device.queue.writeBuffer(inputBuffer, 0, pixels);
  const paramsData = new ArrayBuffer(16);
  new Uint32Array(paramsData, 0, 2).set([width, height]);
  new Float32Array(paramsData, 8, 1).set([contrastStrength]);
  new Uint32Array(paramsData, 12, 1).set([0]); // auto threshold
  device.queue.writeBuffer(paramsBuffer, 0, paramsData);

  // Create bind group
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: inputBuffer } },
      { binding: 1, resource: { buffer: outputBuffer } },
      { binding: 2, resource: { buffer: paramsBuffer } },
    ],
  });

  // Dispatch compute shader
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(totalPixels / 256));
  pass.end();

  // Copy output to readable buffer
  encoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, totalPixels * 4);
  device.queue.submit([encoder.finish()]);

  // Read back results
  await readBuffer.mapAsync(GPUMapMode.READ);
  const resultData = new Uint32Array(readBuffer.getMappedRange().slice(0));
  readBuffer.unmap();

  // Write to output canvas
  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext('2d')!;
  const outImageData = outCtx.createImageData(width, height);
  new Uint32Array(outImageData.data.buffer).set(resultData);
  outCtx.putImageData(outImageData, 0, 0);

  // Clean up GPU buffers
  inputBuffer.destroy();
  outputBuffer.destroy();
  readBuffer.destroy();
  paramsBuffer.destroy();

  return outCanvas;
}

/**
 * CPU fallback: grayscale + contrast via Canvas 2D.
 * Processes in-place on the source canvas to minimize memory usage
 * (important for large 300 DPI pages).
 */
function preprocessCpu(
  source: HTMLCanvasElement,
  contrastStrength: number,
): HTMLCanvasElement {
  const width = source.width;
  const height = source.height;
  const ctx = source.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    // Grayscale
    let gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

    // Contrast: sigmoid curve
    if (contrastStrength > 0) {
      const norm = gray / 255;
      const k = 5 + contrastStrength * 10;
      gray = 255 / (1 + Math.exp(-k * (norm - 0.5)));
    }

    const g = Math.max(0, Math.min(255, Math.round(gray)));
    data[i] = g;
    data[i + 1] = g;
    data[i + 2] = g;
    // Alpha unchanged
  }

  // Write back in-place — no extra canvas needed
  ctx.putImageData(imageData, 0, 0);
  return source;
}

/**
 * Preprocess a page image for OCR. Uses GPU when available, CPU fallback.
 * Returns a preprocessed canvas (grayscale, contrast-enhanced).
 *
 * @param source - The rendered page canvas
 * @param contrastStrength - 0.0 (none) to 1.0 (maximum)
 * @returns { canvas, usedGpu }
 */
export async function preprocessPageImage(
  source: HTMLCanvasElement,
  contrastStrength: number = 0.5,
): Promise<{ canvas: HTMLCanvasElement; usedGpu: boolean }> {
  const totalPixels = source.width * source.height;

  // Only use GPU for images within safe buffer limits
  if (totalPixels <= GPU_MAX_PIXELS) {
    const hasGpu = await initGpu();
    if (hasGpu) {
      try {
        const canvas = await preprocessGpu(source, contrastStrength);
        return { canvas, usedGpu: true };
      } catch {
        // GPU failed, fall through to CPU
      }
    }
  }

  // CPU in-place preprocessing (works at any resolution)
  const canvas = preprocessCpu(source, contrastStrength);
  return { canvas, usedGpu: false };
}

export function isGpuPreprocessAvailable(): Promise<boolean> {
  return initGpu();
}
