export function estimateTime(pages: number, cores: number): number {
  const secsPerPage = 2.5;
  return Math.max(5, Math.ceil((pages * secsPerPage) / cores));
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}
