// @ts-check
export const GameState = {
  TITLE: 'TITLE',
  LOBBY: 'LOBBY',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  DYING: 'DYING',
  GAME_OVER: 'GAME_OVER',
  LEVEL_CLEAR: 'LEVEL_CLEAR',
  TIME_UP: 'TIME_UP'
};

export class StateMachine {
  constructor() {
    this.currentState = GameState.TITLE;
    this.previousState = null;
    this.listeners = [];
  }

  transitionTo(newState) {
    if (this.currentState === newState) return;

    if (!this._isValidTransition(this.currentState, newState)) {
      console.warn(`[State] Invalid transition: ${this.currentState} -> ${newState}`);
      return;
    }

    this.previousState = this.currentState;
    this.currentState = newState;

    this._notifyListeners();
  }

  onStateChange(callback) {
    this.listeners.push(callback);
  }

  _notifyListeners() {
    this.listeners.forEach((cb) => cb(this.currentState, this.previousState));
  }

  _isValidTransition(from, to) {
    if (from === GameState.GAME_OVER && to === GameState.PAUSED) return false;
    if (from === GameState.DYING && to === GameState.PAUSED) return false;
    return true;
  }
}

export const gameState = new StateMachine();
