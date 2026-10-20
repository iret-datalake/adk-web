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

/** The call ADK sends to ask the user to approve another tool call. */
export const REQUEST_CONFIRMATION = 'adk_request_confirmation';
/** The call a Workflow RequestInput (or the request_input tool) sends. */
export const REQUEST_INPUT = 'adk_request_input';
/** The call ADK sends for OAuth; handled by the existing popup flow. */
const REQUEST_CREDENTIAL = 'adk_request_credential';

/** What a tool returns while its call waits for approval. */
export const APPROVAL_REQUESTED_ERROR =
    'This tool call requires confirmation, please approve or reject.';
/** What a tool returns when the user rejected its call. */
export const REJECTED_ERROR = 'This tool call is rejected.';

/** ADK's own hints are written for developers; the UI shows its own text. */
const DEFAULT_HINT_PATTERN = /^Please approve or reject the tool call \S+\(\)/;

export type HitlKind = 'confirmation' | 'input' | 'longRunning';

/** A call the agent is waiting on the user for. */
export interface HitlRequest {
  kind: HitlKind;
  /** The id and name the function response must carry. */
  callId: string;
  callName: string;
  /** The tool to approve (confirmation) or whose result to enter (longRunning). */
  toolName?: string;
  args?: Record<string, unknown>;
  /** The tool's own explanation, or '' for ADK's default hint. */
  hint?: string;
  /** Extra data the tool or workflow attached for the user to check. */
  payload?: unknown;
  /** The question of a RequestInput. */
  message?: string;
  /** JSON Schema of the answer a RequestInput expects. */
  schema?: JsonSchema | null;
}

export interface JsonSchema {
  type?: string;
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  anyOf?: JsonSchema[];
  items?: JsonSchema;
  default?: unknown;
  [key: string]: unknown;
}

/**
 * The HITL request a function call stands for, or null for ordinary calls.
 * `longRunningIds` are the event's long_running_tool_ids.
 */
export function getHitlRequest(
    call: any, longRunningIds: string[] | undefined): HitlRequest | null {
  if (!call?.id || !call.name) {
    return null;
  }
  const args = call.args ?? {};
  if (call.name === REQUEST_CONFIRMATION) {
    const original = args['originalFunctionCall'];
    const confirmation = args['toolConfirmation'] ?? {};
    return {
      kind: 'confirmation',
      callId: call.id,
      callName: call.name,
      toolName: original?.name,
      args: original?.args ?? {},
      hint: ownHint(confirmation.hint),
      payload: confirmation.payload ?? undefined,
    };
  }
  if (call.name === REQUEST_INPUT) {
    const payload = args['payload'];
    const schema = args['response_schema'] ?? args['responseSchema'] ?? null;
    // Inside a Workflow, tool confirmations arrive as a RequestInput.
    if (schema?.title === 'ToolConfirmation' && payload?.tool_name) {
      return {
        kind: 'confirmation',
        callId: call.id,
        callName: call.name,
        toolName: payload.tool_name,
        args: payload.args ?? {},
        hint: ownHint(args['message']),
        payload: payload.confirmation_payload ?? undefined,
      };
    }
    return {
      kind: 'input',
      callId: call.id,
      callName: call.name,
      message: args['message'] ?? args['prompt'] ?? '',
      payload: payload ?? undefined,
      schema,
    };
  }
  if (longRunningIds?.includes(call.id) && call.name !== REQUEST_CREDENTIAL &&
      !args['authConfig']) {
    return {
      kind: 'longRunning',
      callId: call.id,
      callName: call.name,
      toolName: call.name,
      args,
    };
  }
  return null;
}

function ownHint(hint: unknown): string {
  return typeof hint === 'string' && !DEFAULT_HINT_PATTERN.test(hint) ? hint : '';
}

/** The type of a schema, ignoring a `null` alternative (`Optional[...]`). */
export function schemaType(schema: JsonSchema | null | undefined): string | undefined {
  if (!schema) {
    return undefined;
  }
  if (schema.type) {
    return schema.type;
  }
  if (schema.enum) {
    return 'string';
  }
  return schema.anyOf?.find((option) => option.type !== 'null')?.type;
}

/** The enum options of a schema, also inside an `Optional[...]`. */
export function schemaEnum(schema: JsonSchema | null | undefined): unknown[] | undefined {
  return schema?.enum ??
      schema?.anyOf?.find((option) => option.enum)?.enum;
}

/**
 * The confirmation payload the backend's write confirmation sends
 * (callback/write_confirmation.py): what a create / update / delete changes.
 */
export interface WriteConfirmationPayload {
  platform?: string;
  action: string;
  title?: string;
  target?: string;
  changes?: {field: string, label?: string, before?: unknown, after?: unknown}[];
  content?: Record<string, unknown>;
}

export function asWriteConfirmation(payload: unknown): WriteConfirmationPayload | null {
  const value = payload as WriteConfirmationPayload | null;
  return value && typeof value === 'object' && typeof value.action === 'string' &&
          (Array.isArray(value.changes) || (value.content && typeof value.content === 'object')) ?
      value :
      null;
}

/** The fixed choices of a multiple-choice field (an array of enum strings). */
export function schemaMultiOptions(schema: JsonSchema | null | undefined): unknown[] | undefined {
  return schemaType(schema) === 'array' ? schemaEnum(schema?.items) : undefined;
}

/**
 * Wraps a RequestInput answer the way ADK reads it back: objects as they are,
 * anything else as `{result: value}`.
 */
export function inputResponse(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {result: value};
}
