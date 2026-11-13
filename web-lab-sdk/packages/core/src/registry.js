import { ErrorCodes, SdkError } from './errors.js';
import { err, ok } from './result.js';
/**
 * Registry (service locator) for adapters.
 * Adding a provider is a `register` call at bootstrap. Provider ids are not
 * hard-coded here, so a new adapter does not require a core change.
 */
export class ProviderRegistry {
    providers = new Map();
    register(provider) {
        if (this.providers.has(provider.id)) {
            throw new SdkError(ErrorCodes.ProviderAlreadyRegistered, `Provider "${provider.id}" is already registered.`);
        }
        this.providers.set(provider.id, provider);
    }
    get(id) {
        return this.providers.get(id);
    }
    require(id) {
        const found = this.tryGet(id);
        if (!found.ok)
            throw found.error;
        return found.value;
    }
    has(id) {
        return this.providers.has(id);
    }
    ids() {
        return [...this.providers.keys()];
    }
    tryGet(id) {
        const provider = this.providers.get(id);
        if (!provider) {
            return err(new SdkError(ErrorCodes.ProviderNotRegistered, `Provider "${id}" is not registered. Register it at bootstrap.`));
        }
        return ok(provider);
    }
}
//# sourceMappingURL=registry.js.map