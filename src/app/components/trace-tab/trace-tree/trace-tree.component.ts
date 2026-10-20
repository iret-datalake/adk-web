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

import {Component, Input, OnChanges, OnDestroy, OnInit} from '@angular/core';
import {Subscription} from 'rxjs';

import {Span} from '../../../core/models/Trace';
import {TraceService} from '../../../core/services/trace.service';
import {formatDuration, formatTokens} from '../trace-tab.component';

interface TraceRow {
  span: Span;
  level: number;
  icon: string;
  label: string;
  /** Token counts of an LLM call, e.g. "↓1.8k ↑104". */
  tokens: string;
  tokensTitle: string;
  start: number;
  width: number;
  duration: string;
  eventId?: string;
}

/**
 * Waterfall of one answer's spans: agents, LLM calls (with tokens) and tool
 * calls, indented by nesting. Clicking a row with an event opens its details.
 */
@Component({
  selector: 'app-trace-tree',
  templateUrl: './trace-tree.component.html',
  styleUrl: './trace-tree.component.scss',
  standalone: false
})
export class TraceTreeComponent implements OnInit, OnChanges, OnDestroy {
  @Input() spans: Span[] = [];
  @Input() invocationId = '';
  rows: TraceRow[] = [];
  selectedRow: Span|undefined = undefined;
  private eventData: Map<string, any>|undefined;
  private readonly subscriptions = new Subscription();

  constructor(private traceService: TraceService) {}

  ngOnInit(): void {
    this.subscriptions.add(
        this.traceService.selectedTraceRow$.subscribe(span => this.selectedRow = span));
    this.subscriptions.add(
        this.traceService.eventData$.subscribe(e => this.eventData = e));
  }

  ngOnChanges(): void {
    this.rows = this.buildRows(this.spans ?? []);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  selectRow(row: TraceRow) {
    if (this.selectedRow?.span_id === row.span.span_id) {
      this.traceService.selectedRow(undefined);
      this.traceService.setHoveredMessages(undefined, this.invocationId);
      return;
    }
    this.traceService.selectedRow(row.span);
    this.traceService.setHoveredMessages(row.span, this.invocationId);
  }

  isSelected(row: TraceRow): boolean {
    return this.selectedRow?.span_id === row.span.span_id;
  }

  /** The span's event is shown in the chat, so it can be opened. */
  hasEvent(row: TraceRow): boolean {
    return !!row.eventId && !!this.eventData?.has(row.eventId);
  }

  onHover(row: TraceRow) {
    this.traceService.setHoveredMessages(row.span, this.invocationId);
  }

  onHoverOut() {
    this.traceService.setHoveredMessages(this.selectedRow, this.invocationId);
  }

  private buildRows(spans: Span[]): TraceRow[] {
    if (!spans.length) {
      return [];
    }
    const start = Math.min(...spans.map((span) => span.start_time));
    const total = Math.max(1, Math.max(...spans.map((span) => span.end_time)) - start);
    const byId = new Map(spans.map((span) => [span.span_id, span]));
    // generate_content duplicates its call_llm parent; drop it and keep any
    // children under the nearest shown ancestor.
    const hidden = (span: Span) => span.name.startsWith('generate_content');
    const shownParent = (span: Span): string | undefined => {
      let parentId = span.parent_span_id;
      while (parentId && byId.has(parentId) && hidden(byId.get(parentId)!)) {
        parentId = byId.get(parentId)!.parent_span_id;
      }
      return parentId && byId.has(parentId) ? parentId : undefined;
    };
    const children = new Map<string | undefined, Span[]>();
    for (const span of spans) {
      if (hidden(span)) {
        continue;
      }
      const parent = shownParent(span);
      const list = children.get(parent) ?? [];
      list.push(span);
      children.set(parent, list);
    }
    const rows: TraceRow[] = [];
    const visit = (parent: string | undefined, level: number) => {
      const list = (children.get(parent) ?? []).sort((a, b) => a.start_time - b.start_time);
      for (const span of list) {
        rows.push(this.toRow(span, level, start, total));
        visit(span.span_id, level + 1);
      }
    };
    visit(undefined, 0);
    return rows;
  }

  private toRow(span: Span, level: number, start: number, total: number): TraceRow {
    const attributes = span.attributes ?? {};
    const [kind, ...rest] = span.name.split(' ');
    const name = rest.join(' ');
    let icon = 'hub';
    let label = span.name;
    if (kind === 'invocation') {
      icon = 'flag';
      label = 'invocation';
    } else if (kind === 'invoke_agent') {
      icon = 'smart_toy';
      label = name;
    } else if (kind === 'call_llm') {
      icon = 'chat';
      label = `LLM ${attributes['gen_ai.request.model'] ?? ''}`.trim();
    } else if (kind === 'execute_tool') {
      icon = 'build';
      label = name;
    }
    let tokens = '';
    let tokensTitle = '';
    if (kind === 'call_llm') {
      const input = Number(attributes['gen_ai.usage.input_tokens']) || 0;
      const output = Number(attributes['gen_ai.usage.output_tokens']) || 0;
      const reasoning = Number(attributes['gen_ai.usage.reasoning.output_tokens']) || 0;
      const cached = Number(attributes['gen_ai.usage.cache_read.input_tokens']) || 0;
      tokens = `↓${formatTokens(input)} ↑${formatTokens(output)}`;
      tokensTitle = `input ${input} (cached ${cached}) / output ${output} (thinking ${reasoning})`;
    }
    return {
      span,
      level,
      icon,
      label,
      tokens,
      tokensTitle,
      start: ((span.start_time - start) / total) * 100,
      width: Math.max(0.5, ((span.end_time - span.start_time) / total) * 100),
      duration: formatDuration((span.end_time - span.start_time) / 1_000_000),
      eventId: attributes['gcp.vertex.agent.event_id'],
    };
  }
}
