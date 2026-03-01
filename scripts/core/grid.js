// @ts-check
export class Grid {
  constructor(size, wrapWalls = false) {
    this.size = size;
    this.wrapWalls = wrapWalls;
    this.obstacles = new Set();
  }

  isValid(x, y) {
    if (this.wrapWalls) return true;
    return x >= 0 && x < this.size && y >= 0 && y < this.size;
  }

  isObstacle(x, y) {
    if (!this.wrapWalls) return this.obstacles.has(this.getIndex(x, y));
    const norm = this.normalize(x, y);
    return this.obstacles.has(this.getIndex(norm.x, norm.y));
  }

  addObstacle(x, y) {
    if (this.isValid(x, y)) {
      const norm = this.normalize(x, y);
      this.obstacles.add(this.getIndex(norm.x, norm.y));
    }
  }

  removeObstacle(x, y) {
    const norm = this.normalize(x, y);
    this.obstacles.delete(this.getIndex(norm.x, norm.y));
  }

  clearObstacles() {
    this.obstacles.clear();
  }

  getIndex(x, y) {
    return y * this.size + x;
  }

  getCoordinates(index) {
    return {
      x: index % this.size,
      y: Math.floor(index / this.size)
    };
  }

  normalize(x, y) {
    if (!this.wrapWalls) return { x, y };

    let nx = x % this.size;
    if (nx < 0) nx += this.size;

    let ny = y % this.size;
    if (ny < 0) ny += this.size;

    return { x: nx, y: ny };
  }

  getRandomEmptyCell(rng, occupiedCheckFn) {
    let attempts = 0;
    while (attempts < 100) {
      const x = rng.nextInt(0, this.size - 1);
      const y = rng.nextInt(0, this.size - 1);

      if (!this.isObstacle(x, y) && (!occupiedCheckFn || !occupiedCheckFn(x, y))) {
        return { x, y };
      }
      attempts++;
    }
    return null;
  }
}
