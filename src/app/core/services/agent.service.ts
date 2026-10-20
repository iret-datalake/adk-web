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
import {Injectable, NgZone} from '@angular/core';
import {BehaviorSubject, Observable, of} from 'rxjs';
import {URLUtil} from '../../../utils/url-util';
import {AgentRunRequest} from '../models/AgentRunRequest';

@Injectable({
  providedIn: 'root',
})
export class AgentService {
  apiServerDomain = URLUtil.getApiServerBaseUrl();
  private _currentApp = new BehaviorSubject<string>('');
  currentApp = this._currentApp.asObservable();
  private isLoading = new BehaviorSubject<boolean>(false);

  constructor(
    private http: HttpClient,
    private zone: NgZone,
  ) {}

  getApp(): Observable<string> {
    return this.currentApp;
  }

  setApp(name: string) {
    this._currentApp.next(name);
  }

  getLoadingState(): BehaviorSubject<boolean> {
    return this.isLoading;
  }

  runSse(
    req: AgentRunRequest,
    options?: {
      suppressLoading?: boolean,
    },
  ) {
    const url = this.apiServerDomain + `/run_sse`;
    const suppressLoading = options?.suppressLoading ?? false;
    if (!suppressLoading) {
      this.isLoading.next(true);
    }
    return new Observable<string>((observer) => {
      const self = this;
      // Unsubscribing aborts the request (stop button); the backend then stops
      // the agent run when it sees the connection close.
      const controller = new AbortController();
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let finished = false;
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(req),
        signal: controller.signal,
      })
        .then((response) => {
          reader = response.body?.getReader();
          const decoder = new TextDecoder('utf-8');
          let lastData = '';

          const read = () => {
            reader?.read()
                .then(({done, value}) => {
                  if (!suppressLoading) {
                    this.isLoading.next(true);
                  }
                  if (done) {
                    finished = true;
                    if (!suppressLoading) {
                      this.isLoading.next(false);
                    }
                    return observer.complete();
                  }
                  const chunk = decoder.decode(value, {stream: true});
                  lastData += chunk;
                  try {
                    const lines = lastData.split(/\r?\n/).filter(
                        (line) => line.startsWith('data:'));
                    lines.forEach((line) => {
                      const data = line.replace(/^data:\s*/, '');
                      JSON.parse(data);
                      self.zone.run(() => observer.next(data));
                    });
                    lastData = '';
                  } catch (e) {
                    // the data is not a valid json, it could be an incomplete
                    // chunk. we ignore it and wait for the next chunk.
                    if (e instanceof SyntaxError) {
                      read();
                    }
                  }
                  read();  // Read the next chunk
                })
                .catch((err) => {
                  if (controller.signal.aborted) {
                    return;
                  }
                  finished = true;
                  if (!suppressLoading) {
                    this.isLoading.next(false);
                  }
                  self.zone.run(() => observer.error(err));
                });
          };

          read();
        })
        .catch((err) => {
          if (controller.signal.aborted) {
            return;
          }
          finished = true;
          if (!suppressLoading) {
            this.isLoading.next(false);
          }
          self.zone.run(() => observer.error(err));
        });

      return () => {
        if (finished) {
          return;
        }
        controller.abort();
        reader?.cancel().catch(() => {});
        if (!suppressLoading) {
          this.isLoading.next(false);
        }
      };
    });
  }

  listApps(): Observable<string[]> {
    if (this.apiServerDomain != undefined) {
      const url = this.apiServerDomain + `/list-apps?relative_path=./`;
      return this.http.get<string[]>(url);
    }
    return new Observable<[]>();
  }
}
