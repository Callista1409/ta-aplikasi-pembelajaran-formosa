import { Component, input } from '@angular/core';

export interface DashboardStat {
  label: string;
  value: string;
  description: string;
}

@Component({
  selector: 'app-dashboard-page',
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.scss',
})
export class DashboardPageComponent {
  readonly eyebrow = input.required<string>();
  readonly title = input.required<string>();
  readonly description = input.required<string>();
  readonly stats = input.required<DashboardStat[]>();
}
