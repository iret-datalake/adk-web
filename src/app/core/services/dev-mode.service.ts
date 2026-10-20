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

import {effect, Injectable, signal} from '@angular/core';

const DEV_MODE_STORAGE_KEY = 'adk-web.devMode';

/**
 * Developer mode (display settings menu): shows token usage, state changes,
 * traces and system instruction diffs. Remembered per browser.
 */
@Injectable({providedIn: 'root'})
export class DevModeService {
  readonly enabled = signal<boolean>(this.load());

  constructor() {
    effect(() => {
      const enabled = this.enabled();
      try {
        localStorage.setItem(DEV_MODE_STORAGE_KEY, String(enabled));
      } catch {
        // Storage can be unavailable (private mode); the choice then lasts
        // for this page only.
      }
    });
  }

  setEnabled(enabled: boolean) {
    this.enabled.set(enabled);
  }

  private load(): boolean {
    try {
      return localStorage.getItem(DEV_MODE_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }
}
