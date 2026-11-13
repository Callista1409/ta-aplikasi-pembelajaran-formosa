import { Component, Input, computed, inject } from '@angular/core';
import { StudentLearningService } from './student-learning.service';

type MascotVariant = 'default' | 'study' | 'mulai-quiz' | 'quiz-terbuka' | 'quiz-terkunci' | 'benar' | 'salah' | 'rapor';

@Component({
  selector: 'app-mascot-display',
  template: `
    <div class="mascot-canvas">
      <img class="mascot-base" [src]="baseSources[variant]" alt="Maskot panda">
      @for (layer of equippedLayers(); track layer.id) {
        <img class="mascot-layer" [src]="layer.src" [alt]="''" aria-hidden="true">
      }
    </div>
  `,
  styles: [`
    :host { display: block; width: 100%; height: 100%; }
    .mascot-canvas { position: relative; width: 100%; height: 100%; }
    .mascot-base, .mascot-layer { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: contain; }
    .mascot-base { inset: 0; z-index: 1; width: 100%; height: 100%; }
    .mascot-layer { z-index: 2; pointer-events: none; }
  `],
})
export class MascotDisplayComponent {
  private readonly learning = inject(StudentLearningService);

  @Input() variant: MascotVariant = 'default';

  protected readonly baseSources: Record<MascotVariant, string> = {
    default: 'assets/panda_default.PNG',
    study: 'assets/panda_study.png',
    'mulai-quiz': 'assets/panda_mulaiquiz.png',
    'quiz-terbuka': 'assets/panda_quizterbuka.png',
    'quiz-terkunci': 'assets/panda_quizterkunci.png',
    benar: 'assets/panda_benar.png',
    salah: 'assets/panda_salah.png',
    rapor: 'assets/panda_raporbulanan.png',
  };

  private readonly accessorySources: Record<string, string> = {
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

  protected readonly equippedLayers = computed(() => {
    const previewId = this.learning.previewAccessoryId();
    const activeItems = previewId
      ? this.learning.accessories().filter((item) => item.id === previewId)
      : this.learning.accessories().filter((item) => item.equipped);
    return activeItems
      .map((item) => ({ id: item.id, src: item.accessoryUrl ?? this.accessorySources[item.id] }))
      .filter((item): item is { id: string; src: string } => Boolean(item.src));
  });
}
