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

import {Component, inject, OnInit, signal} from '@angular/core';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';

import {MessageKey} from '../../core/i18n/messages';
import {I18nService} from '../../core/i18n/i18n.service';
import {Platform, PLATFORMS} from '../../core/models/Platform';
import {Connection, ConnectionContext, ConnectionService} from '../../core/services/connection.service';
import {DevModeService} from '../../core/services/dev-mode.service';
import {ThemeService} from '../../core/services/theme.service';
import {TokenStreamingService} from '../../core/services/token-streaming.service';

export type SettingsSection = 'general'|'connections';

export interface SettingsDialogData extends ConnectionContext {
  section?: SettingsSection;
}

interface ConnectionRow {
  platform: Platform;
  connection: Connection;
}

/** The settings dialog: general display settings and platform connections. */
@Component({
  selector: 'app-settings-dialog',
  templateUrl: './settings-dialog.component.html',
  styleUrls: ['./settings-dialog.component.scss'],
  standalone: false,
})
export class SettingsDialogComponent implements OnInit {
  protected readonly data = inject<SettingsDialogData>(MAT_DIALOG_DATA);
  protected readonly dialogRef = inject(MatDialogRef<SettingsDialogComponent>);
  protected readonly i18n = inject(I18nService);
  protected readonly themeService = inject(ThemeService);
  protected readonly devMode = inject(DevModeService);
  protected readonly tokenStreaming = inject(TokenStreamingService);
  private readonly connectionService = inject(ConnectionService);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly sections: {id: SettingsSection, label: MessageKey, icon: string}[] = [
    {id: 'general', label: 'settings.general', icon: 'tune'},
    {id: 'connections', label: 'settings.connections', icon: 'hub'},
  ];
  protected readonly section = signal<SettingsSection>(this.data.section ?? 'general');

  protected readonly connections = signal<ConnectionRow[]>([]);
  protected readonly loadingConnections = signal(false);
  protected readonly connectionsError = signal(false);
  /** The platform whose connect / disconnect is in progress. */
  protected readonly busyPlatformId = signal<string|null>(null);

  ngOnInit() {
    this.loadConnections();
  }

  protected loadConnections() {
    this.loadingConnections.set(true);
    this.connectionsError.set(false);
    this.connectionService.getConnections(this.data).subscribe({
      next: (connections) => {
        // Follow the + menu's platform order and names.
        this.connections.set(PLATFORMS.flatMap((platform) => {
          const connection = connections.find((c) => c.id === platform.id);
          return connection ? [{platform, connection}] : [];
        }));
        this.loadingConnections.set(false);
      },
      error: () => {
        this.connectionsError.set(true);
        this.loadingConnections.set(false);
      },
    });
  }

  protected async connect(row: ConnectionRow) {
    this.busyPlatformId.set(row.platform.id);
    const result = await this.connectionService.connect(row.platform.id, this.data);
    this.busyPlatformId.set(null);
    if (result === null) {
      this.snackBar.open(this.i18n.t('settings.popupBlocked'), 'OK');
      return;
    }
    // Reload even when the popup just closed: it may have finished anyway.
    this.loadConnections();
  }

  protected disconnect(row: ConnectionRow) {
    this.busyPlatformId.set(row.platform.id);
    this.connectionService.disconnect(row.platform.id, this.data).subscribe({
      next: () => {
        this.busyPlatformId.set(null);
        this.loadConnections();
      },
      error: () => {
        this.busyPlatformId.set(null);
        this.snackBar.open(
            this.i18n.t('settings.disconnectFailed', {platform: this.platformName(row.platform)}),
            'OK');
      },
    });
  }

  protected platformName(platform: Platform): string {
    return platform.name ?? (platform.labelKey ? this.i18n.t(platform.labelKey) : platform.id);
  }

  protected connectionStatus(connection: Connection): string {
    if (connection.authType === 'shared') {
      return this.i18n.t('settings.sharedAccount');
    }
    if (!connection.enabled) {
      return this.i18n.t('settings.oauthDisabled');
    }
    if (!connection.connected) {
      return this.i18n.t('settings.notConnected');
    }
    return connection.account ?
        this.i18n.t('settings.connectedAs', {account: connection.account}) :
        this.i18n.t('settings.connected');
  }
}
