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


import {Component, HostListener, Inject, OnInit} from '@angular/core';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';
import {DomSanitizer, SafeHtml, SafeUrl} from '@angular/platform-browser';

export interface ViewImageDialogData {
  imageData: string|null;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const BUTTON_ZOOM_STEP = 1.25;

@Component({
  selector: 'app-view-image-dialog',
  templateUrl: './view-image-dialog.component.html',
  styleUrls: ['./view-image-dialog.component.scss'],
  standalone: false,
})
export class ViewImageDialogComponent implements OnInit {
  // Property to hold the sanitized image URL or SVG HTML
  displayContent: SafeUrl|SafeHtml|null = null;
  // Flag to determine if the content is SVG
  isSvgContent: boolean = false;

  scale = 1;
  offsetX = 0;
  offsetY = 0;
  isDragging = false;
  private dragStart = {x: 0, y: 0, offsetX: 0, offsetY: 0};

  constructor(
      public dialogRef: MatDialogRef<ViewImageDialogComponent>,
      @Inject(MAT_DIALOG_DATA) public data: ViewImageDialogData,
      private sanitizer: DomSanitizer) {}

  /**
   * Lifecycle hook to initialize the component.
   * This is used to process the image data when the dialog opens.
   */
  ngOnInit(): void {
    this.processImageData();
  }

  /**
   * Processes the input imageData to determine if it's base64 or SVG
   * and sanitizes it for display.
   */
  private processImageData(): void {
    const imageData = this.data.imageData;

    if (!imageData) {
      this.displayContent = null;
      this.isSvgContent = false;
      return;
    }

    // Check if the data looks like SVG
    if (imageData.trim().includes('<svg')) {
      this.isSvgContent = true;
      this.displayContent = this.sanitizer.bypassSecurityTrustHtml(imageData);
    } else {
      // Data URIs and links (images in markdown) are used as they are;
      // anything else is raw base64.
      const prefix = /^(data:image\/|https?:|blob:)/.test(imageData) ?
          '' :
          'data:image/png;base64,';
      this.isSvgContent = false;
      this.displayContent =
          this.sanitizer.bypassSecurityTrustUrl(prefix + imageData);
    }
  }

  get transform(): string {
    return `translate(${this.offsetX}px, ${this.offsetY}px) scale(${
        this.scale})`;
  }

  get zoomPercent(): number {
    return Math.round(this.scale * 100);
  }

  zoomIn() {
    this.zoomTo(this.scale * BUTTON_ZOOM_STEP);
  }

  zoomOut() {
    this.zoomTo(this.scale / BUTTON_ZOOM_STEP);
  }

  resetZoom() {
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  toggleZoom() {
    if (this.scale === 1) {
      this.zoomTo(2);
    } else {
      this.resetZoom();
    }
  }

  onWheel(event: WheelEvent) {
    event.preventDefault();
    this.zoomTo(this.scale * Math.pow(1.002, -event.deltaY));
  }

  startDrag(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    this.isDragging = true;
    this.dragStart = {
      x: event.clientX,
      y: event.clientY,
      offsetX: this.offsetX,
      offsetY: this.offsetY,
    };
  }

  @HostListener('document:pointermove', ['$event'])
  drag(event: PointerEvent) {
    if (!this.isDragging) return;
    this.offsetX = this.dragStart.offsetX + event.clientX - this.dragStart.x;
    this.offsetY = this.dragStart.offsetY + event.clientY - this.dragStart.y;
  }

  @HostListener('document:pointerup')
  endDrag() {
    this.isDragging = false;
  }

  private zoomTo(scale: number) {
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    if (this.scale === 1) {
      this.offsetX = 0;
      this.offsetY = 0;
    }
  }

  /**
   * Closes the dialog.
   */
  close(): void {
    this.dialogRef.close();
  }
}