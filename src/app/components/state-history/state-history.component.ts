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

import {Component, EventEmitter, Input, OnChanges, Output} from '@angular/core';

interface StateChange {
  key: string;
  before: string | null;
  after: string | null;
  /** Long values are folded; the full JSON is shown on demand. */
  long: boolean;
}

interface StateChangeEntry {
  eventId: string;
  time: Date | null;
  author: string;
  changes: StateChange[];
}

const SHORT_VALUE_LENGTH = 80;

/** Keys whose values are credentials (e.g. OAuth tokens in `asana_oauth`); never shown. */
const SECRET_KEY = /token|secret|password|passwd|credential|api_?key|authorization|cookie/i;

/** JSON of a state value with credential fields masked. */
function maskedJson(value: unknown): string {
  return JSON.stringify(value, (key, field) =>
      key && SECRET_KEY.test(key) && field !== null && typeof field !== 'object' ? '••••' : field);
}

/**
 * Developer tab: the session state changes event by event, newest first,
 * each key as before → after (replayed from the events' state_delta).
 */
@Component({
  selector: 'app-state-history',
  templateUrl: './state-history.component.html',
  styleUrl: './state-history.component.scss',
  standalone: false,
})
export class StateHistoryComponent implements OnChanges {
  @Input() events: any[] = [];
  @Output() readonly eventSelected = new EventEmitter<string>();

  entries: StateChangeEntry[] = [];
  /** `${eventId}:${key}` of the changes shown in full. */
  readonly expanded = new Set<string>();

  ngOnChanges() {
    this.entries = this.buildEntries(this.events ?? []);
  }

  toggle(entry: StateChangeEntry, change: StateChange) {
    const key = `${entry.eventId}:${change.key}`;
    if (!this.expanded.delete(key)) {
      this.expanded.add(key);
    }
  }

  isExpanded(entry: StateChangeEntry, change: StateChange): boolean {
    return this.expanded.has(`${entry.eventId}:${change.key}`);
  }

  short(value: string | null): string {
    if (value === null) {
      return '—';
    }
    return value.length > SHORT_VALUE_LENGTH ? `${value.slice(0, SHORT_VALUE_LENGTH - 1)}…` : value;
  }

  pretty(value: string | null): string {
    if (value === null) {
      return '—';
    }
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }

  private buildEntries(events: any[]): StateChangeEntry[] {
    const state = new Map<string, string>();
    const entries: StateChangeEntry[] = [];
    for (const event of events) {
      const delta = event?.actions?.stateDelta;
      if (!delta || typeof delta !== 'object' || !Object.keys(delta).length) {
        continue;
      }
      const changes: StateChange[] = [];
      for (const [key, value] of Object.entries(delta)) {
        const before = state.get(key) ?? null;
        const after = value === null || value === undefined ? null :
            SECRET_KEY.test(key) ? '"••••"' : maskedJson(value);
        if (after === null) {
          state.delete(key);
        } else {
          state.set(key, after);
        }
        if (before === after) {
          continue;
        }
        const long = (before?.length ?? 0) > SHORT_VALUE_LENGTH ||
            (after?.length ?? 0) > SHORT_VALUE_LENGTH;
        changes.push({key, before, after, long});
      }
      if (changes.length) {
        entries.push({
          eventId: event.id,
          time: typeof event.timestamp === 'number' ? new Date(event.timestamp * 1000) : null,
          author: event.author ?? '',
          changes,
        });
      }
    }
    return entries.reverse();
  }
}
