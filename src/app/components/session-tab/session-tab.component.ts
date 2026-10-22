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

import {Component, ElementRef, EventEmitter, inject, Input, OnInit, Output, ViewChild} from '@angular/core';
import {MatDialog} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';
import {catchError, forkJoin, Observable, of, Subject, switchMap} from 'rxjs';
import {I18nService} from '../../core/i18n/i18n.service';
import {Session} from '../../core/models/Session';
import {SessionFolder, SessionFolders, SessionService} from '../../core/services/session.service';
import {DeleteSessionDialogComponent, DeleteSessionDialogData} from './delete-session-dialog/delete-session-dialog.component';

/** A folder with its sessions; `folder` is null for the unfiled sessions. */
interface SessionGroup {
  folder: SessionFolder|null;
  sessions: any[];
}

const NO_FOLDERS: SessionFolders = {folders: [], assignments: {}};

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
  /** Ids of sessions deleted from this list (the list is already refreshed). */
  @Output() readonly sessionsDeleted = new EventEmitter<string[]>();

  sessionList: any[] = [];
  folders: SessionFolder[] = [];
  /** sessionId -> folderId for the sessions that are in a folder. */
  assignments: Record<string, string> = {};
  /** sessionId -> title the user wrote; it wins over the generated brief. */
  titles: Record<string, string> = {};

  selectMode = false;
  readonly selectedIds = new Set<string>();
  readonly collapsedFolderIds = new Set<string>();
  creatingFolder = false;
  renamingFolderId: string|null = null;
  folderNameDraft = '';
  renamingSessionId: string|null = null;
  titleDraft = '';
  /** The archive starts collapsed, but only the first time it is seen. */
  private archiveSeen = false;

  /** Focuses the folder name input as soon as it is shown. */
  @ViewChild('nameInput')
  set nameInput(input: ElementRef<HTMLInputElement>|undefined) {
    input?.nativeElement.focus();
  }

  private refreshSessionsSubject = new Subject<void>();
  private groupsCache: {key: unknown[]; groups: SessionGroup[]}|null = null;

  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly i18n = inject(I18nService);

  constructor(
    private sessionService: SessionService,
  ) {
    this.refreshSessionsSubject
        .pipe(
            switchMap(
                () => forkJoin([
                  this.sessionService.listSessions(this.userId, this.appName),
                  this.loadFolders(),
                ]),
                ),
            )
        .subscribe(([res, folders]) => {
          this.applyFolders(folders);
          this.sessionList = res
            .map((session: any) => this.decorateSession(session))
            .sort(
              (a: any, b: any) =>
                Number(b.lastUpdateTime) - Number(a.lastUpdateTime),
            );
          this.pruneSelection();
        });
  }

  ngOnInit(): void {
    setTimeout(() => {
      this.refreshSessionsSubject.next();
    }, 500);
  }

  /** The user's own folders (everything but the archive). */
  get userFolders(): SessionFolder[] {
    return this.folders.filter((folder) => folder.kind !== 'archive');
  }

  get archiveFolder(): SessionFolder|undefined {
    return this.folders.find((folder) => folder.kind === 'archive');
  }

  /** The user's folders, the unfiled sessions, then the archive. */
  get groups(): SessionGroup[] {
    const key = [this.sessionList, this.folders, this.assignments];
    if (this.groupsCache &&
        this.groupsCache.key.every((value, i) => value === key[i])) {
      return this.groupsCache.groups;
    }
    const byFolder = new Map<string, any[]>(
        this.folders.map((folder) => [folder.id, []]));
    const unfiled: any[] = [];
    for (const session of this.sessionList) {
      const folderSessions = byFolder.get(this.assignments[session.id]);
      (folderSessions ?? unfiled).push(session);
    }
    const archive = this.archiveFolder;
    const groups: SessionGroup[] = [
      ...this.userFolders.map(
          (folder) => ({folder, sessions: byFolder.get(folder.id)!})),
      {folder: null, sessions: unfiled},
      ...(archive ? [{folder: archive, sessions: byFolder.get(archive.id)!}] :
                    []),
    ];
    this.groupsCache = {key, groups};
    return groups;
  }

  onSessionClick(session: any) {
    if (this.selectMode) {
      this.toggleSelected(session.id);
    } else {
      this.getSession(session.id);
    }
  }

  // --- Selection --------------------------------------------------------

  startSelectMode() {
    this.selectMode = true;
  }

  exitSelectMode() {
    this.selectMode = false;
    this.selectedIds.clear();
  }

  toggleSelected(sessionId: string) {
    if (!this.selectedIds.delete(sessionId)) {
      this.selectedIds.add(sessionId);
    }
  }

  /** 'all', 'some' or 'none' of the sessions are selected. */
  selectionOf(sessions: any[]): 'all'|'some'|'none' {
    const count = sessions.filter((s) => this.selectedIds.has(s.id)).length;
    if (count === 0) {
      return 'none';
    }
    return count === sessions.length ? 'all' : 'some';
  }

  /** Selects all of `sessions`, or clears them if all were selected. */
  toggleSelectedAll(sessions: any[]) {
    const select = this.selectionOf(sessions) !== 'all';
    for (const session of sessions) {
      if (select) {
        this.selectedIds.add(session.id);
      } else {
        this.selectedIds.delete(session.id);
      }
    }
  }

  private pruneSelection() {
    const ids = new Set(this.sessionList.map((session) => session.id));
    for (const id of [...this.selectedIds]) {
      if (!ids.has(id)) {
        this.selectedIds.delete(id);
      }
    }
  }

  // --- Deleting ---------------------------------------------------------

  /** Deletes `ids`, or the selected sessions when omitted, after a confirm. */
  deleteSessions(ids?: string[]) {
    const sessionIds = ids ?? [...this.selectedIds];
    if (!sessionIds.length) {
      return;
    }
    this.confirm(
            this.i18n.t('sessions.deleteTitle'),
            this.i18n.t('sessions.deleteMessage', {count: sessionIds.length}),
            this.i18n.t('sessions.delete'))
        .subscribe((confirmed) => {
          if (!confirmed) {
            return;
          }
          this.sessionService
              .deleteSessions(this.userId, this.appName, sessionIds)
              .subscribe({
                next: ({deleted, failed}) => {
                  const gone = new Set(deleted);
                  this.sessionList =
                      this.sessionList.filter((s) => !gone.has(s.id));
                  this.pruneSelection();
                  if (!ids) {
                    this.exitSelectMode();
                  }
                  if (failed.length) {
                    this.notify(this.i18n.t(
                        'sessions.deleteFailed', {count: failed.length}));
                  }
                  this.sessionsDeleted.emit(deleted);
                  this.refreshSessionsSubject.next();
                },
                error: () => this.notify(this.i18n.t(
                    'sessions.deleteFailed', {count: sessionIds.length})),
              });
        });
  }

  // --- Folders ----------------------------------------------------------

  isCollapsed(folder: SessionFolder|null): boolean {
    return !!folder && this.collapsedFolderIds.has(folder.id);
  }

  toggleCollapsed(folder: SessionFolder) {
    if (!this.collapsedFolderIds.delete(folder.id)) {
      this.collapsedFolderIds.add(folder.id);
    }
  }

  startCreateFolder() {
    this.cancelSessionRename();
    this.renamingFolderId = null;
    this.creatingFolder = true;
    this.folderNameDraft = '';
  }

  startRenameFolder(folder: SessionFolder) {
    this.cancelSessionRename();
    this.creatingFolder = false;
    this.renamingFolderId = folder.id;
    this.folderNameDraft = folder.name;
  }

  cancelFolderEdit() {
    this.creatingFolder = false;
    this.renamingFolderId = null;
    this.folderNameDraft = '';
  }

  /** Saves the folder being created or renamed. */
  submitFolderName() {
    const name = this.folderNameDraft.trim();
    const renamingId = this.renamingFolderId;
    const creating = this.creatingFolder;
    this.cancelFolderEdit();
    if (!name) {
      return;
    }
    if (creating) {
      this.sessionService.createSessionFolder(this.userId, this.appName, name)
          .subscribe({
            next: (folder) => this.folders = [...this.folders, folder],
            error: () => this.notify(this.i18n.t('sessions.folderFailed')),
          });
    } else if (renamingId) {
      this.sessionService
          .renameSessionFolder(this.userId, this.appName, renamingId, name)
          .subscribe({
            next: (renamed) => this.folders = this.folders.map(
                (folder) => folder.id === renamed.id ? renamed : folder),
            error: () => this.notify(this.i18n.t('sessions.folderFailed')),
          });
    }
  }

  deleteFolder(folder: SessionFolder) {
    this.confirm(
            this.i18n.t('sessions.deleteFolder'),
            this.i18n.t('sessions.deleteFolderMessage', {name: folder.name}),
            this.i18n.t('sessions.delete'))
        .subscribe((confirmed) => {
          if (!confirmed) {
            return;
          }
          this.sessionService
              .deleteSessionFolder(this.userId, this.appName, folder.id)
              .subscribe({
                next: () => this.reloadFolders(),
                error: () => this.notify(this.i18n.t('sessions.folderFailed')),
              });
        });
  }

  /**
   * Moves `ids`, or the selected sessions when omitted, into `folderId`
   * (null takes them out of any folder).
   */
  moveSessions(ids: string[]|undefined, folderId: string|null) {
    const sessionIds = ids ?? [...this.selectedIds];
    if (!sessionIds.length) {
      return;
    }
    this.sessionService
        .moveSessionsToFolder(this.userId, this.appName, sessionIds, folderId)
        .subscribe({
          next: () => {
            const assignments = {...this.assignments};
            for (const id of sessionIds) {
              if (folderId) {
                assignments[id] = folderId;
              } else {
                delete assignments[id];
              }
            }
            this.assignments = assignments;
            // Show where the sessions went, but archiving keeps them out of
            // sight.
            if (folderId && folderId !== this.archiveFolder?.id) {
              this.collapsedFolderIds.delete(folderId);
            }
            if (!ids) {
              this.exitSelectMode();
            }
          },
          error: () => this.notify(this.i18n.t('sessions.folderFailed')),
        });
  }

  folderIdOf(sessionId: string): string|undefined {
    return this.assignments[sessionId];
  }

  isArchived(sessionId: string): boolean {
    const archive = this.archiveFolder;
    return !!archive && this.assignments[sessionId] === archive.id;
  }

  /** Moves the session into the archive, or back out of it. */
  toggleArchived(sessionId: string) {
    const archive = this.archiveFolder;
    if (!archive) {
      return;
    }
    this.moveSessions(
        [sessionId], this.isArchived(sessionId) ? null : archive.id);
  }

  // --- Titles -----------------------------------------------------------

  /** The user's title, else the generated brief. */
  getTitle(session: any): string|null {
    return this.titles[session?.id] ?? this.getBrief(session);
  }

  startRenameSession(session: any) {
    this.cancelFolderEdit();
    this.renamingSessionId = session.id;
    this.titleDraft = this.getTitle(session) ?? '';
  }

  cancelSessionRename() {
    this.renamingSessionId = null;
    this.titleDraft = '';
  }

  /**
   * Saves the title being edited. A blank one drops the user's title, so the
   * generated brief shows (and is kept up to date) again.
   */
  submitSessionTitle() {
    const sessionId = this.renamingSessionId;
    if (!sessionId) {
      return;
    }
    const title = this.titleDraft.trim();
    const session = this.sessionList.find((s) => s.id === sessionId);
    this.cancelSessionRename();
    if (title === (this.getTitle(session) ?? '')) {
      return;
    }
    this.sessionService
        .setSessionTitle(this.userId, this.appName, sessionId, title || null)
        .subscribe({
          next: ({title: saved}) => {
            const titles = {...this.titles};
            if (saved) {
              titles[sessionId] = saved;
            } else {
              delete titles[sessionId];
            }
            this.titles = titles;
          },
          error: () => this.notify(this.i18n.t('sessions.titleFailed')),
        });
  }

  private loadFolders(): Observable<SessionFolders> {
    // Folders are an extra; the session list must still load without them.
    return this.sessionService.listSessionFolders(this.userId, this.appName)
        .pipe(catchError(() => of(NO_FOLDERS)));
  }

  private reloadFolders() {
    this.loadFolders().subscribe((folders) => this.applyFolders(folders));
  }

  private applyFolders({folders, assignments, titles}: SessionFolders) {
    this.folders = folders ?? [];
    this.assignments = assignments ?? {};
    this.titles = titles ?? {};
    const archive = this.archiveFolder;
    if (archive && !this.archiveSeen) {
      this.archiveSeen = true;
      this.collapsedFolderIds.add(archive.id);
    }
  }

  private confirm(title: string, message: string, confirmButtonText: string) {
    const data: DeleteSessionDialogData = {
      title,
      message,
      confirmButtonText,
      cancelButtonText: this.i18n.t('sessions.cancel'),
    };
    return this.dialog
        .open(DeleteSessionDialogComponent, {
          width: '600px',
          data,
          panelClass: 'light-dialog',
        })
        .afterClosed();
  }

  private notify(message: string) {
    this.snackBar.open(message, 'OK', {duration: 5000});
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
