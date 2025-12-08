/**
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

import {Component, Input, OnChanges, SimpleChanges} from '@angular/core';

type PlatformStatusCategory = 'completed' | 'overdue' | 'upcoming' | 'active';

interface AsanaTaskCard {
  gid: string;
  name: string;
  completed: boolean;
  statusLabel: string | null;
  statusCategory: PlatformStatusCategory;
  dueOn: string | null;
  overdue: boolean;
  assigneeName: string | null;
  projectNames: string[];
  tagNames: string[];
  priority: string | null;
  permalinkUrl: string | null;
  description: string | null;
  lastUpdated: string | null;
}

interface GoogleDriveFileCard {
  id: string;
  name: string;
  webViewLink: string | null;
}

interface BacklogIssueCard {
  issueKey: string;
  summary: string;
  completed: boolean;
  statusLabel: string | null;
  statusCategory: PlatformStatusCategory;
  dueDate: string | null;
  overdue: boolean;
  assigneeName: string | null;
  priority: string | null;
  issueTypeName: string | null;
  categoryNames: string[];
  milestoneNames: string[];
  versionNames: string[];
  permalinkUrl: string | null;
  lastUpdated: string | null;
  description: string | null;
}

interface SlackMessageCard {
  id: string;
  text: string | null;
  userName: string | null;
  channelName: string | null;
  channelId: string | null;
  channelLabel: string | null;
  timestampMs: number | null;
  permalink: string | null;
}

@Component({
  selector: 'app-state-tab',
  templateUrl: './state-tab.component.html',
  styleUrl: './state-tab.component.scss',
  standalone: false,
})
export class StateTabComponent implements OnChanges {
  @Input() sessionState: any = {};

  protected availablePlatforms: string[] = [];
  protected platformStates: Record<string, any> = {};
  protected expandedPlatform: string | null = null;
  protected asanaTasks: AsanaTaskCard[] = [];
  protected driveFiles: GoogleDriveFileCard[] = [];
  protected backlogIssues: BacklogIssueCard[] = [];
  protected slackMessages: SlackMessageCard[] = [];
  protected slackMessageExpansion: Record<string, boolean> = {};
  protected asanaDescriptionExpansion: Record<string, boolean> = {};
  protected backlogDescriptionExpansion: Record<string, boolean> = {};

  private asanaState: any = {};
  private driveState: any = {};
  private backlogState: any = {};
  private slackState: any = {};
  private fallbackIdCounter = 0;
  private readonly suppressedStateKeyPrefixes: string[] = ['session_brief'];

  ngOnChanges(changes: SimpleChanges): void {
    if ('sessionState' in changes) {
      this.resetPlatformState();
    }
  }

  protected hasAsanaTasks(): boolean {
    return this.asanaTasks.length > 0;
  }

  protected hasDriveFiles(): boolean {
    return this.driveFiles.length > 0;
  }

  protected hasBacklogIssues(): boolean {
    return this.backlogIssues.length > 0;
  }

  protected hasSlackMessages(): boolean {
    return this.slackMessages.length > 0;
  }

  protected isSlackMessageExpanded(id: string): boolean {
    return Boolean(this.slackMessageExpansion[id]);
  }

  protected toggleSlackMessageExpansion(id: string): void {
    this.slackMessageExpansion[id] = !this.slackMessageExpansion[id];
  }

  protected shouldShowSlackToggle(message: SlackMessageCard): boolean {
    const text = message.text ?? '';
    return text.length > 220 || text.includes('\n') || text.includes('\r');
  }

  protected isAsanaDescriptionExpanded(id: string): boolean {
    return Boolean(this.asanaDescriptionExpansion[id]);
  }

  protected toggleAsanaDescription(id: string): void {
    this.asanaDescriptionExpansion[id] = !this.asanaDescriptionExpansion[id];
  }

  protected shouldShowAsanaDescription(task: AsanaTaskCard): boolean {
    const text = task.description ?? '';
    return text.length > 220 || text.includes('\n') || text.includes('\r');
  }

  protected isBacklogDescriptionExpanded(id: string): boolean {
    return Boolean(this.backlogDescriptionExpansion[id]);
  }

  protected toggleBacklogDescription(id: string): void {
    this.backlogDescriptionExpansion[id] = !this.backlogDescriptionExpansion[id];
  }

  protected shouldShowBacklogDescription(issue: BacklogIssueCard): boolean {
    const text = issue.description ?? '';
    return text.length > 220 || text.includes('\n') || text.includes('\r');
  }

  protected getStatusPillClass(item: {statusCategory: PlatformStatusCategory}): string {
    switch (item.statusCategory) {
      case 'completed':
        return 'status-pill completed';
      case 'overdue':
        return 'status-pill overdue';
      case 'upcoming':
        return 'status-pill upcoming';
      default:
        return 'status-pill active';
    }
  }

  protected isPanelExpanded(platform: string): boolean {
    return this.expandedPlatform === platform;
  }

  protected onPanelOpened(platform: string): void {
    this.expandedPlatform = platform;
    if (platform === 'asana') {
      this.asanaState = this.platformStates[platform] ?? {};
      this.prepareAsanaViewModel();
    }
    if (platform === 'gdrive') {
      this.driveState = this.platformStates[platform] ?? {};
      this.prepareDriveViewModel();
    }
    if (platform === 'backlog') {
      this.backlogState = this.platformStates[platform] ?? {};
      this.prepareBacklogViewModel();
    }
    if (platform === 'slack') {
      this.slackState = this.platformStates[platform] ?? {};
      this.prepareSlackViewModel();
    }
  }

  protected getPlatformPanelClass(platform: string): string {
    return `platform-panel platform-${platform}`;
  }

  protected getPlatformAccent(platform: string): string {
    const palette: Record<string, string> = {
      'asana': '#fde2d0',
      'backlog': '#e2e6ff',
      'gdrive': '#e1f4e5',
      'gmail': '#fde1e1',
      'slack': '#f1e5ff',
    };
    return palette[platform] ?? '#f7f9fa';
  }

  protected getPlatformBodyColor(platform: string): string {
    return this.getPlatformAccent(platform);
  }

  private prepareAsanaViewModel(): void {
    if (!this.hasRawState(this.asanaState)) {
      this.asanaTasks = [];
      this.asanaDescriptionExpansion = {};
      return;
    }

    this.asanaTasks = this.normalizeAsanaTasks(this.asanaState?.tasks);
    this.asanaDescriptionExpansion = {};
  }

  private prepareDriveViewModel(): void {
    if (!this.hasRawState(this.driveState)) {
      this.driveFiles = [];
      return;
    }

    const source = this.driveState?.documents ?? this.driveState?.files ?? this.driveState?.items ?? [];
    this.driveFiles = this.normalizeDriveFiles(source);
  }

  private prepareBacklogViewModel(): void {
    if (!this.hasRawState(this.backlogState)) {
      this.backlogIssues = [];
      this.backlogDescriptionExpansion = {};
      return;
    }

    const source = this.backlogState?.issues ?? this.backlogState ?? [];
    this.backlogIssues = this.normalizeBacklogIssues(source);
    this.backlogDescriptionExpansion = {};
  }

  private prepareSlackViewModel(): void {
    if (!this.hasRawState(this.slackState)) {
      this.slackMessages = [];
      this.slackMessageExpansion = {};
      return;
    }

    const messageStore = this.slackState?.messages ?? [];
    const orderedIds = this.extractSlackMessageOrder(this.slackState);
    if (orderedIds.length && messageStore && typeof messageStore === 'object' && !Array.isArray(messageStore)) {
      const orderedMessages = orderedIds
          .map((id) => (messageStore as Record<string, any>)[id])
          .filter((message) => Boolean(message));
      this.slackMessages = orderedMessages.length
        ? this.normalizeSlackMessages(orderedMessages, true)
        : this.normalizeSlackMessages(messageStore);
    } else {
      this.slackMessages = this.normalizeSlackMessages(messageStore);
    }
    this.slackMessageExpansion = {};
  }

  private resetPlatformState(): void {
    const state = this.sessionState ?? {};
    this.availablePlatforms = Object.keys(state || {})
        .filter((platform) => this.shouldDisplayStateKey(platform))
        .sort();
    this.platformStates = {};

    this.availablePlatforms.forEach((platform) => {
      this.platformStates[platform] = state[platform];
    });

    if (!this.availablePlatforms.length) {
      this.expandedPlatform = null;
      this.asanaState = {};
      this.asanaTasks = [];
      this.driveState = {};
      this.driveFiles = [];
      this.backlogState = {};
      this.backlogIssues = [];
      this.slackState = {};
      this.slackMessages = [];
      this.slackMessageExpansion = {};
      this.asanaDescriptionExpansion = {};
      this.backlogDescriptionExpansion = {};
      return;
    }

    if (!this.expandedPlatform || !this.availablePlatforms.includes(this.expandedPlatform)) {
      this.expandedPlatform = this.availablePlatforms.includes('asana') ? 'asana' : this.availablePlatforms[0];
    }

    if (this.expandedPlatform === 'asana') {
      this.asanaState = this.platformStates['asana'] ?? {};
      this.prepareAsanaViewModel();
    } else {
      this.asanaState = {};
      this.asanaTasks = [];
      this.asanaDescriptionExpansion = {};
    }

    if (this.expandedPlatform === 'gdrive') {
      this.driveState = this.platformStates['gdrive'] ?? {};
      this.prepareDriveViewModel();
    } else {
      this.driveState = {};
      this.driveFiles = [];
    }

    if (this.expandedPlatform === 'backlog') {
      this.backlogState = this.platformStates['backlog'] ?? {};
      this.prepareBacklogViewModel();
    } else {
      this.backlogState = {};
      this.backlogIssues = [];
      this.backlogDescriptionExpansion = {};
    }

    if (this.expandedPlatform === 'slack') {
      this.slackState = this.platformStates['slack'] ?? {};
      this.prepareSlackViewModel();
    } else {
      this.slackState = {};
      this.slackMessages = [];
      this.slackMessageExpansion = {};
    }
  }

  private normalizeAsanaTasks(rawTasks: unknown): AsanaTaskCard[] {
    const asArray = this.toArray(rawTasks);
    return asArray
        .map((task) => this.mapTask(task))
        .filter((task): task is AsanaTaskCard => task !== null);
  }

  private normalizeDriveFiles(rawFiles: unknown): GoogleDriveFileCard[] {
    const asArray = this.toArray(rawFiles);
    return asArray
        .map((file) => this.mapDriveFile(file))
        .filter((file): file is GoogleDriveFileCard => file !== null);
  }

  private normalizeBacklogIssues(rawIssues: unknown): BacklogIssueCard[] {
    if (!rawIssues) {
      return [];
    }

    let values: any[] = [];
    if (Array.isArray(rawIssues)) {
      values = rawIssues;
    } else if (typeof rawIssues === 'object') {
      values = Object.values(rawIssues);
    }

    return values
        .map((issue) => this.mapBacklogIssue(issue))
        .filter((issue): issue is BacklogIssueCard => issue !== null);
  }

  private normalizeSlackMessages(rawMessages: unknown, preserveOrder = false): SlackMessageCard[] {
    const asArray = Array.isArray(rawMessages) ? rawMessages : this.toArray(rawMessages);
    const mapped = asArray
        .map((message) => this.mapSlackMessage(message))
        .filter((message): message is SlackMessageCard => message !== null);
    if (!preserveOrder) {
      mapped.sort((a, b) => (b.timestampMs ?? 0) - (a.timestampMs ?? 0));
    }
    return mapped;
  }

  private extractSlackMessageOrder(state: any): string[] {
    if (!state || typeof state !== 'object') {
      return [];
    }
    const lastSearchIds = this.normalizeSlackMessageIds(state['last_search']?.message_ids ?? state['last_search']?.messageIds);
    if (lastSearchIds.length) {
      return lastSearchIds;
    }

    const history = this.toArray(state['recent_searches']);
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const entryIds = this.normalizeSlackMessageIds(history[index]?.message_ids ?? history[index]?.messageIds);
      if (entryIds.length) {
        return entryIds;
      }
    }
    return [];
  }

  private normalizeSlackMessageIds(ids: unknown): string[] {
    if (!ids) {
      return [];
    }
    const values = Array.isArray(ids) ? ids : this.toArray(ids);
    return values
        .map((value) => {
          if (value === null || value === undefined) {
            return '';
          }
          return String(value).trim();
        })
        .filter((value) => value.length > 0);
  }

  private mapTask(task: any): AsanaTaskCard | null {
    if (!task || typeof task !== 'object') {
      return null;
    }

    const gid = this.coerceTaskId(task);
    const completed = Boolean(task.completed);
    const dueRaw = this.extractDueDate(task);
    const overdue = this.isOverdue(dueRaw, completed);
    const statusLabel = this.extractStatusLabel(task, completed, overdue);
    const statusCategory = this.resolveStatusCategory(completed, overdue, dueRaw);

    return {
      gid,
      name: this.extractName(task),
      completed,
      statusLabel,
      statusCategory,
      dueOn: dueRaw,
      overdue,
      assigneeName: this.extractAssignee(task?.assignee),
      projectNames: this.extractNamesArray(task?.projects),
      tagNames: this.extractNamesArray(task?.tags),
      priority: this.extractCustomFieldValue(task, ['priority']),
      permalinkUrl: this.extractPermalink(task),
      description: this.extractDescription(task),
      lastUpdated: this.extractLastUpdated(task),
    };
  }

  private mapDriveFile(file: any): GoogleDriveFileCard | null {
    if (!file || typeof file !== 'object') {
      return null;
    }

    return {
      id: this.coerceDriveId(file),
      name: this.extractDriveName(file),
      webViewLink: this.extractDriveLink(file),
    };
  }

  private mapBacklogIssue(issue: any): BacklogIssueCard | null {
    if (!issue || typeof issue !== 'object') {
      return null;
    }

    const issueKey = this.coerceBacklogIssueKey(issue);
    const summary = this.extractBacklogSummary(issue);
    const dueDate = this.extractBacklogDate(issue, ['dueDate', 'due_on']);
    const completed = this.isBacklogCompleted(issue);
    const overdue = this.isOverdue(dueDate, completed);
    const statusLabel = this.extractBacklogStatus(issue, completed, overdue);

    return {
      issueKey,
      summary,
      completed,
      statusLabel,
      statusCategory: this.resolveStatusCategory(completed, overdue, dueDate),
      dueDate,
      overdue,
      assigneeName: this.extractAssignee(issue['assignee']),
      priority: this.extractBacklogPriority(issue),
      issueTypeName: this.extractIssueTypeName(issue),
      categoryNames: this.extractNamesArray(issue['category']),
      milestoneNames: this.extractNamesArray(issue['milestone']),
      versionNames: this.extractNamesArray(issue['versions']),
      permalinkUrl: this.extractPermalink(issue),
      lastUpdated: this.extractBacklogDate(issue, ['updated', 'updated_at', 'updatedOn']),
      description: this.extractBacklogDescription(issue),
    };
  }

  private mapSlackMessage(rawMessage: any): SlackMessageCard | null {
    if (!rawMessage || typeof rawMessage !== 'object') {
      return null;
    }

    const message = this.flattenSlackEnvelope(rawMessage);
    const channelName = this.extractSlackChannelName(message);
    const channelId = this.extractSlackChannelId(message);

    return {
      id: this.coerceSlackMessageId(message),
      text: this.extractSlackText(message),
      userName: this.extractSlackUser(message),
      channelName,
      channelId,
      channelLabel: channelName ?? channelId ?? null,
      timestampMs: this.extractSlackTimestampMs(message),
      permalink: this.extractPermalink(message),
    };
  }

  private flattenSlackEnvelope(message: Record<string, any>): Record<string, any> {
    const nested = message['message'];
    if (!nested || typeof nested !== 'object') {
      return message;
    }
    const merged: Record<string, any> = {...message};
    Object.keys(nested).forEach((key) => {
      const value = nested[key];
      if (value !== undefined && value !== null) {
        merged[key] = value;
      }
    });
    return merged;
  }

  private coerceSlackMessageId(message: Record<string, any>): string {
    const permalink = this.extractPermalink(message);
    if (permalink) {
      return permalink;
    }
    const channelId = this.extractSlackChannelId(message);
    const tsToken = this.extractSlackTimestampToken(message);
    if (channelId && tsToken) {
      return `${channelId}|${tsToken}`;
    }
    if (tsToken) {
      return tsToken;
    }
    this.fallbackIdCounter += 1;
    return `slack-message-${this.fallbackIdCounter}`;
  }

  private extractSlackTimestampToken(message: Record<string, any>): string | null {
    const candidates = [
      message['ts'],
      message['timestamp'],
      message['event_ts'],
      message['time'],
      message['latest_ts'],
    ];
    for (const candidate of candidates) {
      if (candidate === undefined || candidate === null) {
        continue;
      }
      return typeof candidate === 'string' ? candidate : String(candidate);
    }
    return null;
  }

  private extractSlackText(message: Record<string, any>): string | null {
    const attachments = this.toArray(message['attachments']);
    const files = this.toArray(message['files']);
    const candidates = [
      message['plain_text'],
      message['text'],
      message['summary'],
      attachments[0]?.text,
      attachments[0]?.fallback,
      files[0]?.title,
      files[0]?.name,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return this.cleanSlackFormatting(candidate);
      }
    }
    return null;
  }

  private cleanSlackFormatting(text: string): string {
    let cleaned = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    cleaned = cleaned.replace(/<@([A-Za-z0-9]+)>/g, '@$1');
    cleaned = cleaned.replace(/<!channel>/gi, '@channel');
    cleaned = cleaned.replace(/<!here>/gi, '@here');
    cleaned = cleaned.replace(/<#[A-Za-z0-9]+\|([^>]+)>/g, '#$1');
    cleaned = cleaned.replace(/<([^|>]+)\|([^>]+)>/g, '$2 ($1)');
    cleaned = cleaned.replace(/<([^>]+)>/g, '$1');
    return cleaned.trim();
  }

  private extractSlackUser(message: Record<string, any>): string | null {
    const profile = message['user_profile'] ?? message['profile'];
    const botProfile = message['bot_profile'];
    const candidates = [
      profile?.display_name,
      profile?.real_name,
      profile?.name,
      message['user_name'],
      message['username'],
      message['author_name'],
      botProfile?.name,
      message['bot_name'],
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
    const userId = message['user'];
    if (typeof userId === 'string' && userId.trim().length > 0) {
      return userId.trim();
    }
    return null;
  }

  private extractSlackChannelName(message: Record<string, any>): string | null {
    const direct = message['channel_name'];
    if (typeof direct === 'string' && direct.trim().length > 0) {
      return this.formatChannelLabel(direct.trim());
    }
    const channel = message['channel'];
    if (typeof channel === 'string') {
      const trimmed = channel.trim();
      if (trimmed.startsWith('#')) {
        return trimmed;
      }
    }
    if (channel && typeof channel === 'object') {
      const name = channel['name'];
      if (typeof name === 'string' && name.trim().length > 0) {
        return this.formatChannelLabel(name.trim());
      }
    }
    return null;
  }

  private extractSlackChannelId(message: Record<string, any>): string | null {
    const candidates = [
      message['channel_id'],
      message['channelId'],
      typeof message['channel'] === 'string' && !String(message['channel']).trim().startsWith('#') ? message['channel'] : null,
      message['channel']?.id,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
    return null;
  }

  private formatChannelLabel(name: string): string {
    if (!name) {
      return name;
    }
    const trimmed = name.trim();
    if (!trimmed.length) {
      return trimmed;
    }
    return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  }

  private extractSlackTimestampMs(message: Record<string, any>): number | null {
    const candidates = [
      message['ts'],
      message['timestamp'],
      message['event_ts'],
      message['time'],
      message['latest_ts'],
    ];
    for (const candidate of candidates) {
      const ms = this.coerceSlackTimestampMs(candidate);
      if (ms !== null) {
        return ms;
      }
    }
    return null;
  }

  private coerceSlackTimestampMs(value: any): number | null {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return null;
      }
      return value > 1e12 ? Math.round(value) : Math.round(value * 1000);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      const numeric = Number(trimmed);
      if (!Number.isNaN(numeric)) {
        return numeric > 1e12 ? Math.round(numeric) : Math.round(numeric * 1000);
      }
      const digits = trimmed.replace(/[^0-9.]/g, '');
      if (!digits) {
        return null;
      }
      const parsed = Number(digits);
      if (Number.isNaN(parsed)) {
        return null;
      }
      return parsed > 1e12 ? Math.round(parsed) : Math.round(parsed * 1000);
    }
    return null;
  }

  private coerceTaskId(task: Record<string, any>): string {
    const rawId = task['gid'] ?? task['id'];
    if (rawId !== undefined && rawId !== null) {
      return String(rawId);
    }
    this.fallbackIdCounter += 1;
    return `task-${this.fallbackIdCounter}`;
  }

  private coerceDriveId(file: Record<string, any>): string {
    const rawId = file['id'] ?? file['gid'];
    if (rawId !== undefined && rawId !== null) {
      return String(rawId);
    }
    this.fallbackIdCounter += 1;
    return `drive-file-${this.fallbackIdCounter}`;
  }

  private coerceBacklogIssueKey(issue: Record<string, any>): string {
    const candidates = [issue['issueKey'], issue['key'], issue['keyId']];
    for (const candidate of candidates) {
      if (candidate === undefined || candidate === null) {
        continue;
      }
      const value = String(candidate).trim();
      if (value.length > 0) {
        return value;
      }
    }
    this.fallbackIdCounter += 1;
    return `issue-${this.fallbackIdCounter}`;
  }

  private extractBacklogSummary(issue: Record<string, any>): string {
    const candidates = [issue['summary'], issue['title'], issue['name']];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
    return 'Untitled issue';
  }

  private extractBacklogDescription(issue: Record<string, any>): string | null {
    const candidates = [
      issue['description'],
      issue['content'],
      issue['text'],
      issue['detail'],
      issue['body'],
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
    return null;
  }

  private extractBacklogDate(issue: Record<string, any>, keys: string[]): string | null {
    for (const key of keys) {
      const value = issue[key];
      if (value === undefined || value === null) {
        continue;
      }
      return typeof value === 'string' ? value : String(value);
    }
    return null;
  }

  private extractBacklogStatus(
      issue: Record<string, any>,
      completed: boolean,
      overdue: boolean,
  ): string | null {
    const status = issue['status'];
    if (typeof status === 'string' && status.trim().length > 0) {
      return status.trim();
    }
    if (status && typeof status === 'object') {
      const name = status['name'] ?? status['label'];
      if (typeof name === 'string' && name.trim().length > 0) {
        return name.trim();
      }
    }
    if (completed) {
      return 'Completed';
    }
    if (overdue) {
      return 'Overdue';
    }
    return null;
  }

  private extractBacklogPriority(issue: Record<string, any>): string | null {
    const priority = issue['priority'];
    if (typeof priority === 'string' && priority.trim().length > 0) {
      return priority.trim();
    }
    if (priority && typeof priority === 'object') {
      const name = priority['name'];
      if (typeof name === 'string' && name.trim().length > 0) {
        return name.trim();
      }
    }
    return null;
  }

  private extractIssueTypeName(issue: Record<string, any>): string | null {
    const issueType = issue['issueType'];
    if (typeof issueType === 'string' && issueType.trim().length > 0) {
      return issueType.trim();
    }
    if (issueType && typeof issueType === 'object') {
      const name = issueType['name'];
      if (typeof name === 'string' && name.trim().length > 0) {
        return name.trim();
      }
    }
    return null;
  }

  private extractName(task: Record<string, any>): string {
    const nameCandidates = [task['name'], task['title']];
    for (const candidate of nameCandidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
    return 'Untitled task';
  }

  private extractDriveName(file: Record<string, any>): string {
    const nameCandidates = [file['name'], file['title']];
    for (const candidate of nameCandidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
    return 'Untitled file';
  }

  private extractDueDate(task: Record<string, any>): string | null {
    const dueValue = task['due_on'] ?? task['due_at'] ?? null;
    if (dueValue === null || dueValue === undefined) {
      return null;
    }
    return typeof dueValue === 'string' ? dueValue : String(dueValue);
  }

  private isOverdue(dueRaw: string | null, completed: boolean): boolean {
    if (!dueRaw || completed) {
      return false;
    }
    const dueDate = new Date(dueRaw);
    if (Number.isNaN(dueDate.getTime())) {
      return false;
    }
    const now = new Date();
    return dueDate.getTime() < now.getTime();
  }

  private resolveStatusCategory(
      completed: boolean,
      overdue: boolean,
      dueRaw: string | null,
  ): PlatformStatusCategory {
    if (completed) {
      return 'completed';
    }
    if (overdue) {
      return 'overdue';
    }
    if (dueRaw) {
      return 'upcoming';
    }
    return 'active';
  }

  private extractStatusLabel(task: Record<string, any>, completed: boolean, overdue: boolean): string | null {
    const explicitStatus = task['status'] ?? this.extractCustomFieldValue(task, ['status', 'stage', 'state']);
    if (explicitStatus && typeof explicitStatus === 'string') {
      return explicitStatus;
    }
    if (completed) {
      return 'Completed';
    }
    if (overdue) {
      return 'Overdue';
    }
    return null;
  }

  private extractAssignee(assignee: any): string | null {
    if (!assignee) {
      return null;
    }
    if (typeof assignee === 'string') {
      return assignee;
    }
    return assignee.name ?? assignee.display_name ?? assignee.email ?? assignee.gid ?? null;
  }

  private extractNamesArray(value: any): string[] {
    return this.toArray(value)
        .map((item) => {
          if (!item) {
            return null;
          }
          if (typeof item === 'string') {
            return item;
          }
          return item.name ?? null;
        })
        .filter((name): name is string => Boolean(name));
  }

  private extractPermalink(task: Record<string, any>): string | null {
    const link = task['permalink_url'] ?? task['permalink'] ?? null;
    if (typeof link === 'string' && link.trim().length > 0) {
      return link;
    }
    return null;
  }

  private extractDriveLink(file: Record<string, any>): string | null {
    const link = file['webViewLink'] ?? file['alternateLink'] ?? file['webContentLink'] ?? null;
    if (typeof link === 'string' && link.trim().length > 0) {
      return link.trim();
    }
    return null;
  }

  private extractDescription(task: Record<string, any>): string | null {
    const notes = task['notes'] ?? task['plain_text_description'] ?? task['html_notes'];
    if (typeof notes !== 'string') {
      return null;
    }
    const trimmed = notes.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private extractLastUpdated(task: Record<string, any>): string | null {
    const updated = task['modified_at'] ?? task['updated_at'] ?? task['created_at'] ?? null;
    if (updated === null || updated === undefined) {
      return null;
    }
    return typeof updated === 'string' ? updated : String(updated);
  }

  private extractCustomFieldValue(task: Record<string, any>, keywordCandidates: string[]): string | null {
    const customFields = this.toArray(task['custom_fields']);
    if (!customFields.length) {
      return null;
    }

    const loweredKeywords = keywordCandidates.map((keyword) => keyword.toLowerCase());
    const match = customFields.find((field: any) => {
      if (!field || typeof field !== 'object') {
        return false;
      }
      const name = typeof field.name === 'string' ? field.name.toLowerCase() : '';
      return loweredKeywords.some((keyword) => name.includes(keyword));
    });

    if (!match) {
      return null;
    }

    const values = [match.display_value, match.enum_value?.name, match.text_value];
    for (const value of values) {
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    return null;
  }

  private isBacklogCompleted(issue: Record<string, any>): boolean {
    const resolution = issue?.['resolution'];
    const resolutionName = this.normalizeStatusText(
        typeof resolution === 'string' ? resolution : resolution?.name,
    );
    if (resolutionName && !['未対応', 'open', '未着手'].some((token) => resolutionName.includes(token))) {
      return true;
    }

    const status = issue?.['status'];
    const statusName = this.normalizeStatusText(typeof status === 'string' ? status : status?.name);
    if (!statusName) {
      return false;
    }
    const doneTokens = ['完了', '対応済', 'done', 'closed', 'resolved', 'complete', 'completed'];
    return doneTokens.some((token) => statusName.includes(token));
  }

  private normalizeStatusText(value: any): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.toLowerCase() : null;
  }

  private toArray(value: any): any[] {
    if (Array.isArray(value)) {
      return value;
    }
    if (value && typeof value === 'object') {
      return Object.values(value);
    }
    return [];
  }

  private hasRawState(state: any): boolean {
    if (state === null || state === undefined) {
      return false;
    }

    if (Array.isArray(state)) {
      return state.length > 0;
    }

    if (typeof state === 'object') {
      return Object.keys(state).length > 0;
    }

    return true;
  }

  private shouldDisplayStateKey(key: string): boolean {
    if (!key) {
      return false;
    }
    const normalizedKey = key.toLowerCase();
    return !this.suppressedStateKeyPrefixes.some((prefix) => normalizedKey.startsWith(prefix));
  }
}
