import Table from 'cli-table3';

import {
  importBatchSchema,
  importEntryCount,
  importReviewSchema,
  importStatusSchema,
  type ParsedImportCommand,
} from '../actions/imports.js';
import { safeTerminalText } from './safe-text.js';
import { formatTable } from './table.js';

type RecordValue = Record<string, unknown>;
function record(input: unknown): RecordValue {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? (input as RecordValue)
    : {};
}
function records(input: unknown): RecordValue[] {
  return Array.isArray(input) ? input.map(record) : [];
}
function text(input: unknown): string {
  if (input === null || input === undefined) return '\u2014';
  return safeTerminalText(typeof input === 'string' ? input : JSON.stringify(input));
}
function date(input: unknown): string {
  if ((typeof input !== 'string' && typeof input !== 'number') || input === '') return '\u2014';
  const parsed = new Date(typeof input === 'number' ? input * 1000 : input);
  return Number.isNaN(parsed.getTime()) ? '\u2014' : parsed.toISOString().slice(0, 10);
}
function percent(input: unknown): string {
  return typeof input === 'number' ? `${(input * 100).toFixed(1)}%` : '\u2014';
}
function timestamp(input: unknown): number {
  const parsed =
    typeof input === 'number' ? input * 1000 : typeof input === 'string' ? Date.parse(input) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}
function table(head: string[], rows: unknown[][], width?: number): string {
  const available =
    width === undefined
      ? undefined
      : Math.max(head.length * 10, Math.floor(width) - head.length - 2);
  const output = new Table({
    head,
    wordWrap: true,
    wrapOnWordBoundary: true,
    colWidths: head.map((heading, index) =>
      available === undefined
        ? heading.includes('ID')
          ? 40
          : heading === 'NAME'
            ? 32
            : 16
        : Math.floor(available / head.length) + (index < available % head.length ? 1 : 0),
    ),
  });
  rows.forEach((row) => output.push(row.map(text)));
  return `${output.toString()}\n`;
}
function entry(input: unknown): RecordValue {
  return typeof input === 'string' ? { openai_eval_id: input } : record(input);
}

export function renderImport(command: ParsedImportCommand, response: unknown): string {
  const envelope = record(response);
  switch (command.operation) {
    case 'status': {
      const status = importStatusSchema.parse(response);
      let hint = '';
      if (!status.key_present) {
        hint =
          "Hint: Add an OpenAI key in the Plumloom UI under AI Providers & Models. Run 'autoeval import status --json' for the machine state.\n";
      } else if (status.evals_access === 'forbidden') {
        hint =
          'Hint: Enable Evals access for the configured OpenAI key, then run autoeval import connect.\n';
      } else if (status.evals_access === 'unreachable') {
        hint = 'Hint: OpenAI is unreachable. Try autoeval import connect again later.\n';
      } else if (
        status.evals_access === null ||
        status.evals_access === 'not_ready' ||
        status.cache_status !== 'warm'
      ) {
        hint = "Hint: Run 'autoeval import connect' to check access and warm the cache.\n";
      }
      const accessLabel =
        !status.key_present || status.evals_access === null || status.evals_access === 'not_ready'
          ? 'not ready'
          : status.evals_access;
      const cacheLine =
        status.key_present && status.evals_access === 'ready'
          ? `Cached list:  ${status.cache_status ?? 'unknown'}${status.cache_status === 'warm' ? " (run 'autoeval import review' to list)" : ''}\n`
          : '';
      return `OpenAI key:    ${status.key_present ? `present${status.key_suffix ? ` (...${text(status.key_suffix)})` : ''}` : 'no key'}\nEvals access: ${accessLabel}\n${cacheLine}${hint}`;
    }
    case 'connect':
      return `Connected to OpenAI.\nEvals found: ${text(envelope.total ?? envelope.eval_count ?? envelope.total_evals)}\nRun 'autoeval import review' to choose what to import.\n`;
    case 'disconnect':
      return 'Disconnected. Cached OpenAI eval list cleared.\nYour OpenAI key and imported evaluations are unchanged.\n';
    case 'review': {
      const page = importReviewSchema.parse(response);
      if (page.evals.length === 0) {
        return `No OpenAI evaluations found.\nShowing 0-0 of ${page.total}.${page.total > 0 ? ' Try an earlier page or adjust --search.' : ''}\n`;
      }
      const start = page.evals.length ? (command.all ? 1 : (page.page - 1) * page.size + 1) : 0;
      return (
        formatTable(
          [
            { header: 'OPENAI EVAL ID' },
            { header: 'NAME', maxWidth: 36 },
            { header: 'CREATED', minWidth: 10 },
            { header: 'LAST RUN', minWidth: 10 },
            { header: 'RUNS', align: 'right' },
            { header: 'IMPORTED' },
          ],
          page.evals.map((evaluation) => [
            text(evaluation.openai_eval_id ?? evaluation.id),
            text(evaluation.name),
            date(evaluation.created_at),
            date(evaluation.last_run_at),
            text(evaluation.run_count),
            evaluation.already_imported ? 'yes' : 'no',
          ]),
        ) +
        '\n' +
        `Showing ${start}-${start ? start + page.evals.length - 1 : 0} of ${page.total}.${!command.all && page.page * page.size < page.total ? ` --page ${page.page + 1} for more, or --search <text>.` : ''}\n`
      );
    }
    case 'run': {
      const summary = importBatchSchema.parse(response);
      const lines: string[] = [];
      for (const [label, entries] of [
        ['OK', summary.imported],
        ['SKIP', summary.skipped],
        ['FAIL', summary.failed],
      ] as const) {
        if (typeof entries === 'number') continue;
        for (const item of entries) {
          const evaluation = entry(item);
          lines.push(
            `  ${label} ${text(evaluation.name ?? evaluation.eval_name ?? '')} (${text(evaluation.openai_eval_id ?? evaluation.eval_id ?? evaluation.id)})${label === 'SKIP' ? ' already imported - skipped' : label === 'FAIL' ? ` ${text(evaluation.error ?? evaluation.reason ?? 'Import failed')}` : ` ${text(evaluation.run_count ?? evaluation.runs_imported)} runs, ${text(evaluation.result_count ?? evaluation.results_imported)} results`}`,
          );
        }
      }
      lines.push(
        `Imported ${importEntryCount(summary.imported)}, skipped ${importEntryCount(summary.skipped)}, failed ${summary.failed.length}.`,
      );
      if (summary.workspace_id)
        lines.push(
          `Workspace: Imported from OpenAI (${summary.workspace_id})`,
          `Next: autoeval import insights --workspace ${summary.workspace_id}`,
        );
      return `${lines.join('\n')}\n`;
    }
    case 'list':
      return table(
        ['WORKSPACE ID', 'NAME', 'EVALS', 'CREATED'],
        records(Array.isArray(response) ? response : envelope.workspaces).map((workspace) => [
          workspace.workspace_id ?? workspace.id,
          workspace.name,
          workspace.eval_count,
          date(workspace.created_at),
        ]),
      );
    case 'evals': {
      const page = {
        page: typeof envelope.page === 'number' ? envelope.page : command.page,
        page_size: typeof envelope.page_size === 'number' ? envelope.page_size : command.size,
        total: typeof envelope.total === 'number' ? envelope.total : 0,
        workspace: record(envelope.workspace),
        items: records(envelope.items),
      };
      const heading = `${text(page.workspace.name)} (${text(page.workspace.workspace_id)})\n`;
      if (page.items.length === 0) {
        return `${heading}No imported evaluations found.\nShowing 0-0 of ${page.total}.${page.total > 0 ? ' Try an earlier page or adjust --search.' : ''}\n`;
      }
      const start = (page.page - 1) * page.page_size + 1;
      const rows: string[][] = page.items.map((evaluation): string[] => [
        text(evaluation.eval_id),
        text(evaluation.name),
        text(evaluation.run_count),
        date(evaluation.last_run_at),
        text(evaluation.openai_eval_id),
      ]);
      return (
        heading +
        formatTable(
          [
            { header: 'EVAL ID (plumloom)', atomic: true },
            { header: 'NAME', maxWidth: 32 },
            { header: 'RUNS', align: 'right' },
            { header: 'LAST RUN', minWidth: 10 },
            { header: 'OPENAI EVAL ID', atomic: true },
          ],
          rows,
        ) +
        `\nShowing ${start}-${start + page.items.length - 1} of ${page.total}.${page.page * page.page_size < page.total ? ` --page ${page.page + 1} for more, or --search <text>.` : ''}\n`
      );
    }
    case 'remove':
      return `Removed. (eval_id ${command.evaluationId})\n`;
    case 'show':
      return renderImportedEvaluation(command, envelope);
    case 'insights':
      return renderImportInsights(envelope);
  }
}

function renderImportedEvaluation(
  command: Extract<ParsedImportCommand, { operation: 'show' }>,
  envelope: RecordValue,
): string {
  const evaluation = record(envelope.eval);
  const lines = [
    text(evaluation.name),
    `Source: OpenAI (${text(evaluation.openai_eval_id)})   Imported: ${date(evaluation.imported_at)}`,
  ];
  if (evaluation.description) lines.push(text(evaluation.description));
  lines.push('', 'Graders');
  const graders = records(
    evaluation.graders ?? record(evaluation.raw_json ?? envelope.raw_json).testing_criteria,
  );
  for (const grader of graders) lines.push(`  ${text(grader.name)} (${text(grader.type)})`);
  if (graders.length === 0) lines.push('  None reported.');
  const runs = records(envelope.runs).sort(
    (left, right) => timestamp(right.run_created_at) - timestamp(left.run_created_at),
  );
  lines.push('', 'Run history');
  runs.forEach((run, index) => {
    const model =
      typeof run.model === 'string' && run.model.trim() !== '' ? text(run.model) : 'unknown';
    lines.push(
      `  run ${runs.length - index}   ${model}   ${date(run.run_created_at)}   ${text(run.passed_count)}/${text(run.total_count)} passed`,
    );
  });
  if (runs.length === 0) lines.push('  No runs available.');
  const selectedIndex = command.run
    ? runs.findIndex((run) => (run.openai_run_id ?? run.id) === command.run)
    : runs.length
      ? 0
      : -1;
  const selectedLabel =
    selectedIndex >= 0 ? `run ${runs.length - selectedIndex}` : text(command.run ?? 'no run');
  const resultPage = record(envelope.results);
  const results = records(Array.isArray(envelope.results) ? envelope.results : resultPage.items);
  lines.push(
    '',
    `Results (${selectedLabel})${command.showOutputs ? '' : '  [--show-outputs for input/expected/output]'}`,
  );
  for (const result of results) {
    const passed = result.passed ?? result.pass;
    lines.push(
      `  ${passed === true ? '\u2713 pass' : passed === false ? '\u2717 fail' : '-'}  ${text(result.name ?? result.input).slice(0, 90)}`,
    );
    if (command.showOutputs) {
      const cells = [
        result.input,
        ...(result.expected === '' || result.expected === null || result.expected === undefined
          ? []
          : [result.expected]),
        result.output,
      ];
      const headings = cells.length === 2 ? ['INPUT', 'OUTPUT'] : ['INPUT', 'EXPECTED', 'OUTPUT'];
      lines.push(
        table(headings, [cells], process.stdout.columns ?? process.stderr.columns ?? 100).trimEnd(),
      );
    }
  }
  if (!results.length) lines.push('  No results on this page.');
  const pageNumber =
    typeof resultPage.page === 'number'
      ? resultPage.page
      : typeof envelope.page === 'number'
        ? envelope.page
        : command.page;
  const pageSize =
    typeof resultPage.page_size === 'number'
      ? resultPage.page_size
      : typeof envelope.page_size === 'number'
        ? envelope.page_size
        : command.size;
  if (typeof resultPage.total === 'number') {
    const start = results.length ? (pageNumber - 1) * pageSize + 1 : 0;
    lines.push(
      `Showing ${start}-${results.length ? start + results.length - 1 : 0} of ${resultPage.total} results.${pageNumber * pageSize < resultPage.total ? ` --page ${pageNumber + 1} for more.` : ''}`,
    );
  }
  lines.push(
    '',
    `Page ${pageNumber}; size ${pageSize}.`,
    'Hint: Use --json for the full record, including raw_json and OpenAI run IDs.',
  );
  return `${lines.join('\n')}\n`;
}

function renderImportInsights(envelope: RecordValue): string {
  const totals = record(envelope.totals);
  const readiness = record(envelope.migration_readiness);
  const row = (marker: string, name: unknown, detail = ''): string =>
    `  ${marker ? `${marker} ` : ''}${text(name).padEnd(36)}${detail ? `  ${detail}` : ''}`.trimEnd();
  const lines = [
    `${text(envelope.workspace_name ?? 'Imported from OpenAI')} \u2014 insights            (Derived by Plumloom)`,
    '',
    'Totals',
    `  Evals ${text(totals.evals ?? totals.eval_count)}   Runs ${text(totals.runs ?? totals.run_count)}   Results ${text(totals.results ?? totals.result_count)}   Pass rate ${percent(totals.pass_rate)}   Last run ${date(totals.last_run)}`,
    '',
    `Migration readiness   ${text(readiness.ready)} of ${text(readiness.total ?? totals.evals ?? totals.eval_count)} ready`,
  ];
  for (const evaluation of records(
    Array.isArray(envelope.migration_readiness) ? envelope.migration_readiness : readiness.evals,
  ))
    lines.push(
      row(
        evaluation.ready === true ? '\u2713' : '\u2717',
        evaluation.name,
        evaluation.reason ? text(evaluation.reason) : '',
      ),
    );
  lines.push('', 'Going stale (>30d or never run)');
  const stale = records(envelope.going_stale);
  lines.push(
    ...(stale.length
      ? stale.map((evaluation) =>
          row('\u2022', evaluation.name, `last run ${date(evaluation.last_run_at)}`),
        )
      : ['  none flagged']),
  );
  lines.push('', 'Pass-rate trend');
  const trends = records(envelope.pass_rate_trend);
  lines.push(
    ...(trends.length
      ? trends.map((evaluation) => {
          const points = records(evaluation.points).sort(
            (left, right) => timestamp(left.run_created_at) - timestamp(right.run_created_at),
          );
          const rates = points.map((point) => percent(point.pass_rate));
          return row(
            '',
            evaluation.name,
            `${rates.length ? rates.join(' \u2192 ') : 'no runs available'}${rates.length === 1 ? ' (single run)' : ''}`,
          );
        })
      : ['  single run or no trend available']),
  );
  lines.push('', 'Flaky graders (swing \u2265 25pts)');
  const flaky = records(envelope.flaky_graders).filter((grader) => grader.flagged === true);
  lines.push(
    ...(flaky.length
      ? flaky.flatMap((grader) => {
          const swing =
            typeof grader.swing === 'number' ? `${(grader.swing * 100).toFixed(1)} pts` : '\u2014';
          const evalIds = records(grader.evals).map((evaluation) => text(evaluation.eval_id));
          return [
            row(
              '\u2022',
              grader.name ?? grader.grader_name ?? grader.grader_type ?? 'Unknown grader',
              `swing ${swing}`,
            ),
            ...(evalIds.length ? [`    Evals: ${evalIds.join(', ')}`] : []),
          ];
        })
      : ['  none flagged']),
  );
  return `${lines.join('\n')}\n`;
}
