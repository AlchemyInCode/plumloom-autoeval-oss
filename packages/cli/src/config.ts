export const AUTOEVAL_API_ORIGIN = 'https://pl-be-dev3-billing-updates-5b0fc2eb261a.herokuapp.com';

export type AutoevalConfiguration = {
  apiBaseUrl: URL;
  requestTimeoutMs: number;
  maxResponseBytes: number;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  resultReadyIntervalMs: number;
  resultReadyTimeoutMs: number;
};

export function loadConfiguration(): AutoevalConfiguration {
  return {
    apiBaseUrl: new URL(AUTOEVAL_API_ORIGIN),
    requestTimeoutMs: 30_000,
    maxResponseBytes: 2 * 1024 * 1024,
    pollIntervalMs: 2_000,
    pollTimeoutMs: 10 * 60_000,
    resultReadyIntervalMs: 2_000,
    resultReadyTimeoutMs: 60_000,
  };
}
