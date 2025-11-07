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
import {BehaviorSubject, Observable, catchError, map, of, tap} from 'rxjs';

import {URLUtil} from '../../../utils/url-util';
import {User} from '../models/User';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private readonly currentUserSubject = new BehaviorSubject<User | null>(null);
  readonly currentUser$ = this.currentUserSubject.asObservable();

  constructor(private http: HttpClient) {}

  loadCurrentUser(): Observable<User> {
    const fallbackUser: User = {id: 'user'};

    const baseUrl = URLUtil.getApiServerBaseUrl();
    const url = baseUrl ? `${baseUrl}/users/me` : '/users/me';

    return this.http.get<User>(url).pipe(
        map((user) => user && user.id ? user : fallbackUser),
        catchError(() => of(fallbackUser)),
        tap((user) => this.currentUserSubject.next(user)),
    );
  }

  getCurrentUserSnapshot(): User | null {
    return this.currentUserSubject.value;
  }
}
