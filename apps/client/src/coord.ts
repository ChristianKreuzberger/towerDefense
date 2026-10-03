// Cursor coordinates live in plain number inputs, so the raw text can be empty, fractional or garbage.
export function coordValue(field: { value: string }): number {
  const parsed = Number(field.value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

export function clampCoord(value: number, max: number): number {
  if (max <= 0 || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(max - 1, value));
}
