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
import {Observable} from 'rxjs';

import {URLUtil} from '../../../utils/url-util';

export type FeedbackDirection = 'up' | 'down';

export interface MessageFeedbackInput {
  direction: FeedbackDirection;
  comment?: string;
}

/** One rating, as stored under `message_feedback` in the session state. */
export interface MessageFeedback extends MessageFeedbackInput {
  updated_at?: string;
}

export interface SessionFolder {
  id: string;
  name: string;
  /** 'archive' is the built-in archive folder (can't be renamed or deleted). */
  kind?: 'folder'|'archive';
}

export interface SessionFolders {
  folders: SessionFolder[];
  assignments: Record<string, string>;
  /** sessionId -> title the user wrote (wins over the generated brief). */
  titles?: Record<string, string>;
}

@Injectable({
  providedIn: 'root',
})
export class SessionService {
  apiServerDomain = URLUtil.getApiServerBaseUrl();
  constructor(private http: HttpClient) {}

  createSession(userId: string, appName: string) {
    if (this.apiServerDomain != undefined) {
      const url =
          this.apiServerDomain + `/apps/${appName}/users/${userId}/sessions`;
      return this.http.post<any>(url, null);
    }
    return new Observable<any>();
  }

  listSessions(userId: string, appName: string) {
    if (this.apiServerDomain != undefined) {
      const url =
          this.apiServerDomain + `/apps/${appName}/users/${userId}/sessions`;

      return this.http.get<any>(url);
    }
    return new Observable<[]>();
  }

  deleteSession(userId: string, appName: string, sessionId: string) {
    const url = this.apiServerDomain +
        `/apps/${appName}/users/${userId}/sessions/${sessionId}`;

    return this.http.delete<any>(url);
  }

  deleteSessions(userId: string, appName: string, sessionIds: string[]) {
    const url = this.apiServerDomain +
        `/apps/${appName}/users/${userId}/sessions:batchDelete`;

    return this.http.post<{deleted: string[]; failed: string[]}>(
        url, {sessionIds});
  }

  /** The user's folders and a sessionId -> folderId map of filed sessions. */
  listSessionFolders(userId: string, appName: string) {
    const url = this.apiServerDomain +
        `/apps/${appName}/users/${userId}/session-folders`;

    return this.http.get<SessionFolders>(url);
  }

  createSessionFolder(userId: string, appName: string, name: string) {
    const url = this.apiServerDomain +
        `/apps/${appName}/users/${userId}/session-folders`;

    return this.http.post<SessionFolder>(url, {name});
  }

  renameSessionFolder(
      userId: string, appName: string, folderId: string, name: string) {
    const url = this.apiServerDomain +
        `/apps/${appName}/users/${userId}/session-folders/${folderId}`;

    return this.http.patch<SessionFolder>(url, {name});
  }

  /** Deletes the folder only; its sessions become unfiled. */
  deleteSessionFolder(userId: string, appName: string, folderId: string) {
    const url = this.apiServerDomain +
        `/apps/${appName}/users/${userId}/session-folders/${folderId}`;

    return this.http.delete<void>(url);
  }

  /** Puts the sessions in `folderId`, or takes them out of any folder. */
  moveSessionsToFolder(
      userId: string, appName: string, sessionIds: string[],
      folderId: string|null) {
    const url = this.apiServerDomain +
        `/apps/${appName}/users/${userId}/sessions:moveToFolder`;

    return this.http.post<void>(url, {sessionIds, folderId});
  }

  /** Saves the user's title; null or blank goes back to the generated brief. */
  setSessionTitle(
      userId: string, appName: string, sessionId: string, title: string|null) {
    const url = this.apiServerDomain +
        `/apps/${appName}/users/${userId}/sessions/${sessionId}/title`;

    return this.http.put<{sessionId: string; title?: string|null}>(
        url, {title});
  }

  getSession(userId: string, appName: string, sessionId: string) {
    const url = this.apiServerDomain +
        `/apps/${appName}/users/${userId}/sessions/${sessionId}`;

    return this.http.get<any>(url);
  }

  /** Saves the user's rating of one answer (in the session state). */
  putMessageFeedback(
      userId: string,
      appName: string,
      sessionId: string,
      eventId: string,
      feedback: MessageFeedbackInput,
  ) {
    const url = this.apiServerDomain +
        `/apps/${appName}/users/${userId}/sessions/${sessionId}/feedback/${
                    encodeURIComponent(eventId)}`;
    return this.http.put<MessageFeedback>(url, feedback);
  }

  deleteMessageFeedback(
      userId: string, appName: string, sessionId: string, eventId: string) {
    const url = this.apiServerDomain +
        `/apps/${appName}/users/${userId}/sessions/${sessionId}/feedback/${
                    encodeURIComponent(eventId)}`;
    return this.http.delete<void>(url);
  }

  getSessionBrief(userId: string, appName: string, sessionId: string) {
    const url = this.apiServerDomain +
        `/apps/${appName}/users/${userId}/sessions/${sessionId}/brief`;

    return this.http.get<{sessionId: string; brief: string}>(url);
  }

  pruneSessionState(
      userId: string,
      appName: string,
      sessionId: string,
      operations: Array<{path: string[]; removeIds?: string[]; keepLatest?: number; clearPath?: boolean; idField?: string | null}>,
  ) {
    const url = this.apiServerDomain +
        `/apps/${appName}/users/${userId}/sessions/${sessionId}/state/prune`;

    return this.http.post<{sessionId: string; updatedKeys: string[]; skippedPaths: string[]}>(url, {operations});
  }

  importSession(userId: string, appName: string, events: any[]) {
    if (this.apiServerDomain != undefined) {
      const url = this.apiServerDomain +
          `/apps/${appName}/users/${userId}/sessions`;

      return this.http.post<any>(url, {
        appName: appName,
        userId: userId,
        events: events,
      });
    }

    return new Observable<any>();
  }
}
