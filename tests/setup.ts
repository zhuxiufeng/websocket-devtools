/**
 * Vitest global setup.
 *
 * Runs before any test module is imported, so the zustand `persist` middleware
 * sees a working `localStorage` at store-creation time (previously the mock was
 * installed inside the test file, *after* the store had already been created,
 * which produced "storage is currently unavailable" warnings on every update).
 */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

const mem = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', {
  value: mem,
  writable: true,
  configurable: true,
});
(globalThis as any).window = globalThis;

