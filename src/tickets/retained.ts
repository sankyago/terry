/**
 * Аудит початкових 250 сцен: у кожній учень їхав останнім.
 * Залишаємо 70 різних навчальних випадків (28 % кожного рівня), а повтори замінюємо
 * сценами з перевагою учня та змішаною чергою з priority.ts.
 * Початкові шаблони залишаються джерелом геометрії для складених сцен hard.ts.
 */
export const RETAINED_LAST = new Set([
  // 14 легких: виїзд із двору, права рука, лівий поворот, знаки, світлофор, пішохід.
  'yard-right', 'yard-left-far', 'yard-left-near', 'yard-pedestrian',
  'equal-right', 'equal-left-oncoming', 'equal-left-car-right',
  'giveway-left-car-left', 'stop-right-car-left',
  'signal-left-oncoming', 'signal-right-turn-ped', 'signal-clearing-bus', 'signal-flash-equal',
  'crosswalk-blind',
  // 28 середніх: кілька потоків, проспекти, розвороти, видима небезпека.
  'yard-cyclist', 'stop-left-car-left', 'main-left-ped', 'avenue-left-oncoming-far-lane',
  'uturn-signal-oncoming', 'uturn-equal-right', 'signal-left-oncoming-two', 'giveway-straight-two', 'yard-left-two-cars',
  'avenue-lane-change-right', 'avenue-lane-change-left', 'avenue-simultaneous', 'avenue-bus-departs',
  'avenue-crosswalk-hidden', 'avenue-right-hook', 'main-violator-left', 'signal-red-ped-runner',
  'cyclist-crosswalk-ride', 'child-bike', 'reverse-from-yard', 'roadworks-occupied', 'kid-ball-left',
  'crosswalk-stroller', 'uturn-main-oncoming-right-turn', 'giveway-main-left-turner', 'main-crosswalk-far',
  'signal-left-oncoming-and-ped', 'oncoming-bypass',
  // 28 складних: винятки, обмежена видимість, поєднання обов’язків.
  'hard-left-second-oncoming', 'hard-main-both-streams',
  'hard-green-over-priority', 'hard-stop-is-not-priority', 'hard-uturn-green-stop-sign',
  'hard-bike-zebra-no-license-to-hit', 'hard-bikepath-without-zebra',
  'hard-merge-indicator-first', 'hard-merge-left-right-hand-trap', 'hard-bus-stop-duty-both',
  'hard-ambulance-secondary', 'hard-ambulance-ordinary-right', 'hard-main-violator-obvious',
  'hard-turn-no-zebra', 'hard-main-left-no-zebra', 'hard-blind-not-only-zebra',
  'hard-zebra-adjacent-not-merging', 'hard-zebra-group-not-one', 'hard-obstacle-other-side',
  'hard-obstacle-bike-interval', 'hard-narrowing-already-entered',
  'hard-compound-equal-three', 'hard-compound-right-bike-ped', 'hard-compound-green-ambulance-ped',
  'hard-compound-uturn-two', 'hard-compound-yard-three', 'hard-compound-yard-right-bike', 'hard-compound-yard-bus-ped',
]);
