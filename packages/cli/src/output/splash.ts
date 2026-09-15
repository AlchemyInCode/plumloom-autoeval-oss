import { safeTerminalText } from './safe-text.js';

/** Terminal color capability, resolved from the environment before rendering. */
export type ColorMode = 'none' | 'basic' | 'truecolor';

export type SplashContext = {
  version: string;
  /** Authenticated principal, when already known without a network call. */
  identity?: string;
  /** Active workspace name, when already known without a network call. */
  workspace?: string;
  /** False when no CLI key resolved; the splash then points at `autoeval login`. */
  signedIn: boolean;
  colorMode: ColorMode;
  unicode: boolean;
  boltSize?: BoltSize;
};

export type SplashVisibilityInput = {
  /** True when the invocation is an interactive session. */
  interactive: boolean;
  json: boolean;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  stderrIsTTY: boolean;
  environment: Readonly<Record<string, string | undefined>>;
};

/** Brand palette: teal, plum, olive, charcoal. */
const PALETTE = {
  teal: { hex: '#136D8C', basic: 36 },
  tealBright: { hex: '#3EC8E8', basic: 96 },
  tealMid: { hex: '#2DA5C4', basic: 36 },
  tealDim: { hex: '#1A8AAF', basic: 36 },
  plum: { hex: '#D45FB5', basic: 35 },
  olive: { hex: '#C8D24A', basic: 33 },
  gray: { hex: '#8A9BA3', basic: 37 },
  charcoal: { hex: '#6B8A95', basic: 90 },
  white: { hex: '#F5F5F5', basic: 37 },
  faint: { hex: '#506A74', basic: 90 },
} as const;

type PaletteColor = keyof typeof PALETTE;

const WORDMARK_UNICODE: readonly string[] = [
  ' █████╗ ██╗   ██╗████████╗ ██████╗ ███████╗██╗   ██╗ █████╗ ██╗     ',
  '██╔══██╗██║   ██║╚══██╔══╝██╔═══██╗██╔════╝██║   ██║██╔══██╗██║     ',
  '███████║██║   ██║   ██║   ██║   ██║█████╗  ██║   ██║███████║██║     ',
  '██╔══██║██║   ██║   ██║   ██║   ██║██╔══╝  ╚██╗ ██╔╝██╔══██║██║     ',
  '██║  ██║╚██████╔╝   ██║   ╚██████╔╝███████╗ ╚████╔╝ ██║  ██║███████╗',
  '╚═╝  ╚═╝ ╚═════╝    ╚═╝    ╚═════╝ ╚══════╝  ╚═══╝  ╚═╝  ╚═╝╚══════╝',
];

const WORDMARK_ASCII: readonly string[] = [
  String.raw`  _  _   _ _____ ___  _____ _   _   _   _`,
  String.raw` /_\| | | |_   _/ _ \| __\ \ / / /_\ | |`,
  String.raw`/ _ \ |_| | | || (_) | _| \ V / / _ \| |__`,
  String.raw`/_/ \_\___/  |_| \___/|___| \_/ /_/ \_\____|`,
];

const FIGLET_WIDTH = 70;

type BoltSize = 'current' | 'small';

const BOLT_CURRENT: readonly string[] = ['  ██', ' ██', '██████', '   ██', '  ██', ' ██'];

const BOLT_SMALL: readonly string[] = [' █', '█', '███', '  █', ' █', '█'];

const BOLT_ASCII: readonly string[] = ['  |', ' |', '|---', '   |', '  |', ' |'];

function paint(text: string, color: PaletteColor, mode: ColorMode, bold = false): string {
  if (mode === 'none' || text === '') return text;

  const swatch = PALETTE[color];
  const [red, green, blue] = hexToRgb(swatch.hex);

  const colorCode =
    mode === 'truecolor' ? `\u001B[38;2;${red};${green};${blue}m` : `\u001B[${swatch.basic}m`;

  const boldCode = bold ? '\u001B[1m' : '';

  return `${boldCode}${colorCode}${text}\u001B[39m${bold ? '\u001B[22m' : ''}`;
}

function hexToRgb(hex: string): readonly [number, number, number] {
  const normalized = hex.replace('#', '');
  if (!/^[0-9A-Fa-f]{6}$/u.test(normalized)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return [red, green, blue] as const;
}

/** Decide whether a human is watching an interactive session that may receive a splash. */
export function shouldShowSplash(input: SplashVisibilityInput): boolean {
  if (!input.interactive || input.json) return false;
  if (!input.stdinIsTTY || !input.stdoutIsTTY || !input.stderrIsTTY) return false;
  const environment = input.environment;
  for (const name of ['CI', 'NO_SPLASH', 'AUTOEVAL_NO_SPLASH']) {
    const value = environment[name];
    if (value !== undefined && value !== '' && value !== '0' && value !== 'false') return false;
  }
  return true;
}

/** Resolve color support from the environment; `NO_COLOR` and dumb terminals disable it. */
export function resolveColorMode(
  environment: Readonly<Record<string, string | undefined>>,
): ColorMode {
  if (environment.NO_COLOR !== undefined && environment.NO_COLOR !== '') return 'none';
  const term = environment.TERM ?? '';
  if (term === '' || term === 'dumb') return 'none';
  const colorterm = environment.COLORTERM ?? '';
  if (colorterm.includes('truecolor') || colorterm.includes('24bit')) return 'truecolor';
  return 'basic';
}

/** Unicode is only assumed when the locale advertises UTF-8 on a capable terminal. */
export function supportsUnicode(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  if ((environment.TERM ?? '') === 'dumb') return false;
  const locale = `${environment.LC_ALL ?? ''} ${environment.LC_CTYPE ?? ''} ${
    environment.LANG ?? ''
  }`.toUpperCase();
  return locale.includes('UTF-8') || locale.includes('UTF8');
}

export function resolveBoltSize(
  environment: Readonly<Record<string, string | undefined>>,
  unicode: boolean,
): BoltSize {
  if (!unicode) return 'small';
  const raw = (environment.AUTOEVAL_SPLASH_BOLT_SIZE ?? '').trim().toLowerCase();
  if (raw === 'small') return 'small';
  return 'current';
}

function renderWordmark(context: SplashContext, version: string): string[] {
  const lines = context.unicode ? WORDMARK_UNICODE : WORDMARK_ASCII;
  return lines.map((line, index) => {
    const padded = line.padEnd(FIGLET_WIDTH);
    if (index === 0) return paint(padded, 'tealBright', context.colorMode);
    if (index === 1) {
      return `${paint(padded, 'tealBright', context.colorMode)}  ${paint(
        `v${version}`,
        'gray',
        context.colorMode,
      )}`;
    }
    if (index <= 3) return paint(padded, 'tealMid', context.colorMode);
    return paint(padded, 'tealDim', context.colorMode);
  });
}

function renderBoltBlock(context: SplashContext, version: string): string {
  const ruleChar = context.unicode ? '─' : '-';
  const marker = context.unicode ? '▸' : '>';
  const divider = context.unicode ? '·' : '-';

  const boltSize = context.boltSize ?? (context.unicode ? 'current' : 'small');

  const bolt = context.unicode ? (boltSize === 'small' ? BOLT_SMALL : BOLT_CURRENT) : BOLT_ASCII;

  const right: readonly string[] = [
    `${paint(marker, 'olive', context.colorMode, true)} ${paint(
      'Autoeval',
      'white',
      context.colorMode,
      true,
    )} ${paint(`${divider} v${version}`, 'gray', context.colorMode, true)}`,

    paint('intelligent evaluation engine', 'faint', context.colorMode, true),

    paint(ruleChar.repeat(28), 'faint', context.colorMode, true),

    `${paint('Type', 'faint', context.colorMode, true)} ${paint(
      '--help',
      'olive',
      context.colorMode,
      true,
    )} ${paint('to get started', 'faint', context.colorMode, true)}`,

    `${paint('powered by', 'faint', context.colorMode, true)} ${paint(
      'plumloom',
      'plum',
      context.colorMode,
      true,
    )}`,
  ];

  const BOLT_COLUMN_WIDTH = 14;

  return bolt
    .map((segment, index) => {
      const rightText = right[index] ?? '';
      if (!rightText) {
        return paint(segment, 'tealDim', context.colorMode);
      }

      // IMPORTANT:
      // Pad the RAW string before applying ANSI color.
      // Otherwise ANSI escape codes affect the calculated width.
      // const left = segment.padEnd(BOLT_COLUMN_WIDTH, ' ');

      return `${paint(segment, 'tealDim', context.colorMode)}${' '.repeat(
        BOLT_COLUMN_WIDTH - segment.length,
      )}${rightText}`;
    })
    .join('\n');
}

const WELCOME_INDENT = ' '.repeat(14);
const WELCOME_COMMAND_WIDTH = 24;

function welcomeRow(command: string, description: string, mode: ColorMode): string {
  const padding = ' '.repeat(Math.max(1, WELCOME_COMMAND_WIDTH - command.length));
  return `${WELCOME_INDENT}${paint(command, 'olive', mode)}${padding}${paint(
    description,
    'faint',
    mode,
  )}`;
}

/** Compact next-step card printed for a bare interactive invocation. */
export function renderWelcome(context: SplashContext): string {
  const mode = context.colorMode;
  const lines: string[] = [];

  if (context.signedIn) {
    lines.push(`${WELCOME_INDENT}${paint('Signed in.', 'white', mode)}`);
    lines.push('');
    lines.push(welcomeRow('autoeval quickstart', 'run a sample evaluation', mode));
    lines.push(welcomeRow('autoeval --help', 'see all commands', mode));
  } else {
    lines.push(`${WELCOME_INDENT}${paint('Not signed in.', 'white', mode)}`);
    lines.push('');
    lines.push(welcomeRow('autoeval login', 'sign in with your CLI key', mode));
    lines.push(welcomeRow('autoeval quickstart', 'run a first evaluation end to end', mode));
    lines.push('');
    lines.push(welcomeRow('autoeval --help', 'see all commands', mode));
  }

  return `${lines.join('\n')}\n`;
}

/** Render the interactive welcome screen. Pure: all capabilities arrive through `context`. */
export function renderSplash(context: SplashContext): string {
  const version = safeTerminalText(context.version);
  const wordmark = renderWordmark(context, version);
  const boltBlock = renderBoltBlock(context, version);
  const prompt = `${' '.repeat(14)}${paint(
    'Run a command to get started...',
    'charcoal',
    context.colorMode,
  )}`;
  return `${wordmark.join('\n')}\n\n${boltBlock}\n${prompt}\n\n`;
}
