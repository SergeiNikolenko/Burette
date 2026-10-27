export const BROWSER_TRR_LIMITS: Readonly<{ bytes: number; frames: number; frameBytes: number; decodedBytes: number }>;
export function indexTrrFrames(bytes: Uint8Array): { atomCount: number; frames: Array<{ offset: number; length: number; timePs: number }> };
