import { createInterface } from 'node:readline/promises';

import { AutoevalError } from '../errors/autoeval-error.js';

export type ChoiceOption = {
  label: string;
  /** Optional right-hand detail, such as an evaluation count or a provider. */
  detail?: string;
};

/**
 * A numbered terminal picker. Kept behind an interface so quickstart stays
 * deterministic in tests: the runtime implementation is the only place that
 * touches stdin.
 */
export interface ChoicePrompt {
  choose(question: string, options: readonly ChoiceOption[]): Promise<number>;
}

export function renderChoiceList(question: string, options: readonly ChoiceOption[]): string {
  const lines = [question];
  options.forEach((option, index) => {
    const detail = option.detail === undefined ? '' : `  ${option.detail}`;
    lines.push(`  ${index + 1}. ${option.label}${detail}`);
  });
  return `${lines.join('\n')}\n`;
}

export class ReadlineChoicePrompt implements ChoicePrompt {
  async choose(question: string, options: readonly ChoiceOption[]): Promise<number> {
    if (options.length === 0) {
      throw new AutoevalError('Nothing to choose from.', {
        kind: 'usage',
        code: 'EMPTY_CHOICE_LIST',
      });
    }
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      process.stderr.write(renderChoiceList(question, options));
      const answer = (await rl.question(`Enter 1-${options.length}: `)).trim();
      const index = Number.parseInt(answer, 10);
      if (!Number.isInteger(index) || index < 1 || index > options.length) {
        throw new AutoevalError(`Pick a number between 1 and ${options.length}.`, {
          kind: 'usage',
          code: 'INVALID_CHOICE',
        });
      }
      return index - 1;
    } finally {
      rl.close();
    }
  }
}
