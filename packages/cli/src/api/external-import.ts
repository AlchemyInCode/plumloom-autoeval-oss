export type ExternalImportRequest = {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  query?: Readonly<Record<string, string | number | boolean | undefined>>;
  body?: unknown;
  signal?: AbortSignal;
};

export const externalImportBasePath = '/api/v1/import/external/evals';
