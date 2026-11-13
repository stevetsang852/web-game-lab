export type Unsubscribe = () => void;

/**
 * Observer. Callers subscribe instead of polling.
 * See https://refactoring.guru/design-patterns/observer
 */
export class Observer<T> {
  private readonly listeners = new Set<(event: T) => void>();

  subscribe(listener: (event: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  notify(event: T): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }
}
