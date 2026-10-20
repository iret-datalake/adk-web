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

import {DOCUMENT} from '@angular/common';
import {effect, inject, Injectable, signal} from '@angular/core';

import {Language, MessageKey, MESSAGES} from './messages';

const LANGUAGE_STORAGE_KEY = 'adk-web.language';

/** The UI language (Japanese / English), remembered per browser. */
@Injectable({providedIn: 'root'})
export class I18nService {
  private readonly document = inject(DOCUMENT);

  readonly language = signal<Language>(this.loadLanguage());

  constructor() {
    effect(() => {
      const language = this.language();
      this.document.documentElement.lang = language;
      try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
      } catch {
        // Storage can be unavailable (private mode); the choice then lasts
        // for this page only.
      }
    });
  }

  setLanguage(language: Language) {
    this.language.set(language);
  }

  /** The string for `key`, with `{name}` placeholders filled from `params`. */
  t(key: MessageKey, params?: Record<string, string|number>): string {
    const text = MESSAGES[this.language()][key] ?? key;
    if (!params) {
      return text;
    }
    return text.replace(
        /\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
  }

  private loadLanguage(): Language {
    try {
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (stored === 'ja' || stored === 'en') {
        return stored;
      }
    } catch {}
    return navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'ja';
  }
}
