export const ErrorCodes = {
    NotImplemented: 'NOT_IMPLEMENTED',
    InvalidArgument: 'INVALID_ARGUMENT',
    Unauthenticated: 'UNAUTHENTICATED',
    InvalidSession: 'INVALID_SESSION',
    OfflineDemoRejected: 'OFFLINE_DEMO_REJECTED',
    LinkRejected: 'LINK_REJECTED',
    EmailOnlyLinkForbidden: 'EMAIL_ONLY_LINK_FORBIDDEN',
    ProviderNotRegistered: 'PROVIDER_NOT_REGISTERED',
    ProviderAlreadyRegistered: 'PROVIDER_ALREADY_REGISTERED',
    PrimaryIdentityRequired: 'PRIMARY_IDENTITY_REQUIRED',
    ClientSecretForbidden: 'CLIENT_SECRET_FORBIDDEN',
    IdempotencyKeyRequired: 'IDEMPOTENCY_KEY_REQUIRED',
    IdempotencyConflict: 'IDEMPOTENCY_CONFLICT',
    InvoiceTransitionForbidden: 'INVOICE_TRANSITION_FORBIDDEN',
    InvoiceMismatch: 'INVOICE_MISMATCH',
    DigitalGoodsCurrencyForbidden: 'DIGITAL_GOODS_CURRENCY_FORBIDDEN',
    SettledStubForbidden: 'SETTLED_STUB_FORBIDDEN',
    WalletConnectRequiresGesture: 'WALLET_CONNECT_REQUIRES_GESTURE',
    WalletDisabled: 'WALLET_DISABLED',
    WalletNotConnected: 'WALLET_NOT_CONNECTED',
    WalletProviderMismatch: 'WALLET_PROVIDER_MISMATCH',
    WalletOperationReserved: 'WALLET_OPERATION_RESERVED',
    AccountOwnership: 'ACCOUNT_OWNERSHIP',
};
/** Typed failure shared by the auth, payments, and wallet facades. */
export class SdkError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'SdkError';
        this.code = code;
    }
}
//# sourceMappingURL=errors.js.map