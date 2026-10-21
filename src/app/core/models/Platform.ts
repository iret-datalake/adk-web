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

import {MessageKey} from '../i18n/messages';

/**
 * The platforms (connectors) the user turns on and off in the chat input's
 * + menu. Ids match the backend (agents/internal_ai_search_agent/platforms.py),
 * which hides the tools of turned-off platforms from the agent.
 */
export interface Platform {
  id: string;
  /** Brand name, or an i18n key for names that depend on the UI language. */
  name?: string;
  labelKey?: MessageKey;
  icon: string;
  defaultEnabled: boolean;
}

export const PLATFORMS: Platform[] = [
  {id: 'slack', name: 'Slack', icon: 'forum', defaultEnabled: true},
  {id: 'gdrive', name: 'Google Drive', icon: 'folder', defaultEnabled: true},
  {id: 'asana', name: 'Asana', icon: 'task_alt', defaultEnabled: true},
  {id: 'backlog', name: 'Backlog', icon: 'bug_report', defaultEnabled: true},
  {id: 'github', name: 'GitHub', icon: 'code', defaultEnabled: true},
  {id: 'glossary', labelKey: 'agent.glossary', icon: 'menu_book', defaultEnabled: false},
  {id: 'web_search', labelKey: 'agent.webSearch', icon: 'travel_explore', defaultEnabled: false},
];

/** The models the input's model menu offers; only the current one for now. */
export interface ModelOption {
  id: string;
  label: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  {id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash'},
];
