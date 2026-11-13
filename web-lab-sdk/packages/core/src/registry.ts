import { ErrorCodes, SdkError } from './errors.js';
import { err, ok, type Result } from './result.js';

/**
 * Registry (service locator) for adapters.
 * Adding a provider is a `register` call at bootstrap. Provider ids are not
 * hard-coded here, so a new adapter does not require a core change.
 */
export class ProviderRegistry<T extends { readonly id: string }> {
  private readonly providers = new Map<string, T>();

  register(provider: T): void {
    if (this.providers.has(provider.id)) {
      throw new SdkError(
        ErrorCodes.ProviderAlreadyRegistered,
        `Provider "${provider.id}" is already registered.`,
      );
    }
    this.providers.set(provider.id, provider);
  }

  get(id: string): T | undefined {
    return this.providers.get(id);
  }

  require(id: string): T {
    const found = this.tryGet(id);
    if (!found.ok) throw found.error;
    return found.value;
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  ids(): readonly string[] {
    return [...this.providers.keys()];
  }

  tryGet(id: string): Result<T> {
    const provider = this.providers.get(id);
    if (!provider) {
      return err(new SdkError(
        ErrorCodes.ProviderNotRegistered,
        `Provider "${id}" is not registered. Register it at bootstrap.`,
      ));
    }
    return ok(provider);
  }
}
