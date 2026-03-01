declare module 'https://cdn.jsdelivr.net/npm/lil-gui@0.18.0/dist/lil-gui.esm.min.js' {
  export interface GuiController<T = unknown> {
    name(label: string): GuiController<T>;
    onChange(handler: (value: T) => void): GuiController<T>;
    listen(): GuiController<T>;
    domElement?: HTMLElement;
  }

  export interface GuiFolder {
    add<T extends object, K extends keyof T>(
      object: T,
      property: K,
      ...args: Array<number | Record<string, string | number>>
    ): GuiController<T[K]>;
    addColor<T extends object, K extends keyof T>(
      object: T,
      property: K,
      ...args: Array<number | Record<string, string | number>>
    ): GuiController<T[K]>;
    addFolder(title: string): GuiFolder;
    open(): GuiFolder;
    close(): GuiFolder;
    title(title: string): GuiFolder;
    destroy(): void;
  }

  export class GUI {
    constructor(options?: { container?: HTMLElement; width?: string | number });
    domElement: HTMLElement;
    title(title: string): GUI;
    add<T extends object, K extends keyof T>(
      object: T,
      property: K,
      ...args: Array<number | Record<string, string | number>>
    ): GuiController<T[K]>;
    addColor<T extends object, K extends keyof T>(
      object: T,
      property: K,
      ...args: Array<number | Record<string, string | number>>
    ): GuiController<T[K]>;
    addFolder(title: string): GuiFolder;
    destroy(): void;
  }
}
