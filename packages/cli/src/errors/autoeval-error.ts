export type AutoevalErrorKind =
  | 'usage'
  | 'authentication'
  | 'authorization'
  | 'plan_restriction'
  | 'validation'
  | 'network'
  | 'upstream'
  | 'run_failed'
  | 'gate_failed'
  | 'timeout'
  | 'unsupported';

const EXIT_CODES: Readonly<Record<AutoevalErrorKind, number>> = {
  usage: 2,
  authentication: 3,
  authorization: 3,
  plan_restriction: 3,
  validation: 2,
  network: 4,
  upstream: 4,
  run_failed: 5,
  gate_failed: 1,
  timeout: 4,
  unsupported: 2,
};

export class AutoevalError extends Error {
  readonly kind: AutoevalErrorKind;
  readonly code: string | undefined;
  readonly exitCode: number;

  constructor(
    message: string,
    options: {
      kind: AutoevalErrorKind;
      code?: string;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'AutoevalError';
    this.kind = options.kind;
    this.code = options.code;
    this.exitCode = EXIT_CODES[options.kind];
  }
}

export function asAutoevalError(error: unknown): AutoevalError {
  if (error instanceof AutoevalError) {
    return error;
  }

  return new AutoevalError('Autoeval could not complete the request.', {
    kind: 'upstream',
    code: 'UNEXPECTED_ERROR',
    cause: error,
  });
}
