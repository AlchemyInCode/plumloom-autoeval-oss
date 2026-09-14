import type { SuiteSummary } from '../actions/suite.js';
import { redactText } from '../auth/redact.js';
import type { EvalGateDecision, SuiteGateReport } from '../gate/decision.js';

/**
 * Failure clustering.
 *
 * A blocked suite usually reports the same root cause many times: one upstream
 * outage, one malformed artifact, one metric that regressed across every eval.
 * Reading the per-eval list to rediscover that is noise, so this module groups
 * failures by a normalized signature and reports each distinct cause once, with
 * its count and one exemplar. It is pure: it reads only what the execution,
 * results, and gate planes already produced.
 */

export type FailureClusterCategory = 'execution' | 'threshold' | 'inconclusive';

export type FailureCluster = {
  /** Stable machine identifier for the normalized cause. */
  id: string;
  category: FailureClusterCategory;
  label: string;
  count: number;
  /** Eval labels (name or file) contributing to the cluster, in suite order. */
  evals: string[];
  /** One representative raw message, kept verbatim for debugging. */
  exemplar: string;
};

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;
const NUMBER_PATTERN = /\b\d+(?:\.\d+)?\b/gu;
const MAX_LABEL_CHARS = 80;

/**
 * Known operational causes are matched first so that wording differences
 * between backend messages do not split one outage into several clusters.
 */
const SIGNATURES: readonly { id: string; label: string; pattern: RegExp }[] = [
  { id: 'timeout', label: 'Run or result polling timed out', pattern: /timed?\s*out|timeout/iu },
  { id: 'http-5xx', label: 'Upstream 5xx error', pattern: /\b5\d\d\b/u },
  { id: 'rate-limited', label: 'Rate limited (429)', pattern: /\b429\b|rate limit/iu },
  {
    id: 'unauthorized',
    label: 'Authentication or authorization rejected',
    pattern: /\b40[13]\b|unauthori[sz]ed|forbidden/iu,
  },
  { id: 'not-found', label: 'Resource not found (404)', pattern: /\b404\b|not found/iu },
  {
    id: 'schema-parsing',
    label: 'Schema or JSON parsing failure',
    pattern: /json|schema|parse|parsing|invalid input/iu,
  },
  {
    id: 'model-not-enabled',
    label: 'Model not enabled for this account',
    pattern: /model .*not enabled|is not enabled/iu,
  },
  { id: 'aborted', label: 'Run was aborted', pattern: /abort/iu },
];

function truncate(value: string): string {
  const collapsed = value.replace(/\s+/gu, ' ').trim();
  return collapsed.length <= MAX_LABEL_CHARS
    ? collapsed
    : `${collapsed.slice(0, MAX_LABEL_CHARS - 1)}…`;
}

/** Strips identifiers and magnitudes so two reports of one cause collapse together. */
function normalize(message: string): string {
  return truncate(message.replace(UUID_PATTERN, '<id>').replace(NUMBER_PATTERN, '<n>'));
}

function classify(message: string): { id: string; label: string } {
  for (const signature of SIGNATURES) {
    if (signature.pattern.test(message)) return { id: signature.id, label: signature.label };
  }
  const normalized = normalize(message);
  return { id: `other:${normalized}`, label: normalized };
}

type ClusterSeed = {
  id: string;
  category: FailureClusterCategory;
  label: string;
  evalLabel: string;
  exemplar: string;
};

function collect(seeds: readonly ClusterSeed[]): FailureCluster[] {
  const clusters = new Map<string, FailureCluster>();
  for (const seed of seeds) {
    const existing = clusters.get(seed.id);
    if (existing) {
      existing.count += 1;
      if (!existing.evals.includes(seed.evalLabel)) existing.evals.push(seed.evalLabel);
      continue;
    }
    clusters.set(seed.id, {
      id: seed.id,
      category: seed.category,
      label: seed.label,
      count: 1,
      evals: [seed.evalLabel],
      exemplar: truncate(redactText(seed.exemplar)),
    });
  }
  return [...clusters.values()].sort(
    (left, right) => right.count - left.count || left.label.localeCompare(right.label),
  );
}

function decisionLabel(decision: EvalGateDecision): string {
  return decision.evaluationName ?? decision.inputFile;
}

/**
 * Clusters everything that blocked a release: execution and result errors, and
 * every failing or inconclusive gate check.
 */
export function clusterSuiteFailures(report: SuiteGateReport): FailureCluster[] {
  const seeds: ClusterSeed[] = [];
  for (const decision of report.perEvalDecisions) {
    if (decision.decision === 'PASS') continue;
    const evalLabel = decisionLabel(decision);
    const failingChecks = decision.checks.filter((check) => check.decision !== 'PASS');

    if (failingChecks.length === 0) {
      const classified = classify(decision.reason);
      seeds.push({
        id: `${decision.decision === 'ERROR' ? 'execution' : 'inconclusive'}:${classified.id}`,
        category: decision.decision === 'ERROR' ? 'execution' : 'inconclusive',
        label: classified.label,
        evalLabel,
        exemplar: decision.reason,
      });
      continue;
    }

    for (const check of failingChecks) {
      const category: FailureClusterCategory =
        check.decision === 'FAIL' ? 'threshold' : 'inconclusive';
      seeds.push({
        id: `${category}:${check.metric}:${check.decision}`,
        category,
        label:
          check.decision === 'FAIL'
            ? `${check.label} below threshold (${check.threshold})`
            : `${check.label} ${check.reason}`,
        evalLabel,
        exemplar: `${check.label}: ${check.actual} required ${check.threshold} — ${check.reason}`,
      });
    }
  }
  return collect(seeds);
}

/**
 * Clusters execution and result-plane errors from a suite run, for the ungated
 * `suite run` command where no thresholds are configured.
 */
export function clusterExecutionFailures(summary: SuiteSummary): FailureCluster[] {
  const seeds: ClusterSeed[] = [];
  for (const entry of [...summary.evals].sort((left, right) => left.index - right.index)) {
    if (entry.status === 'completed') continue;
    const message = entry.error ?? `Eval ended in status ${entry.status}`;
    const classified = classify(message);
    seeds.push({
      id: `execution:${classified.id}`,
      category: 'execution',
      label: classified.label,
      evalLabel: entry.execution?.evaluationName ?? entry.inputFile,
      exemplar: message,
    });
  }
  return collect(seeds);
}
