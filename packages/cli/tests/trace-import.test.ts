import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { configuredRunFileSchema } from '../src/configured-run/validation.js';
import { RuntimeCommandExecutor } from '../src/commands/executor.js';
import { loadConfiguration } from '../src/config.js';
import { AutoevalError } from '../src/errors/autoeval-error.js';
import { convertHarnessSession } from '../src/trace/deepseek-harness.js';
import { buildAgentTraceInput } from '../src/trace/import.js';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/deepseek-harness');

async function readFixture(name: string): Promise<string> {
  return readFile(resolve(fixtures, name), 'utf8');
}

type Attribute = { key: string; value: { stringValue: string } };
type Span = {
  spanId: string;
  parentSpanId?: string;
  name: string;
  attributes: Attribute[];
  status: { code: number };
  startTimeUnixNano: string;
  endTimeUnixNano: string;
};

function spansOf(conversion: ReturnType<typeof convertHarnessSession>): Span[] {
  const [resourceSpan] = conversion.artifact.trace.resourceSpans as {
    scopeSpans: { spans: Span[] }[];
  }[];
  const scopeSpan = resourceSpan?.scopeSpans[0];
  if (!scopeSpan) throw new Error('Conversion produced no scope spans.');
  return scopeSpan.spans;
}

function spanAt(spans: Span[], index: number): Span {
  const span = spans[index];
  if (!span) throw new Error(`Expected a span at index ${index}.`);
  return span;
}

function attribute(span: Span, key: string): string | undefined {
  return span.attributes.find((item) => item.key === key)?.value.stringValue;
}

class MemoryStream {
  value = '';
  isTTY = false;

  write(chunk: string): boolean {
    this.value += chunk;
    return true;
  }
}

function localExecutor(): RuntimeCommandExecutor {
  return new RuntimeCommandExecutor({
    configuration: loadConfiguration({ AUTOEVAL_API_BASE_URL: 'https://api.example.test' }),
    environment: {},
    stdout: new MemoryStream(),
    stderr: new MemoryStream(),
    stdin: { isTTY: false },
  });
}

describe('DeepSeek Harness session conversion', () => {
  it('maps a session to an OpenInference-annotated OTLP trace', async () => {
    const conversion = convertHarnessSession({ content: await readFixture('session.jsonl') });
    const spans = spansOf(conversion);
    const root = spanAt(spans, 0);

    expect(attribute(root, 'openinference.span.kind')).toBe('AGENT');
    expect(attribute(root, 'input.value')).toContain('temperature in Example City');
    expect(attribute(root, 'output.value')).toContain('18 degrees Celsius');
    expect(conversion.stats).toMatchObject({
      spans: 4,
      llmSpans: 1,
      toolSpans: 2,
      unpairedToolCalls: 0,
      syntheticTimestamps: false,
    });
    expect(spans.slice(1).every((span) => span.parentSpanId === root.spanId)).toBe(true);
  });

  it('pairs tool calls with results on callId and preserves raw arguments', async () => {
    const spans = spansOf(
      convertHarnessSession({ content: await readFixture('session.jsonl') }),
    ).filter((span) => attribute(span, 'openinference.span.kind') === 'TOOL');

    expect(spans.map((span) => attribute(span, 'tool.name'))).toEqual([
      'weather.lookup',
      'weather.forecast',
    ]);
    const lookup = spanAt(spans, 0);
    expect(attribute(lookup, 'input.value')).toBe('{"city":"Example City","units":"celsius"}');
    expect(attribute(lookup, 'output.value')).toContain('temperature_c');
  });

  it('marks a tool result carrying an error as a failed span', async () => {
    const spans = spansOf(convertHarnessSession({ content: await readFixture('session.jsonl') }));
    const failed = spans.find((span) => attribute(span, 'tool.name') === 'weather.forecast');

    expect(failed?.status.code).toBe(2);
  });

  it('emits a failed span and counts a tool call that never produced a result', () => {
    const conversion = convertHarnessSession({
      content: [
        '{"type":"user/message","timestamp":"2030-01-01T09:00:00.000Z","data":{"message":{"role":"user","content":"hi"}}}',
        '{"type":"tool/call","timestamp":"2030-01-01T09:00:01.000Z","data":{"callId":"call-9","name":"search","arguments":"{}"}}',
      ].join('\n'),
    });

    expect(conversion.stats.unpairedToolCalls).toBe(1);
    expect(spansOf(conversion).at(-1)?.status.code).toBe(2);
  });

  it('falls back to ordering-only timestamps when the log carries none', () => {
    const conversion = convertHarnessSession({
      content: [
        '{"type":"user/message","data":{"message":{"role":"user","content":"hi"}}}',
        '{"type":"assistant/message","data":{"message":{"role":"assistant","content":"hello"}}}',
      ].join('\n'),
    });
    const spans = spansOf(conversion);

    expect(conversion.stats.syntheticTimestamps).toBe(true);
    const root = spanAt(spans, 0);
    expect(BigInt(root.endTimeUnixNano)).toBeGreaterThan(BigInt(root.startTimeUnixNano));
  });

  it('reports skipped subagent activity instead of merging it', () => {
    const conversion = convertHarnessSession({
      content: [
        '{"type":"user/message","data":{"message":{"role":"user","content":"hi"}}}',
        '{"type":"subagent/start","data":{"sessionId":"child-1"}}',
      ].join('\n'),
    });

    expect(conversion.stats.skippedSubagentSessions).toBe(1);
  });

  it('rejects a compressed session log with an actionable hint', () => {
    expect(() =>
      convertHarnessSession({ content: '\u0028\u00b5\u002f\u00fd\u0000binary' }),
    ).toThrow(/Zstandard-compressed/u);
  });

  it('rejects a log with no recognizable events', () => {
    expect(() => convertHarnessSession({ content: '{"version":1,"id":"abc"}' })).toThrow(
      AutoevalError,
    );
  });

  it('rejects a session that exceeds the event limit', () => {
    const event = '{"type":"user/message","data":{"message":{"role":"user","content":"hi"}}}';
    expect(() =>
      convertHarnessSession({ content: Array.from({ length: 100_001 }, () => event).join('\n') }),
    ).toThrow(/100000 event limit/u);
  });
});

describe('trace import filesystem boundaries', () => {
  it('does not overwrite an existing output file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'autoeval-trace-'));
    const sessionFile = join(directory, 'session.jsonl');
    const templateFile = join(directory, 'template.json');
    const outputFile = join(directory, 'output.json');
    try {
      await writeFile(sessionFile, await readFixture('session.jsonl'), 'utf8');
      await writeFile(templateFile, await readFixture('template.json'), 'utf8');
      await writeFile(outputFile, 'keep me', 'utf8');

      await expect(
        localExecutor().execute(
          {
            kind: 'trace-import',
            source: 'deepseek-harness',
            sessionFile,
            templateFile,
            outputFile,
            run: false,
          },
          { json: false, debug: false },
        ),
      ).rejects.toMatchObject({ code: 'TRACE_OUTPUT_EXISTS' });
      expect(await readFile(outputFile, 'utf8')).toBe('keep me');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects an oversized template before parsing it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'autoeval-trace-limit-'));
    const sessionFile = join(directory, 'session.jsonl');
    const templateFile = join(directory, 'template.json');
    const outputFile = join(directory, 'output.json');
    try {
      await writeFile(sessionFile, await readFixture('session.jsonl'), 'utf8');
      await writeFile(templateFile, Buffer.alloc(1024 * 1024 + 1, 0x20));

      await expect(
        localExecutor().execute(
          {
            kind: 'trace-import',
            source: 'deepseek-harness',
            sessionFile,
            templateFile,
            outputFile,
            run: false,
          },
          { json: false, debug: false },
        ),
      ).rejects.toMatchObject({ code: 'TRACE_TEMPLATE_READ_FAILED' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('agent_trace import composition', () => {
  it('produces input that satisfies the configured-run schema', async () => {
    const conversion = convertHarnessSession({ content: await readFixture('session.jsonl') });
    const input = buildAgentTraceInput({
      template: JSON.parse(await readFixture('template.json')) as unknown,
      conversion,
    });

    const parsed = configuredRunFileSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    expect((input.configuration as { contextType: string }).contextType).toBe('agent_trace');
    expect((input.configuration as { artifact: unknown }).artifact).toEqual(conversion.artifact);
  });

  it('overrides the evaluation name when one is supplied', async () => {
    const input = buildAgentTraceInput({
      template: JSON.parse(await readFixture('template.json')) as unknown,
      conversion: convertHarnessSession({ content: await readFixture('session.jsonl') }),
      evaluationName: '[Agent Trace] Nightly harness run',
    });

    expect((input.configuration as { evaluationName: string }).evaluationName).toBe(
      '[Agent Trace] Nightly harness run',
    );
  });

  it('rejects a template that is missing the judge methodology', async () => {
    const conversion = convertHarnessSession({ content: await readFixture('session.jsonl') });

    expect(() => buildAgentTraceInput({ template: { configuration: {} }, conversion })).toThrow(
      AutoevalError,
    );
  });
});

/**
 * The fixtures below are unmodified session logs from the DeepSeek Harness
 * snapshot suite (deepseek-ai/deepseek-harness, MIT). Synthetic fixtures hid
 * real shapes: the header is a typed `session` event, no event carries a
 * timestamp, tool results reference their call only via the message source or
 * the `tool-result` part, and an assistant turn that invokes a tool has no
 * text content at all.
 */
describe('convertHarnessSession with real Harness session logs', () => {
  it('preserves the execution story in order for a search round', async () => {
    const conversion = convertHarnessSession({
      content: await readFixture('real-web-search-session.jsonl'),
    });
    const spans = spansOf(conversion);

    expect(spans.map((span) => span.name)).toEqual([
      'agent.run',
      'llm.respond',
      'tool.web_search',
      'llm.respond',
    ]);
    // Every child hangs off the root and starts after the step before it.
    for (const [index, span] of spans.slice(1).entries()) {
      expect(span.parentSpanId).toBe(spanAt(spans, 0).spanId);
      if (index > 0) {
        expect(Number(span.startTimeUnixNano)).toBeGreaterThan(
          Number(spanAt(spans, index).startTimeUnixNano),
        );
      }
    }

    expect(conversion.stats.unpairedToolCalls).toBe(0);
    expect(conversion.stats.llmSpans).toBe(2);
    expect(conversion.stats.toolSpans).toBe(1);
  });

  it('records the tool call the assistant made and the result it received', async () => {
    const spans = spansOf(
      convertHarnessSession({ content: await readFixture('real-web-search-session.jsonl') }),
    );

    // The assistant turn carried only a tool-call part, so the span must still
    // show the call rather than convert to an empty step.
    expect(attribute(spanAt(spans, 1), 'output.value')).toContain('→ web_search(');
    expect(attribute(spanAt(spans, 2), 'tool.name')).toBe('web_search');
    expect(attribute(spanAt(spans, 2), 'input.value')).toContain('DeepSeek Harness snapshot');
    // The result text nests one level deeper than the other content parts.
    expect(attribute(spanAt(spans, 2), 'output.value')).toContain('Snapshot Search 1 Result 1');
  });

  it('uses the developer prompt, not the injected runtime-context message', async () => {
    const conversion = convertHarnessSession({
      content: await readFixture('real-web-search-session.jsonl'),
    });

    expect(conversion.input).toContain('Use web_search once with queries');
    expect(conversion.input).not.toContain('Current runtime context');
    expect(conversion.output).toBe('SEARCH_DONE');
  });

  it('anchors spans at the session start recorded in the header', async () => {
    const conversion = convertHarnessSession({
      content: await readFixture('real-web-search-session.jsonl'),
    });
    const spans = spansOf(conversion);

    // No event in a Harness log carries a timestamp; only the header does.
    expect(conversion.stats.syntheticTimestamps).toBe(true);
    expect(Number(spanAt(spans, 0).startTimeUnixNano)).toBe(1787736507309 * 1_000_000);
  });

  it('marks failed tool results as errors and keeps the retry visible', async () => {
    const spans = spansOf(
      convertHarnessSession({ content: await readFixture('real-tool-failure-session.jsonl') }),
    );
    const tools = spans.filter((span) => span.name.startsWith('tool.'));

    expect(tools).toHaveLength(2);
    for (const tool of tools) {
      expect(tool.status.code).toBe(2);
      expect(attribute(tool, 'output.value')).toContain('edit requires reading');
    }
  });
});
