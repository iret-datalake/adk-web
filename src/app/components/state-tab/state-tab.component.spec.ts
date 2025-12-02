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

import {ComponentFixture, TestBed} from '@angular/core/testing';
import {NO_ERRORS_SCHEMA, SimpleChange} from '@angular/core';

import {StateTabComponent} from './state-tab.component';

describe('StateTabComponent', () => {
  let component: StateTabComponent;
  let fixture: ComponentFixture<StateTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StateTabComponent],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(StateTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should expose Asana state when available', () => {
    const asanaState = {
      tasks: [
        {gid: '123', name: 'Prepare quarterly report'},
        {gid: '456', name: 'Create hiring plan'},
      ],
    };

    component.sessionState = {asana: asanaState};

    component.ngOnChanges({
      sessionState: new SimpleChange(null, component.sessionState, true),
    });

    expect((component as any).hasStateContent).toBeTrue();
    expect((component as any).currentAsanaState).toEqual(asanaState);
  });
});
