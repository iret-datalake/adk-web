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

import {platformBrowserDynamic} from '@angular/platform-browser-dynamic';
import {AppModule} from './app/app.module';

// Bypass the HTTP cache so edits to the config (backend URL, logo) show up on
// reload, and bootstrap once, after the config is known.
fetch('./assets/config/runtime-config.json', {cache: 'no-store'})
  .then((response) => response.json())
  .catch((err) => {
    console.error('Failed to load runtime-config.json', err);
    return {};
  })
  .then((config) => {
    (window as any)['runtimeConfig'] = config;
    platformBrowserDynamic()
      .bootstrapModule(AppModule)
      .catch((err) => console.error(err));
  });
