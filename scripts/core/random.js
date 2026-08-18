// @ts-check
export class SeededRandom {
  /** @param {number | string} [seed] */
  constructor(seed = Date.now()) {
    this.setSeed(seed);
  }

  /** @param {number | string} seed */
  setSeed(seed) {
    if (typeof seed === 'string') {
      this.initialSeed = this._hashString(seed);
    } else {
      this.initialSeed = seed >>> 0;
    }
    this.state = this.initialSeed;
  }

  _hashString(str) {
    let hash = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      hash = Math.imul(hash ^ str.charCodeAt(i), 3432918353);
      hash = (hash << 13) | (hash >>> 19);
    }
    return (function () {
      hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
      hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
      return hash >>> 0;
    })();
  }

  next() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextFloat() {
    return this.next();
  }

  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  choice(array) {
    if (!array || array.length === 0) return null;
    return array[this.nextInt(0, array.length - 1)];
  }

  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}

// Gameplay and visual randomness are deliberately independent. Rendering
// changes (for example, emitting more particles) must never change future
// item positions or daily challenge outcomes.
export const gameplayRng = new SeededRandom();
export const visualRng = new SeededRandom();

// Backward-compatible alias for existing gameplay code.
export const rng = gameplayRng;
