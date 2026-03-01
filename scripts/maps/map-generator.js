// @ts-check
import { rng } from '../core/random.js';

export const MapTemplate = {
  EMPTY: 'empty',
  CROSS_WALL: 'cross_wall',
  PILLARS: 'pillars',
  MAZE_SIMPLE: 'maze_simple'
};

export class MapGenerator {
  constructor(grid) {
    this.grid = grid;
  }

  generate(template, seed, obstacleDensity = 0.05) {
    this.grid.clearObstacles();
    rng.setSeed(seed);

    this._applyTemplate(template);

    if (obstacleDensity > 0) {
      this._addRandomObstacles(obstacleDensity);
    }
  }

  _applyTemplate(template) {
    const size = this.grid.size;
    const mid = Math.floor(size / 2);

    switch (template) {
      case MapTemplate.EMPTY:
        break;

      case MapTemplate.CROSS_WALL:
        for (let i = 2; i < size - 2; i++) {
          if (Math.abs(i - mid) > 2) {
            this.grid.addObstacle(i, mid);
            this.grid.addObstacle(mid, i);
          }
        }
        break;

      case MapTemplate.PILLARS:
        for (let x = 4; x < size - 4; x += 4) {
          for (let y = 4; y < size - 4; y += 4) {
            this.grid.addObstacle(x, y);
            this.grid.addObstacle(x + 1, y);
            this.grid.addObstacle(x, y + 1);
            this.grid.addObstacle(x + 1, y + 1);
          }
        }
        break;

      case MapTemplate.MAZE_SIMPLE:
        for (let i = 0; i < size; i++) {
          this.grid.addObstacle(i, 0);
          this.grid.addObstacle(i, size - 1);
          this.grid.addObstacle(0, i);
          this.grid.addObstacle(size - 1, i);
        }
        for (let x = 4; x < size - 4; x += 4) {
          for (let i = 4; i < size - 4; i++) {
            if (rng.nextFloat() > 0.3) {
              this.grid.addObstacle(x, i);
            }
          }
        }
        break;
    }
  }

  _addRandomObstacles(density) {
    const totalCells = this.grid.size * this.grid.size;
    const count = Math.floor(totalCells * density);
    const mid = Math.floor(this.grid.size / 2);

    const isSafeZone = (x, y) => {
      return Math.abs(x - mid) <= 1 && Math.abs(y - mid) <= 1;
    };

    let added = 0;
    let attempts = 0;
    while (added < count && attempts < count * 5) {
      const x = rng.nextInt(0, this.grid.size - 1);
      const y = rng.nextInt(0, this.grid.size - 1);

      if (!this.grid.isObstacle(x, y) && !isSafeZone(x, y)) {
        this.grid.addObstacle(x, y);
        added++;
      }
      attempts++;
    }
  }
}
