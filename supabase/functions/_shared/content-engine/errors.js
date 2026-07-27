export class ProviderError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.httpStatus = details.httpStatus;
    this.providerRequestId = details.providerRequestId;
    this.providerErrorType = details.providerErrorType;
    this.providerErrorCode = details.providerErrorCode;
    this.retryable = Boolean(details.retryable);
    if (details.cause) this.cause = details.cause;
  }
}

export function isRetryableProviderCode(code) {
  return code === 'PROVIDER_TIMEOUT' || code === 'PROVIDER_RATE_LIMITED' || code === 'PROVIDER_UNAVAILABLE';
}
