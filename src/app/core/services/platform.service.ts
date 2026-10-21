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

import {computed, effect, Injectable, signal} from '@angular/core';

import {PLATFORMS} from '../models/Platform';

const PLATFORMS_STORAGE_KEY = 'adk-web.enabledPlatforms';

/**
 * The platforms turned on in the chat input's + menu, sent with every message.
 * Remembered per browser.
 */
@Injectable({providedIn: 'root'})
export class PlatformService {
  readonly enabledIds = signal<string[]>(this.load());
  readonly enabledCount = computed(() => this.enabledIds().length);

  constructor() {
    effect(() => {
      const ids = this.enabledIds();
      try {
        localStorage.setItem(PLATFORMS_STORAGE_KEY, JSON.stringify(ids));
      } catch {
        // Storage can be unavailable (private mode); the choice then lasts
        // for this page only.
      }
    });
  }

  isEnabled(id: string): boolean {
    return this.enabledIds().includes(id);
  }

  setEnabled(id: string, enabled: boolean) {
    const others = this.enabledIds().filter((enabledId) => enabledId !== id);
    // Keep the order of PLATFORMS so the request stays stable.
    const next = enabled ? [...others, id] : others;
    this.enabledIds.set(PLATFORMS.map((platform) => platform.id).filter((platformId) => next.includes(platformId)));
  }

  private load(): string[] {
    const known = new Set(PLATFORMS.map((platform) => platform.id));
    try {
      const stored = JSON.parse(localStorage.getItem(PLATFORMS_STORAGE_KEY) ?? 'null');
      if (Array.isArray(stored)) {
        return stored.filter((id) => typeof id === 'string' && known.has(id));
      }
    } catch {
      // Fall back to the defaults below.
    }
    return PLATFORMS.filter((platform) => platform.defaultEnabled).map((platform) => platform.id);
  }
}
