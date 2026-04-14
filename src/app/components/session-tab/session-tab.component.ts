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

import {Component, EventEmitter, Input, OnInit, Output} from '@angular/core';
import {Subject, switchMap} from 'rxjs';
import {Session} from '../../core/models/Session';
import {SessionService} from '../../core/services/session.service';

@Component({
  selector: 'app-session-tab',
  templateUrl: './session-tab.component.html',
  styleUrl: './session-tab.component.scss',
  standalone: false,
})
export class SessionTabComponent implements OnInit {
  @Input() userId: string = '';
  @Input() appName: string = '';
  @Input() sessionId: string = '';

  @Output() readonly sessionSelected = new EventEmitter<Session>();
  @Output() readonly sessionReloaded = new EventEmitter<Session>();

  sessionList: any[] = [];

  private refreshSessionsSubject = new Subject<void>();

  constructor(
    private sessionService: SessionService,
  ) {
    this.refreshSessionsSubject
        .pipe(
            switchMap(
                () =>
                    this.sessionService.listSessions(this.userId, this.appName),
                ),
            )
        .subscribe((res) => {
          this.sessionList = res
            .map((session: any) => this.decorateSession(session))
            .sort(
              (a: any, b: any) =>
                Number(b.lastUpdateTime) - Number(a.lastUpdateTime),
            );
        });
  }

  ngOnInit(): void {
    setTimeout(() => {
      this.refreshSessionsSubject.next();
    }, 500);
  }

  getSession(sessionId: string) {
    this.sessionService
      .getSession(this.userId, this.appName, sessionId)
      .subscribe((res) => {
        const session = this.fromApiResultToSession(res);
        this.sessionSelected.emit(session);
      });
  }

  protected getDate(session: any): string {
    let timeStamp = session.lastUpdateTime;

    const date = new Date(timeStamp * 1000);

    return date.toLocaleString();
  }

  protected getBrief(session: any): string | null {
    if (!session) {
      return null;
    }

    const briefCandidate =
        this.extractBriefFromState(session) ??
        session.sessionBrief ??
        session.brief ??
        session.summary;
    if (typeof briefCandidate !== 'string') {
      return null;
    }

    const trimmed = briefCandidate.trim();
    return trimmed ? trimmed : null;
  }

  private fromApiResultToSession(res: any): Session {
    return {
      id: res?.id ?? '',
      appName: res?.appName ?? '',
      userId: res?.userId ?? '',
      state: res?.state ?? [],
      events: res?.events ?? [],
    };
  }

  reloadSession(sessionId: string) {
    this.sessionService
      .getSession(this.userId, this.appName, sessionId)
      .subscribe((res) => {
        const session = this.fromApiResultToSession(res);
        let found = false;
        const updatedSessions = this.sessionList.map((existing) => {
          if (existing.id !== sessionId) {
            return existing;
          }
          found = true;
          return {
            ...existing,
            ...this.decorateSession(res),
          };
        });

        this.sessionList = found
          ? updatedSessions
          : [
              ...updatedSessions,
              this.decorateSession(res),
            ];

        this.sessionList.sort(
            (a: any, b: any) =>
              Number(b.lastUpdateTime) - Number(a.lastUpdateTime),
        );
        this.sessionReloaded.emit(session);
      });
  }

  refreshSession(session?: string) {
    this.refreshSessionsSubject.next();
    if (this.sessionList.length <= 1) {
      return undefined;
    } else {
      let index = this.sessionList.findIndex((s) => s.id == session);
      if (index == this.sessionList.length - 1) {
        index = -1;
      }
      return this.sessionList[index + 1];
    }
  }

  private decorateSession(session: any): any {
    if (!session || typeof session !== 'object') {
      return session;
    }
    const brief = this.extractBriefFromState(session);
    return {
      ...session,
      sessionBrief: brief ?? session.sessionBrief ?? session.brief ?? session.summary ?? null,
    };
  }

  updateSessionBriefInList(sessionId: string, brief: string): void {
    this.sessionList = this.sessionList.map((session) => {
      if (session.id !== sessionId) {
        return session;
      }
      const trimmed = typeof brief === 'string' ? brief.trim() : null;
      return {
        ...session,
        sessionBrief: trimmed || session.sessionBrief || null,
      };
    });
  }

  private extractBriefFromState(session: any): string | null {
    const state = session?.state;
    if (!state || typeof state !== 'object') {
      return null;
    }
    const brief = state['session_brief'] ?? state['breif'];
    if (typeof brief !== 'string') {
      return null;
    }
    const trimmed = brief.trim();
    return trimmed ? trimmed : null;
  }
}
