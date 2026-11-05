import {
  feedbackObject,
  type FeedbackItem,
  type JudgeFeedbackResult,
} from '../actions/feedback.js';
import type { JsonObject } from '../domain/common.js';
import { safeMultilineTerminalText } from './safe-text.js';
import { formatTable } from './table.js';

function text(input: unknown): string {
  return typeof input === 'string' ? safeMultilineTerminalText(input) : '';
}

function label(key: string): string {
  const name = key.replaceAll('_', ' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function available(entry: FeedbackItem): boolean {
  return entry.judgeFeedback?.status === 'available' || entry.judgeFeedback?.status === 'partial';
}

function evidence(lines: string[], input: unknown): void {
  if (!Array.isArray(input) || input.length === 0) return;
  const quotes = input.filter(
    (quote): quote is string => typeof quote === 'string' && quote.length > 0,
  );
  if (quotes.length) lines.push('', 'Evidence:', ...quotes.map((quote) => `  "${text(quote)}"`));
}

function details(lines: string[], envelope: JsonObject): void {
  const documents = Object.entries(feedbackObject(envelope.reference_docs));
  if (documents.length) {
    lines.push('', 'REFERENCE DOCUMENTS');
    for (const [name, verdict] of documents) {
      const document = feedbackObject(verdict);
      const satisfied =
        document.satisfied === true
          ? 'Satisfied'
          : document.satisfied === false
            ? 'Not satisfied'
            : '';
      lines.push(
        `${text(name)}  ${satisfied}`,
        ...(text(document.note) ? [`  ${text(document.note)}`] : []),
      );
    }
  }
  const method = feedbackObject(envelope.judging_method);
  if (typeof method.judges === 'number' || typeof method.trials === 'number') {
    lines.push('', 'JUDGING');
    if (typeof method.judges === 'number') lines.push(`Judges: ${method.judges}`);
    if (typeof method.trials === 'number') lines.push(`Trials: ${method.trials}`);
  }
  const reliability = Object.fromEntries(
    Object.entries(feedbackObject(envelope.reliability)).filter(([key]) =>
      [
        'vote_margin',
        'entropy',
        'k_eff',
        'tie_policy',
        'judge_agreement',
        'replicas_successful',
        'replicas_requested',
      ].includes(key),
    ),
  );
  if (Object.keys(reliability).length)
    lines.push('', 'RELIABILITY', text(JSON.stringify(reliability, null, 2)));
}

function renderItem(lines: string[], entry: FeedbackItem, expanded: boolean): void {
  if (entry.scenarioName || entry.scenarioId)
    lines.push(`Scenario: ${text(entry.scenarioName ?? entry.scenarioId)}`);
  if (entry.modelKey)
    lines.push(`Model: ${text(entry.modelName ?? entry.modelKey)} (${text(entry.modelKey)})`);
  if (entry.section !== 'response') lines.push(`Section: ${label(entry.section)}`);
  const hasFeedback = available(entry);
  if (!hasFeedback) lines.push('Judge feedback is not available for this section.');
  const envelope = entry.judgeFeedback ?? {};
  if (hasFeedback) {
    if (text(envelope.summary)) lines.push('', 'WHY THIS SCORE', text(envelope.summary));
    const flags = feedbackObject(envelope.flags);
    if (flags.safety_violation === true) lines.push('', 'Safety violation');
    if (flags.policy_violation === true) {
      if (flags.safety_violation !== true) lines.push('');
      lines.push('Policy violation');
    }
  }
  const criteria =
    entry.section === 'trajectory'
      ? (entry.dimensions ?? []).map((dimension) => ({
          key: text(dimension.key),
          criterion: dimension,
          divisor: 1,
        }))
      : Object.entries(feedbackObject(envelope.criteria)).map(([key, criterion]) => ({
          key,
          criterion: feedbackObject(criterion),
          divisor: 2,
        }));
  const scoredCriteria = criteria.filter(({ criterion }) => {
    const score = entry.section === 'trajectory' ? criterion.score : criterion.level;
    return typeof score === 'number';
  });
  if (scoredCriteria.length > 0) {
    const maxLabelLen = scoredCriteria.reduce((max, { key, criterion }) => {
      const l = (text(criterion.label) || label(text(key))).length;
      return Math.max(max, l);
    }, 'CRITERION'.length);
    const colWidth = Math.max(26, maxLabelLen + 2);
    lines.push('', `${'CRITERION'.padEnd(colWidth, ' ')}  SCORE`);
    for (const { key, criterion, divisor } of scoredCriteria) {
      const score = entry.section === 'trajectory' ? criterion.score : criterion.level;
      const criterionLabel = text(criterion.label) || label(text(key));
      const scoreText = typeof score === 'number' ? `${(score / divisor).toFixed(1)}/5` : '';
      lines.push(`${criterionLabel.padEnd(colWidth, ' ')}  ${scoreText}`);
    }
  }

  let evidenceCount = 0;
  if (hasFeedback) {
    for (const { key, criterion } of criteria) {
      const criterionTitle = (text(criterion.label) || label(text(key))).toUpperCase();
      lines.push('', criterionTitle);
      if (text(criterion.explanation)) lines.push(text(criterion.explanation));
      if (Array.isArray(criterion.evidence) && criterion.evidence.length) evidenceCount += 1;
      if (expanded) {
        evidence(lines, criterion.evidence);
        if (Array.isArray(criterion.step_ids) && criterion.step_ids.length) {
          const references = (criterion.step_ids as string[])
            .map((id) => {
              const step = entry.steps?.find((candidate) => candidate.step_id === id);
              return step ? `Step ${step.sequence}` : text(id);
            })
            .filter(Boolean);
          if (references.length) lines.push(`Related steps: ${references.join(', ')}`);
        }
      }
    }
  }
  if (hasFeedback && !expanded && evidenceCount)
    lines.push(
      '',
      `Evidence available for ${evidenceCount} criteria.`,
      'Use --details to show supporting quotes.',
    );
  if (entry.judgeResponses)
    lines.push(
      '',
      'JUDGE RESPONSES',
      `${entry.judgeResponses.successful}/${entry.judgeResponses.requested} completed`,
    );
  if (expanded && hasFeedback) details(lines, envelope);
}

export function renderJudgeFeedback(
  result: JudgeFeedbackResult,
  options: { details?: boolean } = {},
): string {
  const context = result.contextType === 'agent_trace' ? 'Agent Trace' : label(result.contextType);
  const hasScores = result.items.some((entry) =>
    entry.section === 'trajectory'
      ? (entry.dimensions ?? []).some((dimension) => typeof dimension.score === 'number')
      : Object.values(feedbackObject(entry.judgeFeedback?.criteria)).some(
          (criterion) => typeof feedbackObject(criterion).level === 'number',
        ),
  );
  const lines = ['JUDGE FEEDBACK', `Context: ${context}`];
  if (!result.items.some(available) && !hasScores) {
    lines.push(
      '',
      'Judge feedback is not available for this run.',
      'Scores remain available through autoeval results.',
    );
  } else if (result.contextType === 'scenario' && !options.details) {
    lines.push(
      '',
      formatTable(
        [{ header: 'SCENARIO' }, { header: 'MODEL' }, { header: 'FEEDBACK' }],
        result.items.map((entry) => [
          text(entry.scenarioName ?? entry.scenarioId),
          entry.modelName && entry.modelKey
            ? `${text(entry.modelName)} (${text(entry.modelKey)})`
            : text(entry.modelKey ?? entry.modelName),
          available(entry) ? label(text(entry.judgeFeedback?.status)) : 'Unavailable',
        ]),
      ),
    );
    lines.push(
      '',
      `${result.items.filter(available).length} of ${result.items.length} results have judge feedback.`,
      'To inspect a result:',
      `autoeval feedback ${result.evaluationId} ${result.runId} --scenario <name-or-id> --model <model-key> --details`,
    );
  } else {
    for (const entry of result.items) {
      lines.push('');
      renderItem(lines, entry, options.details === true);
    }
  }
  return `${lines.join('\n')}\n`;
}
