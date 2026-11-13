declare module 'hanzi-writer/dist/index.esm.js' {
  export interface HanziWriterOptions {
    width: number;
    height: number;
    padding: number;
    showCharacter: boolean;
    showOutline: boolean;
    strokeColor: string;
    outlineColor: string;
    strokeAnimationSpeed: number;
    delayBetweenStrokes: number;
  }

  export interface HanziWriterInstance {
    animateCharacter(options?: { onComplete?: () => void }): Promise<unknown>;
  }

  export default class HanziWriter {
    static create(
      element: string | HTMLElement,
      character: string,
      options?: Partial<HanziWriterOptions>,
    ): HanziWriterInstance;
  }
}
