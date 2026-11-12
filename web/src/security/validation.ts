/** Shared boundary validation for browser-only financial calculations. */
export class InputError extends Error {
  constructor(message: string) { super(message); this.name = "InputError"; }
}
export function finiteNumber(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new InputError(`${name} must be a finite number between ${min} and ${max}`);
  }
  return value;
}
export function integer(value: unknown, name: string, min: number, max: number): number {
  const n = finiteNumber(value, name, min, max);
  if (!Number.isInteger(n)) throw new InputError(`${name} must be a whole number`);
  return n;
}
export function boundedText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new InputError(`${name} must contain 1–${maxLength} characters`);
  }
  return value.trim();
}
