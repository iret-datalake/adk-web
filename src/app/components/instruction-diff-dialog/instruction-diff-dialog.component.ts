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

import {Component, Inject} from '@angular/core';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';

export interface InstructionDiffData {
  agent: string;
  previous: string;
  current: string;
}

export interface DiffLine {
  type: 'same' | 'added' | 'removed' | 'skipped';
  text: string;
  oldNumber?: number;
  newNumber?: number;
}

/** Unchanged lines kept around each change; longer unchanged runs are folded. */
const CONTEXT_LINES = 3;

/** Line diff of an agent's system instruction between two LLM calls. */
@Component({
  selector: 'app-instruction-diff-dialog',
  templateUrl: './instruction-diff-dialog.component.html',
  styleUrl: './instruction-diff-dialog.component.scss',
  standalone: false,
})
export class InstructionDiffDialogComponent {
  readonly lines: DiffLine[];
  readonly added: number;
  readonly removed: number;

  constructor(
      public dialogRef: MatDialogRef<InstructionDiffDialogComponent>,
      @Inject(MAT_DIALOG_DATA) public data: InstructionDiffData,
  ) {
    const lines = diffLines(data.previous, data.current);
    this.added = lines.filter((line) => line.type === 'added').length;
    this.removed = lines.filter((line) => line.type === 'removed').length;
    this.lines = foldUnchanged(lines);
  }
}

/** Line diff by longest common subsequence (instructions are a few hundred lines). */
export function diffLines(previous: string, current: string): DiffLine[] {
  const a = previous.split('\n');
  const b = current.split('\n');
  // lcs[i][j]: length of the LCS of a[i:] and b[j:].
  const lcs: number[][] = Array.from({length: a.length + 1}, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({type: 'same', text: a[i], oldNumber: i + 1, newNumber: j + 1});
      i++;
      j++;
    } else if (j < b.length && (i >= a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      lines.push({type: 'added', text: b[j], newNumber: j + 1});
      j++;
    } else {
      lines.push({type: 'removed', text: a[i], oldNumber: i + 1});
      i++;
    }
  }
  return lines;
}

/** Replaces unchanged runs away from any change with one "skipped" line. */
export function foldUnchanged(lines: DiffLine[]): DiffLine[] {
  const near = lines.map(() => false);
  lines.forEach((line, index) => {
    if (line.type !== 'same') {
      for (let k = Math.max(0, index - CONTEXT_LINES);
           k <= Math.min(lines.length - 1, index + CONTEXT_LINES); k++) {
        near[k] = true;
      }
    }
  });
  const folded: DiffLine[] = [];
  let skipped = 0;
  lines.forEach((line, index) => {
    if (line.type === 'same' && !near[index]) {
      skipped++;
      return;
    }
    if (skipped) {
      folded.push({type: 'skipped', text: String(skipped)});
      skipped = 0;
    }
    folded.push(line);
  });
  if (skipped) {
    folded.push({type: 'skipped', text: String(skipped)});
  }
  return folded;
}
