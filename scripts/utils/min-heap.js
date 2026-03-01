// @ts-check

/**
 * Simple binary min-heap priority queue.
 * @template T
 */
export class MinHeap {
  /**
   * @param {(a: T, b: T) => number} compare
   */
  constructor(compare) {
    /** @type {T[]} */
    this._data = [];
    this._compare = compare;
  }

  /** @returns {number} */
  get size() {
    return this._data.length;
  }

  /** @param {T} value */
  push(value) {
    this._data.push(value);
    this._siftUp(this._data.length - 1);
  }

  /** @returns {T | null} */
  pop() {
    if (this._data.length === 0) return null;
    const root = this._data[0];
    const last = this._data.pop();
    if (this._data.length > 0 && last !== undefined) {
      this._data[0] = last;
      this._siftDown(0);
    }
    return root;
  }

  clear() {
    this._data.length = 0;
  }

  /** @param {number} index */
  _siftUp(index) {
    let i = index;
    while (i > 0) {
      const parentIndex = (i - 1) >> 1;
      if (this._compare(this._data[i], this._data[parentIndex]) >= 0) {
        break;
      }
      const tmp = this._data[i];
      this._data[i] = this._data[parentIndex];
      this._data[parentIndex] = tmp;
      i = parentIndex;
    }
  }

  /** @param {number} index */
  _siftDown(index) {
    let i = index;
    const n = this._data.length;
    while (i < n) {
      const left = i * 2 + 1;
      if (left >= n) break;
      const right = left + 1;
      let smallest = left;
      if (right < n && this._compare(this._data[right], this._data[left]) < 0) {
        smallest = right;
      }
      if (this._compare(this._data[smallest], this._data[i]) >= 0) {
        break;
      }
      const tmp = this._data[i];
      this._data[i] = this._data[smallest];
      this._data[smallest] = tmp;
      i = smallest;
    }
  }
}
