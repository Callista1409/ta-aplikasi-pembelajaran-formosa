import { Location, PlatformLocation } from '@angular/common';
import { MockPlatformLocation } from '@angular/common/testing';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ContentDataService } from '../../core/services/content-data.service';
import { WebSpeechService } from '../../core/services/web-speech.service';
import { StudentLearningService } from './student-learning.service';
import { StudentPosttestService } from './student-posttest.service';
import { StudentLessonComponent } from './student-lesson.component';

describe('Student lesson navigation', () => {
  let lesson: StudentLessonComponent;
  let router: Router;
  let location: Location;
  const speech = { cancelSpeech: jasmine.createSpy(), cancelRecognition: jasmine.createSpy() };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'lesson', component: StudentLessonComponent }]),
        { provide: PlatformLocation, useClass: MockPlatformLocation },
        { provide: ContentDataService, useValue: {
          pointForCategory: () => 1, users: () => [], units: () => [],
          flashcards: () => [], currentUserId: () => '', loadedUnits: () => new Set<string>(),
        } },
        { provide: WebSpeechService, useValue: speech },
        { provide: StudentLearningService, useValue: {} },
        { provide: StudentPosttestService, useValue: {} },
      ],
    }).overrideComponent(StudentLessonComponent, { set: { template: '', imports: [] } });
    const harness = await RouterTestingHarness.create();
    lesson = await harness.navigateByUrl('/lesson', StudentLessonComponent);
    router = TestBed.inject(Router);
    location = TestBed.inject(Location);
  });

  it('restores the unit and page from a link', async () => {
    await router.navigateByUrl('/lesson?step=cards&unit=greetings');
    expect(lesson['step']()).toBe('cards');
    expect(lesson['selectedUnitId']()).toBe('greetings');
  });

  it('uses browser history for the back button after selecting a unit', async () => {
    await router.navigateByUrl('/lesson?step=cards', { state: { lessonParent: 'units' } });
    const back = spyOn(location, 'back');
    lesson['backTo']('units');
    expect(back).toHaveBeenCalled();
  });

  it('walks back through cards, units and intro instead of leaving the lesson', fakeAsync(() => {
    router.setUpLocationChangeListener();
    void router.navigateByUrl('/lesson?step=units');
    tick();
    void router.navigateByUrl('/lesson?step=cards&unit=greetings');
    tick();
    for (const expected of ['units', 'intro']) {
      location.back();
      tick();
      expect(lesson['step']()).toBe(expected);
    }
  }));

  it('closes the stroke dialog when Back restores the flashcard URL', async () => {
    await router.navigateByUrl('/lesson?step=cards&dialog=strokes');
    expect(lesson['strokeMode']()).toBeTrue();
    await router.navigateByUrl('/lesson?step=cards');
    expect(lesson['step']()).toBe('cards');
    expect(lesson['strokeMode']()).toBeFalse();
  });

  it('returns to cards if a refreshed test URL has no practice session', async () => {
    await router.navigateByUrl('/lesson?step=test');
    expect(lesson['step']()).toBe('cards');
  });

  it('cleans up recording when navigating back out of a test', async () => {
    lesson['step'].set('test');
    speech.cancelRecognition.calls.reset();
    speech.cancelSpeech.calls.reset();
    await router.navigateByUrl('/lesson?step=cards');
    expect(speech.cancelRecognition).toHaveBeenCalled();
    expect(speech.cancelSpeech).toHaveBeenCalled();
  });
});
