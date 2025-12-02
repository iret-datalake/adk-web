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

type AsanaStatusCategory = 'completed' | 'overdue' | 'upcoming' | 'active';

interface AsanaTaskCard {
  gid: string;
  name: string;
  completed: boolean;
  statusLabel: string | null;
  statusCategory: AsanaStatusCategory;
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

  private asanaState: any = {};
  private fallbackIdCounter = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if ('sessionState' in changes) {
      this.resetPlatformState();
    }
  }

  protected hasAsanaTasks(): boolean {
    return this.asanaTasks.length > 0;
  }

  protected getStatusPillClass(task: AsanaTaskCard): string {
    switch (task.statusCategory) {
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
  }

  protected getPlatformPanelClass(platform: string): string {
    return `platform-panel platform-${platform}`;
  }

  protected getPlatformAccent(platform: string): string {
    const palette: Record<string, string> = {
      'asana': '#fef7f1',
      'gdrive': '#f2f8ff',
      'gmail': '#fef4f4',
      'slack': '#f6f2ff',
    };
    return palette[platform] ?? '#f7f9fa';
  }

  private prepareAsanaViewModel(): void {
    if (!this.hasRawState(this.asanaState)) {
      this.asanaTasks = [];
      return;
    }

    this.asanaTasks = this.normalizeAsanaTasks(this.asanaState?.tasks);
  }

  private resetPlatformState(): void {
    const state = this.sessionState ?? {};
    this.availablePlatforms = Object.keys(state || {})
        .filter((platform) => platform !== 'session_brief')
        .sort();
    this.platformStates = {};

    this.availablePlatforms.forEach((platform) => {
      this.platformStates[platform] = state[platform];
    });

    if (!this.availablePlatforms.length) {
      this.expandedPlatform = null;
      this.asanaState = {};
      this.asanaTasks = [];
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
    }
  }

  private normalizeAsanaTasks(rawTasks: unknown): AsanaTaskCard[] {
    const asArray = this.toArray(rawTasks);
    return asArray
        .map((task) => this.mapTask(task))
        .filter((task): task is AsanaTaskCard => task !== null);
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

  private coerceTaskId(task: Record<string, any>): string {
    const rawId = task['gid'] ?? task['id'];
    if (rawId !== undefined && rawId !== null) {
      return String(rawId);
    }
    this.fallbackIdCounter += 1;
    return `task-${this.fallbackIdCounter}`;
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
  ): AsanaStatusCategory {
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
}
