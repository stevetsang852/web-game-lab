import { ErrorCodes, SdkError } from '@web-lab-sdk/core';
import { INVOICE_STATES, type InvoiceState } from './types.js';

/**
 * Legal invoice transitions.
 * INVOICE_OPEN → PAID → APPLIED | REFUNDED.
 */
export const INVOICE_TRANSITIONS: Readonly<Record<InvoiceState, readonly InvoiceState[]>> = {
  INVOICE_OPEN: ['PAID'],
  PAID: ['APPLIED', 'REFUNDED'],
  APPLIED: [],
  REFUNDED: [],
};

export function isInvoiceState(value: unknown): value is InvoiceState {
  return typeof value === 'string' && (INVOICE_STATES as readonly string[]).includes(value);
}

export function assertInvoiceTransition(from: InvoiceState, to: InvoiceState): void {
  const allowed = INVOICE_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new SdkError(
      ErrorCodes.InvoiceTransitionForbidden,
      `Illegal invoice transition ${from} → ${to}. Expected INVOICE_OPEN → PAID → APPLIED | REFUNDED.`,
    );
  }
}
