export type HapticKind = "tap" | "success" | "error";

const patterns: Record<HapticKind, number | number[]> = {
  tap: 12,
  success: [18, 20, 30],
  error: [30, 30, 40]
};

export function haptic(kind: HapticKind) {
  if (typeof navigator === "undefined" || !navigator.vibrate) {
    return;
  }
  navigator.vibrate(patterns[kind]);
}
