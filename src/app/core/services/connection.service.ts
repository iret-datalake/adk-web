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

import {HttpClient} from '@angular/common/http';
import {Injectable} from '@angular/core';
import {map, Observable} from 'rxjs';

import {URLUtil} from '../../../utils/url-util';

/**
 * A platform's connection state (GET /oauth/connections). "oauth" platforms
 * are connected per user; "shared" ones still use one shared token or service
 * account and have nothing to connect.
 */
export interface Connection {
  id: string;
  authType: 'oauth'|'shared';
  enabled: boolean;
  connected: boolean;
  account?: string|null;
  expiresAt?: string|null;
}

/** The current user/session the OAuth endpoints act for. */
export interface ConnectionContext {
  appName: string;
  userId: string;
  sessionId: string;
}

const POPUP_TIMEOUT_MS = 120000;

@Injectable({providedIn: 'root'})
export class ConnectionService {
  constructor(private http: HttpClient) {}

  getConnections(context: ConnectionContext): Observable<Connection[]> {
    return this.http
        .get<{connections: Connection[]}>(
            this.url('/oauth/connections', context))
        .pipe(map((response) => response.connections));
  }

  disconnect(platformId: string, context: ConnectionContext): Observable<unknown> {
    return this.http.post(this.url(`/oauth/${platformId}/reset`, context), null);
  }

  /**
   * Opens the platform's OAuth login in a popup. Resolves true once the
   * popup-complete page reports success, false if the popup was closed or
   * timed out, and null if the browser blocked the popup.
   */
  connect(platformId: string, context: ConnectionContext): Promise<boolean|null> {
    const loginUrl = new URL(this.url(`/oauth/${platformId}/login`, context), window.location.origin);
    loginUrl.searchParams.set(
        'return_to', new URL(`/oauth/${platformId}/popup-complete`, loginUrl).toString());
    const popup = window.open(
        loginUrl.toString(), `${platformId}-oauth-popup`, 'popup,width=640,height=800');
    if (!popup) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      const allowedOrigins = new Set([window.location.origin, loginUrl.origin]);
      const finish = (connected: boolean) => {
        window.removeEventListener('message', onMessage);
        window.clearInterval(closedPoll);
        window.clearTimeout(timeout);
        resolve(connected);
      };
      const onMessage = (event: MessageEvent) => {
        if (allowedOrigins.has(event.origin) &&
            event.data?.type === `${platformId}_oauth_connected`) {
          finish(true);
        }
      };
      window.addEventListener('message', onMessage);
      const closedPoll = window.setInterval(() => {
        if (popup.closed) {
          finish(false);
        }
      }, 500);
      const timeout = window.setTimeout(() => finish(false), POPUP_TIMEOUT_MS);
    });
  }

  private url(path: string, context: ConnectionContext): string {
    const params = new URLSearchParams({
      app_name: context.appName,
      user_id: context.userId,
      session_id: context.sessionId,
    });
    return `${URLUtil.getApiServerBaseUrl() || ''}${path}?${params}`;
  }
}
