import { Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild } from '@angular/core';

export interface UiSelectOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-ui-select',
  template: `
    <div class="ui-select" (click)="$event.stopPropagation()">
      <button
        type="button"
        class="ui-select__trigger"
        [attr.aria-label]="ariaLabel"
        [attr.aria-expanded]="open"
        (click)="toggle()"
      >
        <span>{{ selectedLabel }}</span>
        <i aria-hidden="true" [class.open]="open"></i>
      </button>

      @if (open) {
        <div #menu class="ui-select__menu" role="listbox">
          @for (option of options; track option.value) {
            <button
              type="button"
              role="option"
              [class.active]="option.value === value"
              [attr.aria-selected]="option.value === value"
              (click)="choose(option.value)"
            >
              {{ option.label }}
              @if (option.value === value) { <span aria-hidden="true">&#10003;</span> }
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .ui-select { position: relative; }
    button { border: 0; font: inherit; cursor: pointer; }
    .ui-select__trigger {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      width: 100%;
      min-height: 44px;
      border: 1px solid var(--line);
      border-radius: 7px;
      padding: 8px 12px;
      color: var(--ink);
      background: #fff;
      text-align: left;
      font-weight: 750;
    }
    .ui-select__trigger:hover { border-color: var(--brand); background: var(--brand-soft); }
    .ui-select__trigger > span { min-width: 0; overflow-wrap: anywhere; }
    .ui-select__trigger i { flex-shrink: 0; }
    .ui-select__trigger:focus-visible { outline: 3px solid color-mix(in srgb, var(--brand) 22%, transparent); outline-offset: 2px; }
    .ui-select__trigger i {
      width: 8px;
      height: 8px;
      border-right: 2px solid currentColor;
      border-bottom: 2px solid currentColor;
      transform: translateY(-2px) rotate(45deg);
      transition: transform 160ms ease;
    }
    .ui-select__trigger i.open { transform: translateY(2px) rotate(225deg); }
    .ui-select__menu {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      z-index: 30;
      display: grid;
      width: 100%;
      min-width: 0;
      max-height: 190px;
      overflow-y: auto;
      scrollbar-gutter: stable;
      border: 1px solid var(--line);
      border-radius: 7px;
      padding: 5px;
      background: #fff;
      box-shadow: 0 12px 30px rgb(0 0 0 / 12%);
    }
    .ui-select__menu::-webkit-scrollbar { width: 8px; }
    .ui-select__menu::-webkit-scrollbar-thumb { border: 2px solid #fff; border-radius: 999px; background: var(--brand); }
    .ui-select__menu::-webkit-scrollbar-track { border-radius: 999px; background: #eef3f7; }
    .ui-select__menu button {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      border-radius: 5px;
      padding: 9px 10px;
      color: var(--ink);
      background: #fff;
      text-align: left;
      min-height: 44px;
      overflow-wrap: anywhere;
    }
    .ui-select__menu button:hover,
    .ui-select__menu button.active { color: var(--brand-dark); background: var(--brand-soft); }
  `,
})
export class UiSelectComponent {
  @Input() options: UiSelectOption[] = [];
  @Input() value = '';
  @Input() ariaLabel = 'Pilih opsi';
  @Output() readonly valueChange = new EventEmitter<string>();

  @ViewChild('menu') private menu?: ElementRef<HTMLElement>;

  protected open = false;

  protected toggle(): void {
    this.open = !this.open;
    if (!this.open) return;

    setTimeout(() => {
      this.menu?.nativeElement.querySelector<HTMLElement>('.active')?.scrollIntoView({ block: 'center' });
    });
  }

  protected get selectedLabel(): string {
    return this.options.find((option) => option.value === this.value)?.label ?? this.options[0]?.label ?? '';
  }

  protected choose(value: string): void {
    this.valueChange.emit(value);
    this.open = false;
  }

  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  protected close(): void {
    this.open = false;
  }
}
