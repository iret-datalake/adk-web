/**
 * @license
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Component, Input, OnChanges} from '@angular/core';

import {Span} from '../../core/models/Trace';

/** One answer's spans (one trace), with the figures shown in its header. */
export interface InvocationTrace {
  traceId: string;
  invocationId: string;
  question: string;
  spans: Span[];
  start: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  llmCalls: number;
}

/**
 * Developer tab: the session's traces, one collapsible waterfall per answer,
 * newest first. Traces live in the backend's memory, so sessions from before
 * its last restart have none.
 */
@Component({
  selector: 'app-trace-tab',
  templateUrl: './trace-tab.component.html',
  styleUrl: './trace-tab.component.scss',
  standalone: false
})
export class TraceTabComponent implements OnChanges {
  @Input() traceData: any[]|null = [];
  invocations: InvocationTrace[] = [];

  ngOnChanges() {
    this.invocations = this.buildInvocations(this.traceData ?? []);
  }

  formatDuration(ms: number): string {
    return formatDuration(ms);
  }

  formatTokens(count: number): string {
    return formatTokens(count);
  }

  private buildInvocations(spans: Span[]): InvocationTrace[] {
    const byTrace = new Map<string, Span[]>();
    for (const span of spans) {
      const group = byTrace.get(span.trace_id) ?? [];
      group.push(span);
      byTrace.set(span.trace_id, group);
    }
    const invocations: InvocationTrace[] = [];
    for (const [traceId, group] of byTrace) {
      group.sort((a, b) => a.start_time - b.start_time);
      const start = Math.min(...group.map((span) => span.start_time));
      const end = Math.max(...group.map((span) => span.end_time));
      const llmSpans = group.filter((span) => span.name === 'call_llm');
      invocations.push({
        traceId,
        invocationId: findAttribute(group, 'gcp.vertex.agent.invocation_id') ?? '',
        question: findQuestion(llmSpans),
        spans: group,
        start,
        durationMs: (end - start) / 1_000_000,
        inputTokens: sumAttribute(llmSpans, 'gen_ai.usage.input_tokens'),
        outputTokens: sumAttribute(llmSpans, 'gen_ai.usage.output_tokens'),
        llmCalls: llmSpans.length,
      });
    }
    return invocations.sort((a, b) => b.start - a.start);
  }
}

export function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export function formatTokens(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

function findAttribute(spans: Span[], key: string): string | undefined {
  return spans.find((span) => span.attributes?.[key])?.attributes[key];
}

function sumAttribute(spans: Span[], key: string): number {
  return spans.reduce((sum, span) => sum + (Number(span.attributes?.[key]) || 0), 0);
}

/** The user's message the answer was for: the last user text in the first LLM request. */
function findQuestion(llmSpans: Span[]): string {
  for (const span of llmSpans) {
    try {
      const request = JSON.parse(span.attributes?.['gcp.vertex.agent.llm_request'] ?? '{}');
      const userContents = (request.contents ?? []).filter((c: any) => c.role === 'user');
      for (const content of [...userContents].reverse()) {
        const text = content.parts?.find((part: any) => part.text)?.text;
        if (text) {
          return text;
        }
      }
    } catch {
      // Not JSON; try the next call.
    }
  }
  return '';
}
