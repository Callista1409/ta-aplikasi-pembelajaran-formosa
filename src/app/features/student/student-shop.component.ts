import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, OnDestroy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StudentLearningService } from './student-learning.service';
import { MascotDisplayComponent } from './mascot-display.component';

@Component({
  selector:'app-student-shop',
  imports: [MascotDisplayComponent, RouterLink, NgTemplateOutlet],
  templateUrl: './student-shop.component.html',
  styleUrl: './student-shop.component.scss',
})
export class StudentShopComponent implements OnDestroy {
  protected readonly learning = inject(StudentLearningService);
  protected readonly accessories = computed(() => this.learning.accessories());

  private readonly localPreviewAssets: Record<string, string> = {
    ribbon: 'assets/Preview_acc_ribbon.png',
    glasses: 'assets/Preview_acc_blackglasses.png',
    blackglasses: 'assets/Preview_acc_blackglasses.png',
    hat: 'assets/Preview_acc_hat.png',
    leaf: 'assets/Preview_acc_leaf.png',
    mask: 'assets/Preview_acc_mask.png',
    crown: 'assets/Preview_acc_crown.png',
    star: 'assets/Preview_acc_starclip.png',
    starclip: 'assets/Preview_acc_starclip.png',
  };

  ngOnDestroy(): void {
    this.learning.clearAccessoryPreview();
  }

  protected accessoryAsset(item: { id: string; previewUrl?: string }): string | null {
    if (item.previewUrl) return item.previewUrl;
    if (this.localPreviewAssets[item.id]) return this.localPreviewAssets[item.id];
    const assets: Record<string, string> = {
      ribbon: 'assets/acc_ribbon.PNG',
      glasses: 'assets/acc_blackglasses.PNG',
      hat: 'assets/acc_hat.PNG',
      leaf: 'assets/acc_leaf.PNG',
      mask: 'assets/acc_mask.PNG',
      crown: 'assets/acc_crown.PNG',
      star: 'assets/acc_starclip.PNG',
      starclip: 'assets/acc_starclip.PNG',
      blackglasses: 'assets/acc_blackglasses.PNG',
    };
    return assets[item.id] ?? null;
  }

  protected isLocalPreviewAsset(item: { id: string; previewUrl?: string }): boolean {
    return !!item.previewUrl || !!this.localPreviewAssets[item.id];
  }

  protected accessoryKind(item: { id: string; name: string; icon: string }): string {
    const value = `${item.id} ${item.name} ${item.icon}`.toLowerCase();
    if (value.includes('glass') || value.includes('kacamata')) return 'glasses';
    if (value.includes('hat') || value.includes('topi')) return 'hat';
    if (value.includes('ribbon') || value.includes('pita')) return 'ribbon';
    if (value.includes('star') || value.includes('bintang')) return 'star';
    return 'flower';
  }

  protected isGlassesEquipped(): boolean {
    return this.learning.accessories().some((item) => item.equipped && this.accessoryKind(item) === 'glasses');
  }

}
