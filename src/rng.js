export function hashSeed(seed) {
  const text = String(seed ?? Date.now());
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class SeededRandom {
  constructor(seed = Date.now()) {
    this.state = hashSeed(seed);
  }

  next() {
    this.state += 0x6d2b79f5;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(max) {
    return Math.floor(this.next() * max);
  }

  shuffle(values) {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = this.int(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}
