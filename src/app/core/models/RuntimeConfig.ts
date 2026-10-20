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

/**
 * Runtime configuration for the web app: the JSON file read at startup
 * (assets/config/runtime-config.json), exposed as `window.runtimeConfig`.
 */
export declare interface RuntimeConfig {
  backendUrl: string;
  logo?: LogoConfig;
}

/** Replaces the "Agent Development Kit" logo in the side panel. */
export declare interface LogoConfig {
  text?: string;
  imageUrl?: string;
}

export const DEFAULT_LOGO: Required<LogoConfig> = {
  text: 'Agent Development Kit',
  imageUrl: 'assets/ADK-512-color.svg',
};

/** The logo from the runtime config, with the ADK defaults filled in. */
export function getLogoConfig(): Required<LogoConfig> {
  const logo = ((window as any)['runtimeConfig'] as RuntimeConfig | undefined)?.logo;
  return {
    text: logo?.text || DEFAULT_LOGO.text,
    imageUrl: logo?.imageUrl || DEFAULT_LOGO.imageUrl,
  };
}
