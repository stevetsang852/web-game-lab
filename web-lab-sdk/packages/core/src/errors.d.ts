export declare const ErrorCodes: {
    readonly NotImplemented: "NOT_IMPLEMENTED";
    readonly InvalidArgument: "INVALID_ARGUMENT";
    readonly Unauthenticated: "UNAUTHENTICATED";
    readonly InvalidSession: "INVALID_SESSION";
    readonly OfflineDemoRejected: "OFFLINE_DEMO_REJECTED";
    readonly LinkRejected: "LINK_REJECTED";
    readonly EmailOnlyLinkForbidden: "EMAIL_ONLY_LINK_FORBIDDEN";
    readonly ProviderNotRegistered: "PROVIDER_NOT_REGISTERED";
    readonly ProviderAlreadyRegistered: "PROVIDER_ALREADY_REGISTERED";
    readonly PrimaryIdentityRequired: "PRIMARY_IDENTITY_REQUIRED";
    readonly ClientSecretForbidden: "CLIENT_SECRET_FORBIDDEN";
    readonly IdempotencyKeyRequired: "IDEMPOTENCY_KEY_REQUIRED";
    readonly IdempotencyConflict: "IDEMPOTENCY_CONFLICT";
    readonly InvoiceTransitionForbidden: "INVOICE_TRANSITION_FORBIDDEN";
    readonly InvoiceMismatch: "INVOICE_MISMATCH";
    readonly DigitalGoodsCurrencyForbidden: "DIGITAL_GOODS_CURRENCY_FORBIDDEN";
    readonly SettledStubForbidden: "SETTLED_STUB_FORBIDDEN";
    readonly WalletConnectRequiresGesture: "WALLET_CONNECT_REQUIRES_GESTURE";
    readonly WalletDisabled: "WALLET_DISABLED";
    readonly WalletNotConnected: "WALLET_NOT_CONNECTED";
    readonly WalletProviderMismatch: "WALLET_PROVIDER_MISMATCH";
    readonly WalletOperationReserved: "WALLET_OPERATION_RESERVED";
    readonly AccountOwnership: "ACCOUNT_OWNERSHIP";
};
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
/** Typed failure shared by the auth, payments, and wallet facades. */
export declare class SdkError extends Error {
    readonly code: ErrorCode;
    constructor(code: ErrorCode, message: string);
}
//# sourceMappingURL=errors.d.ts.map