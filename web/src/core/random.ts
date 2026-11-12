/** Five isolated seeded streams. This is a new TS generator; exact CPython parity
 * is not claimed until fixture-by-fixture parity tests have been added. */
export type RandomStream = () => number;
function splitmix32(seed: number): RandomStream {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    z ^= z >>> 16;
    return (z >>> 0) / 0x100000000;
  };
}
export function createRandomStreams(seed: number) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("Seed must be an unsigned 32-bit integer");
  const masks = [0x13579bdf, 0x2468ace0, 0x5a5a5a5a, 0x6c8e9cf5, 0x7f4a7c15] as const;
  const [inflation, market, debt, unemployment, medical] = masks.map(mask => splitmix32((seed ^ mask) >>> 0));
  const gaussian = (rng: RandomStream) => {
    const u = Math.max(Number.EPSILON, rng()), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { inflation, market, debt, unemployment, medical, gaussian };
}
