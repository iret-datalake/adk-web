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

import {Component, EventEmitter, inject, Input, OnChanges, Output, SimpleChanges} from '@angular/core';

import {I18nService} from '../../core/i18n/i18n.service';
import {MessageKey} from '../../core/i18n/messages';
import {asWriteConfirmation, HitlRequest, inputResponse, JsonSchema, schemaEnum, schemaMultiOptions, schemaType, WriteConfirmationPayload} from '../../core/models/Hitl';

/** How a request was answered, shown once it is resolved. */
export interface HitlResolution {
  confirmed?: boolean;
  response: Record<string, unknown>;
}

interface FormField {
  key: string;
  title: string;
  description: string;
  type: string;
  options?: unknown[];
  required: boolean;
}

/** Field types the form edits directly; anything else is edited as JSON. */
const FORM_TYPES = new Set(['string', 'integer', 'number', 'boolean', 'multi']);

/**
 * A request the agent is waiting on: approve a tool call, answer a
 * RequestInput (form generated from its JSON Schema), or enter the result of a
 * long-running tool by hand.
 */
@Component({
  selector: 'app-hitl-request',
  templateUrl: './hitl-request.component.html',
  styleUrl: './hitl-request.component.scss',
  standalone: false,
})
export class HitlRequestComponent implements OnChanges {
  @Input({required: true}) request!: HitlRequest;
  /** Set once the user answered (here or in an earlier visit). */
  @Input() resolution: HitlResolution | null = null;
  /** The conversation moved on without an answer. */
  @Input() expired = false;
  /** An agent response is running; answers have to wait. */
  @Input() disabled = false;
  /** The tool's interim return value, to start the manual result from. */
  @Input() interimResponse: unknown;
  @Output() readonly respond = new EventEmitter<Record<string, unknown>>();

  private readonly i18n = inject(I18nService);

  /** 'object' (form fields), 'boolean' (yes / no), 'multi' (checkboxes), 'text', 'number' or 'json'. */
  inputMode: 'object' | 'boolean' | 'multi' | 'text' | 'number' | 'json' = 'text';
  fields: FormField[] = [];
  values: Record<string, any> = {};
  /** Choices of a top-level multiple-choice answer, and the ones ticked. */
  multiOptions: unknown[] = [];
  multiValues: unknown[] = [];
  /** A create / update / delete described by the backend, shown as a table. */
  write: WriteConfirmationPayload | null = null;
  text = '';
  editAsJson = false;
  jsonText = '';
  error = '';

  ngOnChanges(changes: SimpleChanges) {
    if (changes['request'] || changes['interimResponse']) {
      this.init();
    }
  }

  /** "Asana のタスクを更新" for described writes, else the generic title. */
  get writeTitle(): string {
    const write = this.write;
    if (!write?.title) {
      return '';
    }
    return write.platform ? `${write.platform} の${write.title}` : write.title;
  }

  get changeRows(): {label: string, before: string, after: string}[] {
    return (this.write?.changes ?? []).map((change) => ({
      label: change.label || change.field,
      before: this.display(change.before ?? '—'),
      after: this.display(change.after ?? '—'),
    }));
  }

  get contentEntries(): {key: string, value: string}[] {
    return Object.entries(this.write?.content ?? {})
        .map(([key, value]) => ({key, value: this.display(value)}));
  }

  isTicked(values: unknown[] | undefined, option: unknown): boolean {
    return !!values?.includes(option);
  }

  /** Ticks / unticks a choice of a multiple-choice field (or the top-level answer). */
  toggleOption(field: FormField | null, option: unknown, checked: boolean) {
    const current: unknown[] = field ? (this.values[field.key] ?? []) : this.multiValues;
    const next = checked ? [...current, option] : current.filter((value) => value !== option);
    if (field) {
      this.values[field.key] = next;
    } else {
      this.multiValues = next;
    }
  }

  get argEntries(): {key: string, value: string}[] {
    return Object.entries(this.request.args ?? {})
        .map(([key, value]) => ({key, value: this.display(value)}));
  }

  get payloadJson(): string {
    return JSON.stringify(this.request.payload, null, 2);
  }

  get locked(): boolean {
    return !!this.resolution || this.expired || this.disabled;
  }

  /** The status label of an answered request. */
  get resolutionText(): string {
    if (!this.resolution) {
      return '';
    }
    if (this.request.kind === 'confirmation') {
      return this.i18n.t(this.resolution.confirmed ? 'hitl.approved' : 'hitl.rejected');
    }
    return this.i18n.t('hitl.sent');
  }

  /** The answer that was sent, as label / value rows (field titles from the schema). */
  get answerEntries(): {key: string, value: string}[] {
    const response = this.resolution?.response;
    if (!response || this.request.kind === 'confirmation') {
      return [];
    }
    if (Object.keys(response).length === 1 && 'result' in response) {
      return [{key: this.i18n.t('hitl.answer'), value: this.display(response['result'])}];
    }
    const properties = this.request.schema?.properties ?? {};
    // Stored responses come back with sorted keys; show them in schema order.
    const order = Object.keys(properties);
    const rank = (key: string) => order.includes(key) ? order.indexOf(key) : order.length;
    return Object.entries(response)
        .sort(([a], [b]) => rank(a) - rank(b))
        .map(([key, value]) => ({
          key: properties[key]?.title || key,
          value: this.display(value),
        }));
  }

  approve(confirmed: boolean) {
    if (!this.locked) {
      this.respond.emit({confirmed});
    }
  }

  answer(value: unknown) {
    if (!this.locked) {
      this.respond.emit(inputResponse(value));
    }
  }

  submit() {
    if (this.locked) {
      return;
    }
    this.error = '';
    const value = this.collectValue();
    if (value !== undefined) {
      this.respond.emit(inputResponse(value));
    }
  }

  toggleJson() {
    this.error = '';
    if (!this.editAsJson) {
      const value = this.inputMode === 'object' ? this.objectValue(false) : this.text;
      this.jsonText = JSON.stringify(value ?? {}, null, 2);
      this.editAsJson = true;
      return;
    }
    const parsed = this.parseJson();
    if (parsed === undefined) {
      return;
    }
    if (this.inputMode === 'object' && parsed && typeof parsed === 'object') {
      this.values = {...this.values, ...parsed};
    }
    this.editAsJson = false;
  }

  fieldId(field: FormField): string {
    return `hitl-${this.request.callId}-${field.key}`;
  }

  private init() {
    this.error = '';
    this.editAsJson = false;
    this.fields = [];
    this.values = {};
    this.text = '';
    this.multiOptions = [];
    this.multiValues = [];
    const request = this.request;
    this.write = request?.kind === 'confirmation' ? asWriteConfirmation(request.payload) : null;
    if (!request) {
      return;
    }
    if (request.kind === 'longRunning') {
      this.inputMode = 'json';
      this.jsonText = JSON.stringify(this.interimResponse ?? {}, null, 2);
      return;
    }
    const schema = request.schema;
    const type = schemaType(schema);
    if (type === 'object' && schema?.properties) {
      this.inputMode = 'object';
      this.fields = Object.entries(schema.properties).map(([key, property]) =>
          this.toField(key, property, schema.required ?? []));
      for (const field of this.fields) {
        const fallback = field.type === 'boolean' ? false : field.type === 'multi' ? [] : '';
        const initial = schema.properties[field.key].default;
        this.values[field.key] = initial ?? fallback;
        if (field.type === 'json') {
          this.values[field.key] = initial === undefined ? '' : JSON.stringify(initial);
        }
      }
    } else if (type === 'boolean') {
      this.inputMode = 'boolean';
    } else if (schemaMultiOptions(schema)) {
      this.inputMode = 'multi';
      this.multiOptions = schemaMultiOptions(schema) ?? [];
    } else if (type === 'integer' || type === 'number') {
      this.inputMode = 'number';
    } else if (!schema || type === 'string') {
      this.inputMode = 'text';
    } else {
      this.inputMode = 'json';
      this.jsonText = '';
    }
  }

  private toField(key: string, property: JsonSchema, required: string[]): FormField {
    const multiOptions = schemaMultiOptions(property);
    const type = multiOptions ? 'multi' : schemaType(property) ?? 'string';
    return {
      key,
      title: property.title || key,
      description: property.description || '',
      type: FORM_TYPES.has(type) ? type : 'json',
      options: multiOptions ?? schemaEnum(property),
      required: required.includes(key),
    };
  }

  /** The answer to send, or undefined (with `error` set) when it is invalid. */
  private collectValue(): unknown {
    if (this.editAsJson || this.inputMode === 'json') {
      return this.parseJson();
    }
    if (this.inputMode === 'object') {
      return this.objectValue(true);
    }
    if (this.inputMode === 'multi') {
      if (!this.multiValues.length) {
        this.fail('hitl.required');
        return undefined;
      }
      return this.multiValues;
    }
    if (this.inputMode === 'number') {
      const number = Number(this.text);
      if (this.text.trim() === '' || Number.isNaN(number)) {
        this.fail('hitl.invalidNumber');
        return undefined;
      }
      return number;
    }
    if (!this.text.trim()) {
      this.fail('hitl.required');
      return undefined;
    }
    return this.text.trim();
  }

  /** Form values as an object; empty optional fields are left to their defaults. */
  private objectValue(validate: boolean): Record<string, unknown> | undefined {
    const result: Record<string, unknown> = {};
    for (const field of this.fields) {
      const raw = this.values[field.key];
      const empty = raw === '' || raw === null || raw === undefined ||
          (Array.isArray(raw) && raw.length === 0);
      if (empty) {
        if (validate && field.required) {
          this.fail('hitl.requiredField', {field: field.title});
          return undefined;
        }
        continue;
      }
      if (field.type === 'integer' || field.type === 'number') {
        const number = Number(raw);
        if (Number.isNaN(number) || (field.type === 'integer' && !Number.isInteger(number))) {
          if (validate) {
            this.fail('hitl.invalidField', {field: field.title});
            return undefined;
          }
          continue;
        }
        result[field.key] = number;
      } else if (field.type === 'json') {
        try {
          result[field.key] = JSON.parse(raw);
        } catch {
          if (validate) {
            this.fail('hitl.invalidField', {field: field.title});
            return undefined;
          }
        }
      } else {
        result[field.key] = raw;
      }
    }
    return result;
  }

  private parseJson(): unknown {
    try {
      return JSON.parse(this.jsonText);
    } catch {
      this.fail('hitl.invalidJson');
      return undefined;
    }
  }

  private fail(key: MessageKey, params?: Record<string, string>) {
    this.error = this.i18n.t(key, params);
  }

  private display(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'boolean') {
      return this.i18n.t(value ? 'hitl.yes' : 'hitl.no');
    }
    if (Array.isArray(value) && value.every((item) => typeof item !== 'object')) {
      return value.join('、');
    }
    return JSON.stringify(value);
  }
}
