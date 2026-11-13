export type Unsubscribe = () => void;
/**
 * Observer. Callers subscribe instead of polling.
 * See https://refactoring.guru/design-patterns/observer
 */
export declare class Observer<T> {
    private readonly listeners;
    subscribe(listener: (event: T) => void): Unsubscribe;
    notify(event: T): void;
}
//# sourceMappingURL=observer.d.ts.map