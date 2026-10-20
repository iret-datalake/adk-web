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

export type Theme = 'light' | 'dark';

/** Read by the inline script in index.html too, to avoid a flash on load. */
const THEME_STORAGE_KEY = 'adk-web.theme';

/**
 * Light / dark theme, remembered per browser. Sets `data-theme` on <html>;
 * the colors are the `--app-*` tokens in styles.scss.
 */
@Injectable({providedIn: 'root'})
export class ThemeService {
  private readonly document = inject(DOCUMENT);

  readonly theme = signal<Theme>(this.loadTheme());

  constructor() {
    effect(() => {
      const theme = this.theme();
      this.document.documentElement.dataset['theme'] = theme;
      try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
      } catch {
        // Storage can be unavailable (private mode); the choice then lasts
        // for this page only.
      }
    });
  }

  setTheme(theme: Theme) {
    this.theme.set(theme);
  }

  private loadTheme(): Theme {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') {
        return stored;
      }
    } catch {}
    return 'light';
  }
}
