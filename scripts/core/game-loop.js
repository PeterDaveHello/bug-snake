// @ts-check
export class GameLoop {
  constructor(updateFn, renderFn) {
    this.updateFn = updateFn;
    this.renderFn = renderFn;
    this.lastTime = 0;
    this.accumulator = 0;
    this.step = 1 / 10;
    this.maxUpdatesPerFrame = 5;
    this.tickStep = this.step;
    this.effectiveStep = this.step;
    this.rafId = null;
    this.isRunning = false;
    this.fps = 60;
    this._fpsLastTime = 0;
    this._fpsFrames = 0;
    this.fpsTarget = 10;
    this._boundLoop = this._loop.bind(this);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this._fpsLastTime = this.lastTime;
    this._fpsFrames = 0;
    this.rafId = requestAnimationFrame(this._boundLoop);
  }

  stop() {
    this.isRunning = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  setSpeed(tps) {
    if (tps <= 0) return;
    this.step = 1 / tps;
    this.fpsTarget = tps;
    this.tickStep = this.step;
    this.effectiveStep = this.step;
  }

  _loop(currentTime) {
    if (!this.isRunning) return;

    const deltaTime = (currentTime - this.lastTime) / 1000;
    this.lastTime = currentTime;

    let frameTime = deltaTime;
    if (frameTime > 0.25) frameTime = 0.25;

    this.accumulator += frameTime;

    const minStep = this.maxUpdatesPerFrame > 0 ? frameTime / this.maxUpdatesPerFrame : 0;

    for (;;) {
      const stepBeforeUpdate = Math.max(this.step, minStep);
      if (this.accumulator < stepBeforeUpdate) break;

      this.tickStep = stepBeforeUpdate;
      this.updateFn();
      // Use the step value that was in effect when this tick began.
      // `updateFn()` may change speed (and thus `this.step`), and subtracting the
      // new step can make `accumulator` go negative or distort alpha.
      this.accumulator -= stepBeforeUpdate;
    }

    if (this.accumulator < 0) {
      this.accumulator = 0;
    }

    const renderStep = Math.max(this.step, minStep);
    this.effectiveStep = renderStep;
    const alpha = renderStep > 0 ? this.accumulator / renderStep : 0;
    this.renderFn(alpha);

    this._fpsFrames++;
    const fpsWindow = currentTime - this._fpsLastTime;
    if (fpsWindow >= 1000) {
      this.fps = Math.round((this._fpsFrames * 1000) / fpsWindow);
      this._fpsFrames = 0;
      this._fpsLastTime = currentTime;
    }

    if (this.isRunning) {
      this.rafId = requestAnimationFrame(this._boundLoop);
    }
  }
}
