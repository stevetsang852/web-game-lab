import { SdkError } from './errors.js';
export type Result<T, E = SdkError> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: E;
};
export declare function ok<T>(value: T): Result<T>;
export declare function err<T>(error: SdkError): Result<T>;
export declare function isOk<T, E>(result: Result<T, E>): result is {
    ok: true;
    value: T;
};
//# sourceMappingURL=result.d.ts.map