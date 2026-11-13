import { type Result } from './result.js';
/**
 * Registry (service locator) for adapters.
 * Adding a provider is a `register` call at bootstrap. Provider ids are not
 * hard-coded here, so a new adapter does not require a core change.
 */
export declare class ProviderRegistry<T extends {
    readonly id: string;
}> {
    private readonly providers;
    register(provider: T): void;
    get(id: string): T | undefined;
    require(id: string): T;
    has(id: string): boolean;
    ids(): readonly string[];
    tryGet(id: string): Result<T>;
}
//# sourceMappingURL=registry.d.ts.map