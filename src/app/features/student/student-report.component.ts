import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { StudentLearningService } from './student-learning.service';

@Component({
  selector: 'app-student-report',
  imports: [FormsModule, RouterLink],
  template: `
    <header class="page-header student-page-header report-header">
      <a class="student-back-button" routerLink="../dashboard" title="Kembali ke dashboard" aria-label="Kembali ke dashboard">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6" /></svg>
      </a>
      <div class="report-heading">
        <span class="report-eyebrow">Perkembanganmu</span>
        <h1>Raport Belajar</h1>
        <p>Ringkasan perjalanan belajar berdasarkan rentang tanggal yang dipilih.</p>
        <div class="range-picker">
          <div class="range-title"><span>Pilih periode laporan</span><small>Data akan diperbarui otomatis</small></div>
          <label>Tanggal mulai<input type="date" [ngModel]="startDateId()" (ngModelChange)="startDateId.set($event)" /></label>
          <label>Tanggal akhir<input type="date" [ngModel]="endDateId()" (ngModelChange)="endDateId.set($event)" /></label>
        </div>
      </div>
    </header>

    @if (learning.activityError()) { <p class="speech-message error" role="alert">{{ learning.activityError() }}</p> }

    <section class="summary-grid report-summary">
      <article class="summary-card report-summary-card vocabulary"><span class="summary-icon" aria-hidden="true">Aa</span><div><strong>{{ report().vocabulary }}</strong><span>Kosakata dipelajari</span></div></article>
      <article class="summary-card report-summary-card questions"><span class="summary-icon" aria-hidden="true">✓</span><div><strong>{{ report().questions }}</strong><span>Soal dikerjakan</span></div></article>
      <article class="summary-card report-summary-card points"><span class="summary-icon" aria-hidden="true"><img class="star-icon" src="assets/Star%20Icon.png" alt=""></span><div><strong>{{ report().earnedPoints }}</strong><span>Poin diperoleh pada rentang ini</span></div></article>
    </section>

    <section class="panel report-panel">
      <header class="report-panel-heading">
        <div><span class="report-eyebrow">Aktivitas belajar</span><h2>Aktivitas per Kategori</h2></div>
        <span class="report-period">{{ startDateId() }} – {{ endDateId() }}</span>
      </header>
      <div class="report-target-row">
        <label class="report-target" for="report-target-count">Target soal per kategori
          <input id="report-target-count" type="number" min="1" step="1" inputmode="numeric" [ngModel]="progressTarget()" (ngModelChange)="setProgressTarget($event)" />
        </label>
      </div>
      <div class="report-list">
        @for (item of report().categories; track item.name) {
          <div class="report-row">
            <div class="category-label"><i aria-hidden="true"></i><span>{{ item.name }}</span></div>
            <div class="progress-track" role="progressbar" [attr.aria-label]="item.name" [attr.aria-valuemin]="0" [attr.aria-valuemax]="progressTarget()" [attr.aria-valuenow]="progressValue(item.total)" [attr.aria-valuetext]="item.total + ' dari ' + progressTarget() + ' soal'">
              <i [style.width.%]="progressPercent(item.total)"></i>
            </div>
            <b>{{ item.total }} / {{ progressTarget() }} soal</b>
          </div>
        }
      </div>
    </section>
  `,
  styles: `
    .student-page-header { align-items: start; justify-content: flex-start; }
    .report-heading { flex: 1; min-width: 0; text-align: left; }
    .report-eyebrow { display: block; margin-bottom: 5px; color: #a44c45; font-size: 11px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
    .report-heading h1 { margin-bottom: 5px; }
    .report-heading p { margin-bottom: 0; }
    .range-picker { display: grid; grid-template-columns: repeat(2, minmax(145px, 1fr)); gap: 10px; width: min(100%, 440px); margin-top: 16px; border: 1px solid #f0d2cb; border-radius: 12px; padding: 12px; background: #fff7f4; }
    .range-title { grid-column: 1/-1; display: flex; justify-content: space-between; align-items: baseline; gap: 10px; color: var(--ink); font-size: 13px; font-weight: 900; }
    .range-title small { color: var(--muted); font-size: 10px; font-weight: 600; }
    .range-picker label { display: grid; gap: 6px; color: var(--muted); font-size: 11px; font-weight: 800; }
    .range-picker input { box-sizing: border-box; width: 100%; min-height: 40px; border: 1px solid #e8c5be; border-radius: 8px; padding: 8px 9px; color: var(--ink); background: #fff; font: inherit; }
    .range-picker input:focus-visible { outline: 3px solid rgb(152 73 67 / 18%); outline-offset: 2px; border-color: var(--brand); }
    .report-summary { margin-bottom: 16px; }
    .report-summary-card { display: flex; align-items: center; gap: 12px; min-height: 78px; padding: 14px 16px; }
    .report-summary-card > div { display: grid; gap: 4px; }
    .report-summary-card strong { font-size: 27px; line-height: 1; }
    .summary-icon { display: grid; place-items: center; flex: 0 0 38px; width: 38px; height: 38px; border-radius: 11px; font-size: 15px; font-weight: 900; }
    .report-summary-card.vocabulary { border-color: #9bcfe3; background: #f0fbff; }
    .report-summary-card.vocabulary .summary-icon { color: #236780; background: #cceefa; }
    .report-summary-card.questions { border-color: #9fcdbd; background: #f2fbf6; }
    .report-summary-card.questions .summary-icon { color: #236352; background: #ccebdd; }
    .report-summary-card.points { border-color: #e8c477; background: #fff9ed; }
    .report-summary-card.points .summary-icon { color: #8a5b08; background: #ffe5a8; }
    .summary-icon .star-icon { display: block; width: 24px; height: 24px; object-fit: contain; }
    .report-panel { padding: 20px; }
    .report-panel-heading { display: flex; justify-content: space-between; align-items: end; gap: 18px; margin-bottom: 20px; }
    .report-panel-heading h2 { margin: 0; font-size: 22px; }
    .report-target-row { display: flex; justify-content: flex-start; margin-top: 14px; }
    .report-target { display: grid; gap: 5px; color: var(--muted); font-size: 11px; font-weight: 800; }
    .report-target input { box-sizing: border-box; width: 88px; min-height: 36px; border: 1px solid #e8c5be; border-radius: 8px; padding: 6px 9px; color: var(--ink); background: #fff; font: inherit; font-size: 14px; }
    .report-target input:focus-visible { outline: 3px solid rgb(152 73 67 / 18%); outline-offset: 2px; border-color: var(--brand); }
    .report-period { border-radius: 999px; padding: 6px 10px; color: #7b4c1d; background: #fff1d2; font-size: 11px; font-weight: 800; white-space: nowrap; }
    .report-list { display: grid; gap: 11px; }
    .report-row { display: grid; grid-template-columns: 112px 1fr auto; align-items: center; gap: 14px; padding: 10px 0; }
    .category-label { display: flex; align-items: center; gap: 8px; color: var(--ink); font-weight: 800; }
    .category-label > i { display: block; width: 9px; height: 9px; border-radius: 50%; background: #57a9c4; box-shadow: 0 0 0 4px #e1f4fa; }
    .report-row:nth-child(2) .category-label > i { background: #5db7a7; box-shadow: 0 0 0 4px #e0f4ed; }
    .report-row:nth-child(3) .category-label > i { background: #e3a738; box-shadow: 0 0 0 4px #fff1d2; }
    .report-row:nth-child(4) .category-label > i { background: #a574c4; box-shadow: 0 0 0 4px #f0e6f7; }
    .progress-track { height: 10px; border-radius: 999px; overflow: hidden; background: #f0e9e7; }
    .progress-track > i { display: block; height: 100%; min-width: 0; border-radius: inherit; background: #57a9c4; transition: width .3s ease; }
    .report-row:nth-child(2) .progress-track > i { background: #5db7a7; }
    .report-row:nth-child(3) .progress-track > i { background: #e3a738; }
    .report-row:nth-child(4) .progress-track > i { background: #a574c4; }
    .report-row b { min-width: 62px; color: var(--muted); font-size: 12px; text-align: right; }
    @media (max-width: 760px) { .student-page-header { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: 12px; } .report-heading { grid-column: 2; } .range-picker { grid-template-columns: repeat(2, minmax(145px, 1fr)); width: 100%; min-width: 0; margin-left: 0; } .report-panel-heading { align-items: start; } }
    @media (max-width: 620px) { .range-picker { grid-template-columns: 1fr; } .range-title { align-items: start; flex-direction: column; gap: 3px; } .report-row { grid-template-columns: 1fr auto; gap: 8px 12px; } .category-label { grid-column: 1/-1; } .progress-track { grid-column: 1; } .report-row b { grid-column: 2; } .report-period { font-size: 10px; } }
    @media(max-width:760px) {
      .report-panel-heading { flex-wrap:wrap; gap:10px; }
      .report-target-row { justify-content:flex-start; }
      .report-period { max-width:100%; white-space:normal; overflow-wrap:anywhere; }
      .report-target input { min-height:44px; font-size:16px; }
      .range-picker input { min-width:0; min-height:44px; font-size:16px; }
      .report-summary { grid-template-columns:1fr; }
      .report-summary-card > div { min-width:0; }
    }
  `,
})
export class StudentReportComponent {
  protected readonly learning = inject(StudentLearningService);
  private readonly auth = inject(AuthService);
  protected readonly startDateId = signal(this.firstDayOfCurrentMonth());
  protected readonly endDateId = signal(this.dateId(new Date()));
  protected readonly progressTarget = signal(16);
  protected readonly report = computed(() => this.learning.dateRangeReport(this.startDateId(), this.endDateId()));

  constructor() {
    effect(() => {
      const uid = this.auth.profile()?.uid;
      if (uid) this.progressTarget.set(this.readProgressTarget(uid));
    });
    effect(() => {
      this.learning.pointsLoaded();
      const start = this.startDateId();
      const end = this.endDateId();
      void this.learning.loadActivityRange(start, end);
    });
  }

  protected setProgressTarget(value: number | null): void {
    const target = Number(value);
    if (!Number.isSafeInteger(target) || target < 1) return;

    this.progressTarget.set(target);
    const uid = this.auth.profile()?.uid;
    if (!uid || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.progressTargetStorageKey(uid), String(target));
    } catch {
      // The target remains available for this page view if browser storage is unavailable.
    }
  }

  protected progressPercent(total: number): number {
    return Math.min(100, (total / this.progressTarget()) * 100);
  }

  protected progressValue(total: number): number {
    return Math.min(Math.max(total, 0), this.progressTarget());
  }

  private readProgressTarget(uid: string): number {
    if (typeof localStorage === 'undefined') return 16;
    try {
      const stored = Number(localStorage.getItem(this.progressTargetStorageKey(uid)));
      return Number.isSafeInteger(stored) && stored > 0 ? stored : 16;
    } catch {
      return 16;
    }
  }

  private progressTargetStorageKey(uid: string): string {
    return `formosa:student-report-target:${uid}`;
  }

  private dateId(date: Date): string {
    return `${date.getFullYear()}-${this.pad(date.getMonth() + 1)}-${this.pad(date.getDate())}`;
  }

  private firstDayOfCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${this.pad(now.getMonth() + 1)}-01`;
  }

  private pad(value: number): string { return String(value).padStart(2, '0'); }
}
