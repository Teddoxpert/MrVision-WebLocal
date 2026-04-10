import type { OcrEngine } from '../types/index.js';
export type { OcrEngine };

export interface HardwareCapabilities {
  webgpu: boolean;
  webgpuAdapter: string;
  webnn: boolean;
  webnnNpu: boolean;
  webnnGpu: boolean;
  cores: number;
  deviceMemory: number | null;
}

let cached: HardwareCapabilities | null = null;

export async function detectHardware(): Promise<HardwareCapabilities> {
  if (cached) return cached;

  const cores = navigator.hardwareConcurrency || 4;
  const deviceMemory: number | null = (navigator as any).deviceMemory ?? null;

  // Probe WebGPU
  let webgpu = false;
  let webgpuAdapter = '';
  try {
    if ('gpu' in navigator) {
      const gpu = (navigator as any).gpu;
      // Try high-performance adapter first (discrete GPU), then default
      let adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
      if (!adapter) {
        adapter = await gpu.requestAdapter().catch(() => null);
      }
      if (adapter) {
        webgpu = true;
        // Get adapter info for display (Chrome/Edge expose this)
        try {
          const info = await adapter.requestAdapterInfo?.();
          if (info?.description) webgpuAdapter = info.description;
          else if (info?.vendor) webgpuAdapter = info.vendor;
        } catch { /* adapter info not available (Safari) */ }
      }
    }
  } catch {
    // Not available
  }

  // Probe WebNN
  let webnn = false;
  let webnnNpu = false;
  let webnnGpu = false;
  try {
    if ('ml' in navigator) {
      const ml = (navigator as any).ml;
      // Try NPU first
      try {
        const ctx = await ml.createContext({ deviceType: 'npu' });
        if (ctx) { webnn = true; webnnNpu = true; }
      } catch { /* NPU not available */ }
      // Try GPU
      try {
        const ctx = await ml.createContext({ deviceType: 'gpu' });
        if (ctx) { webnn = true; webnnGpu = true; }
      } catch { /* GPU via WebNN not available */ }
      // Try default
      if (!webnn) {
        try {
          const ctx = await ml.createContext();
          if (ctx) webnn = true;
        } catch { /* WebNN not available */ }
      }
    }
  } catch {
    // Not available
  }

  cached = { webgpu, webgpuAdapter, webnn, webnnNpu, webnnGpu, cores, deviceMemory };
  return cached;
}

export function resolveDevice(engine: OcrEngine, hw: HardwareCapabilities): string {
  switch (engine) {
    case 'npu':
      if (hw.webnnNpu) return 'webnn-npu';
      if (hw.webnn) return 'webnn';
      return 'wasm';
    case 'gpu':
      if (hw.webgpu) return 'webgpu';
      if (hw.webnnGpu) return 'webnn-gpu';
      return 'wasm';
    case 'auto':
      // Prefer GPU (widely available on Safari/Chrome) over NPU
      if (hw.webgpu) return 'webgpu';
      if (hw.webnnNpu) return 'webnn-npu';
      if (hw.webnn) return 'webnn';
      return 'wasm';
    case 'cpu':
    default:
      return 'wasm';
  }
}

export function describeDevice(device: string): string {
  switch (device) {
    case 'webnn-npu': return 'NPU (WebNN)';
    case 'webnn-gpu': return 'GPU (WebNN)';
    case 'webnn': return 'Neural Engine (WebNN)';
    case 'webgpu': return 'GPU (WebGPU)';
    case 'wasm': return 'CPU (WebAssembly)';
    default: return device;
  }
}

export function hardwareSummary(hw: HardwareCapabilities): string {
  const parts = [`${hw.cores} CPU cores`];
  if (hw.deviceMemory != null) {
    parts.push(`${hw.deviceMemory}GB RAM`);
  }
  if (hw.webgpu) {
    parts.push(hw.webgpuAdapter ? `WebGPU (${hw.webgpuAdapter})` : 'WebGPU');
  }
  if (hw.webnnNpu) parts.push('WebNN NPU');
  else if (hw.webnnGpu) parts.push('WebNN GPU');
  else if (hw.webnn) parts.push('WebNN');
  if (!hw.webgpu && !hw.webnn) parts.push('no GPU/NPU detected');
  return parts.join(' | ');
}
