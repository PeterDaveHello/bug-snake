// @ts-check
import { GameConfig } from '../core/config.js';
import { GameState, gameState } from '../core/state-machine.js';

const DEFAULT_ITEM_VISUAL_ATTRS = { sizeVar: 1, hueVar: 0, angleVar: 0, quirk: 0.5 };
const ITEM_DYNAMIC_FRAME_MS = {
  roach: 90,
  ant: 90,
  mosquito: 45,
  egg: 120,
  mouse: 80,
  trash: 110,
  poison: 90
};
const ITEM_SPRITE_CACHE_DISABLED_TYPES = new Set(['roach', 'mosquito']);

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context not available');
    }
    this.ctx = ctx;
    this.cellSize = 0;
    this.width = 0;
    this.height = 0;
    this.lastGridSize = null;
    this._frameTime = 0;
    this._chromeTileSize = 0;
    this._chromeTileDpr = 0;
    this._chromeTiles = null;
    /** @type {Map<string, { canvas: HTMLCanvasElement, padding: number }>} */
    this._itemSpriteCache = new Map();
    this._itemCacheCellSize = 0;
    this._itemCacheDpr = 0;
    this._scaleX = 1;
    this._scaleY = 1;
    /** @type {string[]} */
    this._quantumHslCache = [];
    for (let i = 0; i < 3600; i++) {
      const hue = (i / 10).toFixed(1);
      this._quantumHslCache.push(`hsl(${hue}, 100%, 50%)`);
    }
    /** Reusable scratch object for _lerpSegment to avoid per-segment allocation */
    this._lerpResult = { x: 0, y: 0 };

    this.colors = {
      background: '#030309',
      grid: '#0a0a16',
      wall: '#3d3d7a',
      wallEdge: '#a4f4ff',
      bounds: '#a4f4ff',
      snakeHead: '#4CC9F0',
      snakeBody: '#4895EF',
      path: 'rgba(76, 201, 240, 0.3)'
    };

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    if (!width || !height) return;

    this.width = width;
    this.height = height;

    this.dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.ceil(this.width * this.dpr);
    const pixelHeight = Math.ceil(this.height * this.dpr);
    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
    const scaleX = pixelWidth / this.width;
    const scaleY = pixelHeight / this.height;
    this._scaleX = scaleX;
    this._scaleY = scaleY;
    this.ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    this.ctx.imageSmoothingEnabled = false;

    // Use game grid size if available, otherwise default
    const gridSize = this.game && this.game.grid ? this.game.grid.size : GameConfig.map.defaultSize;
    const cellW = Math.floor(this.width / gridSize);
    const cellH = Math.floor(this.height / gridSize);
    this.cellSize = Math.min(cellW, cellH);

    this.offsetX = Math.floor((this.width - gridSize * this.cellSize) / 2);
    this.offsetY = Math.floor((this.height - gridSize * this.cellSize) / 2);
    this.lastGridSize = gridSize;

    this._refreshItemSpriteCacheContext(this.dpr || 1);
    this._ensureChromeTiles();
    this._wallTile = null;
  }

  _ensureChromeTiles() {
    const size = this.cellSize;
    const dpr = this.dpr || 1;
    if (!size) return;
    if (this._chromeTiles && this._chromeTileSize === size && this._chromeTileDpr === dpr) {
      return;
    }

    const makeTile = (padding, withHeadMark) => {
      const tile = document.createElement('canvas');
      tile.width = Math.ceil(size * dpr);
      tile.height = Math.ceil(size * dpr);
      const tctx = tile.getContext('2d');
      if (!tctx) return null;
      const scaleX = tile.width / size;
      const scaleY = tile.height / size;
      tctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
      tctx.imageSmoothingEnabled = false;

      const grad = tctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, '#FFFFFF');
      grad.addColorStop(0.5, '#A0A0A0');
      grad.addColorStop(1, '#404040');
      tctx.fillStyle = grad;
      tctx.fillRect(padding, padding, size - padding * 2, size - padding * 2);

      if (withHeadMark) {
        tctx.fillStyle = '#FF0000';
        tctx.fillRect(size / 4, size / 4, size / 2, size / 2);
      }

      return tile;
    };

    this._chromeTiles = {
      body: makeTile(1, false),
      head: makeTile(2, true)
    };
    this._chromeTileSize = size;
    this._chromeTileDpr = dpr;
  }

  _isItemSpriteCacheEnabled() {
    return GameConfig.render?.itemSpriteCacheEnabled !== false;
  }

  _canUseItemSpriteCache(type) {
    return !ITEM_SPRITE_CACHE_DISABLED_TYPES.has(type);
  }

  _refreshItemSpriteCacheContext(dpr) {
    const nextDpr = dpr || 1;
    if (this._itemCacheDpr === nextDpr && this._itemCacheCellSize === this.cellSize) {
      return;
    }
    this._itemCacheDpr = nextDpr;
    this._itemCacheCellSize = this.cellSize;
    this._clearItemSpriteCache();
  }

  _clearItemSpriteCache() {
    this._itemSpriteCache.clear();
  }

  _getItemVariantBucket(item) {
    const bucketCount = Math.max(1, GameConfig.render?.itemSpriteVariantBuckets || 1);
    if (bucketCount <= 1) return 0;

    const attrs = item.visualAttrs || DEFAULT_ITEM_VISUAL_ATTRS;
    const seed = (item.id || item.x * 100 + item.y) | 0;
    const sizePart = Math.round((attrs.sizeVar || 1) * 1000);
    const huePart = Math.round((attrs.hueVar || 0) * 10);
    const anglePart = Math.round((attrs.angleVar || 0) * 1000);
    const quirkPart = Math.round((attrs.quirk || 0.5) * 1000);

    let hash = seed ^ 216613626;
    hash = Math.imul(hash ^ sizePart, 16777619);
    hash = Math.imul(hash ^ huePart, 16777619);
    hash = Math.imul(hash ^ anglePart, 16777619);
    hash = Math.imul(hash ^ quirkPart, 16777619);
    return ((hash % bucketCount) + bucketCount) % bucketCount;
  }

  _getItemFrameBucket(item, time, seed) {
    const frameCount = Math.max(1, GameConfig.render?.itemSpriteFrameBuckets || 1);
    if (frameCount <= 1) return 0;

    const frameMs = ITEM_DYNAMIC_FRAME_MS[item.type];
    if (!frameMs) return 0;

    const phase = Math.floor((time + seed * 37) / frameMs);
    return ((phase % frameCount) + frameCount) % frameCount;
  }

  _buildItemSpriteKey(type, variantBucket, frameBucket, size, dpr) {
    return `${type}|${variantBucket}|${frameBucket}|${size}|${dpr}`;
  }

  _getItemSpriteSeed(type, variantBucket) {
    let hash = 216613626;
    for (let i = 0; i < type.length; i++) {
      hash = Math.imul(hash ^ type.charCodeAt(i), 16777619);
    }
    hash = Math.imul(hash ^ variantBucket, 16777619);
    return hash >>> 0;
  }

  _getCachedItemVisualAttrs(variantBucket) {
    const bucketCount = Math.max(1, GameConfig.render?.itemSpriteVariantBuckets || 1);
    const unit = bucketCount <= 1 ? 0.5 : variantBucket / (bucketCount - 1);
    return {
      sizeVar: 0.85 + unit * 0.3,
      hueVar: -15 + unit * 30,
      angleVar: -0.2 + unit * 0.4,
      quirk: unit
    };
  }

  _getOrCreateItemSprite(item, def, size, fixedTime, dpr) {
    if (!size || size <= 0) return null;

    this._refreshItemSpriteCacheContext(dpr);

    const seed = item.id || item.x * 100 + item.y;
    const variantBucket = this._getItemVariantBucket(item);
    const frameBucket = this._getItemFrameBucket(item, fixedTime, seed);
    const cacheKey = this._buildItemSpriteKey(item.type, variantBucket, frameBucket, size, dpr);
    const cached = this._itemSpriteCache.get(cacheKey);
    if (cached) return cached;

    // Reserve extra margin for glow blur and animated offsets to avoid clipping.
    const padding = Math.max(12, Math.ceil(size * 0.3) + 10);
    const logicalSize = size + padding * 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(logicalSize * dpr);
    canvas.height = Math.ceil(logicalSize * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const scaleX = canvas.width / logicalSize;
    const scaleY = canvas.height / logicalSize;
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    ctx.imageSmoothingEnabled = false;

    const spriteItem = {
      type: item.type,
      x: 0,
      y: 0,
      id: this._getItemSpriteSeed(item.type, variantBucket),
      visualAttrs: this._getCachedItemVisualAttrs(variantBucket)
    };

    this._drawItemGlyph(spriteItem, def, ctx, padding, padding, size, fixedTime);

    const sprite = { canvas, padding };
    this._itemSpriteCache.set(cacheKey, sprite);
    return sprite;
  }

  _drawItemSpriteAt(ctx, sprite, x, y, size) {
    const drawSize = size + sprite.padding * 2;
    ctx.drawImage(sprite.canvas, x - sprite.padding, y - sprite.padding, drawSize, drawSize);
  }

  render(game, alpha, frameTime = performance.now()) {
    this.game = game; // Store ref for resize updates
    this._frameTime = Number.isFinite(frameTime) ? frameTime : performance.now();
    this.ctx.fillStyle = this.colors.background;
    this.ctx.fillRect(0, 0, this.width, this.height);

    if (!game.grid) return;

    if (this.cellSize === 0 || this.lastGridSize !== game.grid.size) {
      this.resize();
    }

    // [Fix P1] Prevent jitter when game is paused/over by freezing interpolation
    // If not PLAYING, force alpha to 1.0 (show final position)
    const renderAlpha = gameState.currentState === GameState.PLAYING ? alpha : 1.0;

    this._drawGrid(game.grid);
    this._drawObstacles(game.grid);
    this._drawBounds(game.grid);
    // Apply screen shake during DYING
    const isDying = gameState.currentState === GameState.DYING;
    if (isDying) {
      this.ctx.save();
      const shakeX = (Math.random() - 0.5) * 6;
      const shakeY = (Math.random() - 0.5) * 6;
      this.ctx.translate(shakeX, shakeY);
    }

    this.ctx.imageSmoothingEnabled = true;
    this._drawItems(game.itemManager);
    this.ctx.imageSmoothingEnabled = false;
    this._drawSnake(game.snake, renderAlpha, game.settings.snakeSkin || 'classic');

    if (isDying) {
      this.ctx.restore();
    }
  }

  _drawGrid(grid) {
    this.ctx.strokeStyle = this.colors.grid;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();

    const size = grid.size * this.cellSize;

    for (let i = 0; i <= grid.size; i++) {
      const x = this.offsetX + i * this.cellSize;
      this.ctx.moveTo(x, this.offsetY);
      this.ctx.lineTo(x, this.offsetY + size);
    }

    for (let i = 0; i <= grid.size; i++) {
      const y = this.offsetY + i * this.cellSize;
      this.ctx.moveTo(this.offsetX, y);
      this.ctx.lineTo(this.offsetX + size, y);
    }

    this.ctx.stroke();
  }

  _ensureWallTile() {
    if (this._wallTile) return this._wallTile;
    const size = this.cellSize;
    if (!size) return null;
    const dpr = this.dpr || 1;
    const pad = Math.ceil(3 * dpr);
    const tileW = Math.ceil(size * dpr) + pad * 2;
    const tileH = tileW;
    const tile = document.createElement('canvas');
    tile.width = tileW;
    tile.height = tileH;
    const t = tile.getContext('2d');
    if (!t) return null;
    const sx = tileW / (size + (pad * 2) / dpr);
    const sy = tileH / (size + (pad * 2) / dpr);
    t.setTransform(sx, 0, 0, sy, 0, 0);
    t.imageSmoothingEnabled = false;
    const off = pad / dpr;
    t.fillStyle = this.colors.wall;
    t.strokeStyle = this.colors.wallEdge;
    t.lineWidth = Math.max(1, Math.floor(size * 0.08));
    t.shadowColor = this.colors.wallEdge;
    t.shadowBlur = 3;
    this._drawWallBlock(t, off, off, size);
    this._wallTile = { canvas: tile, offset: off };
    return this._wallTile;
  }

  _drawObstacles(grid) {
    const tile = this._ensureWallTile();
    if (tile) {
      for (const index of grid.obstacles) {
        const x = index % grid.size;
        const y = Math.floor(index / grid.size);
        const px = this.offsetX + x * this.cellSize - tile.offset;
        const py = this.offsetY + y * this.cellSize - tile.offset;
        const drawW = this.cellSize + tile.offset * 2;
        const drawH = drawW;
        this.ctx.drawImage(tile.canvas, px, py, drawW, drawH);
      }
    } else {
      this.ctx.fillStyle = this.colors.wall;
      this.ctx.strokeStyle = this.colors.wallEdge;
      this.ctx.lineWidth = Math.max(1, Math.floor(this.cellSize * 0.08));
      this.ctx.shadowColor = this.colors.wallEdge;
      this.ctx.shadowBlur = 3;
      for (const index of grid.obstacles) {
        const x = index % grid.size;
        const y = Math.floor(index / grid.size);
        const px = this.offsetX + x * this.cellSize;
        const py = this.offsetY + y * this.cellSize;
        this._drawWallBlock(this.ctx, px, py, this.cellSize);
      }
      this.ctx.shadowBlur = 0;
    }
  }

  _drawWallBlock(ctx, x, y, size) {
    ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
    ctx.strokeRect(x + 1.5, y + 1.5, size - 3, size - 3);

    ctx.beginPath();
    ctx.moveTo(x + 3, y + size - 3);
    ctx.lineTo(x + size - 3, y + 3);
    ctx.stroke();
  }

  _drawBounds(grid) {
    const size = grid.size * this.cellSize;
    const x = this.offsetX;
    const y = this.offsetY;
    const wrapWalls = grid.wrapWalls;
    const timeMs = this._frameTime;
    const pulse = wrapWalls ? this._getWrapBoundsPulse(timeMs) : 0;
    const baseLineWidth = Math.max(2, Math.floor(this.cellSize * 0.1));

    this.ctx.save();
    if (wrapWalls) {
      // Wrap mode: soft gradient breathing border.
      this.ctx.setLineDash([]);
      const borderGradient = this.ctx.createLinearGradient(x, y, x + size, y + size);
      borderGradient.addColorStop(0, this._adjustColor(this.colors.bounds, -34));
      borderGradient.addColorStop(0.35, this._adjustColor(this.colors.bounds, -10));
      borderGradient.addColorStop(0.65, this.colors.bounds);
      borderGradient.addColorStop(1, this._adjustColor(this.colors.bounds, -28));

      // Outer halo pass keeps the transition smooth without expensive blur.
      this.ctx.strokeStyle = borderGradient;
      this.ctx.lineWidth = Math.max(1, baseLineWidth * 1.2);
      this.ctx.globalAlpha = 0.08 + pulse * 0.08;
      this.ctx.strokeRect(x, y, size, size);

      // Main border pass controls the readable breathing effect.
      this.ctx.lineWidth = Math.max(1, baseLineWidth * (0.56 + pulse * 0.1));
      this.ctx.globalAlpha = 0.18 + pulse * 0.2;
      this.ctx.strokeRect(x, y, size, size);
    } else {
      this.ctx.strokeStyle = this._adjustColor(this.colors.bounds, -36);
      this.ctx.lineWidth = baseLineWidth;
      this.ctx.globalAlpha = 0.9;
      this.ctx.strokeRect(x, y, size, size);
    }
    this.ctx.restore();
  }

  _getWrapBoundsPulse(timeMs) {
    const cycleMs = 1800;
    const phase = (timeMs % cycleMs) / cycleMs;
    // Smooth breathing curve.
    return (1 - Math.cos(phase * Math.PI * 2)) / 2;
  }

  _drawItems(itemManager) {
    if (!itemManager) return;

    const useSpriteCache = this._isItemSpriteCacheEnabled();
    const time = this._frameTime;
    const dpr = this.dpr || 1;

    for (const item of itemManager.items) {
      const def = GameConfig.items[item.type];
      if (!def) continue;
      if (useSpriteCache && this._canUseItemSpriteCache(item.type)) {
        const sprite = this._getOrCreateItemSprite(item, def, this.cellSize, time, dpr);
        if (sprite) {
          const x = this.offsetX + item.x * this.cellSize;
          const y = this.offsetY + item.y * this.cellSize;
          this._drawItemSpriteAt(this.ctx, sprite, x, y, this.cellSize);
          continue;
        }
      }
      this._drawItemGlyph(item, def, this.ctx, null, null, this.cellSize, time);
    }
  }

  /**
   * @param {{
   *   x: number,
   *   y: number,
   *   type: string,
   *   id?: number,
   *   visualAttrs?: {
   *     sizeVar?: number,
   *     hueVar?: number,
   *     angleVar?: number,
   *     quirk?: number
   *   }
   * }} item
   * @param {{color: string}} def
   * @param {CanvasRenderingContext2D} [ctx]
   * @param {number} [x] Override x coordinate (pixels)
   * @param {number} [y] Override y coordinate (pixels)
   * @param {number} [size] Override size (pixels)
   * @param {number} [fixedTime] Optional fixed time for animation
   */
  _drawItemGlyph(
    item,
    def,
    ctx = this.ctx,
    x = null,
    y = null,
    size = this.cellSize,
    fixedTime = null
  ) {
    const cx = (x !== null ? x : this.offsetX + item.x * this.cellSize) + size / 2;
    const cy = (y !== null ? y : this.offsetY + item.y * this.cellSize) + size / 2;

    // Default attrs if missing (e.g. legend or old items)
    const attrs = item.visualAttrs || DEFAULT_ITEM_VISUAL_ATTRS;
    const r = size * 0.4 * attrs.sizeVar;

    ctx.save();
    ctx.fillStyle = def.color;
    ctx.strokeStyle = def.color;
    ctx.shadowColor = def.color;
    ctx.shadowBlur = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const time = fixedTime !== null ? fixedTime : this._frameTime;
    // Unique random seed based on item ID or position
    const seed = item.id || item.x * 100 + item.y;

    switch (item.type) {
      case 'roach':
        this._drawRoach(ctx, cx, cy, r, size, attrs, time, seed, def);
        break;
      case 'ant':
        this._drawAnt(ctx, cx, cy, r, size, attrs, time, seed);
        break;
      case 'mosquito':
        this._drawMosquito(ctx, cx, cy, r, size, attrs, time, seed, def);
        break;
      case 'egg':
        this._drawEgg(ctx, cx, cy, r, size, attrs, time, seed);
        break;
      case 'mouse':
        this._drawMouse(ctx, cx, cy, r, size, attrs, time, seed);
        break;
      case 'trash':
        this._drawTrash(ctx, cx, cy, r, size, attrs, time, seed);
        break;
      case 'poison':
        this._drawPoison(ctx, cx, cy, r, size, attrs, time, seed);
        break;
      default:
        ctx.translate(cx, cy);
        {
          const p = 2;
          ctx.fillRect(-size / 2 + p, -size / 2 + p, size - p * 2, size - p * 2);
        }
        break;
    }

    ctx.restore();
  }

  _drawRoach(ctx, cx, cy, r, size, attrs, time, seed, def) {
    // Smaller base size for roach
    const rRoach = r * 0.85;

    // Animation: Calm breathing instead of jitter
    const floatY = Math.sin(time * 0.005 + seed) * (size * 0.05);
    // Very slow, subtle rotation sway
    const rotation = attrs.angleVar + Math.sin(time * 0.002 + seed) * 0.05;

    ctx.translate(cx, cy + floatY);
    ctx.rotate(rotation);

    // Body (vary shape based on quirk)
    const bodyWidth = rRoach * (0.7 + attrs.quirk * 0.2);
    ctx.beginPath();
    ctx.ellipse(0, 0, bodyWidth, rRoach * 1.0, 0, 0, Math.PI * 2);
    ctx.fill();

    // Head shield
    ctx.fillStyle = this._adjustColor(def.color, 20);
    ctx.beginPath();
    ctx.arc(0, -rRoach * 0.6, rRoach * 0.5, Math.PI, 0);
    ctx.fill();

    // Antennae (Asymmetric & Twitching)
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1, size * 0.04);
    ctx.beginPath();

    const antLen1 = 1.2 + attrs.quirk * 0.4; // Random length
    const antLen2 = 1.2 + (1 - attrs.quirk) * 0.4;
    const twitch1 = Math.sin(time * 0.02 + seed) * 0.2;
    const twitch2 = Math.cos(time * 0.02 + seed * 2) * 0.2;

    ctx.moveTo(-rRoach * 0.2, -rRoach * 0.8);
    ctx.quadraticCurveTo(-r, -r * 1.5, -r * 0.5 + twitch1 * r, -r * (1 + antLen1));

    ctx.moveTo(rRoach * 0.2, -rRoach * 0.8);
    ctx.quadraticCurveTo(r, -r * 1.5, r * 0.5 + twitch2 * r, -r * (1 + antLen2));
    ctx.stroke();

    // Legs (Spiky)
    ctx.lineWidth = Math.max(1, size * 0.03);
    for (let i = 0; i < 3; i++) {
      const ly = (i - 1) * rRoach * 0.5;
      // Subtle independent leg movement
      const legTwitch = Math.sin(time * 0.01 + i) * 0.05;

      ctx.beginPath();
      ctx.moveTo(-rRoach * 0.5, ly);
      ctx.lineTo(-rRoach * 1.2, ly + rRoach * 0.3 + legTwitch * r);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(rRoach * 0.5, ly);
      ctx.lineTo(rRoach * 1.2, ly + rRoach * 0.3 - legTwitch * r);
      ctx.stroke();
    }
  }

  _drawAnt(ctx, cx, cy, r, size, attrs, time, seed) {
    // Walking Wave Animation
    const floatY = Math.sin(time * 0.003 + seed) * (size * 0.03);
    ctx.translate(cx, cy + floatY);
    ctx.rotate(attrs.angleVar);

    // Body Proportions (Quirk determines if head or abdomen is bigger)
    const abdomenScale = 1.0 + (attrs.quirk - 0.5) * 0.4; // 0.8 ~ 1.2
    const segmentR = r * 0.45;

    // Abdomen
    ctx.beginPath();
    ctx.ellipse(
      0,
      r * 0.5,
      segmentR * 1.1 * abdomenScale,
      segmentR * 1.4 * abdomenScale,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
    // Thorax
    ctx.beginPath();
    ctx.ellipse(0, 0, segmentR * 0.8, segmentR * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    // Head
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.6, segmentR, segmentR, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs (Walking animation)
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1, size * 0.04);
    const legLength = r * 0.9;
    const walkSpeed = 0.01;

    for (let i = 0; i < 3; i++) {
      const sideY = (i - 1) * r * 0.3;
      const legPhase = i * 2 + seed;
      const legOffset = Math.sin(time * walkSpeed + legPhase) * (r * 0.2);

      ctx.beginPath();
      ctx.moveTo(-r * 0.2, sideY);
      ctx.lineTo(-legLength, sideY + (i - 1) * r * 0.4 + legOffset);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(r * 0.2, sideY);
      ctx.lineTo(legLength, sideY + (i - 1) * r * 0.4 - legOffset); // Opposite phase
      ctx.stroke();
    }

    // Antennae
    ctx.lineWidth = Math.max(1, size * 0.04);
    // Antennas feel around
    const feelAngle = Math.sin(time * 0.005 + seed) * 0.2;

    ctx.beginPath();
    ctx.moveTo(-r * 0.2, -r * 0.8);
    ctx.lineTo(-r * 0.6 + feelAngle * r, -r * 1.2);
    ctx.lineTo(-r * 0.4 + feelAngle * r * 1.5, -r * 1.6);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(r * 0.2, -r * 0.8);
    ctx.lineTo(r * 0.6 + feelAngle * r, -r * 1.2);
    ctx.lineTo(r * 0.4 + feelAngle * r * 1.5, -r * 1.6);
    ctx.stroke();
  }

  _drawMosquito(ctx, cx, cy, r, size, attrs, time, seed, def) {
    // Hover flight path (Figure 8 or circle)
    const hoverX = Math.sin(time * 0.004 + seed) * (size * 0.1);
    const hoverY = Math.cos(time * 0.003 + seed * 2) * (size * 0.1);

    ctx.translate(cx + hoverX, cy + hoverY);
    ctx.rotate(attrs.angleVar + hoverX * 0.01); // Lean into turn

    // Wings (Blur effect)
    const wingSpeed = 0.5; // Very fast
    const wingState = Math.sin(time * wingSpeed + seed);
    const wingScale = 0.8 + Math.abs(wingState) * 0.4;
    const wingAlpha = 0.3 + Math.abs(wingState) * 0.4;

    ctx.fillStyle = `rgba(200, 255, 255, ${wingAlpha})`;

    // Left Wing
    ctx.beginPath();
    ctx.ellipse(-r * 0.6, 0, r * 0.8 * wingScale, r * 0.3, -0.4 + wingState * 0.2, 0, Math.PI * 2);
    ctx.fill();
    // Right Wing
    ctx.beginPath();
    ctx.ellipse(r * 0.6, 0, r * 0.8 * wingScale, r * 0.3, 0.4 - wingState * 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.3, r, 0, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.beginPath();
    ctx.arc(0, -r * 0.8, r * 0.3, 0, Math.PI * 2);
    ctx.fill();

    // Proboscis (Long needle)
    const probLength = r * (1.5 + attrs.quirk * 0.5); // Varying length
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1, size * 0.03);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.8);
    ctx.lineTo(0, -r * 0.8 - probLength);
    ctx.stroke();
  }

  _drawTrash(ctx, cx, cy, r, size, attrs, time, seed) {
    // Random rotation and offset
    const rot = attrs.angleVar + Math.sin(time * 0.001 + seed) * 0.1;
    ctx.translate(cx, cy);
    ctx.rotate(rot);

    // Jagged shape
    ctx.fillStyle = '#8B7355';
    ctx.beginPath();
    const spikes = 8;
    // Vary roughness based on quirk
    const rough = 1.0 + attrs.quirk * 0.3;
    const outerRadius = r * 1.1 * rough;
    const innerRadius = r * 0.7;

    for (let i = 0; i < spikes * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i / spikes) * Math.PI;
      const tx = Math.cos(angle) * radius;
      const ty = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(tx, ty);
      else ctx.lineTo(tx, ty);
    }
    ctx.closePath();
    ctx.fill();

    // Texture
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.arc(-r * 0.3, -r * 0.2, r * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(r * 0.4, r * 0.3, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, r * 0.4);
    ctx.lineTo(r * 0.1, r * 0.2);
    ctx.lineWidth = Math.max(1, size * 0.05);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.stroke();
  }

  _drawPoison(ctx, cx, cy, r, size, attrs, time, seed) {
    const floatY = Math.sin(time * 0.004 + seed) * (size * 0.08);
    ctx.translate(cx, cy + floatY);
    // Tilt slightly
    ctx.rotate(Math.sin(time * 0.002 + seed) * 0.1);

    // Flask
    ctx.beginPath();
    ctx.rect(-r * 0.3, -r * 1.2, r * 0.6, r * 0.6);
    ctx.arc(0, r * 0.2, r * 0.9, 0, Math.PI * 2);
    ctx.fill();

    // Bubbles (Moving up)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.shadowBlur = 0;

    // Generate bubbles based on time and quirk
    const bubbleSpeed = 0.002 + attrs.quirk * 0.002;
    const bubbleOffset = (time * bubbleSpeed + seed) % 1; // 0 to 1
    const bY = r * 0.5 - bubbleOffset * (r * 1.5);

    if (bY < r * 0.2 && bY > -r * 1.0) {
      ctx.beginPath();
      ctx.arc(0, bY, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawEgg(ctx, cx, cy, r, size, attrs, time, seed) {
    const wobble = Math.sin(time * 0.003 + seed) * 0.08;
    ctx.translate(cx, cy);
    ctx.rotate(wobble);

    // Egg shape (oval)
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.7, r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();

    // Highlight (shine)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.ellipse(-r * 0.2, -r * 0.3, r * 0.2, r * 0.3, -0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawMouse(ctx, cx, cy, r, size, attrs, time, seed) {
    const floatY = Math.sin(time * 0.004 + seed) * (size * 0.03);
    ctx.translate(cx, cy + floatY);

    // Body
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.8, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Ears
    ctx.beginPath();
    ctx.arc(-r * 0.5, -r * 0.5, r * 0.35, 0, Math.PI * 2);
    ctx.arc(r * 0.5, -r * 0.5, r * 0.35, 0, Math.PI * 2);
    ctx.fill();

    // Inner ears
    ctx.fillStyle = 'rgba(255, 180, 180, 0.6)';
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(-r * 0.5, -r * 0.5, r * 0.2, 0, Math.PI * 2);
    ctx.arc(r * 0.5, -r * 0.5, r * 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(-r * 0.25, -r * 0.1, r * 0.1, 0, Math.PI * 2);
    ctx.arc(r * 0.25, -r * 0.1, r * 0.1, 0, Math.PI * 2);
    ctx.fill();

    // Nose
    ctx.fillStyle = '#FFB6C1';
    ctx.beginPath();
    ctx.arc(0, r * 0.15, r * 0.12, 0, Math.PI * 2);
    ctx.fill();

    // Whiskers
    ctx.strokeStyle = '#666';
    ctx.lineWidth = Math.max(1, size * 0.02);
    const whiskerTwitch = Math.sin(time * 0.01 + seed) * 0.1;
    ctx.beginPath();
    ctx.moveTo(-r * 0.15, r * 0.15);
    ctx.lineTo(-r * 0.8, r * 0.05 + whiskerTwitch * r);
    ctx.moveTo(-r * 0.15, r * 0.2);
    ctx.lineTo(-r * 0.8, r * 0.3 + whiskerTwitch * r);
    ctx.moveTo(r * 0.15, r * 0.15);
    ctx.lineTo(r * 0.8, r * 0.05 - whiskerTwitch * r);
    ctx.moveTo(r * 0.15, r * 0.2);
    ctx.lineTo(r * 0.8, r * 0.3 - whiskerTwitch * r);
    ctx.stroke();

    // Tail
    ctx.strokeStyle = '#999';
    ctx.lineWidth = Math.max(1, size * 0.04);
    const tailWag = Math.sin(time * 0.008 + seed) * 0.3;
    ctx.beginPath();
    ctx.moveTo(0, r * 0.5);
    ctx.quadraticCurveTo(r * 0.5 + tailWag * r, r * 1.0, r * 0.3 + tailWag * r, r * 1.4);
    ctx.stroke();
  }

  /**
   * Renders a single icon to a canvas element (for Legend)
   * @param {HTMLCanvasElement} canvas
   * @param {string} type
   */
  drawIcon(canvas, type) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    // Configure canvas for high DPI
    const pixelWidth = Math.ceil(rect.width * dpr);
    const pixelHeight = Math.ceil(rect.height * dpr);
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const scaleX = pixelWidth / rect.width;
    const scaleY = pixelHeight / rect.height;
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // Clear
    ctx.clearRect(0, 0, rect.width, rect.height);

    const size = Math.min(rect.width, rect.height);
    // Add some padding
    const padding = size * 0.1;
    const drawSize = size - padding * 2;
    const x = padding;
    const y = padding;

    if (type === 'wall') {
      ctx.save();
      ctx.fillStyle = this.colors.wall;
      ctx.strokeStyle = this.colors.wallEdge;
      ctx.lineWidth = Math.max(1, Math.floor(drawSize * 0.08));
      this._drawWallBlock(ctx, x, y, drawSize);
      ctx.restore();
    } else {
      const def = GameConfig.items[type];
      if (def) {
        const legendItem = {
          type,
          x: 0,
          y: 0,
          id: 0,
          visualAttrs: { sizeVar: 1, angleVar: 0, quirk: 0.5, hueVar: 0 }
        };
        const fixedTime = 200;
        if (this._isItemSpriteCacheEnabled()) {
          const sprite = this._getOrCreateItemSprite(legendItem, def, drawSize, fixedTime, dpr);
          if (sprite) {
            this._drawItemSpriteAt(ctx, sprite, x, y, drawSize);
            return;
          }
        }
        // Use a fixed time for consistent legend pose.
        this._drawItemGlyph(legendItem, def, ctx, x, y, drawSize, fixedTime);
      }
    }
  }

  renderLegendIcons() {
    const icons = document.querySelectorAll('.legend-icon');
    icons.forEach((canvas) => {
      if (canvas instanceof HTMLCanvasElement) {
        const type = canvas.dataset.type;
        if (type) {
          this.drawIcon(canvas, type);
        }
      }
    });
  }

  _adjustColor(hex, amount) {
    // Basic validation for 6-digit hex
    if (!/^#?[0-9A-Fa-f]{6}$/.test(hex)) {
      return hex;
    }

    const cleanHex = hex.replace(/^#/, '');
    const adjustComponent = (colorPart) => {
      const value = parseInt(colorPart, 16);
      const adjusted = Math.min(255, Math.max(0, value + amount));
      return adjusted.toString(16).padStart(2, '0');
    };

    const r = adjustComponent(cleanHex.substring(0, 2));
    const g = adjustComponent(cleanHex.substring(2, 4));
    const b = adjustComponent(cleanHex.substring(4, 6));

    return '#' + r + g + b;
  }

  _isHighScoreBreathingActive() {
    if (!this.game || this.game.gameMode !== 'classic') return false;
    if (gameState.currentState !== GameState.PLAYING) return false;
    const scoreManager = this.game.scoreManager;
    if (!scoreManager) return false;
    return scoreManager.score > scoreManager.highScore;
  }

  _drawSnake(snake, alpha, skin = 'classic') {
    if (!snake) return;

    // Visual state modifiers
    let needsRestore = false;
    if (this.game && this.game.waitingForInput) {
      const pulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this._frameTime * 0.006));
      this.ctx.save();
      this.ctx.globalAlpha = pulse;
      needsRestore = true;
    } else if (gameState.currentState === GameState.DYING) {
      const flash = Math.floor(this._frameTime / 100) % 2;
      if (flash === 1) {
        this.ctx.save();
        this.ctx.globalAlpha = 0.3;
        needsRestore = true;
      }
    } else if (this._isHighScoreBreathingActive()) {
      const pulse = 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(this._frameTime * 0.01));
      this.ctx.save();
      this.ctx.globalAlpha = pulse;
      needsRestore = true;
    }

    switch (skin) {
      case 'neon':
        this._drawNeonSnake(snake, alpha);
        break;
      case 'quantum':
        this._drawQuantumSnake(snake, alpha);
        break;
      case 'chrome':
        this._drawChromeSnake(snake, alpha);
        break;
      case 'void':
        this._drawVoidSnake(snake, alpha);
        break;
      default:
        this._drawClassicSnake(snake, alpha);
    }

    if (needsRestore) {
      this.ctx.restore();
    }
  }

  _drawClassicSnake(snake, alpha) {
    const t = typeof alpha === 'number' ? alpha : 1;
    const prevBody = Array.isArray(snake.prevBody) ? snake.prevBody : [];
    const gridSize = this.game && this.game.grid ? this.game.grid.size : GameConfig.map.defaultSize;
    const halfSize = gridSize / 2;
    const wrapWalls = this.game && this.game.grid ? this.game.grid.wrapWalls : false;

    this.ctx.fillStyle = this.colors.snakeBody;
    const bodyLen = snake.body.length;

    for (let i = 1; i < bodyLen; i++) {
      const segment = snake.body[i];
      const prev = prevBody[i] || segment;

      // [Fix P2] Handle wrapping interpolation (shortest path)
      let dx = segment.x - prev.x;
      let dy = segment.y - prev.y;

      if (wrapWalls) {
        if (Math.abs(dx) > halfSize) dx = dx > 0 ? dx - gridSize : dx + gridSize;
        if (Math.abs(dy) > halfSize) dy = dy > 0 ? dy - gridSize : dy + gridSize;
      }

      let ix = prev.x + dx * t;
      let iy = prev.y + dy * t;
      if (wrapWalls) {
        ix = ((ix % gridSize) + gridSize) % gridSize;
        iy = ((iy % gridSize) + gridSize) % gridSize;
      }
      // Taper tail: last few segments get smaller
      let padding = 1;
      const distFromTail = bodyLen - 1 - i;

      // Calculate max allowed padding to keep segment visible (at least 4px or 50% of cell)
      const minSegmentSize = Math.min(4, this.cellSize * 0.5);
      const maxPaddingAllowed = Math.max(0, (this.cellSize - minSegmentSize) / 2);

      if (distFromTail < 4) {
        // Base padding calculation
        const rawPadding = 2 + (4 - distFromTail) * 1.5;
        padding = Math.min(rawPadding, maxPaddingAllowed);
      }

      // Ensure global padding doesn't exceed visibility bounds
      padding = Math.min(padding, maxPaddingAllowed);

      this._drawCellAt(ix, iy, padding);
    }

    const head = snake.body[0];
    const prevHead = prevBody[0] || head;

    let hdx = head.x - prevHead.x;
    let hdy = head.y - prevHead.y;
    if (wrapWalls) {
      if (Math.abs(hdx) > halfSize) hdx = hdx > 0 ? hdx - gridSize : hdx + gridSize;
      if (Math.abs(hdy) > halfSize) hdy = hdy > 0 ? hdy - gridSize : hdy + gridSize;
    }

    let ix = prevHead.x + hdx * t;
    let iy = prevHead.y + hdy * t;
    if (wrapWalls) {
      ix = ((ix % gridSize) + gridSize) % gridSize;
      iy = ((iy % gridSize) + gridSize) % gridSize;
    }
    this.ctx.fillStyle = this.colors.snakeHead;
    this.ctx.shadowColor = this.colors.snakeHead;
    this.ctx.shadowBlur = 6;
    this._drawCellAt(ix, iy);
    this.ctx.shadowBlur = 0;

    // Draw Face Details
    if (snake.direction) {
      const cx = this.offsetX + ix * this.cellSize + this.cellSize / 2;
      const cy = this.offsetY + iy * this.cellSize + this.cellSize / 2;
      const size = this.cellSize;

      this.ctx.save();
      this.ctx.translate(cx, cy);

      // Rotate based on direction
      let angle = 0;
      if (snake.direction.x === 1) angle = 0;
      else if (snake.direction.x === -1) angle = Math.PI;
      else if (snake.direction.y === -1) angle = -Math.PI / 2;
      else if (snake.direction.y === 1) angle = Math.PI / 2;

      this.ctx.rotate(angle);

      // Eyes
      const eyeOffset = size * 0.25;
      const eyeSize = size * 0.12;

      this.ctx.fillStyle = '#FFF';
      this.ctx.beginPath();
      this.ctx.arc(size * 0.1, -eyeOffset, eyeSize, 0, Math.PI * 2);
      this.ctx.arc(size * 0.1, eyeOffset, eyeSize, 0, Math.PI * 2);
      this.ctx.fill();

      // Pupils
      this.ctx.fillStyle = '#000';
      const pupilSize = eyeSize * 0.5;
      this.ctx.beginPath();
      this.ctx.arc(size * 0.15, -eyeOffset, pupilSize, 0, Math.PI * 2);
      this.ctx.arc(size * 0.15, eyeOffset, pupilSize, 0, Math.PI * 2);
      this.ctx.fill();

      // Tongue (flick animation)
      const time = this._frameTime;
      if (Math.floor(time / 200) % 10 === 0) {
        this.ctx.strokeStyle = '#FF3333';
        this.ctx.lineWidth = Math.max(1, size * 0.05);
        this.ctx.lineCap = 'round';
        this.ctx.beginPath();
        this.ctx.moveTo(size * 0.3, 0);
        this.ctx.lineTo(size * 0.7, 0);
        // Fork
        this.ctx.lineTo(size * 0.9, -size * 0.15);
        this.ctx.moveTo(size * 0.7, 0);
        this.ctx.lineTo(size * 0.9, size * 0.15);
        this.ctx.stroke();
      }

      this.ctx.restore();
    }
  }

  _drawNeonSnake(snake, alpha) {
    const t = typeof alpha === 'number' ? alpha : 1;
    const prevBody = Array.isArray(snake.prevBody) ? snake.prevBody : [];
    const gridSize = this.game && this.game.grid ? this.game.grid.size : GameConfig.map.defaultSize;
    const halfSize = gridSize / 2;
    const wrapWalls = this.game && this.game.grid ? this.game.grid.wrapWalls : false;

    this.ctx.strokeStyle = '#00FF00';
    this.ctx.lineWidth = 2;
    this.ctx.shadowColor = '#00FF00';

    for (let i = 0; i < snake.body.length; i++) {
      // Only apply expensive shadowBlur to the head
      this.ctx.shadowBlur = i === 0 ? 4 : 0;
      const s = snake.body[i];
      const prev = prevBody[i] || s;

      let dx = s.x - prev.x;
      let dy = s.y - prev.y;
      if (wrapWalls) {
        if (Math.abs(dx) > halfSize) dx = dx > 0 ? dx - gridSize : dx + gridSize;
        if (Math.abs(dy) > halfSize) dy = dy > 0 ? dy - gridSize : dy + gridSize;
      }

      let ix = prev.x + dx * t;
      let iy = prev.y + dy * t;
      if (wrapWalls) {
        ix = ((ix % gridSize) + gridSize) % gridSize;
        iy = ((iy % gridSize) + gridSize) % gridSize;
      }
      const px = this.offsetX + ix * this.cellSize + 2;
      const py = this.offsetY + iy * this.cellSize + 2;
      let sx = px;
      let sy = py;
      // Avoid snapping interpolated movement to device pixels (can introduce visible jitter).
      if (Math.abs(ix - Math.round(ix)) < 1e-6 && Math.abs(iy - Math.round(iy)) < 1e-6) {
        sx = Math.round(px * this._scaleX) / this._scaleX;
        sy = Math.round(py * this._scaleY) / this._scaleY;
      }
      const size = this.cellSize - 4;
      this.ctx.strokeRect(sx, sy, size, size);

      if (i === 0) {
        this.ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
        this.ctx.fillRect(sx, sy, size, size);
      }
    }
    this.ctx.shadowBlur = 0;
  }

  _drawQuantumSnake(snake, alpha) {
    const t = typeof alpha === 'number' ? alpha : 1;
    const prevBody = Array.isArray(snake.prevBody) ? snake.prevBody : [];
    const gridSize = this.game && this.game.grid ? this.game.grid.size : GameConfig.map.defaultSize;
    const wrapWalls = this.game && this.game.grid ? this.game.grid.wrapWalls : false;
    const time = this._frameTime * 0.005;

    for (let i = 0; i < snake.body.length; i++) {
      const s = snake.body[i];
      const prev = prevBody[i] || s;
      const pos = this._lerpSegment(s, prev, t, gridSize, wrapWalls);
      const hue = (time * 50 + i * 10) % 360;
      const hueIndex = Math.floor(hue * 10) % 3600;
      const color = this._quantumHslCache[hueIndex] || `hsl(${hue}, 100%, 50%)`;
      this.ctx.fillStyle = color;
      this.ctx.shadowColor = color;
      this.ctx.shadowBlur = i === 0 ? 6 : 0;

      if (i > snake.body.length - 3) {
        this.ctx.globalAlpha = 0.5;
      }

      this._drawCellAt(pos.x, pos.y, 1);
      this.ctx.globalAlpha = 1.0;
    }
    this.ctx.shadowBlur = 0;
  }

  _drawChromeSnake(snake, alpha) {
    this._ensureChromeTiles();
    const tiles = this._chromeTiles;
    const bodyTile = tiles ? tiles.body : null;
    const headTile = tiles ? tiles.head : null;
    const t = typeof alpha === 'number' ? alpha : 1;
    const prevBody = Array.isArray(snake.prevBody) ? snake.prevBody : [];
    const gridSize = this.game && this.game.grid ? this.game.grid.size : GameConfig.map.defaultSize;
    const wrapWalls = this.game && this.game.grid ? this.game.grid.wrapWalls : false;

    for (let i = 0; i < snake.body.length; i++) {
      const s = snake.body[i];
      const prev = prevBody[i] || s;
      const pos = this._lerpSegment(s, prev, t, gridSize, wrapWalls);
      const px = this.offsetX + pos.x * this.cellSize;
      const py = this.offsetY + pos.y * this.cellSize;
      const size = this.cellSize;

      if (i === 0) {
        if (headTile) {
          this.ctx.drawImage(headTile, px, py, size, size);
        } else {
          this.ctx.fillStyle = '#A0A0A0';
          this.ctx.fillRect(px + 2, py + 2, size - 4, size - 4);
          this.ctx.fillStyle = '#FF0000';
          this.ctx.fillRect(px + size / 4, py + size / 4, size / 2, size / 2);
        }
      } else {
        if (bodyTile) {
          this.ctx.drawImage(bodyTile, px, py, size, size);
        } else {
          this.ctx.fillStyle = '#A0A0A0';
          this.ctx.fillRect(px + 1, py + 1, size - 2, size - 2);
        }
      }
    }
  }

  _drawVoidSnake(snake, alpha) {
    const t = typeof alpha === 'number' ? alpha : 1;
    const prevBody = Array.isArray(snake.prevBody) ? snake.prevBody : [];
    const gridSize = this.game && this.game.grid ? this.game.grid.size : GameConfig.map.defaultSize;
    const wrapWalls = this.game && this.game.grid ? this.game.grid.wrapWalls : false;

    this.ctx.fillStyle = '#1A0033';
    this.ctx.strokeStyle = '#E0E0E0';
    this.ctx.lineWidth = 1;

    for (let i = 0; i < snake.body.length; i++) {
      const s = snake.body[i];
      const prev = prevBody[i] || s;
      const pos = this._lerpSegment(s, prev, t, gridSize, wrapWalls);
      const px = this.offsetX + pos.x * this.cellSize;
      const py = this.offsetY + pos.y * this.cellSize;

      this.ctx.fillRect(px, py, this.cellSize, this.cellSize);
      this.ctx.strokeRect(px + 2, py + 2, this.cellSize - 4, this.cellSize - 4);

      if (i === 0) {
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.shadowColor = '#FFFFFF';
        this.ctx.shadowBlur = 10;
        this.ctx.fillRect(px + 4, py + 4, this.cellSize - 8, this.cellSize - 8);
        this.ctx.shadowBlur = 0;
        this.ctx.fillStyle = '#1A0033';
      }
    }
  }

  /**
   * Interpolate a segment position with wrap-aware shortest-path logic.
   * @param {{x:number,y:number}} curr
   * @param {{x:number,y:number}} prev
   * @param {number} t - alpha [0,1]
   * @param {number} gridSize
   * @param {boolean} wrapWalls
   * @returns {{x:number,y:number}}
   */
  _lerpSegment(curr, prev, t, gridSize, wrapWalls) {
    let dx = curr.x - prev.x;
    let dy = curr.y - prev.y;
    if (wrapWalls) {
      const half = gridSize / 2;
      if (Math.abs(dx) > half) dx = dx > 0 ? dx - gridSize : dx + gridSize;
      if (Math.abs(dy) > half) dy = dy > 0 ? dy - gridSize : dy + gridSize;
    }
    let ix = prev.x + dx * t;
    let iy = prev.y + dy * t;
    if (wrapWalls) {
      ix = ((ix % gridSize) + gridSize) % gridSize;
      iy = ((iy % gridSize) + gridSize) % gridSize;
    }
    this._lerpResult.x = ix;
    this._lerpResult.y = iy;
    return this._lerpResult;
  }

  _drawCell(x, y, padding = 0) {
    const px = this.offsetX + x * this.cellSize + padding;
    const py = this.offsetY + y * this.cellSize + padding;
    const size = this.cellSize - padding * 2;
    this.ctx.fillRect(px, py, size, size);
  }

  _drawCellAt(x, y, padding = 0) {
    const px = this.offsetX + x * this.cellSize + padding;
    const py = this.offsetY + y * this.cellSize + padding;
    const size = this.cellSize - padding * 2;
    let sx = px;
    let sy = py;
    // Avoid snapping interpolated movement to device pixels (can introduce visible jitter).
    if (Math.abs(x - Math.round(x)) < 1e-6 && Math.abs(y - Math.round(y)) < 1e-6) {
      sx = Math.round(px * this._scaleX) / this._scaleX;
      sy = Math.round(py * this._scaleY) / this._scaleY;
    }
    this.ctx.fillRect(sx, sy, size, size);
  }
}
