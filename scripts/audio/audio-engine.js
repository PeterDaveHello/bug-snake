// @ts-check
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.masterVolume = 1;
    this.musicVolume = 0.35;
    this.sfxVolume = 0.6;
    this.musicEnabled = true;
    this.musicNodes = null;
    this.musicGain = null;
    this.musicNeedsGesture = false;
    this.musicTimer = null;
    this.musicSchedulerMs = 25;
    this.musicScheduleAheadSec = 0.5;
    this.musicNextTime = 0;
    this.musicStep = 0;
    this.musicPattern = [0, 3, 5, 7, 10, 7, 5, 3];
    this.currentPattern = [...this.musicPattern]; // Clone for mutation
    this.musicRootHz = 220;
    this.musicTempoMs = 300; // Slightly faster for groove
    this.musicProfileKey = '';
    this.scale = [0, 3, 5, 7, 10, 12, 15]; // Minor Pentatonic Extended

    // FX Nodes
    this.compressor = null;
    this.delayNode = null;
    this.delayGain = null;

    // Pre-allocated noise buffers (for CPU optimization)
    this.noiseBuffers = {
      short: null, // ~50ms for hi-hat
      medium: null, // ~100ms for general SFX
      long: null // ~300ms for sweeps
    };

    // Beat Clock System
    this.beatStartTime = 0; // AudioContext time when music started
    this.beatsPerMeasure = 4;
    this.subdivisionsPerBeat = 4; // 16th notes
    this.currentBeat = 0;
    this.currentMeasure = 0;

    // Harmony State
    this.chordProgression = [
      [0, 3, 7], // i   (minor)
      [5, 8, 12], // iv  (minor)
      [7, 10, 14], // v   (minor)
      [0, 3, 7] // i   (minor)
    ];
    this.currentChordIndex = 0;
    this.measuresPerChord = 2;

    // Music Layers
    this.padNodes = null;
    this.padGain = null;
    this.rhythmEnabled = true;
    this.layerIntensity = 0.5; // 0-1, controls how many layers are active

    // Rhythm patterns (1 = hit, 0 = rest) - 16th note grid
    this.rhythmPatterns = {
      hihat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0], // 8th notes
      hihatBusy: [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0], // Busier pattern
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0] // On 1 and 3
    };
    this.currentRhythmPattern = 'hihat';

    // Combo system for escalating sounds
    this.combo = 0;
    this.comboDecayTimer = null;
    this.comboDecayMs = 2000; // Reset combo after 2s of no eating
    this.maxCombo = 12; // Maximum combo level for pitch scaling

    // Snake context for dynamic sounds
    this.snakeLength = 3;

    // Melodic Motif Library
    this.motifs = {
      roach: [
        [0, 4, 7], // Major triad up
        [0, 3, 7], // Minor triad up
        [0, 5, 7], // Sus4 up
        [7, 4, 0] // Major triad down
      ],
      ant: [
        [12, 7], // Quick fifth down
        [12, 10], // Quick minor 3rd down
        [0, 5], // Quick fourth up
        [7, 12] // Quick fifth up
      ],
      mosquito: [
        [7, 12, 7], // Neighbor tone
        [5, 7, 5], // Lower neighbor
        [0, 3, 0], // Minor 3rd back
        [12, 7, 12] // High neighbor
      ],
      collect: [
        [0, 7, 12], // Power chord up
        [0, 4, 7, 12], // Extended major
        [0, 3, 7, 10] // Minor 7th
      ]
    };
    this.lastMotifIndex = { roach: -1, ant: -1, mosquito: -1, collect: -1 };
  }

  init() {
    if (this.ctx) return;

    const win =
      /** @type {Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }} */ (
        window
      );
    const AudioContextCtor = win.AudioContext || win.webkitAudioContext;
    if (AudioContextCtor) {
      try {
        this.ctx = new AudioContextCtor();
      } catch (e) {
        console.warn('AudioContext creation failed:', e);
        return;
      }

      // Master Chain: MasterGain -> Compressor -> Destination
      //                             |-> Delay ->|

      this.gainNode = this.ctx.createGain();
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -24;
      this.compressor.knee.value = 30;
      this.compressor.ratio.value = 12;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.25;

      // Delay Effect (Retro Echo)
      this.delayNode = this.ctx.createDelay();
      this.delayNode.delayTime.value = 0.33; // Synced roughly to tempo
      this.delayGain = this.ctx.createGain();
      this.delayGain.gain.value = 0.3; // 30% feedback

      // Wiring
      this.gainNode.connect(this.compressor);

      // Delay Loop
      this.compressor.connect(this.delayNode);
      this.delayNode.connect(this.delayGain);
      this.delayGain.connect(this.delayNode); // Feedback loop
      this.delayNode.connect(this.ctx.destination);

      this.compressor.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.connect(this.gainNode);

      // Pre-allocate noise buffers (avoids GC during gameplay)
      this._initNoiseBuffers();

      this._updateGain();
      this._updateMusicGain();
    }
  }

  _initNoiseBuffers() {
    if (!this.ctx) return;
    const sampleRate = this.ctx.sampleRate;

    // Create buffers of different lengths
    const lengths = {
      short: Math.floor(sampleRate * 0.08), // 80ms
      medium: Math.floor(sampleRate * 0.15), // 150ms
      long: Math.floor(sampleRate * 0.4) // 400ms
    };

    for (const [key, length] of Object.entries(lengths)) {
      const buffer = this.ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffers[key] = buffer;
    }
  }

  play(type, options = {}) {
    if (!this.ctx || this.isMuted) return;
    if (this.ctx.state === 'suspended') {
      const resumePromise = this.ctx.resume();
      if (resumePromise && typeof resumePromise.then === 'function') {
        resumePromise
          .then(() => {
            if (this.musicEnabled && this.musicNeedsGesture) {
              this.startMusic();
            }
          })
          .catch(() => {
            // Ignore resume failures; UI should notify if needed
          });
      }
    } else if (this.musicEnabled && this.musicNeedsGesture) {
      this.startMusic();
    }

    switch (type) {
      // Food-specific sounds with combo system
      case 'eat_roach':
        this._incrementCombo();
        this._playRoachSound();
        break;
      case 'eat_ant':
        this._incrementCombo();
        this._playAntSound();
        break;
      case 'eat_mosquito':
        this._incrementCombo();
        this._playMosquitoSound();
        break;
      case 'eat_egg':
        this._incrementCombo();
        this._playEggSound();
        break;
      case 'eat_mouse':
        this._incrementCombo();
        this._playMouseSound();
        break;
      case 'eat':
        // Generic eat (fallback)
        this._incrementCombo();
        this._playCollectSound();
        break;

      // Bad items (trash is alias for eat_bad)
      case 'eat_bad':
      case 'trash':
        this._resetCombo();
        this._playCrunchSound();
        break;
      case 'poison':
        this._resetCombo();
        this._playPoisonSound();
        break;

      // Game events
      case 'die':
        this._playGameOverSound();
        break;
      case 'level_clear':
        this._playLevelClear();
        break;
      case 'combo_break':
        this._playComboBreak();
        break;

      // UI sounds
      case 'ui':
        this._playUIClick();
        break;
      case 'ui_start':
        this._playUIStart();
        break;
      case 'ui_back':
        this._playUIBack();
        break;
      case 'ui_toggle':
        this._playUIToggle(options.enabled);
        break;
    }
  }

  // Update snake length for dynamic sound variations
  setSnakeLength(length) {
    this.snakeLength = length;
    // Update music intensity based on snake length
    this._updateMusicIntensity();
  }

  // ========== ADAPTIVE MUSIC SYSTEM ==========

  // Set overall game intensity (0-1)
  setGameIntensity(intensity) {
    this.layerIntensity = Math.max(0, Math.min(1, intensity));
    this._applyIntensity();
  }

  // Automatically calculate intensity from game state
  _updateMusicIntensity() {
    // Base intensity from snake length (longer = more intense)
    const lengthFactor = Math.min(1, (this.snakeLength - 3) / 30);

    // Combo factor (higher combo = more intense)
    const comboFactor = this.combo / this.maxCombo;

    // Combined intensity (weighted average)
    const intensity = lengthFactor * 0.6 + comboFactor * 0.4;

    this.layerIntensity = Math.max(0.2, Math.min(1, intensity));
    this._applyIntensity();
  }

  // Apply current intensity to music layers
  _applyIntensity() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Pad volume scales with intensity
    if (this.padGain) {
      const padVol = this.musicVolume * (0.15 + this.layerIntensity * 0.2);
      this.padGain.gain.setTargetAtTime(padVol, now, 0.5);
    }

    // Pad filter opens with intensity (brighter at high intensity)
    if (this.padNodes && this.padNodes.filter) {
      const filterFreq = 400 + this.layerIntensity * 800;
      this.padNodes.filter.frequency.setTargetAtTime(filterFreq, now, 0.5);
    }

    // Switch rhythm pattern based on intensity
    if (this.layerIntensity > 0.7) {
      this.currentRhythmPattern = 'hihatBusy';
    } else {
      this.currentRhythmPattern = 'hihat';
    }
  }

  /**
   * @param {{ seed: number, density: number, template: string, size: number }} profile
   */
  setMusicProfile(profile) {
    const profileKey = `${profile.template}:${profile.size}:${profile.density}:${profile.seed}`;
    if (profileKey === this.musicProfileKey) return;
    this.musicProfileKey = profileKey;

    const seededRand = this._createSeededRandom(this._hashMusicProfile(profile));
    const densityBoost = Math.min(1, Math.max(0, profile.density * 6));
    const sizeBoost = Math.min(1, Math.max(0, (profile.size - 16) / 32));

    this.musicRootHz = 190 + Math.floor(seededRand() * 70) + Math.floor(sizeBoost * 30);
    this.musicTempoMs = 320 - Math.floor(densityBoost * 50) + Math.floor(seededRand() * 20);

    const basePattern = [0, 3, 5, 7, 10, 7, 5, 3];
    const nextPattern = [...basePattern];
    for (let i = 0; i < nextPattern.length; i += 1) {
      if (seededRand() > 0.6) {
        const scaleIndex = Math.floor(seededRand() * this.scale.length);
        nextPattern[i] = this.scale[scaleIndex];
      }
    }
    if (seededRand() > 0.5) {
      nextPattern.reverse();
    }

    this.musicPattern = nextPattern;
    this.currentPattern = [...this.musicPattern];

    if (this.musicNodes && this.ctx) {
      this.musicNodes.osc1.frequency.setValueAtTime(this.musicRootHz, this.ctx.currentTime);
      this.musicNodes.osc2.frequency.setValueAtTime(this.musicRootHz * 2, this.ctx.currentTime);
      this._restartMusicSequence();
    }
  }

  _incrementCombo() {
    this.combo = Math.min(this.combo + 1, this.maxCombo);
    // Reset decay timer
    if (this.comboDecayTimer) {
      clearTimeout(this.comboDecayTimer);
    }
    this.comboDecayTimer = setTimeout(() => {
      if (this.combo > 3) {
        this.play('combo_break');
      }
      this.combo = 0;
      this._updateMusicIntensity();
    }, this.comboDecayMs);

    // Update music intensity with new combo
    this._updateMusicIntensity();

    // Play combo milestone sounds
    if (this.combo === 5) {
      this._playComboMilestone(5);
    } else if (this.combo === 10) {
      this._playComboMilestone(10);
    }
  }

  _resetCombo() {
    if (this.comboDecayTimer) {
      clearTimeout(this.comboDecayTimer);
      this.comboDecayTimer = null;
    }
    this.combo = 0;
    this._updateMusicIntensity();
  }

  // Get pitch multiplier based on combo
  _getComboPitch() {
    // Pitch rises with combo: 1.0 -> 1.5 over maxCombo
    return 1.0 + (this.combo / this.maxCombo) * 0.5;
  }

  // Get slight random variation to prevent repetition
  _getVariation(range = 0.1) {
    return 1.0 + (Math.random() - 0.5) * range * 2;
  }

  // Get bass boost factor based on snake length (longer snake = more bass)
  _getSnakeBassBoost() {
    // Returns 0.0 to 1.0 based on snake length (3 to ~50)
    const normalized = Math.min(1.0, (this.snakeLength - 3) / 40);
    return normalized;
  }

  // ========== BEAT CLOCK SYSTEM ==========

  // Get current beat timing information
  getBeatInfo(atTime = null) {
    if (!this.ctx || !this.beatStartTime) {
      return { beat: 0, measure: 0, subdivision: 0, phase: 0 };
    }
    const now = atTime !== null ? atTime : this.ctx.currentTime;
    const beatDuration = this.musicTempoMs / 1000;
    const elapsed = now - this.beatStartTime;

    const totalBeats = elapsed / beatDuration;
    const measure = Math.floor(totalBeats / this.beatsPerMeasure);
    const beat = Math.floor(totalBeats) % this.beatsPerMeasure;
    const subdivision = Math.floor((totalBeats % 1) * this.subdivisionsPerBeat);
    const phase = totalBeats % 1; // 0-1 within current beat

    return { beat, measure, subdivision, phase, totalBeats };
  }

  // Get AudioContext time for the next subdivision (for quantization)
  getNextSubdivisionTime(subdivisionSize = 1) {
    if (!this.ctx) return 0;
    const now = this.ctx.currentTime;
    if (!this.beatStartTime) return now;

    const beatDuration = this.musicTempoMs / 1000;
    const subDuration = (beatDuration / this.subdivisionsPerBeat) * subdivisionSize;
    const elapsed = now - this.beatStartTime;
    const currentSub = Math.floor(elapsed / subDuration);
    const nextSubTime = this.beatStartTime + (currentSub + 1) * subDuration;

    // If next subdivision is too far away (>100ms), just play now
    const delay = nextSubTime - now;
    if (delay > 0.1) {
      return now;
    }
    return nextSubTime;
  }

  // Get delay until next subdivision (for setTimeout-based scheduling)
  getQuantizeDelay(subdivisionSize = 1) {
    if (!this.ctx) return 0;
    const nextTime = this.getNextSubdivisionTime(subdivisionSize);
    const delay = Math.max(0, (nextTime - this.ctx.currentTime) * 1000);
    return delay;
  }

  // ========== HARMONY STATE ==========

  // Get current chord notes (as semitones from root)
  getCurrentChord() {
    return this.chordProgression[this.currentChordIndex] || this.chordProgression[0];
  }

  // Advance chord based on measure
  _updateChord(atTime = null) {
    const { measure } = this.getBeatInfo(atTime);
    const newChordIndex =
      Math.floor(measure / this.measuresPerChord) % this.chordProgression.length;
    if (newChordIndex !== this.currentChordIndex) {
      this.currentChordIndex = newChordIndex;
      // Update pad layer to match new chord
      this._updatePadChord(atTime);
    }
  }

  // Get a note that harmonizes with current chord
  getHarmonicNote(preferredOctave = 0) {
    const chord = this.getCurrentChord();
    const noteIndex = Math.floor(Math.random() * chord.length);
    return chord[noteIndex] + preferredOctave * 12;
  }

  // Check if a semitone is in the current chord
  isInCurrentChord(semitone) {
    const chord = this.getCurrentChord();
    const normalizedSemitone = ((semitone % 12) + 12) % 12;
    return chord.some((note) => ((note % 12) + 12) % 12 === normalizedSemitone);
  }

  // Snap a semitone to the nearest chord tone
  snapToChord(semitone) {
    const chord = this.getCurrentChord();
    const octave = Math.floor(semitone / 12);
    const note = ((semitone % 12) + 12) % 12;

    let closest = chord[0];
    let minDistance = 12;
    for (const chordNote of chord) {
      const normalizedChordNote = ((chordNote % 12) + 12) % 12;
      const distance = Math.min(
        Math.abs(note - normalizedChordNote),
        Math.abs(note - normalizedChordNote + 12),
        Math.abs(note - normalizedChordNote - 12)
      );
      if (distance < minDistance) {
        minDistance = distance;
        closest = normalizedChordNote;
      }
    }
    return octave * 12 + closest;
  }

  // ========== MOTIF PLAYBACK ==========

  // Get a motif, avoiding immediate repetition
  _getMotif(type) {
    const motifList = this.motifs[type];
    if (!motifList || motifList.length === 0) return [0];

    // Avoid repeating the same motif twice in a row
    let index;
    do {
      index = Math.floor(Math.random() * motifList.length);
    } while (index === this.lastMotifIndex[type] && motifList.length > 1);

    this.lastMotifIndex[type] = index;
    return motifList[index];
  }

  // Play a melodic motif with harmony adaptation
  _playMotif(type, baseOctave = 1, noteSpacing = 0.06, options = {}) {
    if (!this.ctx) return;

    const motif = this._getMotif(type);
    const comboPitch = this._getComboPitch();
    const startTime = this.getNextSubdivisionTime(1);
    const volume = options.volume || 0.5;
    const waveform = options.waveform || 'sine';
    const decay = options.decay || 0.15;

    motif.forEach((semitone, i) => {
      // Apply harmony: snap to current chord if enabled
      const harmonized = options.harmonize ? this.snapToChord(semitone) : semitone;
      const finalSemitone = harmonized + baseOctave * 12;
      const freq = this.musicRootHz * Math.pow(2, finalSemitone / 12) * comboPitch;

      this._playMotifNote(freq, startTime + i * noteSpacing, decay, volume, waveform);
    });

    // Add extra notes for high combo
    if (this.combo >= 8 && motif.length < 4) {
      const extraNote = this.getHarmonicNote(baseOctave + 1);
      const freq = this.musicRootHz * Math.pow(2, extraNote / 12) * comboPitch;
      this._playMotifNote(
        freq,
        startTime + motif.length * noteSpacing,
        decay * 1.5,
        volume * 0.7,
        waveform
      );
    }
  }

  // Play a single note in a motif
  _playMotifNote(freq, startTime, decay, volume, waveform) {
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = waveform;
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(this.sfxVolume * volume, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.01, startTime + decay);

    osc.connect(gain);
    gain.connect(this.gainNode);

    osc.start(startTime);
    osc.stop(startTime + decay + 0.01);
  }

  // Add a sub-bass layer for longer snakes
  _playSnakeBassLayer(baseFreq = 60) {
    if (!this.ctx) return;
    const bassBoost = this._getSnakeBassBoost();
    if (bassBoost < 0.15) return; // Skip for short snakes

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.5, now + 0.1);

    gain.gain.setValueAtTime(this.sfxVolume * bassBoost * 0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

    osc.connect(gain);
    gain.connect(this.gainNode);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  // Generic collect sound with melodic motif
  _playCollectSound() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const comboPitch = this._getComboPitch();

    // FM bell for shimmer
    const chordNote = this.getHarmonicNote(2);
    const baseFreq = this.musicRootHz * Math.pow(2, chordNote / 12) * comboPitch;

    const carrier = this.ctx.createOscillator();
    const modulator = this.ctx.createOscillator();
    const modGain = this.ctx.createGain();
    const masterGain = this.ctx.createGain();

    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(baseFreq, now);
    modulator.type = 'triangle';
    modulator.frequency.setValueAtTime(baseFreq * 2.0, now);

    modGain.gain.setValueAtTime(baseFreq * 1.2, now);
    modGain.gain.exponentialRampToValueAtTime(0.1, now + 0.25);

    modulator.connect(modGain);
    modGain.connect(carrier.frequency);

    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(this.sfxVolume * 0.6, now + 0.01);
    masterGain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

    carrier.connect(masterGain);
    masterGain.connect(this.gainNode);

    carrier.start(now);
    modulator.start(now);
    carrier.stop(now + 0.3);
    modulator.stop(now + 0.3);

    // Melodic motif layer
    this._playMotif('collect', 2, 0.05, {
      volume: 0.4,
      waveform: 'triangle',
      decay: 0.15,
      harmonize: true
    });
  }

  // ROACH: Satisfying crunch/chomp with melodic motif
  _playRoachSound() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const comboPitch = this._getComboPitch();
    const variation = this._getVariation(0.15);

    // Layer 1: Bass thump (body of the roach)
    const bassOsc = this.ctx.createOscillator();
    const bassGain = this.ctx.createGain();
    bassOsc.type = 'sine';
    const bassFreq = 80 * variation * comboPitch;
    bassOsc.frequency.setValueAtTime(bassFreq, now);
    bassOsc.frequency.exponentialRampToValueAtTime(40, now + 0.15);
    bassGain.gain.setValueAtTime(this.sfxVolume * 0.7, now);
    bassGain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    bassOsc.connect(bassGain);
    bassGain.connect(this.gainNode);
    bassOsc.start(now);
    bassOsc.stop(now + 0.15);

    // Layer 2: Short noise burst for crunch texture
    this._playNoise(0.06, 0.2);

    // Layer 3: Melodic motif (quantized to beat, harmonized)
    this._playMotif('roach', 2, 0.05, {
      volume: 0.5,
      waveform: 'triangle',
      decay: 0.18,
      harmonize: true
    });

    // Layer 4: Extra bass for longer snakes
    this._playSnakeBassLayer(50);
  }

  // ANT: Quick, light melodic pip
  _playAntSound() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const comboPitch = this._getComboPitch();

    // Quick sparkle attack
    const sparkleOsc = this.ctx.createOscillator();
    const sparkleGain = this.ctx.createGain();
    sparkleOsc.type = 'sine';
    sparkleOsc.frequency.setValueAtTime(2000 * comboPitch, now);
    sparkleOsc.frequency.exponentialRampToValueAtTime(1500, now + 0.05);
    sparkleGain.gain.setValueAtTime(this.sfxVolume * 0.2, now);
    sparkleGain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
    sparkleOsc.connect(sparkleGain);
    sparkleGain.connect(this.gainNode);
    sparkleOsc.start(now);
    sparkleOsc.stop(now + 0.05);

    // Melodic motif - fast, high pitched
    this._playMotif('ant', 3, 0.035, {
      volume: 0.45,
      waveform: 'sine',
      decay: 0.1,
      harmonize: true
    });

    // Subtle bass for longer snakes
    this._playSnakeBassLayer(80);
  }

  // MOSQUITO: Buzzy slap with melodic motif
  _playMosquitoSound() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const comboPitch = this._getComboPitch();
    const variation = this._getVariation(0.15);

    // Layer 1: Quick buzz (mosquito body)
    const buzzOsc = this.ctx.createOscillator();
    const buzzGain = this.ctx.createGain();
    const buzzFilter = this.ctx.createBiquadFilter();
    buzzOsc.type = 'sawtooth';
    buzzOsc.frequency.setValueAtTime(180 * variation, now);
    // Rapid vibrato for buzz effect
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 40;
    lfoGain.gain.value = 30;
    lfo.connect(lfoGain);
    lfoGain.connect(buzzOsc.frequency);
    buzzFilter.type = 'bandpass';
    buzzFilter.frequency.value = 300;
    buzzFilter.Q.value = 3;
    buzzGain.gain.setValueAtTime(this.sfxVolume * 0.3, now);
    buzzGain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
    buzzOsc.connect(buzzFilter);
    buzzFilter.connect(buzzGain);
    buzzGain.connect(this.gainNode);
    lfo.start(now);
    buzzOsc.start(now);
    lfo.stop(now + 0.08);
    buzzOsc.stop(now + 0.08);

    // Layer 2: Slap/pop sound
    const slapOsc = this.ctx.createOscillator();
    const slapGain = this.ctx.createGain();
    slapOsc.type = 'triangle';
    slapOsc.frequency.setValueAtTime(500 * comboPitch, now);
    slapOsc.frequency.exponentialRampToValueAtTime(200, now + 0.04);
    slapGain.gain.setValueAtTime(this.sfxVolume * 0.5, now);
    slapGain.gain.exponentialRampToValueAtTime(0.01, now + 0.06);
    slapOsc.connect(slapGain);
    slapGain.connect(this.gainNode);
    slapOsc.start(now);
    slapOsc.stop(now + 0.06);

    // Layer 3: Melodic neighbor-tone motif
    this._playMotif('mosquito', 2, 0.04, {
      volume: 0.45,
      waveform: 'sine',
      decay: 0.12,
      harmonize: true
    });

    // Subtle bass for longer snakes
    this._playSnakeBassLayer(70);
  }

  // EGG: Soft crack/pop sound
  _playEggSound() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const comboPitch = this._getComboPitch();

    // Crack sound - short noise burst
    const noiseBuffer = this.noiseBuffers.short;
    if (noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      const noiseGain = this.ctx.createGain();
      const noiseFilter = this.ctx.createBiquadFilter();
      noiseFilter.type = 'highpass';
      noiseFilter.frequency.value = 2000;
      noiseGain.gain.setValueAtTime(this.sfxVolume * 0.3, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(this.gainNode);
      noise.start(now);
      noise.stop(now + 0.05);
    }

    // Soft pop tone
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600 * comboPitch, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.08);
    gain.gain.setValueAtTime(this.sfxVolume * 0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    osc.connect(gain);
    gain.connect(this.gainNode);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  // MOUSE: Squeak sound
  _playMouseSound() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const comboPitch = this._getComboPitch();
    const variation = this._getVariation(0.1);

    // High pitched squeak with vibrato
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200 * comboPitch * variation, now);
    osc.frequency.exponentialRampToValueAtTime(800 * comboPitch, now + 0.15);

    // Add vibrato
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 25;
    lfoGain.gain.value = 80;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    gain.gain.setValueAtTime(this.sfxVolume * 0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    osc.connect(gain);
    gain.connect(this.gainNode);
    lfo.start(now);
    osc.start(now);
    lfo.stop(now + 0.15);
    osc.stop(now + 0.15);

    // Second shorter squeak
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1400 * comboPitch, now + 0.08);
    osc2.frequency.exponentialRampToValueAtTime(1000 * comboPitch, now + 0.15);
    gain2.gain.setValueAtTime(0, now);
    gain2.gain.setValueAtTime(this.sfxVolume * 0.25, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    osc2.connect(gain2);
    gain2.connect(this.gainNode);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.15);
  }

  // POISON: Ominous, unsettling sound
  _playPoisonSound() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Dissonant chord
    const freqs = [120, 127, 180]; // Minor second cluster
    freqs.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.5, now + 0.4);
      gain.gain.setValueAtTime(this.sfxVolume * 0.4, now + i * 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
      osc.connect(gain);
      gain.connect(this.gainNode);
      osc.start(now + i * 0.02);
      osc.stop(now + 0.4);
    });

    // Noise sweep
    this._playFilteredNoise(0.3, 800, 100, 0.5);
  }

  // Filtered noise sweep (for dramatic effects)
  _playFilteredNoise(duration, startFreq, endFreq, volumeMod = 1.0) {
    if (!this.ctx) return;

    // Select appropriate pre-allocated buffer
    const buffer = duration <= 0.2 ? this.noiseBuffers.medium : this.noiseBuffers.long;
    if (!buffer) return;

    const now = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(startFreq, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 20), now + duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(this.sfxVolume * volumeMod, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.gainNode);

    noise.start(now);
    noise.stop(now + duration);
  }

  _playComboMilestone(level) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Use current chord for harmonic coherence
    const chord = this.getCurrentChord();
    const baseOctave = 2;
    const intervals =
      level === 5
        ? [chord[0], chord[1], chord[2], chord[0] + 12]
        : [chord[0], chord[1], chord[2], chord[0] + 12, chord[1] + 12, chord[2] + 12];

    intervals.forEach((semitone, i) => {
      const freq = this.musicRootHz * Math.pow(2, (semitone + baseOctave * 12) / 12);
      this._playToneAtTime(freq, 'sine', 0.2, now + i * 0.05);
    });
  }

  // Combo break - descending arpeggio
  _playComboBreak() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Descending minor arpeggio from current root
    const descendingNotes = [12, 7, 3, 0, -5];

    descendingNotes.forEach((semitone, i) => {
      const freq = this.musicRootHz * Math.pow(2, (semitone + 12) / 12);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.value = freq;

      const startT = now + i * 0.06;
      gain.gain.setValueAtTime(0, startT);
      gain.gain.linearRampToValueAtTime(this.sfxVolume * 0.25, startT + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.01, startT + 0.12);

      osc.connect(gain);
      gain.connect(this.gainNode);
      osc.start(startT);
      osc.stop(startT + 0.12);
    });
  }

  // UI SOUNDS

  // Generic click
  _playUIClick() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const variation = this._getVariation(0.05);

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800 * variation, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.04);

    gain.gain.setValueAtTime(this.sfxVolume * 0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);

    osc.connect(gain);
    gain.connect(this.gainNode);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  // Game start - energetic ascending using current key
  _playUIStart() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Ascending pentatonic from music root
    const startNotes = [0, 3, 7, 12, 15];

    startNotes.forEach((semitone, i) => {
      const freq = this.musicRootHz * Math.pow(2, (semitone + 12) / 12);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.05);
      gain.gain.linearRampToValueAtTime(this.sfxVolume * 0.35, now + i * 0.05 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.05 + 0.12);
      osc.connect(gain);
      gain.connect(this.gainNode);
      osc.start(now + i * 0.05);
      osc.stop(now + i * 0.05 + 0.12);
    });
  }

  // Back/cancel - descending
  _playUIBack() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(500, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.1);

    gain.gain.setValueAtTime(this.sfxVolume * 0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);

    osc.connect(gain);
    gain.connect(this.gainNode);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  // Toggle on/off
  _playUIToggle(enabled) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    if (enabled) {
      // On - ascending
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);
    } else {
      // Off - descending
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.08);
    }

    gain.gain.setValueAtTime(this.sfxVolume * 0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

    osc.connect(gain);
    gain.connect(this.gainNode);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  // Gritty sound for bad items - VARIED
  _playCrunchSound() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Randomize pitch and decay slightly
    const startPitch = 150 + Math.random() * 50;
    const decay = 0.15 + Math.random() * 0.1;

    // 1. Low Sawtooth
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(startPitch, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + decay);

    gain.gain.setValueAtTime(this.sfxVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + decay);

    osc.connect(gain);
    gain.connect(this.gainNode);
    osc.start(now);
    osc.stop(now + decay);

    // 2. Short Noise Burst
    this._playNoise(decay * 0.8, 0.4);
  }

  _playGameOverSound() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Reset combo on death
    this._resetCombo();

    // Layer 1: Main power-down sweep
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 1.2);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(4000, now);
    filter.frequency.exponentialRampToValueAtTime(80, now + 1.0);

    gain.gain.setValueAtTime(this.sfxVolume * 0.8, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 1.2);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.gainNode);
    osc.start(now);
    osc.stop(now + 1.2);

    // Layer 2: Dissonant chord stab
    const chordFreqs = [150, 159, 200]; // Ugly cluster
    chordFreqs.forEach((freq, i) => {
      const chordOsc = this.ctx.createOscillator();
      const chordGain = this.ctx.createGain();
      chordOsc.type = 'square';
      chordOsc.frequency.setValueAtTime(freq, now);
      chordOsc.frequency.exponentialRampToValueAtTime(freq * 0.3, now + 0.8);
      chordGain.gain.setValueAtTime(this.sfxVolume * 0.25, now);
      chordGain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
      chordOsc.connect(chordGain);
      chordGain.connect(this.gainNode);
      chordOsc.start(now + i * 0.015);
      chordOsc.stop(now + 0.8);
    });

    // Layer 3: Impact thump
    const thumpOsc = this.ctx.createOscillator();
    const thumpGain = this.ctx.createGain();
    thumpOsc.type = 'sine';
    thumpOsc.frequency.setValueAtTime(60, now);
    thumpOsc.frequency.exponentialRampToValueAtTime(20, now + 0.3);
    thumpGain.gain.setValueAtTime(this.sfxVolume, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    thumpOsc.connect(thumpGain);
    thumpGain.connect(this.gainNode);
    thumpOsc.start(now);
    thumpOsc.stop(now + 0.3);

    // Layer 4: Noise burst (crash)
    this._playFilteredNoise(0.4, 2000, 200, 0.6);

    // Layer 5: Sad descending notes (delayed)
    const sadNotes = [330, 294, 262, 220];
    sadNotes.forEach((freq, i) => {
      const noteOsc = this.ctx.createOscillator();
      const noteGain = this.ctx.createGain();
      noteOsc.type = 'triangle';
      noteOsc.frequency.value = freq;
      const startT = now + 0.4 + i * 0.15;
      noteGain.gain.setValueAtTime(0, startT);
      noteGain.gain.linearRampToValueAtTime(this.sfxVolume * 0.3, startT + 0.02);
      noteGain.gain.exponentialRampToValueAtTime(0.01, startT + 0.2);
      noteOsc.connect(noteGain);
      noteGain.connect(this.gainNode);
      noteOsc.start(startT);
      noteOsc.stop(startT + 0.2);
    });
  }

  _playLevelClear() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Use current music root for coherence - major arpeggio
    const majorArpeggio = [0, 4, 7, 12, 16, 19, 24];
    const baseOctave = 1;

    majorArpeggio.forEach((semitone, i) => {
      const freq = this.musicRootHz * Math.pow(2, (semitone + baseOctave * 12) / 12);
      this._playToneAtTime(freq, 'triangle', 0.35, now + i * 0.07);
    });

    // Add a final shimmer chord
    const chordTime = now + majorArpeggio.length * 0.07;
    [0, 4, 7, 12].forEach((semitone, i) => {
      const freq = this.musicRootHz * Math.pow(2, (semitone + (baseOctave + 1) * 12) / 12);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = (i - 1.5) * 3; // Slight detune for shimmer
      gain.gain.setValueAtTime(0, chordTime);
      gain.gain.linearRampToValueAtTime(this.sfxVolume * 0.4, chordTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, chordTime + 0.8);
      osc.connect(gain);
      gain.connect(this.gainNode);
      osc.start(chordTime);
      osc.stop(chordTime + 0.8);
    });
  }

  _playToneAtTime(freq, type, duration, startTime) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.value = freq;

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(this.sfxVolume, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

    osc.connect(gain);
    gain.connect(this.gainNode);

    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  setMute(muted) {
    this.isMuted = muted;
    this._updateGain();
    this._updateMusicGain();
    if (muted) {
      this._resetCombo();
    }
  }

  setVolume(vol) {
    this.masterVolume = Math.max(0, Math.min(1, vol));
    this._updateGain();
  }

  setMusicVolume(vol) {
    this.musicVolume = Math.max(0, Math.min(1, vol));
    this._updateMusicGain();
  }

  setMusicEnabled(enabled) {
    this.musicEnabled = Boolean(enabled);
    if (this.musicEnabled) {
      this.startMusic();
    } else {
      this.stopMusic();
    }
    this._updateMusicGain();
  }

  setSfxVolume(vol) {
    this.sfxVolume = Math.max(0, Math.min(1, vol));
  }

  duck(enabled) {
    if (!this.gainNode) return;
    const now = this.ctx.currentTime;
    // Target volume: 30% if ducked, normal if not.
    // Use masterVolume as the baseline.
    const targetVol = enabled ? this.masterVolume * 0.3 : this.masterVolume;

    // Smooth transition
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
    this.gainNode.gain.linearRampToValueAtTime(targetVol, now + 0.5);
  }

  needsMusicGesture() {
    return this.musicNeedsGesture;
  }

  _updateGain() {
    if (!this.gainNode) return;
    this.gainNode.gain.value = this.isMuted ? 0 : this.masterVolume;
  }

  _updateMusicGain() {
    if (!this.musicGain) return;
    const enabled = this.musicEnabled && !this.isMuted;
    this.musicGain.gain.value = enabled ? this.musicVolume : 0;
  }

  /**
   * @param {{ seed: number, density: number, template: string, size: number }} profile
   * @returns {number}
   */
  _hashMusicProfile(profile) {
    let hash = profile.seed >>> 0;
    hash ^= (Math.floor(profile.density * 1000) + (profile.size << 8)) >>> 0;
    for (let i = 0; i < profile.template.length; i += 1) {
      hash = (hash * 31 + profile.template.charCodeAt(i)) >>> 0;
    }
    return hash >>> 0;
  }

  /**
   * @param {number} seed
   * @returns {() => number}
   */
  _createSeededRandom(seed) {
    let state = seed || 1;
    return function seededRandom() {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 0x100000000;
    };
  }

  _restartMusicSequence() {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.musicStep = 0;
    this.musicNextTime = 0;
    this._cancelScheduledMusic();
    this._startMusicSequence();
  }

  _cancelScheduledMusic() {
    if (!this.ctx || !this.musicNodes) return;
    const now = this.ctx.currentTime;

    this.musicNodes.gate.gain.cancelScheduledValues(now);
    this.musicNodes.osc1.frequency.cancelScheduledValues(now);
    this.musicNodes.osc2.frequency.cancelScheduledValues(now);

    if (this.padNodes && this.padNodes.oscs) {
      for (const osc of this.padNodes.oscs) {
        osc.frequency.cancelScheduledValues(now);
      }
    }
  }

  startMusic() {
    if (!this.ctx || !this.musicEnabled) return;

    // If music nodes exist but timer is dead, we have stale state - clean up
    if (this.musicNodes && !this.musicTimer) {
      this._cleanupStaleMusic();
    }

    if (this.musicNodes) return;

    if (this.ctx.state === 'suspended') {
      this.musicNeedsGesture = true;
      const resumePromise = this.ctx.resume();
      if (resumePromise && typeof resumePromise.then === 'function') {
        resumePromise
          .then(() => {
            this.musicNeedsGesture = false;
            if (this.musicEnabled) {
              this._ensureMusicNodes();
            }
          })
          .catch(() => {
            this.musicNeedsGesture = true;
          });
      }
      return;
    }

    this.musicNeedsGesture = false;
    this._ensureMusicNodes();
  }

  // Clean up stale music state (oscillators exist but aren't playing)
  _cleanupStaleMusic() {
    try {
      if (this.musicNodes) {
        this.musicNodes.osc1.stop();
        this.musicNodes.osc2.stop();
      }
    } catch (e) {
      // Oscillators might already be stopped - ignore
    }
    this.musicNodes = null;
    this._stopPadLayer();
  }

  _ensureMusicNodes() {
    if (this.musicNodes || !this.ctx) return;

    // Initialize beat clock
    this.beatStartTime = this.ctx.currentTime;
    this.currentChordIndex = 0;

    // Dual Oscillator for fatter music
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gate = this.ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'triangle';
    osc1.frequency.value = this.musicRootHz;
    osc2.frequency.value = this.musicRootHz * 2;

    // Detune slightly for richness
    osc2.detune.value = 5;

    filter.type = 'lowpass';
    filter.frequency.value = 1200;
    filter.Q.value = 0.6;
    gate.gain.value = 0;

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gate);
    gate.connect(this.musicGain);

    osc1.start();
    osc2.start();

    this.musicNodes = { osc1, osc2, filter, gate };

    // Initialize Pad Layer (warm sustained chords)
    this._initPadLayer();

    this._startMusicSequence();
  }

  _initPadLayer() {
    if (!this.ctx || this.padNodes) return;

    // Create 3 oscillators for triad chord
    const padOscs = [];
    const padFilter = this.ctx.createBiquadFilter();
    this.padGain = this.ctx.createGain();

    padFilter.type = 'lowpass';
    padFilter.frequency.value = 800;
    padFilter.Q.value = 0.5;

    for (let i = 0; i < 3; i++) {
      const osc = this.ctx.createOscillator();
      // Use slightly detuned pairs for warmth
      osc.type = i === 0 ? 'sine' : 'triangle';
      osc.detune.value = (i - 1) * 4; // -4, 0, +4 cents
      osc.connect(padFilter);
      osc.start();
      padOscs.push(osc);
    }

    padFilter.connect(this.padGain);
    this.padGain.connect(this.musicGain);
    this.padGain.gain.value = this.musicVolume * 0.25;

    this.padNodes = { oscs: padOscs, filter: padFilter };

    // Set initial chord
    this._updatePadChord();
  }

  _updatePadChord(atTime = null) {
    if (!this.ctx || !this.padNodes) return;

    const chord = this.getCurrentChord();
    const now = atTime !== null ? atTime : this.ctx.currentTime;

    // Map chord notes to frequencies (lower octave for pad)
    this.padNodes.oscs.forEach((osc, i) => {
      const semitone = chord[i % chord.length] - 12; // One octave down
      const freq = this.musicRootHz * Math.pow(2, semitone / 12);
      // Smooth portamento for chord changes
      osc.frequency.setTargetAtTime(freq, now, 0.3);
    });
  }

  _stopPadLayer() {
    if (!this.padNodes) return;
    try {
      this.padNodes.oscs.forEach((osc) => {
        try {
          osc.stop();
        } catch (e) {
          /* already stopped */
        }
      });
    } catch (e) {
      // Ignore errors during cleanup
    }
    this.padNodes = null;
    this.padGain = null;
  }

  // ========== RHYTHM LAYER ==========

  _playHiHat(time, accent = false) {
    if (!this.ctx) return;
    // Re-initialize noise buffers if missing (safety check)
    if (!this.noiseBuffers.short) this._initNoiseBuffers();
    if (!this.noiseBuffers.short) return;

    const duration = accent ? 0.08 : 0.05;

    // Reuse pre-allocated buffer instead of creating new one
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffers.short;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = accent ? 7000 : 9000;

    const gain = this.ctx.createGain();
    const volume = this.musicVolume * (accent ? 0.15 : 0.08);
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);

    noise.start(time);
    noise.stop(time + duration);
  }

  _playKick(time) {
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.1);

    gain.gain.setValueAtTime(this.musicVolume * 0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

    osc.connect(gain);
    gain.connect(this.musicGain);

    osc.start(time);
    osc.stop(time + 0.15);
  }

  _playRhythmStep(step16th, scheduledTime = null) {
    if (!this.ctx || !this.rhythmEnabled) return;

    // Use scheduled time or fall back to current time
    const time = scheduledTime !== null ? scheduledTime : this.ctx.currentTime;
    const pattern = this.rhythmPatterns[this.currentRhythmPattern];
    const kickPattern = this.rhythmPatterns.kick;

    const patternIndex = step16th % pattern.length;

    // Hi-hat
    if (pattern[patternIndex]) {
      const isAccent = patternIndex % 4 === 0; // Accent on beat
      this._playHiHat(time, isAccent);
    }

    // Kick (only when intensity is high enough)
    if (this.layerIntensity > 0.6 && kickPattern[patternIndex]) {
      this._playKick(time);
    }
  }

  stopMusic() {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.musicNextTime = 0;
    this.musicStep = 0;
    this._resetCombo();

    // Stop pad layer
    this._stopPadLayer();

    if (!this.musicNodes) return;
    try {
      this.musicNodes.osc1.stop();
      this.musicNodes.osc2.stop();
    } catch (e) {
      // Oscillators might already be stopped - ignore
    }
    this.musicNodes = null;
    this.musicNeedsGesture = false;
  }

  _startMusicSequence() {
    if (!this.ctx || !this.musicNodes) return;
    if (this.musicTimer) return;
    this.musicStep = 0;
    // Reset to base pattern on start
    this.currentPattern = [...this.musicPattern];

    this._cancelScheduledMusic();
    this.musicNextTime = this.ctx.currentTime + 0.05;
    this._scheduleMusic();
    this.musicTimer = setInterval(() => {
      this._scheduleMusic();
    }, this.musicSchedulerMs);
  }

  _scheduleMusic() {
    if (!this.ctx || !this.musicNodes) return;

    if (!this.musicNextTime) {
      this.musicNextTime = this.ctx.currentTime + 0.05;
    }

    const stepDuration = this.musicTempoMs / 1000;
    const now = this.ctx.currentTime;
    if (this.musicNextTime < now) {
      this.musicNextTime = now;
    }

    const scheduleUntil = now + this.musicScheduleAheadSec;
    while (this.musicNextTime < scheduleUntil) {
      this._playMusicStep(this.musicNextTime, stepDuration);
      this.musicNextTime += stepDuration;
    }
  }

  _playMusicStep(scheduledTime, stepDuration) {
    if (!this.ctx || !this.musicNodes) return;

    // Update harmony state
    this._updateChord(scheduledTime);

    // PROCEDURAL GENERATION LOGIC
    // 1. Every 16 steps (approx 2 bars), mutate one note
    if (this.musicStep > 0 && this.musicStep % 16 === 0) {
      const mutateIndex = Math.floor(Math.random() * this.currentPattern.length);
      const newNote = this.scale[Math.floor(Math.random() * this.scale.length)];
      this.currentPattern[mutateIndex] = newNote;
    }

    // 2. Every 64 steps (approx 8 bars), potentially reset or change root
    if (this.musicStep > 0 && this.musicStep % 64 === 0) {
      if (Math.random() > 0.5) {
        // Reset to original theme
        this.currentPattern = [...this.musicPattern];
      } else {
        // Shift root note slightly for chord change feel
        // (Only visual/internal shift, frequency calc handles it)
        // Ideally we'd change musicRootHz but let's keep it simple for now
        // Just scramble the pattern a bit more
        this.currentPattern.sort(() => Math.random() - 0.5);
      }
    }

    const { osc1, osc2, gate } = this.musicNodes;
    const now = scheduledTime;

    const semitone = this.currentPattern[this.musicStep % this.currentPattern.length];

    // Occasional rest (10% chance, but not on beat 1)
    const beatInMeasure = this.musicStep % (this.beatsPerMeasure * 2); // 8th notes
    const isRest = beatInMeasure !== 0 && Math.random() < 0.1;

    if (isRest) {
      // Silent step - just advance
      gate.gain.setValueAtTime(0.001, now);
    } else {
      // Add occasional octave jump for bass
      const octave = Math.random() < 0.12 ? 12 : 0;
      const freq = this.musicRootHz * Math.pow(2, (semitone - 12 + octave) / 12);

      // Use portamento for smoother bass (30% of the time)
      const useSlide = Math.random() < 0.3;
      if (useSlide) {
        osc1.frequency.setTargetAtTime(freq, now, 0.05);
        osc2.frequency.setTargetAtTime(freq * 2, now, 0.05);
      } else {
        osc1.frequency.setValueAtTime(freq, now);
        osc2.frequency.setValueAtTime(freq * 2, now);
      }

      // Vary articulation (staccato vs legato)
      const isStaccato = Math.random() < 0.25;
      const attackTime = 0.03;
      const decayTime = isStaccato ? 0.15 : 0.28;
      const peakGain = isStaccato ? 0.25 : 0.3;

      const maxDecayTime = Math.max(attackTime + 0.001, Math.min(decayTime, stepDuration - 0.001));
      gate.gain.setValueAtTime(0.001, now);
      gate.gain.exponentialRampToValueAtTime(peakGain, now + attackTime);
      gate.gain.exponentialRampToValueAtTime(0.001, now + maxDecayTime);
    }

    // Play rhythm (2 x 16th notes per 8th note step)
    // Use Web Audio scheduling for precise timing (no setTimeout)
    const step16th = this.musicStep * 2;
    const halfBeatSec = stepDuration / 2;

    this._playRhythmStep(step16th, now);
    this._playRhythmStep(step16th + 1, now + halfBeatSec);

    this.musicStep += 1;
  }

  _playNoise(duration, volumeMod = 1.0) {
    if (!this.ctx) return;

    // Select appropriate pre-allocated buffer based on duration
    let buffer;
    if (duration <= 0.1) {
      buffer = this.noiseBuffers.short;
    } else if (duration <= 0.2) {
      buffer = this.noiseBuffers.medium;
    } else {
      buffer = this.noiseBuffers.long;
    }

    if (!buffer) return;

    const now = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const gain = this.ctx.createGain();
    const finalVol = this.sfxVolume * volumeMod;
    gain.gain.setValueAtTime(finalVol, now);
    gain.gain.linearRampToValueAtTime(0.01, now + duration);

    noise.connect(gain);
    gain.connect(this.gainNode);

    noise.start(now);
    noise.stop(now + duration);
  }
}

export const audio = new AudioEngine();
