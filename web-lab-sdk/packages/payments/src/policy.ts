import { ErrorCodes, SdkError, type LabEnvironment } from '@web-lab-sdk/core';

export function normalizeCurrency(currency: string): string {
  return currency.trim().toUpperCase();
}

/**
 * Digital goods inside Telegram may use Stars (XTR) only.
 * TON is never a checkout currency, including on web and native.
 */
export function assertDigitalGoodsCurrency(environment: LabEnvironment, currency: string): void {
  const normalized = normalizeCurrency(currency);
  if (normalized === 'TON') {
    throw new SdkError(
      ErrorCodes.DigitalGoodsCurrencyForbidden,
      'TON cannot be used to check out digital goods. Inside Telegram, sell items with Stars (XTR) only.',
    );
  }
  if (environment === 'mini_app' && normalized !== 'XTR') {
    throw new SdkError(
      ErrorCodes.DigitalGoodsCurrencyForbidden,
      'Inside Telegram, digital goods may only use Stars (XTR).',
    );
  }
}
