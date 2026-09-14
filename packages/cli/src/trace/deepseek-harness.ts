/**
 * DeepSeek Harness session -> Autoeval agent_trace artifact.
 *
 * The Harness records an agent session as an append-only log of typed
 * `SessionEvent`s, one JSONL line per event. Autoeval's `agent_trace` context
 * evaluates an OTLP export annotated with OpenInference span kinds. Those are
 * different shapes, so the conversion lives here — in the OSS CLI, where it is
 * unit-testable and usable without the Harness installed.
 *
 * Mapping (pinned to Harness dsh-v0.1.x event names):
 *   session            -> root AGENT span
 *   assistant/message  -> child LLM span
 *   tool/call + tool/result (joined on callId) -> child TOOL span
 *
 * Only the root session is imported. Subagents run in their own child sessions
 * with their own logs; those are counted and reported, not merged.
 */
import { AutoevalError } from '../errors/autoeval-error.js';

/** Harness event names this converter understands. */
const SUPPORTED_SCHEMA = 'dsh-v0.1.x';

const ZSTANDARD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

const NANOS_PER_MILLISECOND = 1_000_000n;
/** Synthetic span duration when the log carries no usable timestamps. */
const FALLBACK_SPAN_STEP_MS = 1;
const MAX_HARNESS_EVENTS = 100_000;

export type HarnessSpanKind = 'AGENT' | 'LLM' | 'TOOL';

export type HarnessImportStats = {
  schema: string;
  events: number;
  spans: number;
  llmSpans: number;
  toolSpans: number;
  unpairedToolCalls: number;
  skippedSubagentSessions: number;
  syntheticTimestamps: boolean;
};

export type HarnessTraceConversion = {
  /** Exactly the shape `configuration.artifact` expects for `agent_trace`. */
  artifact: { trace: { resourceSpans: unknown[] } };
  serviceName: string;
  input: string | undefined;
  output: string | undefined;
  stats: HarnessImportStats;
};

type JsonRecord = Record<string, unknown>;

type HarnessEvent = {
  type: string;
  timestampMs: number | undefined;
  payload: JsonRecord;
};

function usageError(message: string, code: string, cause?: unknown): AutoevalError {
  return new AutoevalError(message, { kind: 'usage', code, ...(cause ? { cause } : {}) });
}

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function firstString(record: JsonRecord, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return undefined;
}

function firstRecord(record: JsonRecord, keys: readonly string[]): JsonRecord | undefined {
  for (const key of keys) {
    const value = asRecord(record[key]);
    if (value) return value;
  }
  return undefined;
}

function toEpochMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

/**
 * The Harness persists a session as concatenated Zstandard frames by default.
 * Decompression is not bundled, so a compressed log is rejected with the
 * setting that produces raw lines instead of a JSON parse error.
 */
function rejectCompressedLog(content: string): void {
  const head = Buffer.from(content.slice(0, 4), 'utf8');
  if (head.subarray(0, 4).equals(ZSTANDARD_MAGIC) || content.includes('\u0000')) {
    throw usageError(
      'The session log looks Zstandard-compressed. Configure the JSONL session persistence plugin to write raw lines, or decompress the log before importing it.',
      'HARNESS_SESSION_COMPRESSED',
    );
  }
}

/**
 * Event envelopes carry the type under `type`/`event`/`kind` and the body
 * either inline or nested under `data`/`payload`, depending on the writer.
 * Both shapes are accepted so an import does not hinge on that detail.
 */
function readEvent(line: string, lineNumber: number): HarnessEvent | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch (error) {
    throw usageError(
      `Session log line ${lineNumber} is not valid JSON. Expected one JSON event per line.`,
      'HARNESS_SESSION_INVALID_JSON',
      error,
    );
  }
  const record = asRecord(parsed);
  if (!record) return undefined;
  const type = firstString(record, ['type', 'event', 'kind']);
  if (!type) return undefined;
  const payload = firstRecord(record, ['data', 'payload', 'body']) ?? record;
  return {
    type,
    timestampMs: toEpochMs(record.timestamp ?? record.time ?? record.ts ?? record.at),
    payload,
  };
}

/**
 * Renders a Harness message body as text.
 *
 * Content parts nest: a `tool-result` part carries its own `content` array of
 * text parts, so blocks are flattened recursively. `tool-call` parts hold no
 * text at all — they are rendered as a readable call line, otherwise an
 * assistant turn that only invoked a tool would convert to an empty span and
 * the trajectory would lose that step.
 */
function messageText(message: unknown): string {
  const record = asRecord(message);
  if (!record) return typeof message === 'string' ? message : '';
  const content = record.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => blockText(block))
      .filter((text) => text !== '')
      .join('\n');
  }
  return firstString(record, ['text', 'value']) ?? '';
}

function blockText(block: unknown): string {
  const record = asRecord(block);
  if (!record) return typeof block === 'string' ? block : '';
  if (record.type === 'tool-call') {
    const name = firstString(record, ['name', 'toolName']) ?? 'tool';
    const args =
      typeof record.arguments === 'string'
        ? record.arguments
        : JSON.stringify(record.arguments ?? {});
    return `→ ${name}(${args})`;
  }
  const direct = firstString(record, ['text', 'reasoning', 'value']);
  if (direct !== undefined) return direct;
  const nested = record.content;
  if (typeof nested === 'string') return nested;
  if (Array.isArray(nested)) {
    return nested
      .map((child) => blockText(child))
      .filter((text) => text !== '')
      .join('\n');
  }
  return '';
}

/**
 * Resolves the tool call this event belongs to. The Harness records the id in
 * three different places depending on the event: top-level on `tool/call`, and
 * on `tool/result` under the message source and on each `tool-result` part.
 */
function toolCallId(payload: JsonRecord): string | undefined {
  const direct = firstString(payload, ['callId', 'call_id', 'toolCallId']);
  if (direct !== undefined) return direct;
  const message = asRecord(payload.message);
  if (!message) return undefined;
  const fromSource = firstString(asRecord(message.source) ?? {}, ['callId', 'call_id']);
  if (fromSource !== undefined) return fromSource;
  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      const id = firstString(asRecord(block) ?? {}, ['toolCallId', 'callId', 'call_id']);
      if (id !== undefined) return id;
    }
  }
  return undefined;
}

/** A tool result is a failure via the event-level error or a part-level flag. */
function toolResultFailed(payload: JsonRecord): boolean {
  if (asRecord(payload.error) !== undefined) return true;
  const content = asRecord(payload.message)?.content;
  return Array.isArray(content) && content.some((block) => asRecord(block)?.isError === true);
}

/**
 * True for messages the Harness injects on the model's behalf (runtime-context
 * snapshots from system-prompt plugins). They are recorded with `role: "user"`
 * but are not what the developer asked for, so they must not become the
 * trajectory's input.
 */
function isRealUserMessage(payload: JsonRecord): boolean {
  const kind = firstString(asRecord(payload.source) ?? {}, ['kind']);
  return kind === undefined || kind === 'user';
}

function attribute(key: string, value: string): JsonRecord {
  return { key, value: { stringValue: value } };
}

function hex(value: number, width: number): string {
  return value.toString(16).padStart(width, '0');
}

type SpanDraft = {
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  openInferenceKind: HarnessSpanKind;
  startMs: number;
  endMs: number;
  input: string;
  output: string;
  toolName?: string;
  failed: boolean;
};

function toOtlpSpan(draft: SpanDraft, traceId: string): JsonRecord {
  const attributes: JsonRecord[] = [
    attribute('openinference.span.kind', draft.openInferenceKind),
    ...(draft.toolName ? [attribute('tool.name', draft.toolName)] : []),
    attribute('input.value', draft.input),
    attribute('output.value', draft.output),
  ];
  return {
    traceId,
    spanId: draft.spanId,
    ...(draft.parentSpanId ? { parentSpanId: draft.parentSpanId } : {}),
    name: draft.name,
    kind: draft.kind,
    startTimeUnixNano: (BigInt(Math.round(draft.startMs)) * NANOS_PER_MILLISECOND).toString(),
    endTimeUnixNano: (BigInt(Math.round(draft.endMs)) * NANOS_PER_MILLISECOND).toString(),
    attributes,
    status: { code: draft.failed ? 2 : 1 },
  };
}

export type HarnessConversionInput = {
  /** Raw JSONL session log content. */
  content: string;
  /** Overrides the `service.name` resource attribute. */
  serviceName?: string;
};

export function convertHarnessSession(input: HarnessConversionInput): HarnessTraceConversion {
  rejectCompressedLog(input.content);

  const events: HarnessEvent[] = [];
  let header: JsonRecord | undefined;
  const lines = input.content.split('\n');
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line === '') continue;
    const event = readEvent(line, index + 1);
    if (event) {
      // The Harness writes its SessionHeader as a typed `session` event on the
      // first line rather than as a bare object, so it carries the session id
      // and wall-clock start that the rest of the log omits.
      if (event.type === 'session' && !header) header = event.payload;
      events.push(event);
      if (events.length > MAX_HARNESS_EVENTS) {
        throw usageError(
          `The session log exceeds the ${MAX_HARNESS_EVENTS} event limit.`,
          'HARNESS_SESSION_TOO_MANY_EVENTS',
        );
      }
      continue;
    }
    // Tolerate a writer that emits the header as a leading untyped object.
    const record = asRecord(JSON.parse(line) as unknown);
    if (record && !header) header = record;
  }

  if (events.length === 0) {
    throw usageError(
      'The session log contains no recognizable Harness session events.',
      'HARNESS_SESSION_EMPTY',
    );
  }

  const timestamps = events
    .map((event) => event.timestampMs)
    .filter((value): value is number => value !== undefined);
  // Harness events carry no per-event timestamp; only the header records when
  // the session began. Anchor synthetic times there so spans land at the real
  // wall-clock moment even though their ordering is all that is meaningful.
  const syntheticTimestamps = timestamps.length === 0;
  const headerStartMs = toEpochMs(header?.createdAt ?? header?.startedAt);
  const sessionStartMs = syntheticTimestamps
    ? (headerStartMs ?? 0)
    : Math.min(...timestamps, headerStartMs ?? Number.POSITIVE_INFINITY);

  let syntheticCursor = 0;
  const timeOf = (event: HarnessEvent): number => {
    if (event.timestampMs !== undefined) return event.timestampMs;
    syntheticCursor += FALLBACK_SPAN_STEP_MS;
    return sessionStartMs + syntheticCursor;
  };

  const sessionId = firstString(header ?? {}, ['id', 'sessionId']) ?? 'harness-session';
  const traceId = Buffer.from(sessionId).toString('hex').padEnd(32, '0').slice(0, 32);
  const rootSpanId = hex(1, 16);

  const children: SpanDraft[] = [];
  const pendingToolCalls = new Map<string, { name: string; args: string; startMs: number }>();
  let firstUserMessage: string | undefined;
  let lastAssistantMessage: string | undefined;
  let unpairedToolCalls = 0;
  let sequence = 1;
  let lastEventMs = sessionStartMs;

  const nextSpanId = (): string => {
    sequence += 1;
    return hex(sequence, 16);
  };

  for (const event of events) {
    const at = timeOf(event);
    lastEventMs = Math.max(lastEventMs, at);

    if (event.type === 'user/message') {
      if (!isRealUserMessage(event.payload)) continue;
      const text = messageText(event.payload.message ?? event.payload);
      if (firstUserMessage === undefined && text !== '') firstUserMessage = text;
      continue;
    }

    if (event.type === 'assistant/message') {
      const text = messageText(event.payload.message ?? event.payload);
      if (text !== '') lastAssistantMessage = text;
      children.push({
        spanId: nextSpanId(),
        parentSpanId: rootSpanId,
        name: 'llm.respond',
        kind: 1,
        openInferenceKind: 'LLM',
        startMs: at,
        endMs: at + FALLBACK_SPAN_STEP_MS,
        input: firstUserMessage ?? '',
        output: text,
        failed: event.payload.interrupted === true,
      });
      continue;
    }

    if (event.type === 'tool/call') {
      const callId = toolCallId(event.payload) ?? firstString(event.payload, ['id']);
      const name = firstString(event.payload, ['name', 'toolName']) ?? 'tool';
      const args =
        typeof event.payload.arguments === 'string'
          ? event.payload.arguments
          : JSON.stringify(event.payload.arguments ?? {});
      if (callId === undefined) {
        unpairedToolCalls += 1;
        continue;
      }
      pendingToolCalls.set(callId, { name, args, startMs: at });
      continue;
    }

    if (event.type === 'tool/result') {
      const callId = toolCallId(event.payload);
      const pending = callId === undefined ? undefined : pendingToolCalls.get(callId);
      if (callId !== undefined) pendingToolCalls.delete(callId);
      if (!pending) {
        unpairedToolCalls += 1;
        continue;
      }
      children.push({
        spanId: nextSpanId(),
        parentSpanId: rootSpanId,
        name: `tool.${pending.name}`,
        kind: 3,
        openInferenceKind: 'TOOL',
        startMs: pending.startMs,
        endMs: at,
        input: pending.args,
        output: messageText(event.payload.message ?? event.payload),
        toolName: pending.name,
        failed: toolResultFailed(event.payload),
      });
    }
  }

  // A call that never produced a result is still evidence about the trajectory.
  for (const [, pending] of pendingToolCalls) {
    unpairedToolCalls += 1;
    children.push({
      spanId: nextSpanId(),
      parentSpanId: rootSpanId,
      name: `tool.${pending.name}`,
      kind: 3,
      openInferenceKind: 'TOOL',
      startMs: pending.startMs,
      endMs: pending.startMs + FALLBACK_SPAN_STEP_MS,
      input: pending.args,
      output: '',
      toolName: pending.name,
      failed: true,
    });
  }

  children.sort((left, right) => left.startMs - right.startMs);

  const root: SpanDraft = {
    spanId: rootSpanId,
    name: 'agent.run',
    kind: 1,
    openInferenceKind: 'AGENT',
    startMs: sessionStartMs,
    endMs: Math.max(lastEventMs, sessionStartMs + FALLBACK_SPAN_STEP_MS),
    input: firstUserMessage ?? '',
    output: lastAssistantMessage ?? '',
    failed: false,
  };

  const serviceName =
    input.serviceName ??
    firstString(header ?? {}, ['serviceName', 'agentPreset']) ??
    'deepseek-harness';

  const skippedSubagentSessions = events.filter(
    (event) => event.type === 'subagent/start' || event.type === 'subagent/end',
  ).length;

  const artifact = {
    trace: {
      resourceSpans: [
        {
          resource: {
            attributes: [
              attribute('service.name', serviceName),
              attribute('deepseek.harness.session.id', sessionId),
              attribute('deepseek.harness.schema', SUPPORTED_SCHEMA),
            ],
          },
          scopeSpans: [
            {
              scope: { name: 'deepseek.harness.session', version: SUPPORTED_SCHEMA },
              spans: [root, ...children].map((draft) => toOtlpSpan(draft, traceId)),
            },
          ],
        },
      ],
    },
  };

  return {
    artifact,
    serviceName,
    input: firstUserMessage,
    output: lastAssistantMessage,
    stats: {
      schema: SUPPORTED_SCHEMA,
      events: events.length,
      spans: children.length + 1,
      llmSpans: children.filter((child) => child.openInferenceKind === 'LLM').length,
      toolSpans: children.filter((child) => child.openInferenceKind === 'TOOL').length,
      unpairedToolCalls,
      skippedSubagentSessions,
      syntheticTimestamps,
    },
  };
}
