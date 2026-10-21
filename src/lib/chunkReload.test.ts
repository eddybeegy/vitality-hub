import { describe, it, expect, vi } from 'vitest';
import { isChunkLoadError, reloadForChunkError } from './chunkReload';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
  };
}

describe('isChunkLoadError', () => {
  it('recognises the browser dynamic-import failures', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/ActivityTab-abc.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: https://x/assets/a.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/index-abc.css'))).toBe(true);
    expect(isChunkLoadError(Object.assign(new Error('x'), { name: 'ChunkLoadError' }))).toBe(true);
  });

  it('ignores ordinary errors', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe('reloadForChunkError', () => {
  it('reloads once, then holds off inside the guard window', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    expect(reloadForChunkError(storage, reload, 1_000)).toBe(true);
    expect(reloadForChunkError(storage, reload, 5_000)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads again once the guard window has passed', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    reloadForChunkError(storage, reload, 1_000);
    expect(reloadForChunkError(storage, reload, 20_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('still reloads when storage is unavailable', () => {
    const reload = vi.fn();
    expect(reloadForChunkError(null, reload, 1_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
