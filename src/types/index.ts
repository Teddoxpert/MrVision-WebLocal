export interface OcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

export interface OcrPageResult {
  pageNum: number;
  text: string;
  words: OcrWord[];
  confidence: number;
  imageWidth: number;
  imageHeight: number;
}

export type OcrEngine = 'auto' | 'cpu' | 'gpu' | 'npu';

export interface PipelineOptions {
  language: string;
  dpi: number;
  downsample: boolean;
  engine: OcrEngine;
}

export type PageStatus = 'pending' | 'rendering' | 'ocr' | 'done' | 'error';

export interface ProgressCallback {
  onLog: (message: string) => void;
  onStep: (step: string) => void;
  onProgress: (completed: number, total: number) => void;
  onPageStatus: (pageNum: number, status: PageStatus) => void;
}
