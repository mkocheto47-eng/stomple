/**
 * Один AudioContext на всё приложение (звуки, музыка, индикация речи).
 * У iOS Safari жёсткий лимит на число контекстов — лишние молча глушатся.
 */
let ctx: AudioContext | null = null;
export function getAudioCtx(): AudioContext | null {
  if (!ctx) { try { ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch { return null; } }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
