const BARE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isBareEmail(value: unknown): boolean {
  return typeof value === 'string' && BARE_EMAIL.test(value.trim());
}

export function readAssertion(record: Record<string, unknown>, provider?: string): string {
  const keys = provider === 'telegram'
    ? ['assertion', 'initData', 'idToken', 'identityToken']
    : ['assertion', 'idToken', 'identityToken'];
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}
