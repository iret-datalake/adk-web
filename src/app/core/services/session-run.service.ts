import {Injectable, signal} from '@angular/core';
import {Subscription} from 'rxjs';

/** One agent run (one /run_sse request) of a session. */
export interface SessionRun {
  sessionId: string;
  /** The user's turn as shown in the chat (text, attachments). */
  userMessages: any[];
  /** The run's SSE events so far, to rebuild the chat when it is reopened. */
  chunks: any[];
  /** ADK invocation of this run, from its first event. */
  invocationId?: string;
  /** Index of the last part shown, while the session is open. */
  index: number;
  subscription?: Subscription;
}

/**
 * Agent runs in progress, per session. A run keeps streaming while the user
 * looks at another session, so the chat can show it again on return and the
 * session list can show which sessions are running.
 */
@Injectable({
  providedIn: 'root',
})
export class SessionRunService {
  private readonly runs = new Map<string, SessionRun>();
  readonly runningIds = signal<ReadonlySet<string>>(new Set());

  get(sessionId: string): SessionRun|undefined {
    return this.runs.get(sessionId);
  }

  isRunning(sessionId: string): boolean {
    return this.runningIds().has(sessionId);
  }

  start(sessionId: string, userMessages: any[] = []): SessionRun {
    const run: SessionRun = {sessionId, userMessages, chunks: [], index: -1};
    this.runs.set(sessionId, run);
    this.publish();
    return run;
  }

  /** Ends the run; a newer run of the same session (an auth retry) stays. */
  end(run: SessionRun) {
    if (this.runs.get(run.sessionId) !== run) {
      return;
    }
    this.runs.delete(run.sessionId);
    this.publish();
  }

  /** Stops the session's run: the backend aborts it when the request closes. */
  abort(sessionId: string): boolean {
    const run = this.runs.get(sessionId);
    if (!run) {
      return false;
    }
    run.subscription?.unsubscribe();
    this.end(run);
    return true;
  }

  abortAll() {
    for (const sessionId of [...this.runs.keys()]) {
      this.abort(sessionId);
    }
  }

  private publish() {
    this.runningIds.set(new Set(this.runs.keys()));
  }
}
