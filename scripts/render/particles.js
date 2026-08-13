// @ts-check
import { visualRng } from '../core/random.js';

export class ParticleSystem {
  constructor(renderer, maxParticles = 60) {
    this.renderer = renderer;
    this.maxParticles = maxParticles;
    // Pre-allocate all particle objects to eliminate per-emission GC pressure
    this.particles = Array.from({ length: maxParticles }, () => ({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      decay: 0.02,
      color: '#fff',
      size: 2
    }));
    this._count = 0;
    /** @type {Array<{text: string, x: number, y: number, vy: number, life: number, decay: number, color: string}>} */
    this.textParticles = [];
  }

  emit(x, y, color, count = 10) {
    const px = this.renderer.offsetX + x * this.renderer.cellSize + this.renderer.cellSize / 2;
    const py = this.renderer.offsetY + y * this.renderer.cellSize + this.renderer.cellSize / 2;

    for (let i = 0; i < count; i++) {
      const angle = visualRng.nextFloat() * Math.PI * 2;
      const speed = visualRng.nextFloat() * 2 + 1;

      if (this._count >= this.maxParticles) {
        // Evict oldest particle by shifting left; no allocation needed
        const evicted = this.particles[0];
        for (let j = 1; j < this._count; j++) {
          this.particles[j - 1] = this.particles[j];
        }
        this.particles[this._count - 1] = evicted;
        this._count--;
      }

      // Reuse the pre-allocated object at slot this._count
      const p = this.particles[this._count++];
      p.x = px;
      p.y = py;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.life = 1.0;
      p.decay = visualRng.nextFloat() * 0.03 + 0.02;
      p.color = color;
      p.size = visualRng.nextFloat() * 3 + 2;
    }
  }

  emitText(gridX, gridY, text, color) {
    const x = this.renderer.offsetX + (gridX + 0.5) * this.renderer.cellSize;
    const y = this.renderer.offsetY + (gridY + 0.5) * this.renderer.cellSize;
    this.textParticles.push({
      text,
      x,
      y,
      vy: -1.5,
      life: 1.0,
      decay: 0.018,
      color: color || '#fff'
    });
    if (this.textParticles.length > 10) {
      this.textParticles.shift();
    }
  }

  update() {
    let writeIdx = 0;
    for (let i = 0; i < this._count; i++) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;

      if (p.life > 0) {
        if (writeIdx !== i) {
          const slot = this.particles[writeIdx];
          slot.x = p.x;
          slot.y = p.y;
          slot.vx = p.vx;
          slot.vy = p.vy;
          slot.life = p.life;
          slot.decay = p.decay;
          slot.color = p.color;
          slot.size = p.size;
        }
        writeIdx++;
      }
    }
    this._count = writeIdx;

    // Update text particles
    for (let i = this.textParticles.length - 1; i >= 0; i--) {
      const tp = this.textParticles[i];
      tp.y += tp.vy;
      tp.life -= tp.decay;
      if (tp.life <= 0) {
        this.textParticles.splice(i, 1);
      }
    }
  }

  draw(ctx) {
    for (let i = 0; i < this._count; i++) {
      const p = this.particles[i];
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // Draw text particles
    for (const tp of this.textParticles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, tp.life);
      ctx.font = 'bold ' + Math.max(12, Math.round(this.renderer.cellSize * 0.7)) + 'px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.strokeText(tp.text, tp.x, tp.y);
      ctx.fillStyle = tp.color;
      ctx.fillText(tp.text, tp.x, tp.y);
      ctx.restore();
    }
  }
}
