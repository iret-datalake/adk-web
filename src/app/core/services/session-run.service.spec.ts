import {TestBed} from '@angular/core/testing';
import {Subscription} from 'rxjs';

import {SessionRunService} from './session-run.service';

describe('SessionRunService', () => {
  let service: SessionRunService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SessionRunService);
  });

  it('tracks runs per session', () => {
    service.start('a');
    service.start('b');

    expect(service.isRunning('a')).toBeTrue();
    expect(service.isRunning('b')).toBeTrue();
    expect(service.runningIds().size).toBe(2);
  });

  it('keeps a newer run of the session when an older one ends', () => {
    const first = service.start('a');
    const retry = service.start('a');

    service.end(first);

    expect(service.get('a')).toBe(retry);
    service.end(retry);
    expect(service.isRunning('a')).toBeFalse();
  });

  it('aborts a run by closing its request', () => {
    const run = service.start('a');
    run.subscription = new Subscription();

    expect(service.abort('a')).toBeTrue();

    expect(run.subscription.closed).toBeTrue();
    expect(service.isRunning('a')).toBeFalse();
    expect(service.abort('a')).toBeFalse();
  });
});
