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

import {Directive, ElementRef, OnDestroy, OnInit} from '@angular/core';
import {MatDialog} from '@angular/material/dialog';
import {MarkdownComponent} from 'ngx-markdown';
import {Subscription} from 'rxjs';

import {ViewImageDialogComponent} from '../components/view-image-dialog/view-image-dialog.component';
import {I18nService} from '../core/i18n/i18n.service';

type Mermaid = typeof import('mermaid').default;

const MERMAID_MAX_HEIGHT = 480;

let mermaidLoader: Promise<Mermaid>|null = null;
let mermaidRenderCount = 0;

/** Loads mermaid on first use; it is large, so it lives in its own chunk. */
function loadMermaid(): Promise<Mermaid> {
  mermaidLoader ??= import('mermaid').then(({default: mermaid}) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'neutral',
      fontFamily: '\'Google Sans\', \'Helvetica Neue\', sans-serif',
    });
    return mermaid;
  });
  return mermaidLoader;
}

/**
 * Adds to rendered markdown what upstream adk-web shows: mermaid diagrams,
 * a copy button on code blocks, and images that open in the zoomable viewer.
 *
 * ngx-markdown rewrites the element on every render, so this runs again on
 * each `ready`.
 */
@Directive({
  selector: 'markdown[appMarkdownEnhance]',
  standalone: false,
})
export class MarkdownEnhanceDirective implements OnInit, OnDestroy {
  private readySubscription?: Subscription;

  constructor(
      private readonly markdown: MarkdownComponent,
      private readonly elementRef: ElementRef<HTMLElement>,
      private readonly dialog: MatDialog,
      private readonly i18n: I18nService,
  ) {}

  ngOnInit() {
    this.readySubscription =
        this.markdown.ready.subscribe(() => this.enhance());
  }

  ngOnDestroy() {
    this.readySubscription?.unsubscribe();
  }

  private enhance() {
    const root = this.elementRef.nativeElement;
    root.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector('code.language-mermaid')) {
        this.renderMermaid(pre);
      } else {
        this.addCopyButton(pre);
      }
    });
    root.querySelectorAll('img').forEach((img) => {
      img.classList.add('markdown-zoomable');
      img.addEventListener('click', () => this.openViewer(img.src));
    });
  }

  private async renderMermaid(pre: HTMLPreElement) {
    const definition = (pre.textContent || '').trim();
    const mermaid = await loadMermaid();
    // Unfinished or invalid diagrams stay as a plain code block.
    if (!pre.isConnected ||
        !(await mermaid.parse(definition, {suppressErrors: true}))) {
      this.addCopyButton(pre);
      return;
    }
    try {
      const {svg} =
          await mermaid.render(`markdown-mermaid-${++mermaidRenderCount}`,
                               definition);
      if (!pre.isConnected) return;
      const diagram = document.createElement('div');
      diagram.className = 'markdown-mermaid markdown-zoomable';
      diagram.innerHTML = svg;
      // Natural size instead of `width: 100%`, which shrinks the diagram to
      // the width of the surrounding text. Tall diagrams are scaled down to
      // MERMAID_MAX_HEIGHT; CSS still caps the width at 100%.
      const svgElement = diagram.querySelector('svg');
      const {width, height} = svgElement?.viewBox.baseVal ?? {};
      if (svgElement && width && height) {
        const scale = Math.min(1, MERMAID_MAX_HEIGHT / height);
        svgElement.setAttribute('width', String(Math.round(width * scale)));
      }
      diagram.addEventListener(
          'click', () => this.openViewer(this.viewerSvg(diagram)));
      pre.replaceWith(diagram);
    } catch {
      this.addCopyButton(pre);
    }
  }

  /**
   * Mermaid draws at `width: 100%`, which collapses inside the viewer, so
   * the copy shown there gets a fixed size that fits the screen.
   */
  private viewerSvg(diagram: HTMLElement): string {
    const svg = diagram.querySelector('svg')!.cloneNode(true) as SVGSVGElement;
    svg.removeAttribute('width');
    const {width, height} = svg.viewBox.baseVal;
    if (width && height) {
      const fit = Math.min(
          (window.innerWidth * 0.8) / width, (window.innerHeight * 0.75) / height,
          2);
      svg.setAttribute('width', String(Math.round(width * fit)));
      svg.setAttribute('height', String(Math.round(height * fit)));
      svg.style.maxWidth = 'none';
    }
    return svg.outerHTML;
  }

  private addCopyButton(pre: HTMLPreElement) {
    if (pre.querySelector('.markdown-copy-button')) return;
    const source = pre.querySelector('code') ?? pre;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'markdown-copy-button material-symbols-outlined';
    button.title = this.i18n.t('markdown.copy');
    button.setAttribute('aria-label', button.title);
    button.textContent = 'content_copy';
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(source.textContent || '');
      } catch {
        return;
      }
      button.textContent = 'check';
      button.classList.add('copied');
      setTimeout(() => {
        button.textContent = 'content_copy';
        button.classList.remove('copied');
      }, 2000);
    });
    pre.appendChild(button);
  }

  private openViewer(imageData: string) {
    this.dialog.open(ViewImageDialogComponent, {
      maxWidth: '95vw',
      maxHeight: '95vh',
      data: {imageData},
    });
  }
}
