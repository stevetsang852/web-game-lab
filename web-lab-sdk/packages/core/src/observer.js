/**
 * Observer. Callers subscribe instead of polling.
 * See https://refactoring.guru/design-patterns/observer
 */
export class Observer {
    listeners = new Set();
    subscribe(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    notify(event) {
        for (const listener of [...this.listeners]) {
            try {
                listener(event);
            }
            catch {
                // One subscriber cannot cancel the operation that already completed,
                // and cannot block the remaining subscribers.
            }
        }
    }
}
//# sourceMappingURL=observer.js.map