import { dom } from './dom.js';
import type { PipelineOptions, OcrEngine } from '../types/index.js';
import { detectHardware, hardwareSummary } from '../core/hardware.js';

export function getOptions(): PipelineOptions {
  return {
    language: dom.langSelect().value,
    dpi: parseInt(dom.dpiSelect().value, 10),
    downsample: dom.downsampleCheck().checked,
    engine: dom.engineSelect().value as OcrEngine,
    preprocess: dom.preprocessCheck().checked,
  };
}

export function showPdfOptions(show: boolean): void {
  dom.dpiOption().style.display = show ? '' : 'none';
  dom.downsampleOption().style.display = show ? '' : 'none';
}

export async function initHardwareStatus(): Promise<void> {
  const hw = await detectHardware();
  const el = dom.hwStatus();
  el.textContent = hardwareSummary(hw);

  // Disable unavailable engine options
  const select = dom.engineSelect();
  for (const option of Array.from(select.options)) {
    if (option.value === 'gpu' && !hw.webgpu && !hw.webnnGpu) {
      option.disabled = true;
      option.textContent += ' (not available)';
    }
    if (option.value === 'npu' && !hw.webnnNpu && !hw.webnn) {
      option.disabled = true;
      option.textContent += ' (not available)';
    }
  }
}
