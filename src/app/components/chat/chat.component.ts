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

import {DOCUMENT, Location} from '@angular/common';
import {HttpErrorResponse} from '@angular/common/http';
import {AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener, Inject, inject, OnDestroy, OnInit, Renderer2, signal, ViewChild, WritableSignal} from '@angular/core';
import {FormControl} from '@angular/forms';
import {MatDialog, MatDialogModule} from '@angular/material/dialog';
import {MatPaginatorIntl} from '@angular/material/paginator';
import {MatDrawer} from '@angular/material/sidenav';
import {MatSnackBar} from '@angular/material/snack-bar';
import {DomSanitizer, SafeHtml} from '@angular/platform-browser';
import {ActivatedRoute, NavigationEnd, Router} from '@angular/router';
import {instance} from '@viz-js/viz';
import {BehaviorSubject, catchError, combineLatest, distinctUntilChanged, finalize, filter, map, Observable, of, shareReplay, Subscription, switchMap, take, tap} from 'rxjs';
import stc from 'string-to-color';

import {URLUtil} from '../../../utils/url-util';
import {AgentRunRequest, ThinkingMode} from '../../core/models/AgentRunRequest';
import {Session} from '../../core/models/Session';
import {User} from '../../core/models/User';
import {AgentService} from '../../core/services/agent.service';
import {ArtifactService} from '../../core/services/artifact.service';
import {AudioService} from '../../core/services/audio.service';
import {DownloadService} from '../../core/services/download.service';
import {EvalService} from '../../core/services/eval.service';
import {EventService} from '../../core/services/event.service';
import {FeatureFlagService} from '../../core/services/feature-flag.service';
import {FeedbackDirection, MessageFeedback, SessionService} from '../../core/services/session.service';
import {UserService} from '../../core/services/user.service';
import {TraceService} from '../../core/services/trace.service';
import {VideoService} from '../../core/services/video.service';
import {WebSocketService} from '../../core/services/websocket.service';
import {ResizableDrawerDirective} from '../../directives/resizable-drawer.directive';
import {getMediaTypeFromMimetype, MediaType, openBase64InNewTab} from '../artifact-tab/artifact-tab.component';
import {AudioPlayerComponent} from '../audio-player/audio-player.component';
import {EditFunctionArgsDialogComponent} from '../eval-tab/edit-function-args-dialog/edit-function-args-dialog.component';
import {EvalCase, EvalTabComponent} from '../eval-tab/eval-tab.component';
import {EventTabComponent} from '../event-tab/event-tab.component';
import {DeleteSessionDialogComponent, DeleteSessionDialogData,} from '../session-tab/delete-session-dialog/delete-session-dialog.component';
import {SessionTabComponent} from '../session-tab/session-tab.component';
import {ViewImageDialogComponent} from '../view-image-dialog/view-image-dialog.component';
import {I18nService} from '../../core/i18n/i18n.service';
import {Language, MessageKey} from '../../core/i18n/messages';
import {APPROVAL_REQUESTED_ERROR, getHitlRequest, HitlRequest, REJECTED_ERROR} from '../../core/models/Hitl';
import {getLogoConfig} from '../../core/models/RuntimeConfig';
import {HitlResolution} from '../hitl-request/hitl-request.component';
import {InstructionDiffDialogComponent} from '../instruction-diff-dialog/instruction-diff-dialog.component';
import {DevModeService} from '../../core/services/dev-mode.service';
import {PlatformService} from '../../core/services/platform.service';
import {MODEL_OPTIONS, PLATFORMS} from '../../core/models/Platform';
import {ThemeService} from '../../core/services/theme.service';

function fixBase64String(base64: string): string {
  // Replace URL-safe characters if they exist
  base64 = base64.replace(/-/g, '+').replace(/_/g, '/');

  // Fix base64 padding
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }

  return base64;
}

class CustomPaginatorIntl extends MatPaginatorIntl {
  override nextPageLabel = 'Next Event';
  override previousPageLabel = 'Previous Event';
  override firstPageLabel = 'First Event';
  override lastPageLabel = 'Last Event';

  override getRangeLabel = (page: number, pageSize: number, length: number) => {
    if (length === 0) {
      return `Event 0 of ${length}`;
    }

    length = Math.max(length, 0);
    const startIndex = page * pageSize;

    return `Event ${startIndex + 1} of ${length}`;
  };
}

const BIDI_STREAMING_RESTART_WARNING =
  'Restarting bidirectional streaming is not currently supported. Please refresh the page or start a new session.';

const THINKING_MODE_STORAGE_KEY = 'adk-web.thinkingMode';
const TOKEN_STREAMING_STORAGE_KEY = 'adk-web.tokenStreaming';

/** Display names for the root agent's platform tools (sub-agents). */
const AGENT_TOOL_NAMES: Record<string, string> = {
  sub_agent_slack: 'Slack',
  sub_agent_gdrive: 'Google Drive',
  sub_agent_asana: 'Asana',
  sub_agent_backlog: 'Backlog',
  sub_agent_github: 'GitHub',
};

/** Platform tools whose display name depends on the UI language. */
const AGENT_TOOL_LABEL_KEYS: Record<string, MessageKey> = {
  sub_agent_glossary: 'agent.glossary',
  sub_agent_google_search: 'agent.googleSearch',
  web_search: 'agent.webSearch',
};

/** error_code ADK puts on the events that seal a run stopped by the client. */
const INVOCATION_ABORTED = 'INVOCATION_ABORTED';

/** Session state key the backend stores answer ratings under. */
const MESSAGE_FEEDBACK_STATE_KEY = 'message_feedback';

/** Token streaming ends a response with an empty text part, which has nothing to show. */
function isEmptyTextPart(part: any): boolean {
  return part?.text === '' && Object.keys(part).every((key) => key === 'text' || key === 'thought');
}

/** The system instruction of an LLM request (a string or a Content). */
function systemInstructionText(request: any): string | null {
  const instruction = request?.config?.system_instruction ?? request?.config?.systemInstruction;
  if (typeof instruction === 'string') {
    return instruction;
  }
  if (instruction?.parts) {
    return instruction.parts.map((part: any) => part.text ?? '').join('\n');
  }
  return null;
}

/** Token counts summed over LLM calls (from the events' usage_metadata). */
interface TokenUsage {
  prompt: number;
  cached: number;
  output: number;
  thoughts: number;
  total: number;
  calls: number;
}

/** How an agent or tool took part in a turn, in the flow diagram. */
type FlowState = 'done' | 'running' | 'aborted';

/** How many recent steps the collapsed activity panel keeps on screen. */
const ACTIVITY_ROLLING_STEPS = 3;

export interface ActivityStep {
  /** Index of the message in `messages`, used to open the event detail. */
  index: number;
  kind: 'thought' | 'call' | 'response';
  label: string;
  detail?: string;
  /** Thought text, shown in full when the panel is expanded. */
  text?: string;
  /** True for steps run inside a sub-agent (its own tool calls). */
  nested: boolean;
  /** The tool call was cut off by the stop button (sealed by ADK). */
  aborted?: boolean;
  /** A handoff to another agent (transfer_to_agent). */
  transfer?: boolean;
  /** Function call id, which is also the run id in the sub-agent's branch name. */
  callId?: string;
  /** For a root call to a sub-agent: the steps that sub-agent ran (its branch). */
  children?: ActivityStep[];
}

export interface ActivityGroup {
  start: number;
  end: number;
  /** All steps in order (rolling window, summary, stop state). */
  steps: ActivityStep[];
  /** Steps for the expanded view: each sub-agent's steps nested under the call that started it. */
  tree: ActivityStep[];
  summary: string;
}

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: MatPaginatorIntl, useClass: CustomPaginatorIntl }],
})
export class ChatComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('videoContainer', { read: ElementRef }) videoContainer!: ElementRef;
  @ViewChild('sideDrawer') sideDrawer!: MatDrawer;
  @ViewChild(EventTabComponent) eventTabComponent!: EventTabComponent;
  @ViewChild(SessionTabComponent) sessionTab!: SessionTabComponent;
  @ViewChild(EvalTabComponent) evalTab!: EvalTabComponent;
  @ViewChild('autoScroll') private scrollContainer!: ElementRef;
  @ViewChild('messageTextarea') private textarea: ElementRef | undefined;
  @ViewChild('bottomPanel') bottomPanelRef!: ElementRef;
  private _snackBar = inject(MatSnackBar);
  shouldShowEvalTab = signal(true);
  enableSseIndicator = signal(false);
  isChatMode = signal(true);
  isEvalCaseEditing = signal(false);
  hasEvalCaseChanged = signal(false);
  isEvalEditMode = signal(false);
  videoElement!: HTMLVideoElement;
  currentMessage = '';
  messages: any[] = [];
  lastTextChunk: string = '';
  streamingTextMessage: any | null = null;
  /** The thought message being streamed (token streaming), until its final event. */
  streamingThoughtMessage: any | null = null;
  artifacts: any[] = [];
  userInput: string = '';
  userEditEvalCaseMessage: string = '';
  protected isLoadingUser = signal(true);
  protected userLoadingError = signal('');
  userId = '';
  currentUser: User | null = null;
  protected userInitial = '';
  protected userAvatarColor = '#5f6368';
  protected userAvatarTextColor = '#ffffff';
  appName = '';
  sessionId = ``;
  evalCase: EvalCase | null = null;
  updatedEvalCase: EvalCase | null = null;
  evalSetId = '';
  isAudioRecording = false;
  isVideoRecording = false;
  longRunningEvents: any[] = [];
  functionCallEventId = '';
  redirectUri = URLUtil.getBaseUrlWithoutPath();
  showSidePanel = true;
  /** Token streaming (settings menu): show answers and thoughts while they are generated. */
  useSse = this.loadTokenStreaming();
  readonly thinkingModeOptions: {value: ThinkingMode, label: MessageKey, tooltip: MessageKey}[] = [
    {value: 'fast', label: 'mode.fast', tooltip: 'mode.fastTooltip'},
    {value: 'standard', label: 'mode.standard', tooltip: 'mode.standardTooltip'},
    {value: 'thinking', label: 'mode.thinking', tooltip: 'mode.thinkingTooltip'},
  ];
  thinkingMode: ThinkingMode = this.loadThinkingMode();
  /** True while an agent response is streaming; swaps the send button for a stop button. */
  isAgentResponding = signal(false);
  readonly feedbackDirections: FeedbackDirection[] = ['up', 'down'];
  /** The answer whose optional feedback comment box is open. */
  feedbackCommentEventId: string | null = null;
  feedbackNotice: {eventId: string, failed: boolean} | null = null;
  private feedbackNoticeTimer?: ReturnType<typeof setTimeout>;
  /** Ratings changed in this page, keyed `${sessionId}:${eventId}`; null = removed. */
  private readonly feedbackOverrides = new Map<string, MessageFeedback | null>();
  private tokenUsageCache: {events: Map<string, any> | null, byInvocation: Map<string, TokenUsage | null>} =
      {events: null, byInvocation: new Map()};
  /** HITL requests by call id, and the answers sent from this page. */
  private readonly hitlRequests = new Map<string, HitlRequest>();
  private readonly hitlAnswers = new Map<string, HitlResolution>();
  /** Graphviz (viz.js) for the flow diagram in the activity panel, loaded on first use. */
  private viz?: Awaited<ReturnType<typeof instance>>;
  private readonly activityFlowCache = new Map<string, {svg: string, html: SafeHtml}>();
  private activeSseSubscription?: Subscription;
  currentSessionState = {};
  /** Every event of the session as stored (also state-only ones), for the developer tabs. */
  sessionEvents: any[] = [];
  private hasInitializedAfterUserLoad = false;
  private readonly messagesSubject = new BehaviorSubject<any[]>([]);
  private readonly streamingTextMessageSubject =
    new BehaviorSubject<any | null>(null);
  private readonly scrollInterruptedSubject = new BehaviorSubject(true);
  private readonly isModelThinkingSubject = new BehaviorSubject(false);
  private readonly hostElementRef = inject(ElementRef<HTMLElement>);

  // TODO: Remove this once backend supports restarting bidi streaming.
  sessionHasUsedBidi = new Set<string>();

  eventData = new Map<string, any>();
  traceData: any[] = [];
  eventMessageIndexArray: any[] = [];
  renderedEventGraph: SafeHtml | undefined;
  rawSvgString: string | null = null;

  selectedEvent: any = undefined;
  selectedEventIndex: any = undefined;
  llmRequest: any = undefined;
  llmResponse: any = undefined;
  llmRequestKey = 'gcp.vertex.agent.llm_request';
  /** The selected event's system instruction and the same agent's previous one (null: first call). */
  systemInstructionDiff: {agent: string, current: string, previous: string | null} | null = null;
  llmResponseKey = 'gcp.vertex.agent.llm_response';

  getMediaTypeFromMimetype = getMediaTypeFromMimetype;

  selectedFiles: { file: File; url: string }[] = [];
  private previousMessageCount = 0;

  protected openBase64InNewTab = openBase64InNewTab;
  protected MediaType = MediaType;

  // Sync query params with value from agent picker.
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  protected readonly selectedAppControl = new FormControl<string>('', {
    nonNullable: true,
  });

  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly userService = inject(UserService);
  protected readonly i18n = inject(I18nService);
  protected readonly themeService = inject(ThemeService);
  protected readonly devMode = inject(DevModeService);
  protected readonly platformService = inject(PlatformService);
  protected readonly platforms = PLATFORMS;
  protected readonly modelOptions = MODEL_OPTIONS;
  protected selectedModel = MODEL_OPTIONS[0];
  protected readonly logo = getLogoConfig();

  // Load apps
  private readonly agentService = inject(AgentService);
  protected isLoadingApps: WritableSignal<boolean> = signal(false);
  protected loadingError: WritableSignal<string> = signal('');
  protected readonly apps$: Observable<string[] | undefined> = of([]).pipe(
    tap(() => {
      this.isLoadingApps.set(true);
      this.selectedAppControl.disable();
    }),
    switchMap(
      () => this.agentService.listApps().pipe(
        catchError((err: HttpErrorResponse) => {
          this.loadingError.set(err.message);
          return of(undefined);
        }),
      ),
    ),
    take(1),
    tap((app) => {
      this.isLoadingApps.set(false);
      this.selectedAppControl.enable();
      if (app?.length == 1) {
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { app: app[0] },
        });
      }
    }),
    shareReplay(),
  );

  private readonly featureFlagService = inject(FeatureFlagService);

  // Import session
  importSessionEnabledObs: Observable<boolean> =
      this.featureFlagService.isImportSessionEnabled();

  // Edit eval tool use
  isEditFunctionArgsEnabledObs =
      this.featureFlagService.isEditFunctionArgsEnabled();

  // Session url
  isSessionUrlEnabledObs = this.featureFlagService.isSessionUrlEnabled();

  // Trace detail
  bottomPanelVisible = false;
  hoveredEventMessageIndices: number[] = [];

  constructor(
      private sanitizer: DomSanitizer,
      private sessionService: SessionService,
      private artifactService: ArtifactService,
      private audioService: AudioService,
      private webSocketService: WebSocketService,
      private videoService: VideoService,
      private dialog: MatDialog,
      private eventService: EventService,
      private route: ActivatedRoute,
      private downloadService: DownloadService,
      private evalService: EvalService,
      private traceService: TraceService,
      private location: Location,
      private renderer: Renderer2,
      @Inject(DOCUMENT) private document: Document,
  ) {}

  ngOnInit(): void {
    this.document.title = this.logo.text;
    this.userService.userLoadError$.subscribe((error) => {
      this.userLoadingError.set(error);
    });

    this.userService.currentUser$
      .pipe(filter((user): user is User => !!user && !!user.id))
      .subscribe((user) => {
        this.currentUser = user;
        this.userId = user.id;
        this.computeUserAvatar(user);
        if (!this.hasInitializedAfterUserLoad) {
          this.hasInitializedAfterUserLoad = true;
          this.initializeAfterUserResolved();
        }
      });

    this.isLoadingUser.set(true);
    this.userService
      .loadCurrentUser()
      .pipe(
        take(1),
        finalize(() => this.isLoadingUser.set(false)),
      )
      .subscribe();
  }

  private initializeAfterUserResolved(): void {
    this.syncSelectedAppFromUrl();
    this.updateSelectedAppUrl();

    this.webSocketService.onCloseReason().subscribe((closeReason) => {
      const error =
        'Please check server log for full details: \n' + closeReason;
      this.openSnackBar(error, 'OK');
    });

    // OAuth HACK: Opens oauth popup in a new window. If the oauth callback
    // is successful, the new window acquires the auth token, state and
    // optionally the scope. Send this back to the main window.
    const location = new URL(window.location.href);
    const searchParams = location.searchParams;
    if (searchParams.has('code')) {
      const authResponseUrl = window.location.href;
      // Send token to the main window
      window.opener?.postMessage({ authResponseUrl }, window.origin);
      // Close the popup
      window.close();
    }

    this.agentService.getApp().subscribe((app) => {
      this.appName = app;
    });

    combineLatest([
      this.agentService.getLoadingState(), this.isModelThinkingSubject
    ]).subscribe(([isLoading, isModelThinking]) => {
      this.isAgentResponding.set(isLoading);
      const lastMessage = this.messages[this.messages.length - 1];

      if (isLoading) {
        if (!lastMessage?.isLoading && !this.streamingTextMessage) {
          this.messages.push({ role: 'bot', isLoading: true });
          this.messagesSubject.next(this.messages);
        }
      } else if (lastMessage?.isLoading && !isModelThinking) {
        this.messages.pop();
        this.messagesSubject.next(this.messages);
        this.changeDetectorRef.detectChanges();
      }
    });

    combineLatest([
      this.messagesSubject, this.scrollInterruptedSubject,
      this.streamingTextMessageSubject
    ]).subscribe(([messages, scrollInterrupted, streamingTextMessage]) => {
      if (!scrollInterrupted) {
        setTimeout(() => {
          this.scrollToBottom();
        }, 100);
      }
      setTimeout(() => {
        this.ensureMarkdownLinksTargetBlank();
      }, 0);
    });

    this.traceService.selectedTraceRow$.subscribe(node => {
      const eventId = node?.attributes?.['gcp.vertex.agent.event_id'];
      if (eventId && this.eventData.has(eventId)) {
        this.bottomPanelVisible = true;
        // Trace tab: open the clicked span's event.
        this.openEventDetails(eventId);
      } else {
        this.bottomPanelVisible = false;
      }
    })

    this.traceService.hoveredMessageIndicies$.subscribe(i => this.hoveredEventMessageIndices = i);
  }

  ngAfterViewInit() {
    this.showSidePanel = true;
    this.sideDrawer.open();
  }

  scrollToBottom() {
    setTimeout(() => {
      this.scrollContainer.nativeElement.scrollTo({
        top: this.scrollContainer.nativeElement.scrollHeight,
        behavior: 'smooth',
      });
    });
  }

  private computeUserAvatar(user: User): void {
    const source = this.getUserAvatarSource(user);
    const initial = source ? source[0].toUpperCase() : '?';
    const background = stc(source || 'user');
    this.userInitial = initial;
    this.userAvatarColor = background;
    this.userAvatarTextColor = this.getContrastingTextColor(background);
  }

  private getUserAvatarSource(user: User): string {
    const trimmedDisplay = user.displayName?.trim();
    const trimmedEmail = user.email?.trim();
    const trimmedId = user.id?.trim();
    return trimmedDisplay || trimmedEmail || trimmedId || 'user';
  }

  private getContrastingTextColor(colorHex: string): string {
    const hex = colorHex.startsWith('#') ? colorHex.slice(1) : colorHex;
    if (hex.length !== 6 || Number.isNaN(Number.parseInt(hex, 16))) {
      return '#ffffff';
    }

    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);

    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? '#202124' : '#ffffff';
  }

  private ensureMarkdownLinksTargetBlank(): void {
    const hostElement = this.hostElementRef.nativeElement;
    if (!hostElement) {
      return;
    }

    const anchorElements = hostElement.querySelectorAll('.message-card a[href]');
  anchorElements.forEach((anchorElement: Element) => {
      const anchor = anchorElement as HTMLAnchorElement;
      if (anchor.target !== '_blank') {
        this.renderer.setAttribute(anchor, 'target', '_blank');
      }

      const existingRel = anchor.getAttribute('rel') ?? '';
      const relTokens = new Set(existingRel.split(' ').filter(Boolean));
      relTokens.add('noopener');
      relTokens.add('noreferrer');
      this.renderer.setAttribute(anchor, 'rel', Array.from(relTokens).join(' '));
    });
  }

  selectApp(appName: string) {
    if (appName != this.appName) {
      this.agentService.setApp(appName);

      this.isSessionUrlEnabledObs.subscribe((sessionUrlEnabled) => {
        const sessionUrl = this.activatedRoute.snapshot.queryParams['session'];

        if (!sessionUrlEnabled || !sessionUrl) {
          this.createSessionAndReset();

          return;
        }

        if (sessionUrl) {
          this.sessionService.getSession(this.userId, this.appName, sessionUrl)
              .pipe(take(1), catchError((error) => {
                      this.openSnackBar(
                          'Cannot find specified session. Creating a new one.',
                          'OK');
                      this.createSessionAndReset();
                      return of(null);
                    }))
              .subscribe((session) => {
                if (session) {
                  this.updateWithSelectedSession(session);
                }
              });
        }
      });
    }
  }

  private createSessionAndReset() {
    this.createSession();
    this.eventData = new Map<string, any>();
    this.eventMessageIndexArray = [];
    this.messages = [];
    this.artifacts = [];
    this.userInput = '';
    this.longRunningEvents = [];
  }

  createSession() {
    this.sessionService.createSession(this.userId, this.appName)
      .subscribe((res) => {
        this.currentSessionState = res.state;
        this.sessionEvents = [];
        this.sessionId = res.id;
        this.sessionTab.refreshSession();

        this.isSessionUrlEnabledObs.subscribe((enabled) => {
          if (enabled) {
            this.updateSelectedSessionUrl();
          }
        });
      });
  }

  async sendMessage(event: Event) {
    if (this.messages.length === 0) {
      this.scrollContainer.nativeElement.addEventListener('wheel', () => {
        this.scrollInterruptedSubject.next(true);
      });
      this.scrollContainer.nativeElement.addEventListener('touchmove', () => {
        this.scrollInterruptedSubject.next(true);
      });
    }
    this.scrollInterruptedSubject.next(false);

    event.preventDefault();
    if (this.isAgentResponding()) return;
    if (!this.userInput.trim() && this.selectedFiles.length <= 0) return;

    if (event instanceof KeyboardEvent) {
      // support for japanese IME
      if (event.isComposing || event.keyCode === 229) {
        return;
      }
    }

    // Add user message
    if (!!this.userInput.trim()) {
      this.messages.push({role: 'user', text: this.userInput});
      this.messagesSubject.next(this.messages);
    }

    // Add user message attachments
    if (this.selectedFiles.length > 0) {
      const messageAttachments = this.selectedFiles.map((file) => ({
        file: file.file,
        url: file.url,
      }));
      this.messages.push({ role: 'user', attachments: messageAttachments });
      this.messagesSubject.next(this.messages);
    }

    const req: AgentRunRequest = {
      appName: this.appName,
      userId: this.userId,
      sessionId: this.sessionId,
      newMessage: {
        'role': 'user',
        'parts': await this.getUserMessageParts(),
      },
      streaming: this.useSse,
      thinkingMode: this.thinkingMode,
      enabledPlatforms: this.platformService.enabledIds(),
    };
    this.selectedFiles = [];
    this.runSseWithAuthRetry(req);
    // Clear input
    this.userInput = '';
    this.changeDetectorRef.detectChanges();
  }

  private runSseWithAuthRetry(
    req: AgentRunRequest,
    options?: { authRetryCount?: number },
  ) {
    let index = this.eventMessageIndexArray.length - 1;
    this.streamingTextMessage = null;
    this.streamingThoughtMessage = null;
    let sessionBriefRefreshQueued = false;
    const authRetryCount = options?.authRetryCount ?? 0;
    const subscription: Subscription = this.agentService.runSse(req).subscribe({
      next: async (chunk) => {
        const chunkJson = JSON.parse(chunk);
        if (chunkJson.error) {
          if (chunkJson.requiresAuth === 'asana' && chunkJson.authUrl) {
            if (authRetryCount >= 1) {
              this.openSnackBar('Asana authorization did not complete. Please try again.', 'OK');
              return;
            }

            const authCompleted = await this.startAsanaOAuthPopupAndWait(chunkJson.authUrl);
            if (!authCompleted) {
              this.openSnackBar('Asana authorization was not completed.', 'OK');
              return;
            }
            this.openSnackBar('Asana connected. Continuing your request...', 'OK');
            this.runSseWithAuthRetry(req, { authRetryCount: authRetryCount + 1 });
            return;
          }
          if (chunkJson.requiresAuth === 'github' && chunkJson.authUrl) {
            if (authRetryCount >= 1) {
              this.openSnackBar('GitHub authorization did not complete. Please try again.', 'OK');
              return;
            }

            const authCompleted = await this.startGitHubOAuthPopupAndWait(chunkJson.authUrl);
            if (!authCompleted) {
              this.openSnackBar('GitHub authorization was not completed.', 'OK');
              return;
            }
            this.openSnackBar('GitHub connected. Continuing your request...', 'OK');
            this.runSseWithAuthRetry(req, { authRetryCount: authRetryCount + 1 });
            return;
          }
          this.openSnackBar(chunkJson.error, 'OK');
          return;
        }
        if (chunkJson.sessionBriefRefreshRequired) {
          sessionBriefRefreshQueued = true;
          return;
        }
        if (chunkJson.content) {
          for (let part of chunkJson.content.parts) {
            index += 1;
            this.processPart(chunkJson, part, index);
            this.traceService.setEventData(this.eventData);
          }
        }
        this.changeDetectorRef.detectChanges();
      },
      error: (err) => {
        this.clearActiveSseSubscription(subscription);
        console.error('SSE error:', err);
      },
      complete: () => {
        // An auth retry may already have started the next request; keep that one.
        this.clearActiveSseSubscription(subscription);
        this.streamingTextMessage = null;
        this.streamingThoughtMessage = null;
        if (sessionBriefRefreshQueued) {
          this.requestSessionBriefRefresh();
        }
        this.syncAfterAgentRun();
      },
    });
    this.activeSseSubscription = subscription;
  }

  /** The user's rating of an answer: changed here, or saved in the session state. */
  feedbackFor(eventId: string): MessageFeedback | undefined {
    const key = `${this.sessionId}:${eventId}`;
    if (this.feedbackOverrides.has(key)) {
      return this.feedbackOverrides.get(key) ?? undefined;
    }
    return (this.currentSessionState as any)?.[MESSAGE_FEEDBACK_STATE_KEY]?.[eventId];
  }

  /** Rating buttons go under the last text of each finished answer. */
  showsFeedback(i: number): boolean {
    const message = this.messages[i];
    if (this.isEvalEditMode() || message?.role !== 'bot' || !message.text ||
        !message.eventId || message.thought || message.stopped || message.isLoading ||
        message.functionCall || message.functionResponse) {
      return false;
    }
    const next = this.messages[i + 1];
    if (next) {
      return next.role !== 'bot';
    }
    return !this.isAgentResponding();
  }

  toggleFeedback(eventId: string, direction: FeedbackDirection) {
    if (this.feedbackFor(eventId)?.direction === direction) {
      this.feedbackCommentEventId = null;
      this.saveFeedback(eventId, null);
      return;
    }
    this.saveFeedback(eventId, {direction});
    this.feedbackCommentEventId = eventId;
    setTimeout(() => {
      this.hostElementRef.nativeElement.querySelector('.feedback-comment')?.focus();
    });
  }

  sendFeedbackComment(eventId: string, comment: string) {
    const direction = this.feedbackFor(eventId)?.direction;
    this.feedbackCommentEventId = null;
    if (!direction) {
      return;
    }
    this.saveFeedback(eventId, {direction, comment: comment.trim() || undefined}, true);
  }

  private saveFeedback(
      eventId: string, feedback: MessageFeedback | null, showThanks = false) {
    const key = `${this.sessionId}:${eventId}`;
    this.feedbackOverrides.set(key, feedback);
    const request: Observable<unknown> = feedback ?
        this.sessionService.putMessageFeedback(
            this.userId, this.appName, this.sessionId, eventId, feedback) :
        this.sessionService.deleteMessageFeedback(
            this.userId, this.appName, this.sessionId, eventId);
    request.subscribe({
      next: () => {
        if (showThanks) {
          this.showFeedbackNotice(eventId, false);
        }
      },
      error: () => {
        // Fall back to what the server has.
        this.feedbackOverrides.delete(key);
        this.feedbackCommentEventId = null;
        this.showFeedbackNotice(eventId, true);
      },
    });
  }

  private showFeedbackNotice(eventId: string, failed: boolean) {
    clearTimeout(this.feedbackNoticeTimer);
    this.feedbackNotice = {eventId, failed};
    this.feedbackNoticeTimer = setTimeout(() => {
      this.feedbackNotice = null;
      this.changeDetectorRef.markForCheck();
    }, 3000);
    this.changeDetectorRef.markForCheck();
  }

  /**
   * Compares the system instruction of the selected event's LLM call with the
   * same agent's previous call (from their traces).
   */
  private compareSystemInstruction(event: any, request: any) {
    const current = systemInstructionText(request);
    if (current === null) {
      return;
    }
    const events = [...this.eventData.values()];
    const index = events.findIndex((candidate) => candidate.id === event.id);
    const previous = events.slice(0, Math.max(0, index)).reverse().find(
        (candidate) => candidate.author === event.author && candidate.usageMetadata);
    if (!previous) {
      this.systemInstructionDiff = {agent: event.author, current, previous: null};
      return;
    }
    this.eventService.getEventTrace(previous.id).subscribe({
      next: (res) => {
        if (this.selectedEvent?.id !== event.id) {
          return;
        }
        let previousText: string | null = null;
        try {
          previousText = systemInstructionText(JSON.parse(res[this.llmRequestKey]));
        } catch {}
        this.systemInstructionDiff = previousText === null ? null :
            {agent: event.author, current, previous: previousText};
        this.changeDetectorRef.markForCheck();
      },
      // The previous call's trace is gone (e.g. the server restarted).
      error: () => {},
    });
  }

  openInstructionDiff() {
    const diff = this.systemInstructionDiff;
    if (diff?.previous == null) {
      return;
    }
    this.dialog.open(InstructionDiffDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      panelClass: 'light-dialog',
      data: {agent: diff.agent, previous: diff.previous, current: diff.current},
    });
  }

  invocationOf(eventId: string | undefined): string | undefined {
    return eventId ? this.eventData.get(eventId)?.invocationId : undefined;
  }

  /**
   * Token usage of the LLM calls in one turn (an invocation, including its
   * sub-agents' calls) or, without an id, in the whole session.
   */
  tokenUsage(invocationId?: string): TokenUsage | null {
    if (this.tokenUsageCache.events !== this.eventData) {
      this.tokenUsageCache = {events: this.eventData, byInvocation: new Map()};
    }
    const key = invocationId ?? '';
    const cached = this.tokenUsageCache.byInvocation.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const usage: TokenUsage = {prompt: 0, cached: 0, output: 0, thoughts: 0, total: 0, calls: 0};
    for (const event of this.eventData.values()) {
      const metadata = event.usageMetadata;
      if (!metadata || (invocationId && event.invocationId !== invocationId)) {
        continue;
      }
      usage.prompt += metadata.promptTokenCount ?? 0;
      usage.cached += metadata.cachedContentTokenCount ?? 0;
      usage.output += metadata.candidatesTokenCount ?? 0;
      usage.thoughts += metadata.thoughtsTokenCount ?? 0;
      usage.total += metadata.totalTokenCount ?? 0;
      usage.calls += 1;
    }
    const result = usage.calls ? usage : null;
    this.tokenUsageCache.byInvocation.set(key, result);
    return result;
  }

  usageTooltip(usage: TokenUsage): string {
    return this.i18n.t('usage.tooltip', {
      prompt: this.formatTokens(usage.prompt),
      cached: this.formatTokens(usage.cached),
      output: this.formatTokens(usage.output),
      thoughts: this.formatTokens(usage.thoughts),
      total: this.formatTokens(usage.total),
      calls: usage.calls,
    });
  }

  formatTokens(count: number): string {
    return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
  }

  /** Stop button: abort the running response; the backend stops the agent run. */
  stopAgentResponse() {
    if (!this.abortActiveSse()) {
      return;
    }
    this.isModelThinkingSubject.next(false);
    this.streamingTextMessage = null;
    this.streamingThoughtMessage = null;
    this.insertMessageBeforeLoadingMessage(this.stoppedNoticeMessage());
    this.changeDetectorRef.detectChanges();
    this.syncAfterAgentRun();
  }

  private stoppedNoticeMessage() {
    return {role: 'bot', text: '回答を停止しました。', stopped: true};
  }

  private abortActiveSse(): boolean {
    if (!this.activeSseSubscription) {
      return false;
    }
    this.activeSseSubscription.unsubscribe();
    this.activeSseSubscription = undefined;
    return true;
  }

  private clearActiveSseSubscription(subscription: Subscription) {
    if (this.activeSseSubscription === subscription) {
      this.activeSseSubscription = undefined;
    }
  }

  /** Reload trace, messages for the trace view, and state after a run ends or is stopped. */
  private syncAfterAgentRun() {
    this.eventService.getTrace(this.sessionId)
        .pipe(catchError((error) => {
          if (error.status === 404) {
            return of(null);
          }
          return of([]);
        }))
        .subscribe(res => {
          this.traceData = res;
          this.changeDetectorRef.detectChanges();
        });
    this.traceService.setMessages(this.messages);
    this.refreshSessionStateFromServer();
  }

  private async startAsanaOAuthPopupAndWait(authUrlRaw: string): Promise<boolean> {
    let popupUrl: URL;
    try {
      const apiBase = URLUtil.getApiServerBaseUrl() || window.location.origin;
      popupUrl = new URL(authUrlRaw, apiBase);
      const popupCompleteUrl = new URL('/oauth/asana/popup-complete', apiBase);
      popupUrl.searchParams.set('return_to', popupCompleteUrl.toString());
    } catch (error) {
      console.error('Failed to build Asana OAuth popup URL', error);
      return false;
    }

    const popupWindow = window.open(
      popupUrl.toString(),
      'asana-oauth-popup',
      'popup,width=640,height=800',
    );

    if (!popupWindow) {
      this.openSnackBar('Popup was blocked. Please allow popups and try again.', 'OK');
      return false;
    }

    this.openSnackBar('Please complete Asana authorization in the opened tab.', 'OK');

    return await this.waitForAsanaAuthInSession(popupWindow, 120000, 1500);
  }

  private waitForAsanaAuthInSession(
    popupWindow: Window,
    timeoutMs: number,
    intervalMs: number,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      let settled = false;
      let expectedApiOrigin: string | null = null;

      try {
        const apiBase = URLUtil.getApiServerBaseUrl() || window.location.origin;
        expectedApiOrigin = new URL(apiBase).origin;
      } catch {
        expectedApiOrigin = null;
      }

      const complete = (result: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        done = true;
        window.removeEventListener('message', onMessage);
        resolve(result);
      };

      const onMessage = (event: MessageEvent) => {
        const allowedOrigins = new Set<string>([window.location.origin]);
        if (expectedApiOrigin) {
          allowedOrigins.add(expectedApiOrigin);
        }

        if (!allowedOrigins.has(event.origin)) {
          return;
        }
        if (event.data?.type === 'asana_oauth_connected') {
          complete(true);
        }
      };

      window.addEventListener('message', onMessage);

      const timeoutId = window.setTimeout(() => {
        complete(false);
      }, timeoutMs);

      const poll = () => {
        if (done) {
          window.clearTimeout(timeoutId);
          return;
        }

        this.sessionService.getSession(this.userId, this.appName, this.sessionId)
          .pipe(take(1))
          .subscribe({
            next: (session: Session) => {
              const token = session?.state?.asana_oauth?.access_token;
              if (typeof token === 'string' && token.length > 0) {
                complete(true);
                window.clearTimeout(timeoutId);
                return;
              }

              if (popupWindow.closed) {
                complete(false);
                window.clearTimeout(timeoutId);
                return;
              }

              window.setTimeout(poll, intervalMs);
            },
            error: () => {
              if (popupWindow.closed) {
                complete(false);
                window.clearTimeout(timeoutId);
                return;
              }
              window.setTimeout(poll, intervalMs);
            },
          });
      };

      poll();
    });
  }

  private async startGitHubOAuthPopupAndWait(authUrlRaw: string): Promise<boolean> {
    let popupUrl: URL;
    try {
      const apiBase = URLUtil.getApiServerBaseUrl() || window.location.origin;
      popupUrl = new URL(authUrlRaw, apiBase);
      const popupCompleteUrl = new URL('/oauth/github/popup-complete', apiBase);

      popupUrl.searchParams.set('return_to', popupCompleteUrl.toString());
      popupUrl.searchParams.set('prompt_select_account', 'true');
      popupUrl.searchParams.set('reauthorize', 'true');
    } catch (error) {
      console.error('Failed to build GitHub OAuth popup URL', error);
      return false;
    }

    const popupWindow = window.open(
      popupUrl.toString(),
      'github-oauth-popup',
      'popup,width=640,height=800',
    );

    if (!popupWindow) {
      this.openSnackBar('Popup was blocked. Please allow popups and try again.', 'OK');
      return false;
    }

    this.openSnackBar('Please complete GitHub authorization in the opened tab.', 'OK');

    return await this.waitForGitHubAuthInSession(popupWindow, 120000, 1500);
  }

  private waitForGitHubAuthInSession(
    popupWindow: Window,
    timeoutMs: number,
    intervalMs: number,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      let settled = false;
      let expectedApiOrigin: string | null = null;

      try {
        const apiBase = URLUtil.getApiServerBaseUrl() || window.location.origin;
        expectedApiOrigin = new URL(apiBase).origin;
      } catch {
        expectedApiOrigin = null;
      }

      const complete = (result: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        done = true;
        window.removeEventListener('message', onMessage);
        resolve(result);
      };

      const onMessage = (event: MessageEvent) => {
        const allowedOrigins = new Set<string>([window.location.origin]);
        if (expectedApiOrigin) {
          allowedOrigins.add(expectedApiOrigin);
        }

        if (!allowedOrigins.has(event.origin)) {
          return;
        }
        if (event.data?.type === 'github_oauth_connected') {
          complete(true);
        }
      };

      window.addEventListener('message', onMessage);

      const timeoutId = window.setTimeout(() => {
        complete(false);
      }, timeoutMs);

      const poll = () => {
        if (done) {
          window.clearTimeout(timeoutId);
          return;
        }

        this.sessionService.getSession(this.userId, this.appName, this.sessionId)
          .pipe(take(1))
          .subscribe({
            next: (session: Session) => {
              const token = session?.state?.github_oauth?.access_token;
              if (typeof token === 'string' && token.length > 0) {
                complete(true);
                window.clearTimeout(timeoutId);
                return;
              }

              if (popupWindow.closed) {
                complete(false);
                window.clearTimeout(timeoutId);
                return;
              }

              window.setTimeout(poll, intervalMs);
            },
            error: () => {
              if (popupWindow.closed) {
                complete(false);
                window.clearTimeout(timeoutId);
                return;
              }
              window.setTimeout(poll, intervalMs);
            },
          });
      };

      poll();
    });
  }

  private requestSessionBriefRefresh() {
    if (!this.sessionId) {
      return;
    }
    this.sessionService
      .getSessionBrief(this.userId, this.appName, this.sessionId)
      .subscribe({
        next: (response) => {
          if (response?.brief) {
            this.sessionTab.updateSessionBriefInList(this.sessionId, response.brief);
          }
        },
        error: (error) => {
          console.error('Failed to refresh session brief', error);
        },
      });
  }

  private processPart(chunkJson: any, part: any, index: number) {
    if (isEmptyTextPart(part)) {
      return;
    }
    if (part.text && this.isDelegatedSubAgentEvent(chunkJson)) {
      if (chunkJson.partial) {
        // A sub-agent's text is stored once, from its final event.
        return;
      }
      this.storeEvents(part, chunkJson, index);
      this.eventMessageIndexArray[index] = part.text;
      return;
    }

    const renderedContent =
      chunkJson.groundingMetadata?.searchEntryPoint?.renderedContent;

    if (part.text) {
      this.isModelThinkingSubject.next(false);
      this.processTextPart(chunkJson, part, index, renderedContent);
    } else if (!part.thought) {
      this.isModelThinkingSubject.next(false);
      this.storeEvents(part, chunkJson, index);
      this.storeMessage(
        part, chunkJson, index, chunkJson.author === 'user' ? 'user' : 'bot');
    } else {
      this.isModelThinkingSubject.next(true);
    }
  }

  /**
   * Shows a text or thought part. With token streaming, the partial events of
   * one model response share its event id: their chunks are appended to one
   * thought message and one answer message, and the final event (which repeats
   * the whole text) only replaces their text instead of adding messages.
   */
  private processTextPart(chunkJson: any, part: any, index: number, renderedContent?: string) {
    const thought = !!part.thought;
    // Strips planner markers (/*PLANNING*/ ...), as before for both kinds.
    const text = this.processThoughtText(part.text);
    const streamed = thought ? this.streamingThoughtMessage : this.streamingTextMessage;
    const sameResponse = streamed?.eventId === chunkJson.id;

    if (chunkJson.partial) {
      if (sameResponse) {
        streamed.text += text;
      } else {
        const message: any = {role: 'bot', text, thought, eventId: chunkJson.id};
        if (thought) {
          this.streamingThoughtMessage = message;
        } else {
          this.streamingTextMessage = message;
        }
        this.insertMessageBeforeLoadingMessage(message);
      }
      if (renderedContent && !thought) {
        this.streamingTextMessage.renderedContent = renderedContent;
      }
      this.streamingTextMessageSubject.next(this.streamingTextMessage);
      return;
    }

    this.storeEvents(part, chunkJson, index);
    this.eventMessageIndexArray[index] = part.text;
    if (sameResponse) {
      // The final event: keep the streamed message, with the complete text.
      streamed.text = text;
      if (renderedContent && !thought) {
        streamed.renderedContent = renderedContent;
      }
      if (thought) {
        this.streamingThoughtMessage = null;
      } else {
        this.streamingTextMessage = null;
      }
      this.messagesSubject.next(this.messages);
      return;
    }

    const message: any = {role: 'bot', text, thought, eventId: chunkJson.id};
    if (renderedContent && !thought) {
      message.renderedContent = renderedContent;
    }
    // A thought that only arrives with the final event goes before the answer
    // already streamed for the same response.
    const answerIndex = thought && this.streamingTextMessage?.eventId === chunkJson.id ?
        this.messages.indexOf(this.streamingTextMessage) : -1;
    if (answerIndex >= 0) {
      this.messages.splice(answerIndex, 0, message);
      this.messagesSubject.next(this.messages);
    } else {
      this.insertMessageBeforeLoadingMessage(message);
    }
  }

  async getUserMessageParts() {
    let parts: any = [];

    if (!!this.userInput.trim()) {
      parts.push({'text': `${this.userInput}`});
    }

    if (this.selectedFiles.length > 0) {
      for (const file of this.selectedFiles) {
        parts.push({
          inlineData: {
            displayName: file.file.name,
            data: await this.readFileAsBytes(file.file),
            mimeType: file.file.type,
          },
        });
      }
    }
    return parts;
  }

  readFileAsBytes(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        const base64Data = e.target.result.split(',')[1];
        resolve(base64Data);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);  // Read as raw bytes
    });
  }

  private updateRedirectUri(urlString: string, newRedirectUri: string): string {
    try {
      const url = new URL(urlString);
      const searchParams = url.searchParams;
      searchParams.set('redirect_uri', newRedirectUri);
      return url.toString();
    } catch (error) {
      console.warn('Failed to update redirect URI: ', error);
      return urlString;
    }
  }

  private storeMessage(
      part: any, e: any, index: number, role: string, invocationIndex?: number,
      additionalIndeces?: any) {
    if (!!e.author) {
      this.createAgentIconColorClass(e.author);
    }

    if (e?.longRunningToolIds && e.longRunningToolIds.length > 0) {
      this.getAsyncFunctionsFromParts(e.longRunningToolIds, e.content.parts);
      const func = this.longRunningEvents[0];
      if (func.args.authConfig &&
        func.args.authConfig.exchangedAuthCredential &&
        func.args.authConfig.exchangedAuthCredential.oauth2) {
        // for OAuth
        const authUri =
          func.args.authConfig.exchangedAuthCredential.oauth2.authUri;
        const updatedAuthUri = this.updateRedirectUri(
          authUri,
          this.redirectUri,
        );
        this.openOAuthPopup(updatedAuthUri)
          .then((authResponseUrl) => {
            this.functionCallEventId = e.id;
            this.sendOAuthResponse(func, authResponseUrl, this.redirectUri);
          })
          .catch((error) => {
            console.error('OAuth Error:', error);
          });
      } else {
        this.functionCallEventId = e.id;
      }
    }
    if (e?.actions && e.actions.artifactDelta) {
      for (const key in e.actions.artifactDelta) {
        if (e.actions.artifactDelta.hasOwnProperty(key)) {
          this.renderArtifact(key, e.actions.artifactDelta[key]);
        }
      }
    }

    if (e?.evalStatus) {
      this.isChatMode.set(false);
    }

    let message: any = {
      role,
      evalStatus: e?.evalStatus,
      failedMetric: e?.failedMetric,
      evalScore: e?.evalScore,
      evalThreshold: e?.evalThreshold,
      actualInvocationToolUses: e?.actualInvocationToolUses,
      expectedInvocationToolUses: e?.expectedInvocationToolUses,
      actualFinalResponse: e?.actualFinalResponse,
      expectedFinalResponse: e?.expectedFinalResponse,
      invocationIndex: invocationIndex !== undefined ? invocationIndex :
                                                       undefined,
      finalResponsePartIndex:
          additionalIndeces?.finalResponsePartIndex !== undefined ?
          additionalIndeces.finalResponsePartIndex :
          undefined,
      toolUseIndex: additionalIndeces?.toolUseIndex !== undefined ?
          additionalIndeces.toolUseIndex :
          undefined,
    };
    if (part.inlineData) {
      const base64Data =
        this.formatBase64Data(part.inlineData.data, part.inlineData.mimeType);
      message.inlineData = {
        displayName: part.inlineData.displayName,
        data: base64Data,
        mimeType: part.inlineData.mimeType,
      };
      this.eventMessageIndexArray[index] = part.inlineData;
    } else if (part.text) {
      message.text = part.text;
      message.thought = part.thought ? true : false;
      if (e?.groundingMetadata && e.groundingMetadata.searchEntryPoint &&
        e.groundingMetadata.searchEntryPoint.renderedContent) {
        message.renderedContent =
          e.groundingMetadata.searchEntryPoint.renderedContent;
      }
      message.eventId = e?.id;
      this.eventMessageIndexArray[index] = part.text;
    } else if (part.functionCall) {
      message.functionCall = part.functionCall;
      message.eventId = e?.id;
      this.eventMessageIndexArray[index] = part.functionCall;
    } else if (part.functionResponse) {
      message.functionResponse = part.functionResponse;
      message.eventId = e?.id;
      this.eventMessageIndexArray[index] = part.functionResponse;
    } else if (part.executableCode) {
      message.executableCode = part.executableCode;
      this.eventMessageIndexArray[index] = part.executableCode;
    } else if (part.codeExecutionResult) {
      message.codeExecutionResult = part.codeExecutionResult;
      this.eventMessageIndexArray[index] = part.codeExecutionResult;
      if (e.actions && e.actions.artifact_delta) {
        for (const key in e.actions.artifact_delta) {
          if (e.actions.artifact_delta.hasOwnProperty(key)) {
            this.renderArtifact(key, e.actions.artifact_delta[key]);
          }
        }
      }
    }

    if (Object.keys(part).length > 0) {
      this.insertMessageBeforeLoadingMessage(message);
    }
  }

  private insertMessageBeforeLoadingMessage(message: any) {
    const lastMessage = this.messages[this.messages.length - 1];
    if (lastMessage?.isLoading) {
      this.messages.splice(this.messages.length - 1, 0, message);
    } else {
      this.messages.push(message);
    }
    this.messagesSubject.next(this.messages);
  }

  private formatBase64Data(data: string, mimeType: string) {
    const fixedBase64Data = fixBase64String(data);
    return `data:${mimeType};base64,${fixedBase64Data}`;
  }

  private renderArtifact(artifactId: string, versionId: string) {
    // Add a placeholder message for the artifact
    // Feed the placeholder with the artifact data after it's fetched
    let message = {
      role: 'bot',
      inlineData: {
        data: '',
        mimeType: 'image/png',
      },
    };
    this.insertMessageBeforeLoadingMessage(message);

    const currentIndex = this.messages.length - 2;

    this.artifactService
      .getArtifactVersion(
        this.userId,
        this.appName,
        this.sessionId,
        artifactId,
        versionId,
      )
      .subscribe((res) => {
        const mimeType = res.inlineData.mimeType;
        const base64Data =
          this.formatBase64Data(res.inlineData.data, mimeType);

        const mediaType = getMediaTypeFromMimetype(mimeType);

        let inlineData = {
          name: this.createDefaultArtifactName(mimeType),
          data: base64Data,
          mimeType: mimeType,
          mediaType,
        };

        this.messages[currentIndex] = {
          role: 'bot',
          inlineData,
        };

        // To trigger ngOnChanges in the artifact tab component
        this.artifacts = [
          ...this.artifacts,
          {
            id: artifactId,
            data: base64Data,
            mimeType,
            versionId,
            mediaType: getMediaTypeFromMimetype(mimeType),
          },
        ];
      });
  }

  /**
   * Whether the event comes from a single_turn/task sub-agent that the root
   * agent invoked as a tool. ADK runs those in a sub-branch named
   * `<agent>@<run_id>`; their text is the tool result, which the root agent
   * relays in its own reply, so it is kept out of the chat (events panel only).
   */
  private isDelegatedSubAgentEvent(e: any): boolean {
    return typeof e?.branch === 'string' &&
        e.branch.split('.').some((segment: string) => segment.includes('@'));
  }

  private storeEvents(part: any, e: any, index: number) {
    let title = '';
    if (part.text) {
      title += 'text:' + part.text;
    } else if (part.functionCall) {
      title += 'functionCall:' + part.functionCall.name;
    } else if (part.functionResponse) {
      title += 'functionResponse:' + part.functionResponse.name;
    } else if (part.executableCode) {
      title += 'executableCode:' + part.executableCode.code.slice(0, 10);
    } else if (part.codeExecutionResult) {
      title += 'codeExecutionResult:' + part.codeExecutionResult.outcome;
    }
    e.title = title;

    this.eventData.set(e.id, e);
    this.eventData = new Map(this.eventData);
  }

  private sendOAuthResponse(
    func: any,
    authResponseUrl: string,
    redirectUri: string,
  ) {
    this.longRunningEvents.pop();
    const authResponse: AgentRunRequest = {
      appName: this.appName,
      userId: this.userId,
      sessionId: this.sessionId,
      newMessage: {
        'role': 'user',
        'parts': [],
      },
    };

    var authConfig = structuredClone(func.args.authConfig);
    authConfig.exchangedAuthCredential.oauth2.authResponseUri = authResponseUrl;
    authConfig.exchangedAuthCredential.oauth2.redirectUri = redirectUri;

    authResponse.functionCallEventId = this.functionCallEventId;
    authResponse.newMessage.parts.push({
      'function_response': {
        id: func.id,
        name: func.name,
        response: authConfig,
      },
    });

    let response: any[] = [];
    this.agentService.runSse(authResponse, { suppressLoading: true }).subscribe({
      next: async (chunk) => {
        const chunkJson = JSON.parse(chunk);
        response.push(chunkJson);
      },
      error: (err) => console.error('SSE error:', err),
      complete: () => {
        this.processRunSseResponse(response);
      },
    });
  }

  private processRunSseResponse(response: any) {
    let index = this.eventMessageIndexArray.length - 1;
    let sessionBriefRefreshQueued = false;
    for (const e of response) {
      if (e.sessionBriefRefreshRequired) {
        sessionBriefRefreshQueued = true;
        continue;
      }
      if (e.content) {
        for (let part of e.content.parts) {
          index += 1;
          this.processPart(e, part, index);
        }
      }
    }
    if (sessionBriefRefreshQueued) {
      this.requestSessionBriefRefresh();
    }
    this.refreshSessionStateFromServer();
  }

  getAgentNameFromEvent(i: number) {
    const key = this.messages[i].eventId;
    const selectedEvent = this.eventData.get(key);

    return selectedEvent?.author ?? this.selectedAppControl.value;
  }

  customIconColorClass(i: number) {
    const agentName = this.getAgentNameFromEvent(i);
    return `custom-icon-color-${stc(agentName).replace('#', '')}`;
  }

  createAgentIconColorClass(agentName: string) {
    const agentIconColor = stc(agentName);

    const agentIconColorClass =
        `custom-icon-color-${agentIconColor.replace('#', '')}`;

    // Inject the style for this unique class
    this.injectCustomIconColorStyle(agentIconColorClass, agentIconColor);
  }

  clickEvent(i: number) {
    this.openEventDetails(this.messages[i]?.eventId);
  }

  /**
   * Opens the event detail panel. Also for events not shown as a message
   * (e.g. a sub-agent's own text), as opened from the trace / state tabs.
   */
  openEventDetails(key: string | undefined) {
    // Client-side messages such as the stop notice have no event to show.
    if (!key || !this.eventData.has(key)) {
      return;
    }

    this.sideDrawer.open();
    this.showSidePanel = true;
    this.selectedEvent = this.eventData.get(key);
    this.selectedEventIndex = this.getIndexOfKeyInMap(key);

    this.systemInstructionDiff = null;
    const selected = this.selectedEvent;
    this.eventService.getEventTrace(this.selectedEvent.id).subscribe((res) => {
      this.llmRequest = JSON.parse(res[this.llmRequestKey]);
      this.llmResponse = JSON.parse(res[this.llmResponseKey]);
      this.compareSystemInstruction(selected, this.llmRequest);
    });

    this.eventService
      .getEvent(
        this.userId,
        this.appName,
        this.sessionId,
        this.selectedEvent.id,
      )
      .subscribe(async (res) => {
        if (!res.dotSrc) {
          this.renderedEventGraph = undefined;
          return;
        }
        const graphSrc = res.dotSrc;
        const viz = await instance();
        const svg = viz.renderString(graphSrc, {
          format: 'svg',
          engine: 'dot',
        });
        this.rawSvgString = svg;
        this.renderedEventGraph = this.sanitizer.bypassSecurityTrustHtml(svg);
      });
  }

  userMessagesLength(i: number) {
    return this.messages.slice(0, i).filter((m) => m.role == 'user').length;
  }

  ngOnDestroy(): void {
    this.abortActiveSse();
    this.webSocketService.closeConnection();
  }

  onAppSelection(event: any) {
    if (this.isAudioRecording) {
      this.stopAudioRecording();
      this.isAudioRecording = false;
    }
    if (this.isVideoRecording) {
      this.stopVideoRecording();
      this.isVideoRecording = false;
    }
    this.evalTab?.resetEvalResults();
    this.traceData = [];
    this.bottomPanelVisible = false;
  }

  toggleAudioRecording() {
    this.isAudioRecording ? this.stopAudioRecording() :
      this.startAudioRecording();
  }

  startAudioRecording() {
    if (this.sessionHasUsedBidi.has(this.sessionId)) {
      this.openSnackBar(BIDI_STREAMING_RESTART_WARNING, 'OK')
      return;
    }

    this.isAudioRecording = true;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    this.webSocketService.connect(
      `${protocol}://${URLUtil.getWSServerUrl()}/run_live?app_name=${this.appName}&user_id=${this.userId}&session_id=${this.sessionId}`,
    );
    this.audioService.startRecording();
    this.messages.push({ role: 'user', text: 'Speaking...' });
    this.messages.push({ role: 'bot', text: 'Speaking...' });
    this.messagesSubject.next(this.messages);
    this.sessionHasUsedBidi.add(this.sessionId);
  }

  stopAudioRecording() {
    this.audioService.stopRecording();
    this.webSocketService.closeConnection();
    this.isAudioRecording = false;
  }

  toggleVideoRecording() {
    this.isVideoRecording ? this.stopVideoRecording() :
      this.startVideoRecording();
  }

  startVideoRecording() {
    if (this.sessionHasUsedBidi.has(this.sessionId)) {
      this.openSnackBar(BIDI_STREAMING_RESTART_WARNING, 'OK')
      return;
    }

    this.isVideoRecording = true;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    this.webSocketService.connect(
      `${protocol}://${URLUtil.getWSServerUrl()}/run_live?app_name=${this.appName}&user_id=${this.userId}&session_id=${this.sessionId}`,
    );
    this.videoService.startRecording(this.videoContainer);
    this.audioService.startRecording();
    this.messages.push({ role: 'user', text: 'Speaking...' });
    this.messagesSubject.next(this.messages);
    this.sessionHasUsedBidi.add(this.sessionId);
  }

  stopVideoRecording() {
    this.audioService.stopRecording();
    this.videoService.stopRecording(this.videoContainer);
    this.webSocketService.closeConnection();
    this.isVideoRecording = false;
  }

  private getAsyncFunctionsFromParts(pendingIds: any[], parts: any[]) {
    for (const part of parts) {
      if (part.functionCall && pendingIds.includes(part.functionCall.id)) {
        this.longRunningEvents.push(part.functionCall);
      }
    }
  }

  private openOAuthPopup(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      // Open OAuth popup
      const popup = window.open(url, 'oauthPopup', 'width=600,height=700');

      if (!popup) {
        reject('Popup blocked!');
        return;
      }

      // Listen for messages from the popup
      window.addEventListener(
        'message',
        (event) => {
          if (event.origin !== window.location.origin) {
            return;  // Ignore messages from unknown sources
          }
          const { authResponseUrl } = event.data;
          if (authResponseUrl) {
            resolve(authResponseUrl);
          } else {
            reject('OAuth failed');
          }
        },
        { once: true },
      );
    });
  }

  toggleSidePanel() {
    if (this.showSidePanel) {
      this.sideDrawer.close();
    } else {
      this.sideDrawer.open();
    }
    this.showSidePanel = !this.showSidePanel;
  }

  protected handleTabChange(event: any) {
    if (!this.isChatMode()) {
      this.resetEditEvalCaseVars();
      this.handleReturnToSession(true);
    }
  }

  protected handleShouldShowEvalTab(shouldShow: boolean) {
    this.shouldShowEvalTab.set(shouldShow);
  }

  protected handleReturnToSession(event: boolean) {
    this.sessionTab.getSession(this.sessionId);
  this.evalTab?.resetEvalCase();
    this.isChatMode.set(true);
  }

  protected handleEvalNotInstalled(errorMsg: string) {
    if (errorMsg) {
      this.openSnackBar(errorMsg, 'OK');
    }
  }

  private resetEventsAndMessages() {
    this.eventData.clear();
    this.eventMessageIndexArray = [];
    this.messages = [];
    this.messagesSubject.next(this.messages);
    this.artifacts = [];
  }

  protected updateWithSelectedSession(session: Session) {
    if (!session || !session.id || !session.events || !session.state) {
      return;
    }
    this.traceService.resetTraceService();
    this.sessionId = session.id;
    this.currentSessionState = session.state;
    this.sessionEvents = session.events ?? [];
    this.evalCase = null;
    this.isChatMode.set(true);

    this.isSessionUrlEnabledObs.subscribe((enabled) => {
      if (enabled) {
        this.updateSelectedSessionUrl();
      }
    });

    this.resetEventsAndMessages();
    let index = 0;
    // A turn stopped with the stop button ends with ADK's INVOCATION_ABORTED
    // events; show the same stop notice as when it was stopped live.
    let abortedInvocationId: string | null = null;
    const addStoppedNotice = () => {
      if (abortedInvocationId) {
        this.messages.push(this.stoppedNoticeMessage());
        this.messagesSubject.next(this.messages);
        abortedInvocationId = null;
      }
    };

    session.events.forEach((event: any) => {
      if (abortedInvocationId && event.invocationId !== abortedInvocationId) {
        addStoppedNotice();
      }
      event.content?.parts?.forEach((part: any) => {
        if (part.text && this.isDelegatedSubAgentEvent(event)) {
          this.eventMessageIndexArray[index] = part.text;
        } else if (isEmptyTextPart(part)) {
          // Nothing to show.
        } else {
          this.storeMessage(
            part, event, index, event.author === 'user' ? 'user' : 'bot');
        }
        index += 1;
        if (event.author && event.author !== 'user') {
          this.storeEvents(part, event, index);
        }
      });
      if (event.errorCode === INVOCATION_ABORTED) {
        abortedInvocationId = event.invocationId;
      }
    });
    addStoppedNotice();

    this.eventService.getTrace(this.sessionId).subscribe(res => {
      this.traceData = res;
      this.traceService.setEventData(this.eventData);
      this.traceService.setMessages(this.messages);
    });

    this.bottomPanelVisible = false;
  }

  protected updateWithSelectedEvalCase(evalCase: EvalCase) {
    this.evalCase = evalCase;
    this.isChatMode.set(false);

    this.resetEventsAndMessages();
    let index = 0;
    let invocationIndex = 0;

    for (const invocation of evalCase.conversation) {
      if (invocation.userContent?.parts) {
        for (const part of invocation.userContent.parts) {
          this.storeMessage(part, null, index, 'user');
          index++;
        }
      }

      if (invocation.intermediateData?.toolUses) {
        let toolUseIndex = 0;
        for (const toolUse of invocation.intermediateData.toolUses) {
          const functionCallPart = {
            functionCall: {name: toolUse.name, args: toolUse.args}
          };
          this.storeMessage(
              functionCallPart, null, index, 'bot', invocationIndex,
              {toolUseIndex});
          index++;
          toolUseIndex++;

          const functionResponsePart = { functionResponse: { name: toolUse.name } };
          this.storeMessage(functionResponsePart, null, index, 'bot');
          index++;
        }
      }

      if (invocation.finalResponse?.parts) {
        let finalResponsePartIndex = 0;
        for (const part of invocation.finalResponse.parts) {
          this.storeMessage(
              part, null, index, 'bot', invocationIndex,
              {finalResponsePartIndex});
          index++;
          finalResponsePartIndex++;
        }
      }
      invocationIndex++;
    }
  }

  protected updateSelectedEvalSetId(evalSetId: string) {
    this.evalSetId = evalSetId;
  }

  protected editEvalCaseMessage(message: any) {
    this.isEvalCaseEditing.set(true);
    this.userEditEvalCaseMessage = message.text;
    message.isEditing = true;
    setTimeout(() => {
      this.textarea?.nativeElement.focus();
      let textLength = this.textarea?.nativeElement.value.length;
      if (message.text.charAt(textLength - 1) === '\n') {
        textLength--;
      }
      this.textarea?.nativeElement.setSelectionRange(textLength, textLength);
    }, 0);
  }

  protected editFunctionArgs(message: any) {
    this.isEvalCaseEditing.set(true);
    const dialogRef = this.dialog.open(EditFunctionArgsDialogComponent, {
      maxWidth: '90vw',
      maxHeight: '90vh',
      data: {
        functionName: message.functionCall.name,
        args: message.functionCall.args
      },
    });

    dialogRef.afterClosed().subscribe((result) => {
      this.isEvalCaseEditing.set(false);
      if (result) {
        this.hasEvalCaseChanged.set(true);
        message.functionCall.args = result;

        this.updatedEvalCase = structuredClone(this.evalCase!);
        this.updatedEvalCase!.conversation[message.invocationIndex]
            .intermediateData!.toolUses![message.toolUseIndex]
            .args = result;
      }
    });
  }

  protected saveEvalCase() {
    this.evalService
        .updateEvalCase(
            this.appName, this.evalSetId, this.updatedEvalCase!.evalId,
            this.updatedEvalCase!)
        .subscribe((res) => {
          this.openSnackBar('Eval case updated', 'OK');
          this.resetEditEvalCaseVars()
        });
  }

  protected cancelEditEvalCase() {
    this.resetEditEvalCaseVars();
    this.updateWithSelectedEvalCase(this.evalCase!);
  }

  private resetEditEvalCaseVars() {
    this.hasEvalCaseChanged.set(false);
    this.isEvalCaseEditing.set(false);
    this.isEvalEditMode.set(false);
    this.updatedEvalCase = null;
  }

  protected cancelEditMessage(message: any) {
    message.isEditing = false;
    this.isEvalCaseEditing.set(false);
  }

  protected saveEditMessage(message: any) {
    this.hasEvalCaseChanged.set(true);
    this.isEvalCaseEditing.set(false);
    message.isEditing = false;
    message.text =
      this.userEditEvalCaseMessage ? this.userEditEvalCaseMessage : ' ';

    this.updatedEvalCase = structuredClone(this.evalCase!);
    this.updatedEvalCase!.conversation[message.invocationIndex]
      .finalResponse!.parts![message.finalResponsePartIndex] = {
      text: this.userEditEvalCaseMessage
    };

    this.userEditEvalCaseMessage = '';
  }

  protected handleKeydown(event: KeyboardEvent, message: any) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.saveEditMessage(message);
    } else if (event.key === 'Escape') {
      this.cancelEditMessage(message);
    }
  }

  protected deleteEvalCaseMessage(message: any, index: number) {
    this.hasEvalCaseChanged.set(true);
    this.messages.splice(index, 1);
    this.messagesSubject.next(this.messages);

    this.updatedEvalCase = structuredClone(this.evalCase!);
    this.updatedEvalCase!.conversation[message.invocationIndex]
      .finalResponse!.parts!.splice(message.finalResponsePartIndex, 1);
  }

  protected editEvalCase() {
    this.isEvalEditMode.set(true);
  }

  protected deleteEvalCase() {
    const dialogData: DeleteSessionDialogData = {
      title: 'Confirm delete',
      message: `Are you sure you want to delete ${this.evalCase!.evalId}?`,
      confirmButtonText: 'Delete',
      cancelButtonText: 'Cancel',
    };

    const dialogRef = this.dialog.open(DeleteSessionDialogComponent, {
      width: '600px',
      data: dialogData,
      panelClass: 'light-dialog',
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
  this.evalTab?.deleteEvalCase(this.evalCase!.evalId);
        this.openSnackBar('Eval case deleted', 'OK')
      }
    });
  }

  protected updateSessionState(session: Session) {
    this.currentSessionState = session.state;
  }

  protected onSessionStateChanged(state: any): void {
    this.currentSessionState = state ?? {};
    this.changeDetectorRef.detectChanges();
  }

  onNewSessionClick() {
    this.createSession();
    this.eventData.clear();
    this.eventMessageIndexArray = [];
    this.messages = [];
    this.artifacts = [];
    this.traceData = [];
    this.bottomPanelVisible = false;

    // Close eval history if opened
    if (!!this.evalTab?.showEvalHistory) {
      this.evalTab?.toggleEvalHistoryButton();
    }
  }

  onFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      for (let i = 0; i < input.files.length; i++) {
        const file = input.files[i];
        const url = URL.createObjectURL(file);
        this.selectedFiles.push({ file, url });
      }
    }
    input.value = '';
  }

  removeFile(index: number) {
    URL.revokeObjectURL(this.selectedFiles[index].url);
    this.selectedFiles.splice(index, 1);
  }

  private activityLayoutCache: {
    messages: any[],
    language: Language,
    length: number,
    first: any,
    last: any,
    groups: Map<number, ActivityGroup>,
    hidden: Set<number>,
  } | null = null;

  /**
   * Groups consecutive thoughts / tool calls / tool results into one activity
   * panel, keyed by the index of the group's first message. The other messages
   * of the group are hidden from the flat list.
   */
  private activityLayout() {
    const messages = this.messages;
    const language = this.i18n.language();
    const cache = this.activityLayoutCache;
    if (cache && cache.messages === messages && cache.language === language &&
        cache.length === messages.length &&
        cache.first === messages[0] && cache.last === messages[messages.length - 1]) {
      return cache;
    }

    const groups = new Map<number, ActivityGroup>();
    const hidden = new Set<number>();
    let current: ActivityGroup | null = null;
    messages.forEach((message, i) => {
      if (!this.isActivityMessage(message)) {
        current = null;
        return;
      }
      if (!current) {
        current = {start: i, end: i, steps: [], tree: [], summary: ''};
        groups.set(i, current);
      } else {
        hidden.add(i);
      }
      current.end = i;
      current.steps.push(this.toActivityStep(message, i));
    });
    groups.forEach((group) => {
      group.tree = this.activityTree(group.steps);
      group.summary = this.activitySummary(group);
    });

    this.activityLayoutCache = {
      messages,
      language,
      length: messages.length,
      first: messages[0],
      last: messages[messages.length - 1],
      groups,
      hidden,
    };
    return this.activityLayoutCache;
  }

  /**
   * Nests each sub-agent's steps under the root call that started it. A
   * single_turn sub-agent runs in branch `<agent>@<function call id>`, so
   * parallel searches no longer interleave in the expanded view.
   */
  private activityTree(steps: ActivityStep[]): ActivityStep[] {
    const callsById = new Map<string, ActivityStep>();
    const tree: ActivityStep[] = [];
    for (const step of steps) {
      const parent = step.nested ? callsById.get(this.branchRunId(step) ?? '') : undefined;
      if (parent) {
        parent.children = [...(parent.children ?? []), step];
        continue;
      }
      if (step.kind === 'call' && step.callId && !step.nested) {
        callsById.set(step.callId, step);
      }
      tree.push(step);
    }
    return tree;
  }

  /** The run id of the sub-agent branch a step ran in (the part after the last `@`). */
  private branchRunId(step: ActivityStep): string | undefined {
    const branch: string | undefined = this.eventData.get(this.messages[step.index]?.eventId)?.branch;
    const segment = branch?.split('.').reverse().find((part) => part.includes('@'));
    return segment?.slice(segment.lastIndexOf('@') + 1);
  }

  /** Display name of a platform tool (sub-agent), or undefined for other tools. */
  private platformLabel(toolName: string | undefined): string | undefined {
    if (!toolName) {
      return undefined;
    }
    const key = AGENT_TOOL_LABEL_KEYS[toolName];
    return key ? this.i18n.t(key) : AGENT_TOOL_NAMES[toolName];
  }

  /** Display name of an agent: platform label for sub-agents, "assistant" for the root. */
  agentDisplayName(agentName: string | undefined): string {
    if (!agentName) {
      return '';
    }
    return this.platformLabel(agentName) ??
        (agentName === this.appName ? this.i18n.t('agent.assistant') : agentName);
  }

  /** Label for answers written by an agent the root handed the chat over to. */
  answeringAgentLabel(i: number): string | undefined {
    if (this.messages[i]?.stopped) {
      return undefined;
    }
    return this.platformLabel(this.getAgentNameFromEvent(i));
  }

  private isActivityMessage(message: any): boolean {
    // Requests waiting on the user get their own card instead.
    return message?.role === 'bot' && !this.hitlRequestOf(message) &&
        !!(message.thought || message.functionCall || message.functionResponse);
  }

  /** The approval / input / manual result the call at message `i` waits for. */
  hitlRequestAt(i: number): HitlRequest | null {
    const message = this.messages[i];
    return message?.role === 'bot' ? this.hitlRequestOf(message) : null;
  }

  private hitlRequestOf(message: any): HitlRequest | null {
    const call = message?.functionCall;
    if (!call?.id) {
      return null;
    }
    // Cached so the card keeps the same input (and its form state) across checks.
    const cached = this.hitlRequests.get(call.id);
    if (cached) {
      return cached;
    }
    const request = getHitlRequest(
        call, this.eventData.get(message.eventId)?.longRunningToolIds);
    if (request) {
      this.hitlRequests.set(call.id, request);
    }
    return request;
  }

  /** The user's function responses are shown on the request card, not as messages. */
  isHitlResponseMessage(message: any): boolean {
    return message?.role === 'user' && !!message.functionResponse;
  }

  hitlResolution(request: HitlRequest): HitlResolution | null {
    const answered = this.hitlAnswers.get(request.callId);
    if (answered) {
      return answered;
    }
    const message = this.messages.find((m) =>
        m.role === 'user' && m.functionResponse?.id === request.callId);
    if (!message) {
      return null;
    }
    const response = message.functionResponse.response ?? {};
    const resolution = {confirmed: response.confirmed, response};
    this.hitlAnswers.set(request.callId, resolution);
    return resolution;
  }

  /** The user moved on (sent a new message) without answering the request. */
  isHitlExpired(i: number, request: HitlRequest): boolean {
    return !this.hitlResolution(request) &&
        this.messages.slice(i + 1).some((m) => m.role === 'user' && m.text);
  }

  /** What a long-running tool returned so far, to start the manual result from. */
  hitlInterimResponse(request: HitlRequest): unknown {
    return this.messages.find((m) =>
        m.role === 'bot' && m.functionResponse?.id === request.callId)
        ?.functionResponse.response;
  }

  respondToHitl(request: HitlRequest, response: Record<string, unknown>) {
    if (this.isAgentResponding()) {
      return;
    }
    this.hitlAnswers.set(request.callId, {
      confirmed: response['confirmed'] as boolean | undefined,
      response,
    });
    this.scrollInterruptedSubject.next(false);
    const req: AgentRunRequest = {
      appName: this.appName,
      userId: this.userId,
      sessionId: this.sessionId,
      newMessage: {
        role: 'user',
        parts: [{
          function_response: {
            id: request.callId,
            name: request.callName,
            response,
          },
        }],
      },
      streaming: this.useSse,
      thinkingMode: this.thinkingMode,
      enabledPlatforms: this.platformService.enabledIds(),
    };
    this.runSseWithAuthRetry(req);
  }

  private toActivityStep(message: any, index: number): ActivityStep {
    const event = this.eventData.get(message.eventId);
    const nested = this.isDelegatedSubAgentEvent(event);
    if (message.thought) {
      return {
        index,
        kind: 'thought',
        label: this.thoughtTitle(message.text) || this.i18n.t('activity.thinking'),
        text: message.text,
        nested,
      };
    }
    const call = message.functionCall;
    if (call) {
      const args = call.args ?? {};
      const callId = call.id;
      const platform = this.platformLabel(call.name);
      if (platform) {
        return {index, kind: 'call', label: this.i18n.t('activity.call', {platform}), detail: args.request, nested, callId};
      }
      if (call.name === 'transfer_to_agent') {
        const agent = this.agentDisplayName(args.agent_name);
        return {index, kind: 'call', label: this.i18n.t('activity.switch', {agent}), nested, callId};
      }
      return {index, kind: 'call', label: call.name, detail: this.compactArgs(args), nested, callId};
    }
    const response = message.functionResponse;
    const error = response?.response?.error;
    if (error === APPROVAL_REQUESTED_ERROR || error === REJECTED_ERROR) {
      return {
        index,
        kind: 'response',
        label: this.i18n.t(
            error === REJECTED_ERROR ? 'activity.rejectedCall' : 'activity.awaitingApproval',
            {name: this.platformLabel(response.name) ?? response.name}),
        nested,
        aborted: error === REJECTED_ERROR,
      };
    }
    const transferTarget = event?.actions?.transferToAgent;
    if (transferTarget) {
      return {
        index,
        kind: 'response',
        label: `${this.agentDisplayName(event.author)} → ${this.agentDisplayName(transferTarget)}`,
        nested,
        transfer: true,
      };
    }
    const platform = this.platformLabel(response?.name);
    const name = response?.name;
    if (event?.errorCode === INVOCATION_ABORTED) {
      return {
        index,
        kind: 'response',
        label: platform ? this.i18n.t('activity.callAborted', {platform}) :
                          this.i18n.t('activity.aborted', {name}),
        nested,
        aborted: true,
      };
    }
    return {
      index,
      kind: 'response',
      label: platform ? this.i18n.t('activity.callDone', {platform}) :
                        this.i18n.t('activity.done', {name}),
      nested,
    };
  }

  private compactArgs(args: any): string | undefined {
    const text = JSON.stringify(args);
    if (!text || text === '{}') {
      return undefined;
    }
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  }

  private activitySummary(group: ActivityGroup): string {
    const platforms = [...new Set(group.steps
        .filter((step) => step.kind === 'call' && !step.nested)
        .map((step) => this.platformLabel(this.messages[step.index]?.functionCall?.name))
        .filter((label) => !!label))];
    const steps = this.i18n.t('activity.steps', {count: group.steps.length});
    if (platforms.length > 0) {
      const separator = this.i18n.t('activity.platformSeparator');
      return this.i18n.t('activity.summaryCall', {platforms: platforms.join(separator), steps});
    }
    if (group.steps.every((step) => step.kind === 'thought')) {
      return this.i18n.t('activity.summaryThought', {steps});
    }
    return this.i18n.t('activity.summaryOther', {steps});
  }

  /** The activity group that starts at message `i`, if any. */
  activityGroupAt(i: number): ActivityGroup | undefined {
    if (this.isEvalEditMode()) {
      return undefined;
    }
    return this.activityLayout().groups.get(i);
  }

  /** True for messages folded into an activity panel that starts earlier. */
  isHiddenInActivity(i: number): boolean {
    if (this.isEvalEditMode()) {
      return false;
    }
    return this.activityLayout().hidden.has(i);
  }

  /** The agent is still working on this group: only the loading placeholder follows it. */
  isActivityRunning(group: ActivityGroup): boolean {
    const after = this.messages.slice(group.end + 1);
    return after.length > 0 && after.every((message) => message.isLoading);
  }

  /** The user pressed stop while this group was running (live, or sealed by ADK on reload). */
  isActivityStopped(group: ActivityGroup): boolean {
    return !!this.messages[group.end + 1]?.stopped ||
        group.steps.some((step) => step.aborted);
  }

  rollingActivitySteps(group: ActivityGroup): ActivityStep[] {
    return group.steps.slice(-ACTIVITY_ROLLING_STEPS);
  }

  isActivityExpanded(group: ActivityGroup): boolean {
    return !!this.messages[group.start]?.activityExpanded;
  }

  toggleActivity(group: ActivityGroup) {
    const first = this.messages[group.start];
    if (first) {
      first.activityExpanded = !first.activityExpanded;
    }
  }

  isActivityFlowOpen(group: ActivityGroup): boolean {
    return !!this.messages[group.start]?.activityFlowOpen;
  }

  toggleActivityFlow(group: ActivityGroup) {
    const first = this.messages[group.start];
    if (!first) {
      return;
    }
    first.activityFlowOpen = !first.activityFlowOpen;
    if (!this.viz) {
      instance().then((viz) => {
        this.viz = viz;
        this.changeDetectorRef.markForCheck();
      });
    }
  }

  /**
   * The turn as a workflow, in the order it ran: the question, each round of
   * the root agent deciding what to do, the calls it made (side by side when
   * parallel, each with the sub-agent's own tool calls in its lane), and the
   * answer. Nodes still waiting for a result are drawn as running.
   * Null until Graphviz (viz.js) is loaded.
   */
  activityFlowHtml(group: ActivityGroup): SafeHtml | null {
    return this.activityFlow(group)?.html ?? null;
  }

  openActivityFlow(group: ActivityGroup) {
    const flow = this.activityFlow(group);
    if (flow) {
      this.openViewImageDialog(flow.svg);
    }
  }

  private activityFlow(group: ActivityGroup): {svg: string, html: SafeHtml} | null {
    if (!this.viz) {
      return null;
    }
    const dot = this.flowDot(group);
    let cached = this.activityFlowCache.get(dot);
    if (!cached) {
      if (this.activityFlowCache.size > 100) {
        this.activityFlowCache.clear();
      }
      const svg = this.viz.renderString(dot, {format: 'svg', engine: 'dot'})
          .replace('<svg ', '<svg class="flow-graph" ');
      cached = {svg, html: this.sanitizer.bypassSecurityTrustHtml(svg)};
      this.activityFlowCache.set(dot, cached);
    }
    return cached;
  }

  /** Graphviz DOT of the turn's workflow; states go in `class` attributes (styles.scss). */
  private flowDot(group: ActivityGroup): string {
    const running = this.isActivityRunning(group);
    const stopped = this.isActivityStopped(group);
    // Result of every call in the turn, by call id.
    const results = new Map<string, FlowState>();
    for (const step of group.steps) {
      const message = this.messages[step.index];
      const response = message?.functionResponse;
      if (response?.id) {
        const aborted = this.eventData.get(message.eventId)?.errorCode === INVOCATION_ABORTED ||
            response.response?.error === REJECTED_ERROR;
        results.set(response.id, aborted ? 'aborted' : 'done');
      }
    }
    const callState = (step: ActivityStep): FlowState =>
        (step.callId && results.get(step.callId)) ||
        (running ? 'running' : stopped ? 'aborted' : 'done');

    // Rounds: the calls one model response made (they share an event), with
    // the thoughts that led to them.
    type Round = {eventId?: string, thoughts: string[], calls: ActivityStep[]};
    const rounds: Round[] = [];
    let thoughts: string[] = [];
    for (const step of group.tree) {
      if (step.kind === 'thought') {
        thoughts.push(step.label);
      } else if (step.kind === 'call') {
        const eventId = this.messages[step.index]?.eventId;
        let round = rounds[rounds.length - 1];
        if (!round || round.eventId !== eventId || thoughts.length) {
          round = {eventId, thoughts, calls: []};
          rounds.push(round);
          thoughts = [];
        }
        round.calls.push(step);
      }
    }
    if (thoughts.length) {
      rounds.push({thoughts, calls: []});
    }

    const quote = (text: string) =>
        `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    const short = (text: string, max = 24) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
    const lines: string[] = [];
    let count = 0;
    const node = (label: string, kind: string, state: FlowState, attrs = '') => {
      const id = `n${count++}`;
      lines.push(`  ${id} [label=${quote(label)} class="flow-${kind} flow-${state}"${attrs}]`);
      return id;
    };
    const edge = (from: string, to: string, state: FlowState) =>
        lines.push(`  ${from} -> ${to} [class="flow-${state}"]`);

    let previous = [node(this.i18n.t('flow.question'), 'start', 'done', ' shape=ellipse')];
    rounds.forEach((round, i) => {
      const last = i === rounds.length - 1;
      const thinking = last && running && round.calls.length === 0;
      const label = this.i18n.t('flow.decide') +
          (round.thoughts.length ? `\n${short(round.thoughts[round.thoughts.length - 1])}` : '');
      const decide = node(label, 'round', thinking ? 'running' : 'done');
      previous.forEach((from) => edge(from, decide, thinking ? 'running' : 'done'));
      if (!round.calls.length) {
        previous = [decide];
        return;
      }
      previous = round.calls.map((call) => {
        const state = callState(call);
        lines.push(`  subgraph cluster_${count} {`);
        lines.push(`  class="flow-lane flow-${state}" style=rounded label=""`);
        const callNode = node(short(call.label, 28), 'call', state);
        let tail = callNode;
        for (const child of call.children ?? []) {
          if (child.kind !== 'call') {
            continue;
          }
          const childState = callState(child);
          const toolNode = node(short(child.label, 28), 'tool', childState);
          edge(tail, toolNode, childState);
          tail = toolNode;
        }
        lines.push('  }');
        edge(decide, callNode, state);
        return tail;
      });
    });

    const lastRound = rounds[rounds.length - 1];
    const after = this.messages[group.end + 1];
    if (stopped) {
      const end = node(this.i18n.t('flow.stopped'), 'end', 'aborted', ' shape=ellipse');
      previous.forEach((from) => edge(from, end, 'aborted'));
    } else if (running) {
      // The calls came back and the root is deciding again or writing the answer.
      if (lastRound?.calls.length && lastRound.calls.every((call) => callState(call) !== 'running')) {
        const next = node(this.i18n.t('flow.thinking'), 'round', 'running');
        previous.forEach((from) => edge(from, next, 'running'));
      }
    } else if (after?.role === 'bot' && !after.thought) {
      const answer = node(this.i18n.t('flow.answer'), 'end', 'done', ' shape=ellipse');
      previous.forEach((from) => edge(from, answer, 'done'));
    }

    return [
      'digraph {',
      '  graph [rankdir=TB bgcolor=transparent nodesep=0.3 ranksep=0.35]',
      '  node [shape=box style="rounded" fontname="Helvetica" fontsize=11 margin="0.18,0.06" height=0.3]',
      '  edge [arrowsize=0.6]',
      ...lines,
      '}',
    ].join('\n');
  }


  /**
   * The latest heading of a thought summary (e.g. "**Planning the search**"),
   * shown while collapsed. A streamed thought grows heading by heading, so the
   * latest one tells what the model is thinking about now.
   */
  thoughtTitle(text: string | undefined): string {
    const lines = (text ?? '').trim().split('\n').map((line) => line.trim());
    const headings = lines.filter((line) => /^\*\*.+\*\*$/.test(line));
    const title = headings.length ? headings[headings.length - 1] : lines[0] ?? '';
    return title.replace(/^\*\*(.+)\*\*$/, '$1').trim();
  }

  thinkingModeIndex(): number {
    return Math.max(0, this.thinkingModeOptions.findIndex((option) => option.value === this.thinkingMode));
  }

  setThinkingMode(mode: ThinkingMode) {
    this.thinkingMode = mode;
    try {
      localStorage.setItem(THINKING_MODE_STORAGE_KEY, mode);
    } catch {
      // Storage can be unavailable (e.g. private mode); the choice still applies to this page.
    }
  }

  private loadThinkingMode(): ThinkingMode {
    try {
      const stored = localStorage.getItem(THINKING_MODE_STORAGE_KEY);
      if (stored === 'fast' || stored === 'standard' || stored === 'thinking') {
        return stored;
      }
    } catch {
      // Fall back to the default below.
    }
    return 'standard';
  }

  /** On unless the user turned it off. */
  private loadTokenStreaming(): boolean {
    try {
      return localStorage.getItem(TOKEN_STREAMING_STORAGE_KEY) !== 'false';
    } catch {
      return true;
    }
  }

  setTokenStreaming(enabled: boolean) {
    this.useSse = enabled;
    try {
      localStorage.setItem(TOKEN_STREAMING_STORAGE_KEY, String(enabled));
    } catch {
      // Storage can be unavailable (private mode); the choice then lasts for this page only.
    }
  }

  toggleSse() {
    this.useSse = !this.useSse;
  }

  selectEvent(key: string) {
    this.selectedEvent = this.eventData.get(key);
    this.selectedEventIndex = this.getIndexOfKeyInMap(key);
    this.systemInstructionDiff = null;
    const selected = this.selectedEvent;
    this.eventService.getEventTrace(this.selectedEvent.id).subscribe((res) => {
      this.llmRequest = JSON.parse(res[this.llmRequestKey]);
      this.llmResponse = JSON.parse(res[this.llmResponseKey]);
      this.compareSystemInstruction(selected, this.llmRequest);
    });
    this.eventService
      .getEvent(
        this.userId,
        this.appName,
        this.sessionId,
        this.selectedEvent.id,
      )
      .subscribe(async (res) => {
        if (!res.dotSrc) {
          this.renderedEventGraph = undefined;
          return;
        }
        const graphSrc = res.dotSrc;
        const viz = await instance();
        const svg = viz.renderString(graphSrc, {
          format: 'svg',
          engine: 'dot',
        });
        this.rawSvgString = svg;
        this.renderedEventGraph = this.sanitizer.bypassSecurityTrustHtml(svg);
      });
  }

  protected deleteSession(session: string) {
    const dialogData: DeleteSessionDialogData = {
      title: 'Confirm delete',
      message:
        `Are you sure you want to delete this session ${this.sessionId}?`,
      confirmButtonText: 'Delete',
      cancelButtonText: 'Cancel',
    };

    const dialogRef = this.dialog.open(DeleteSessionDialogComponent, {
      width: '600px',
      data: dialogData,
      panelClass: 'light-dialog',
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.sessionService.deleteSession(this.userId, this.appName, session)
          .subscribe((res) => {
            const nextSession = this.sessionTab.refreshSession(session);
            if (nextSession) {
              this.sessionTab.getSession(nextSession.id);
            } else {
              window.location.reload();
            }
          });
      } else {
      }
    });
  }

  /** Leaves the open session if the session list just deleted it. */
  protected onSessionsDeleted(sessionIds: string[]) {
    if (!sessionIds.includes(this.sessionId)) {
      return;
    }
    const nextSession = this.sessionTab.sessionList[0];
    if (nextSession) {
      this.sessionTab.getSession(nextSession.id);
    } else {
      window.location.reload();
    }
  }

  private syncSelectedAppFromUrl() {
    combineLatest([
      this.router.events.pipe(
        filter((e) => e instanceof NavigationEnd),
        map(() => this.activatedRoute.snapshot.queryParams),
      ),
      this.apps$
    ]).subscribe(([params, apps]) => {
      if (apps && apps.length) {
        const app = params['app'];
        if (app && apps.includes(app)) {
          this.selectedAppControl.setValue(app);
        } else if (app) {
          this.openSnackBar(`Agent '${app}' not found`, 'OK');
        }
      }
    });
  }

  private updateSelectedAppUrl() {
    this.selectedAppControl.valueChanges
      .pipe(distinctUntilChanged(), filter(Boolean))
      .subscribe((app: string) => {
        this.selectApp(app);

        // Navigate if selected app changed.
        const selectedAgent = this.activatedRoute.snapshot.queryParams['app'];
        if (app === selectedAgent) {
          return;
        }
        this.router.navigate([], {
          queryParams: { 'app': app },
          queryParamsHandling: 'merge',
        });
      });
  }

  private updateSelectedSessionUrl() {
    const url = this.router
                    .createUrlTree([], {
                      queryParams: {'session': this.sessionId},
                      queryParamsHandling: 'merge',
                    })
                    .toString();
    this.location.replaceState(url);
  }

  handlePageEvent(event: any) {
    if (event.pageIndex >= 0) {
      const key = this.getKeyAtIndexInMap(event.pageIndex);
      if (key) {
        this.selectEvent(key);
      }
    }
  }

  closeSelectedEvent() {
    this.selectedEvent = undefined;
    this.selectedEventIndex = undefined;
  }

  private getIndexOfKeyInMap(key: string): number | undefined {
    let index = 0;
    const mapOrderPreservingSort = (a: any, b: any): number =>
      0;  // Simple compare function

    const sortedKeys = Array.from(this.eventData.keys())
      .sort(
        mapOrderPreservingSort,
      );

    for (const k of sortedKeys) {
      if (k === key) {
        return index;
      }
      index++;
    }
    return undefined;  // Key not found
  }

  private getKeyAtIndexInMap(index: number): string | undefined {
    const mapOrderPreservingSort = (a: any, b: any): number =>
      0;  // Simple compare function

    const sortedKeys = Array.from(this.eventData.keys())
      .sort(
        mapOrderPreservingSort,
      );

    if (index >= 0 && index < sortedKeys.length) {
      return sortedKeys[index];
    }
    return undefined;  // Index out of bounds
  }

  openSnackBar(message: string, action: string) {
    this._snackBar.open(message, action);
  }

  private processThoughtText(text: string) {
    return text.replace('/*PLANNING*/', '').replace('/*ACTION*/', '');
  }

  openLink(url: string) {
    window.open(url, '_blank');
  }

  renderGooglerSearch(content: string) {
    return this.sanitizer.bypassSecurityTrustHtml(content);
  }

  openViewImageDialog(imageData: string | null) {
    const dialogRef = this.dialog.open(ViewImageDialogComponent, {
      maxWidth: '90vw',
      maxHeight: '90vh',
      data: {
        imageData,
      },
    });
  }

  private createDefaultArtifactName(mimeType: string): string {
    if (!mimeType || !mimeType.includes('/')) {
      return '';
    }

    return mimeType.replace('/', '.');
  }

  private refreshSessionStateFromServer(): void {
    if (!this.userId || !this.appName || !this.sessionId) {
      return;
    }

    this.sessionService
        .getSession(this.userId, this.appName, this.sessionId)
        .pipe(take(1))
        .subscribe({
          next: (session) => {
            if (!session) {
              return;
            }
            this.currentSessionState = session.state ?? {};
            this.sessionEvents = session.events ?? [];
            this.changeDetectorRef.detectChanges();
          },
          error: (error) => {
            console.error('Failed to refresh session state', error);
          },
        });
  }

  protected exportSession() {
    this.sessionService.getSession(this.userId, this.appName, this.sessionId)
      .subscribe((res) => {
        console.log(res);
        this.downloadService.downloadObjectAsJson(
          res, `session-${this.sessionId}.json`);
      });
  }

  closeTraceEventDetailPanel() {
    this.bottomPanelVisible = false;
    this.traceService.selectedRow(undefined);
    this.traceService.setHoveredMessages(undefined, "")
  }

  shouldMessageHighlighted(index: number) {
    return this.hoveredEventMessageIndices.includes(index);
  }

  protected importSession() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';

    input.onchange = () => {
      if (!input.files || input.files.length === 0) {
        return;
      }

      const file = input.files[0];
      const reader = new FileReader();

      reader.onload = (e) => {
        if (e.target?.result) {
          try {
            const sessionData = JSON.parse(e.target.result as string);
            if (!sessionData.userId || !sessionData.appName ||
                !sessionData.events) {
              this.openSnackBar('Invalid session file format', 'OK');
              return;
            }
            this.sessionService
                .importSession(
                    sessionData.userId, sessionData.appName, sessionData.events)
                .subscribe((res) => {
                  this.openSnackBar('Session imported', 'OK');
                  this.sessionTab.refreshSession();
                });
          } catch (error) {
            this.openSnackBar('Error parsing session file', 'OK');
          }
        }
      };

      reader.readAsText(file);
    };

    input.click();
  }

  // Helper method to dynamically inject the style
  private injectCustomIconColorStyle(className: string, color: string): void {
    // Check if the style already exists to prevent duplicates
    if (this.document.getElementById(className)) {
      return;
    }

    const style = this.renderer.createElement('style');
    this.renderer.setAttribute(
        style, 'id', className);  // Set an ID to check for existence later
    this.renderer.setAttribute(style, 'type', 'text/css');

    // Define the CSS
    const css = `
      .${className} {
        background-color: ${color} !important;
      }
    `;

    this.renderer.appendChild(style, this.renderer.createText(css));
    this.renderer.appendChild(
        this.document.head, style);  // Append to the head of the document
  }
}
