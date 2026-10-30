/**
 * Observer / EventBus pattern for transport events.
 * See https://refactoring.guru/design-patterns/observer
 */
export type Unsubscribe = () => void;

export class EventBus<T extends object> {
  private listeners = new Map<keyof T, Set<(payload: T[keyof T]) => void>>();

  on<K extends keyof T>(event: K, listener: (payload: T[K]) => void): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as (payload: T[keyof T]) => void);
    return () => set!.delete(listener as (payload: T[keyof T]) => void);
  }

  emit<K extends keyof T>(event: K, payload: T[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) listener(payload);
  }

  clear(): void {
    this.listeners.clear();
  }
}
