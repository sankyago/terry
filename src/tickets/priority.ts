import { CW, O, STOP, STOP_RIGHT, STOP_SIGNAL, drive, lane, prioritySigns, walk } from './local';
import type { ActorSpec, Arm, Control, Difficulty, NodeTemplate, RankedTicketTemplate, TicketOption, TicketTemplate, Turn } from './types';

/**
 * Черговість за ПДР, а не вимога наполягати на перевазі в небезпечній ситуації.
 * У нових сценах інші водії дотримуються правил; явні порушники залишаються в окремих білетах.
 * Джерело: https://zakon.rada.gov.ua/laws/show/1306-2001-%D0%BF (10.2, 10.3, 16.6, 16.11–16.13).
 */
interface Case {
  id: string;
  title: string;
  control: Control;
  turn: Turn;
  from: Arm;
  to: Arm;
  situation: string;
  reason: string;
  rule: string;
  lanes?: 2 | 3;
  signs?: NodeTemplate['signs'];
  before?: 'pedestrian' | 'oncoming' | 'right' | 'ambulance';
}

interface Participant {
  id: string;
  name: string;
  kind: ActorSpec['kind'];
  model?: ActorSpec['model'];
}
const PARTICIPANTS: Participant[] = [
  { id: 'car', name: 'легковий автомобіль', kind: 'car', model: 'sedan' },
  { id: 'bus', name: 'автобус поза зупинкою', kind: 'bus' },
  { id: 'bicycle', name: 'велосипедист на проїзній частині', kind: 'cyclist' },
  { id: 'ambulance', name: 'швидка без увімкнених маячків і сирени', kind: 'ambulance' },
];
const MAIN = 'Перевага головної діє незалежно від напрямку повороту й розташування іншого транспорту справа чи зліва.';
const EQUAL = 'Інший учасник наближається зліва; ви для нього справа. На рівнозначних дорогах він має дати вам дорогу.';
const ONCOMING = 'Зустрічний повертає ліворуч, а ви їдете прямо або праворуч, тому саме він має дати вам дорогу.';
const GOOD = 'Усі водії дотримуються правил, інших учасників немає, перехрестя не заблоковане. Яка черговість за ПДР?';

const EASY: Case[] = [
  { id: 'equal-west-straight', title: 'Ваша перешкода зліва', control: 'equal', turn: 'straight', from: 'W', to: 'E', situation: 'Рівнозначні дороги без світлофора. Ви прямо. Зліва через перехрестя прямо рухається', reason: EQUAL, rule: '16.12' },
  { id: 'equal-west-right', title: 'Праворуч перед транспортом зліва', control: 'equal', turn: 'right', from: 'W', to: 'E', situation: 'Рівнозначне перехрестя. Ви повертаєте праворуч. Зліва прямо на ту саму дорогу рухається', reason: EQUAL, rule: '16.12' },
  { id: 'equal-west-left', title: 'Ліворуч із перевагою справа', control: 'equal', turn: 'left', from: 'W', to: 'E', situation: 'Рівнозначне перехрестя. Ви ліворуч, зустрічних немає. Зліва прямо рухається', reason: EQUAL, rule: '16.12' },
  { id: 'equal-oncoming-left-straight', title: 'Прямо перед зустрічним лівим', control: 'equal', turn: 'straight', from: 'N', to: 'E', situation: 'Рівнозначне перехрестя. Ви прямо. Назустріч із лівим поворотом через вашу траєкторію —', reason: ONCOMING, rule: '16.13' },
  { id: 'equal-oncoming-left-right', title: 'Правий проти зустрічного лівого', control: 'equal', turn: 'right', from: 'N', to: 'E', situation: 'Рівнозначне перехрестя. Ви праворуч. Назустріч ліворуч на ту саму дорогу повертає', reason: ONCOMING, rule: '16.13' },
  { id: 'main-west-straight', title: 'Головною прямо, транспорт зліва', control: 'main', turn: 'straight', from: 'W', to: 'E', situation: 'Ви прямо головною. Зліва з другорядної перетинає вашу дорогу', reason: MAIN, rule: '16.11' },
  { id: 'main-west-right', title: 'З головної праворуч першим', control: 'main', turn: 'right', from: 'W', to: 'E', situation: 'Ви праворуч із головної. Зліва з другорядної прямо на дорогу вашого повороту їде', reason: MAIN, rule: '16.11' },
  { id: 'main-west-left', title: 'Головна перед лівим поворотом', control: 'main', turn: 'left', from: 'W', to: 'E', situation: 'Ви ліворуч із головної, зустрічних немає. Зліва з другорядної прямо —', reason: MAIN, rule: '16.11' },
  { id: 'main-east-straight', title: 'Справа, але з другорядної', control: 'main', turn: 'straight', from: 'E', to: 'W', situation: 'Ви прямо головною. Справа з другорядної прямо рухається', reason: MAIN, rule: '16.11' },
  { id: 'main-east-left', title: 'Лівий поворот із головної', control: 'main', turn: 'left', from: 'E', to: 'W', situation: 'Ви ліворуч із головної, зустрічних немає. Справа з другорядної прямо на дорогу вашого повороту їде', reason: MAIN, rule: '16.11' },
  { id: 'green-oncoming-left-right', title: 'Зелений: правий перед лівим', control: 'signal', turn: 'right', from: 'N', to: 'E', situation: 'Обом зустрічним напрямкам основний зелений. Ви праворуч, назустріч ліворуч на ту саму дорогу —', reason: ONCOMING, rule: '16.6' },
  { id: 'green-oncoming-left-straight', title: 'Зелений: прямий перед лівим', control: 'signal', turn: 'straight', from: 'N', to: 'E', situation: 'Основний зелений обом зустрічним напрямкам. Ви прямо, назустріч ліворуч —', reason: ONCOMING, rule: '16.6' },
];

const MEDIUM: Case[] = [
  { ...EASY[0], id: 'flash-west-straight', title: 'Миготіння: перевага справа', control: 'flash', situation: 'Миготливий жовтий без знаків пріоритету. Ви прямо, зліва прямо рухається', rule: '16.1, 16.12' },
  { ...EASY[1], id: 'flash-west-right', title: 'Миготіння: правий поворот першим', control: 'flash', situation: 'Миготливий жовтий без знаків. Ви праворуч, зліва прямо на ту саму дорогу їде', rule: '16.1, 16.12' },
  { ...EASY[2], id: 'flash-west-left', title: 'Миготіння: лівий перед лівим сусідом', control: 'flash', situation: 'Миготливий жовтий без знаків. Ви ліворуч, зустрічних немає, зліва прямо —', rule: '16.1, 16.12' },
  { ...EASY[3], id: 'secondary-oncoming-left-straight', title: 'Між двома другорядними', control: 'giveWay', situation: 'Ви й зустрічний на другорядній, головна вільна. Ви прямо, назустріч ліворуч —', reason: 'Між транспортом на другорядних дорогах діють правила рівнозначних доріг. ' + ONCOMING, rule: '16.11, 16.13' },
  { ...EASY[4], id: 'secondary-oncoming-left-right', title: 'З другорядної праворуч перед лівим', control: 'giveWay', situation: 'Обидва зустрічні під’їзди другорядні, головна вільна. Ви праворуч, назустріч ліворуч на ту саму дорогу —', reason: 'Між транспортом на другорядних дорогах діють правила рівнозначних доріг. ' + ONCOMING, rule: '16.11, 16.13' },
  { ...EASY[3], id: 'stop-oncoming-left-straight', title: 'Після STOP черга не за прибуттям', control: 'stop', situation: 'Ви вже зупинилися перед STOP. Обидва зустрічні під’їзди другорядні, головна вільна. Ви прямо, назустріч ліворуч —', reason: 'Обов’язкову зупинку виконано; порядок прибуття до STOP не замінює правил роз’їзду. ' + ONCOMING, rule: '16.11, 16.13, 33.2.2' },
  { ...EASY[4], id: 'stop-oncoming-left-right', title: 'STOP: правий перед зустрічним лівим', control: 'stop', situation: 'Після повної зупинки перед STOP ви праворуч. Зустрічний теж із другорядної ліворуч на ту саму дорогу; головна вільна. Це', reason: 'Після виконаної зупинки роз’їжджаєтеся між собою як на рівнозначних дорогах. ' + ONCOMING, rule: '16.11, 16.13, 33.2.2' },
  { ...EASY[5], id: 'avenue-main-east-straight', title: 'Проспект не змінює знаків', lanes: 2, from: 'E', to: 'W', situation: 'Ви прямо проспектом зі знаком головної. Справа з другорядної перетинає проспект', rule: '16.11' },
  { ...EASY[3], id: 'avenue-green-oncoming-left', title: 'Зустрічний перетинає дві смуги', control: 'signal', lanes: 2, situation: 'Ви прямо лівою смугою двосмугового проспекту на основний зелений. Назустріч на зелений ліворуч через ваш шлях —', rule: '16.6' },
  { ...EASY[3], id: 'flash-oncoming-left', title: 'Без знаків після вимкнення регулювання', control: 'flash', situation: 'Світлофор блимає жовтим, знаків пріоритету немає. Ви прямо, зустрічний повертає ліворуч. Це', rule: '16.1, 16.13' },
  { ...EASY[5], id: 'flash-main-west-straight', title: 'Миготливий на головній', control: 'flash', signs: prioritySigns(false, 'giveWay'), situation: 'Миготливий жовтий, перед вами «Головна дорога». Ви прямо, зліва з другорядної прямо —', rule: '16.1, 16.11' },
  { ...EASY[9], id: 'flash-main-east-left', title: 'Знаки працюють при миготінні', control: 'flash', signs: prioritySigns(false, 'giveWay'), situation: 'Миготливий жовтий, ви ліворуч із головної, зустрічних немає. Справа з другорядної прямо —', rule: '16.1, 16.11' },
  { ...EASY[3], id: 'equal-oncoming-ped', title: 'Пішохід, ви, зустрічний', before: 'pedestrian', situation: 'Рівнозначне перехрестя. Ви прямо, пішохід перетинає вашу дорогу на зебрі перед перехрестям. Назустріч ліворуч —', rule: '18.1, 16.13' },
  { ...EASY[5], id: 'main-west-ped', title: 'Пішохід перед перевагою головної', before: 'pedestrian', situation: 'Ви прямо головною, пішохід на зебрі перед перехрестям. Зліва з другорядної прямо —', rule: '18.1, 16.11' },
  { ...EASY[8], id: 'main-east-ped', title: 'Після пішохода — перед другорядною', before: 'pedestrian', situation: 'Ви прямо головною, перед вами пішохід на зебрі. Справа з другорядної прямо —', rule: '18.1, 16.11' },
  { ...EASY[9], id: 'main-left-oncoming', title: 'Зустрічний, ваш поворот, другорядна', before: 'oncoming', situation: 'Ви ліворуч із головної. Зустрічний автомобіль головною прямо. Справа з другорядної прямо —', rule: '16.11, 16.13' },
  { ...EASY[0], id: 'equal-both-sides', title: 'Справа, ви, зліва', before: 'right', situation: 'Рівнозначне перехрестя. Ви прямо, справа легковик прямо, зліва прямо —', rule: '16.12' },
  { ...EASY[5], id: 'main-west-emergency', title: 'Сирена, головна, другорядна', before: 'ambulance', situation: 'Ви прямо головною. Справа швидка з синім маячком і сиреною. Зліва з другорядної прямо —', rule: '3.2, 16.11' },
];

const HARD: Case[] = [
  { ...EASY[10], id: 'green-yield-sign-ignored', title: 'Зелений важливіший за ваш «Дати дорогу»', signs: prioritySigns(true, 'giveWay'), situation: 'Вам і зустрічному основний зелений, перед вами «Дати дорогу». Ви праворуч, назустріч ліворуч —', reason: 'На регульованому перехресті знаки пріоритету не визначають черговість. ' + ONCOMING, rule: '8.3, 16.6' },
  { ...EASY[11], id: 'green-stop-sign-ignored', title: 'STOP під основним зеленим', signs: prioritySigns(true, 'stop'), situation: 'Вам і зустрічному основний зелений. Перед вами STOP. Ви прямо, назустріч ліворуч —', reason: 'Працюючий світлофор визначає режим проїзду; знак STOP не змінює черговість на основний зелений. ' + ONCOMING, rule: '8.3, 16.6' },
  { ...EASY[2], id: 'left-vs-west-left', title: 'Два ліві, але не зустрічні', to: 'N', situation: 'Рівнозначне перехрестя. Ви повертаєте ліворуч. Зліва теж із лівим поворотом —', reason: 'Це не зустрічні ліві повороти: ви наближаєтеся під прямим кутом. ' + EQUAL, rule: '16.12' },
  { ...MEDIUM[5], id: 'flash-stop-oncoming-left', title: 'Миготіння й виконаний STOP', control: 'flash', signs: prioritySigns(true, 'stop'), situation: 'Миготливий жовтий, з обох зустрічних боків STOP; ви вже повністю зупинилися. Головна вільна. Ви прямо, зустрічний ліворуч —', rule: '16.1, 16.11, 16.13, 33.2.2' },
  { ...EASY[7], id: 'main-left-secondary-left', title: 'Лівий із головної перед лівим з другорядної', to: 'N', situation: 'Ви ліворуч із головної, зустрічних немає. Зліва з другорядної також ліворуч —', reason: 'Порівнюють статус доріг перед в’їздом на перехрестя. Ліві повороти не зрівнюють головну й другорядну. ' + MAIN, rule: '16.11' },
  { ...EASY[11], id: 'avenue-three-green-left', title: 'Зустрічний лівий через три смуги', lanes: 3, situation: 'Ви прямо крайньою лівою смугою трисмугового проспекту на основний зелений. Зустрічний також на зелений повертає ліворуч. Це', rule: '16.6' },
  { ...MEDIUM[12], id: 'equal-oncoming-two-points', title: 'Зебра перед зустрічним лівим', situation: 'Рівнозначне перехрестя: ви прямо, перед вами пішохід на зебрі. Зустрічний уже ввімкнув лівий покажчик і чекає. Це' },
  { ...MEDIUM[13], id: 'main-west-two-points', title: 'Головна не забирає переваги пішохода', situation: 'Ви прямо головною. Пішохід уже переходить перед перехрестям. Зліва з другорядної прямо під’їжджає і чекає', reason: 'Пішохідний перехід та пріоритет між автомобілями оцінюють окремо. ' + MAIN },
  { ...MEDIUM[14], id: 'main-east-two-points', title: 'Справа не означає наступний після пішохода', situation: 'Ви прямо головною, перед вами пішохід на зебрі. Праворуч із другорядної прямо стоїть', reason: 'Надання дороги пішоходу не передає вашу перевагу транспорту на другорядній. ' + MAIN },
  { ...MEDIUM[15], id: 'main-left-three', title: 'Головна: ви між двома потоками', situation: 'Ви ліворуч із головної. Зустрічний легковик прямо головною; справа з другорядної прямо, на ту саму дорогу вашого повороту, —', reason: 'Спочатку діє обов’язок пропустити зустрічний прямий рух. Після нього ви зберігаєте перевагу перед другорядною. ' + MAIN },
  { ...MEDIUM[16], id: 'equal-three-no-arrival-order', title: 'Троє: прибуття не створює черги', situation: 'Рівнозначне перехрестя, всі їдуть прямо. Справа легковик, а зліва раніше за всіх прибув', reason: 'Час прибуття не визначає перевагу: ви пропускаєте транспорт справа, а транспорт зліва пропускає вас.', rule: '16.12' },
  { ...MEDIUM[17], id: 'main-after-siren', title: 'Після сирени перевага зберігається', situation: 'Ви прямо головною. Справа оперативне авто із синім маячком і сиреною. Зліва з другорядної прямо чекає', reason: 'Проїзд швидкої не створює нової черги: після неї між вами й другорядною знову діє пріоритет головної.', rule: '3.2, 16.11' },
  { ...MEDIUM[12], id: 'green-oncoming-ped', title: 'Зелений: пішохід, ви, лівий поворот', control: 'signal', situation: 'Обом зустрічним напрямкам основний зелений, пішохід закінчує перехід перед вами. Ви прямо, назустріч ліворуч —', rule: '16.5, 16.6' },
  { ...MEDIUM[12], id: 'flash-equal-oncoming-ped', title: 'Миготіння: дві незалежні черги', control: 'flash', situation: 'Миготливий жовтий без знаків. Ви прямо, перед вами пішохід на зебрі, зустрічний ліворуч —', rule: '16.1, 18.1, 16.13' },
  { ...MEDIUM[13], id: 'flash-main-west-ped', title: 'Миготіння: пішохід перед головною', control: 'flash', signs: prioritySigns(false, 'giveWay'), situation: 'Миготливий жовтий, ви прямо головною. Пішохід на зебрі перед перехрестям; зліва з другорядної прямо —', rule: '16.1, 18.1, 16.11' },
  { ...MEDIUM[14], id: 'flash-main-east-ped', title: 'Миготіння: другорядна після вас', control: 'flash', signs: prioritySigns(false, 'giveWay'), situation: 'Миготливий жовтий, ваша дорога головна. Ви прямо, перед вами пішохід на зебрі; справа з другорядної прямо —', rule: '16.1, 18.1, 16.11' },
  { ...MEDIUM[15], id: 'flash-main-left-three', title: 'Миготіння: головна між потоками', control: 'flash', signs: prioritySigns(false, 'giveWay'), situation: 'Миготливий жовтий, ви ліворуч із головної. Зустрічний легковик прямо головною; справа прямо з другорядної —', rule: '16.1, 16.11, 16.13' },
  { ...MEDIUM[16], id: 'flash-equal-three', title: 'Миготіння: справа, ви, зліва', control: 'flash', situation: 'Миготливий жовтий, знаків немає, усі прямо. Справа легковик, зліва —', rule: '16.1, 16.12' },
];

function beforeActor(kind: Case['before'], turn: Turn): ActorSpec | null {
  if (kind === 'pedestrian') return { id: 'before', kind: 'pedestrian', path: walk([9, -CW], [-9, -CW]), speed: 1.3, gap: 2.5 };
  if (kind === 'oncoming') return { id: 'before', kind: 'car', path: drive('N', 'S'), speed: 10, gap: 13 };
  if (kind === 'right') return { id: 'before', kind: 'car', path: drive('E', 'W'), speed: 9, gap: 12 };
  if (kind === 'ambulance') return { id: 'before', kind: 'ambulance', siren: true, path: turn === 'right' ? drive('W', 'E') : drive('E', 'W'), speed: 12, gap: 16 };
  return null;
}

function optionsFor(before: Case['before'], index: number): TicketOption[] {
  const first = 'Проїжджаю першим, переконавшись, що мені дають дорогу';
  const middle = before === 'pedestrian' ? 'Пропускаю пішохода, потім проїжджаю перед іншим транспортом'
    : before === 'oncoming' ? 'Пропускаю зустрічний легковик, потім повертаю перед іншим транспортом'
    : before === 'right' ? 'Пропускаю легковик справа, потім проїжджаю перед транспортом зліва'
    : 'Пропускаю оперативне авто зі спецсигналами, потім проїжджаю перед іншим транспортом';
  const options: TicketOption[] = [
    { text: 'За ПДР я маю їхати останнім: пропускаю всіх учасників', correct: false, mistakeOnly: true },
    before ? { text: first, correct: false } : { text: 'За ПДР інший транспорт має перевагу через свій маневр або тип', correct: false, mistakeOnly: true },
  ];
  options.splice(index, 0, { text: before ? middle : first, correct: true });
  return options;
}

function makeTicket(c: Case, p: Participant, difficulty: Difficulty, index: number): RankedTicketTemplate {
  const before = beforeActor(c.before, c.turn);
  const after: ActorSpec = {
    id: 'after', kind: p.kind, model: p.model, color: '#3b6fd8', path: drive(c.from, c.to),
    speed: p.kind === 'cyclist' ? 5 : p.kind === 'bus' ? 8 : 9,
    // Довгий автобус зупиняється далі від конфлікту; жоден кузов не перекриває перехрестя.
    gap: p.kind === 'bus' ? 17 : 13, yieldsToEgo: true,
  };
  const prefix = before ? (c.before === 'pedestrian' ? 'Спершу даєте пішоходу закінчити перехід. ' : 'Спершу пропускаєте учасника, який має перевагу перед вами. ') : '';
  return {
    id: `${difficulty === 'hard' ? 'hard-' : ''}priority-${c.id}-${p.id}`,
    site: 'node', difficulty, title: c.title, control: c.control, turn: c.turn, lanes: c.lanes,
    laneIn: c.lanes ? 0 : undefined, laneOut: c.lanes ? 0 : undefined,
    question: `${c.situation} ${p.name}. ${before ? 'Учасник без переваги чекає перед перехрестям. ' : ''}${GOOD}`,
    options: optionsFor(c.before, index % 3),
    explanation: prefix + c.reason + ' Добровільне надання дороги можливе, але в запитанні потрібно визначити встановлену правилами черговість.',
    rule: `ПДР, п. ${c.rule}`,
    stopLine: before?.kind === 'pedestrian' ? { x: O, z: -CW - 2.2 }
      : c.lanes ? { x: lane(0), z: -8 } : c.control === 'signal' ? STOP_SIGNAL : c.turn === 'right' ? STOP_RIGHT : STOP,
    actors: [...(before ? [before] : []), after],
    signs: c.signs, autoCrosswalks: false,
    crosswalks: before?.kind === 'pedestrian' ? [{ x: 0, z: -CW, acrossEgoRoad: true }] : undefined,
  };
}

/** 36 легких, 72 середні й 72 складні: перший або між іншими учасниками. */
const REBALANCED_PRIORITY_TICKETS: RankedTicketTemplate[] = [
  ...EASY.flatMap((c, i) => PARTICIPANTS.slice(0, 3).map((p, j) => makeTicket(c, p, 'easy', i + j))),
  ...MEDIUM.flatMap((c, i) => PARTICIPANTS.map((p, j) => makeTicket(c, p, 'medium', i + j))),
  ...HARD.flatMap((c, i) => PARTICIPANTS.map((p, j) => makeTicket(c, p, 'hard', i + j))),
];

// Додаткові 100 білетів: нові траєкторії, виїзди з прилеглих територій і перестроювання.
const ADDITIONAL_EASY: Case[] = [
  { ...EASY[0], id: 'equal-west-turns-left', title: 'Прямо перед лівим із лівого рукава', to: 'N', situation: 'Рівнозначне перехрестя. Ви прямо; зліва ліворуч на вашу дорогу повертає' },
  { ...EASY[7], id: 'main-left-west-left', title: 'Ліворуч перед лівим із другорядної', to: 'N', situation: 'Ви ліворуч із головної, зустрічних немає. Зліва з другорядної ліворуч через вашу траєкторію повертає' },
  { ...EASY[8], id: 'main-east-turns-left', title: 'Головною перед лівим із другорядної', to: 'S', situation: 'Ви прямо головною. Справа з другорядної ліворуч через вашу траєкторію повертає' },
  { ...EASY[5], id: 'main-west-turns-left', title: 'Головною перед в’їздом у вашу смугу', to: 'N', situation: 'Ви прямо головною. Зліва з другорядної ліворуч у вашу смугу повертає' },
  { ...EASY[4], id: 'main-right-oncoming-left', title: 'Обидва з головної: правий перед лівим', control: 'main', situation: 'Обидва зустрічні напрямки на головній. Ви праворуч; назустріч ліворуч на ту саму дорогу повертає' },
  { ...EASY[3], id: 'main-straight-oncoming-left', title: 'Обидва з головної: прямо перед лівим', control: 'main', situation: 'Обидва зустрічні напрямки на головній. Ви прямо; назустріч ліворуч через вашу смугу повертає' },
];
const ADDITIONAL_MEDIUM: Case[] = [
  { ...ADDITIONAL_EASY[0], id: 'flash-west-turns-left', title: 'Миготіння перед бічним лівим', control: 'flash', situation: 'Миготливий жовтий без знаків. Ви прямо; зліва ліворуч на вашу дорогу повертає', rule: '16.1, 16.12' },
  { ...ADDITIONAL_EASY[2], id: 'flash-main-east-turns-left', title: 'Миготіння й бічний лівий із другорядної', control: 'flash', signs: prioritySigns(false, 'giveWay'), situation: 'Миготливий жовтий, ви прямо головною. Справа з другорядної ліворуч через вашу траєкторію повертає', rule: '16.1, 16.11' },
  { ...MEDIUM[12], id: 'stop-ped-oncoming-left', title: 'Після STOP: пішохід і зустрічний лівий', control: 'stop', situation: 'Ви вже повністю зупинилися перед STOP. Головна вільна, обидва зустрічні під’їзди другорядні. Ви прямо, перед вами пішохід на зебрі, назустріч ліворуч —', rule: '18.1, 16.11, 16.13, 33.2.2' },
  { ...MEDIUM[12], id: 'secondary-ped-oncoming-left', title: 'Другорядна: пішохід перед вашою чергою', control: 'giveWay', situation: 'Ви прямо з другорядної, головна вільна. Перед вами пішохід на зебрі; назустріч із другорядної ліворуч —', rule: '18.1, 16.11, 16.13' },
  { ...MEDIUM[15], id: 'main-left-west-turns-left', title: 'Зустрічний, ви, бічний лівий', from: 'W', to: 'N', situation: 'Ви ліворуч із головної; зустрічний легковик головною прямо. Зліва з другорядної ліворуч —' },
  { ...EASY[4], id: 'main-right-ped-oncoming-left', title: 'Праворуч після пішохода перед зустрічним', control: 'main', before: 'pedestrian', situation: 'Ви й зустрічний на головній. Ви праворуч, перед вами пішохід на зебрі через ваш під’їзд; назустріч ліворуч на дорогу вашого повороту —', rule: '18.1, 16.13' },
];
const ADDITIONAL_HARD: Case[] = [
  { ...ADDITIONAL_MEDIUM[4], id: 'main-left-west-two-turners', title: 'Два ліві після зустрічного прямого', situation: 'Ви ліворуч головною; зустрічний легковик прямо головною. Зліва з другорядної ліворуч перетинає вашу дугу', reason: 'Спершу пропускаєте зустрічний прямий рух. Бічний лівий поворот виконується з другорядної, тому після зустрічного він пропускає вас.', rule: '16.11, 16.13' },
  { ...EASY[2], id: 'equal-left-between-sides', title: 'Ліворуч між правим і лівим сусідами', before: 'right', to: 'N', situation: 'Рівнозначне перехрестя. Ви ліворуч, справа легковик прямо, зліва ліворуч —', rule: '16.12' },
  { ...ADDITIONAL_EASY[4], id: 'main-right-siren-oncoming-left', title: 'Сирена перед правим, лівий після вас', before: 'ambulance', situation: 'Ви й зустрічний на головній. Ви праворуч. Зліва перетинає шлях оперативне авто з маячком і сиреною, назустріч ліворуч на ту саму дорогу —', rule: '3.2, 16.13' },
  { ...EASY[10], id: 'green-right-ped-oncoming-left', title: 'Основний зелений: пішохід перед правим', before: 'pedestrian', situation: 'Обом зустрічним напрямкам основний зелений. Пішохід закінчує перехід через ваш під’їзд. Ви праворуч, назустріч ліворуч —', rule: '16.5, 16.6' },
  { ...EASY[1], id: 'flash-right-west-ped', title: 'Миготіння: пішохід, правий, транспорт зліва', control: 'flash', before: 'pedestrian', situation: 'Миготливий жовтий без знаків, ви праворуч. Перед вами на зебрі через ваш під’їзд пішохід, зліва прямо —', rule: '16.1, 18.1, 16.12' },
  { ...HARD[1], id: 'green-stop-ped-oncoming-left', title: 'Зелений зі STOP: пішохід, ви, зустрічний', before: 'pedestrian', situation: 'Вам і зустрічному основний зелений, перед вами STOP. Пішохід закінчує перехід через ваш під’їзд. Ви прямо, назустріч ліворуч —', rule: '8.3, 16.5, 16.6' },
  { ...ADDITIONAL_MEDIUM[3], id: 'flash-secondary-ped-oncoming-left', title: 'Миготіння на другорядних із пішоходом', control: 'flashGiveWay', situation: 'Миготливий жовтий; обидва зустрічні під’їзди зі знаками «Дати дорогу». Головна вільна. Ви прямо, перед вами на зебрі пішохід; назустріч ліворуч —', rule: '16.1, 18.1, 16.11, 16.13' },
  { ...ADDITIONAL_EASY[3], id: 'main-west-left-siren', title: 'Сирена перед головною та бічним лівим', before: 'ambulance', situation: 'Ви прямо головною. Справа швидка з маячком і сиреною. Зліва з другорядної ліворуч у вашу смугу —', reason: 'Спершу забезпечуєте проїзд оперативного авто. Після нього транспорт із другорядної пропускає вас, навіть коли повертає у вашу смугу.', rule: '3.2, 16.11' },
  { ...ADDITIONAL_EASY[2], id: 'main-east-left-ped', title: 'Пішохід перед бічним лівим із другорядної', before: 'pedestrian', situation: 'Ви прямо головною, перед вами на зебрі пішохід. Справа з другорядної ліворуч через вашу траєкторію —', rule: '18.1, 16.11' },
  { ...ADDITIONAL_EASY[0], id: 'equal-west-left-ped', title: 'Пішохід, прямий, бічний лівий', before: 'pedestrian', situation: 'Рівнозначне перехрестя: ви прямо, перед вами на зебрі пішохід. Зліва ліворуч у вашу смугу —', rule: '18.1, 16.12' },
];

interface RoadCase {
  id: string;
  title: string;
  situation: string;
  reason: string;
  rule: string;
  scene: Extract<TicketTemplate, { site: 'block' | 'avenue' }>;
  path: ActorSpec['path'];
}
const yardScene = { site: 'block', stopLine: { x: O, z: -8 } } as const;
const roadBase = { id: '', title: '', question: '', options: [], explanation: '', rule: '', actors: [] };
const YARDS: RoadCase[] = [
  { id: 'road-yard-right-merge', title: 'Ви дорогою, інший — із двору праворуч', situation: 'Ви прямо дорогою. Справа з двору праворуч у вашу смугу хоче виїхати', reason: 'Ви рухаєтеся дорогою, а інший учасник виїжджає з прилеглої території й повинен дати вам дорогу. Правило перешкоди справа тут не визначає перевагу.', rule: '10.2', scene: { ...roadBase, ...yardScene }, path: drive('E', 'N').map((p) => ({ ...p, z: p.z + 8 })) },
  { id: 'road-yard-right-cross', title: 'Із двору справа через вашу смугу', situation: 'Ви прямо дорогою. Справа з двору ліворуч у протилежний вам напрямок, перетинаючи вашу смугу, хоче виїхати', reason: 'Транспорт із двору дає дорогу всім, хто рухається дорогою, незалежно від того, яку смугу займе після виїзду.', rule: '10.2', scene: { ...roadBase, ...yardScene }, path: drive('E', 'S').map((p) => ({ ...p, z: p.z + 8 })) },
  { id: 'road-yard-left-merge', title: 'Ви дорогою, із двору зліва — у вашу смугу', situation: 'Ви прямо дорогою. Зліва з двору ліворуч у вашу смугу хоче виїхати', reason: 'Виїжджаючи з прилеглої території, інший водій поступається вам як учаснику руху на дорозі.', rule: '10.2', scene: { ...roadBase, ...yardScene }, path: drive('W', 'N').map((p) => ({ ...p, z: p.z + 8 })) },
  { id: 'road-yard-crossing', title: 'Переїзд між двома дворами', situation: 'Ви прямо дорогою. Зліва з двору поперек дороги в протилежний двір хоче переїхати', reason: 'Переїзд із двору до двору не створює рівнозначного перехрестя: учасник із прилеглої території має пропустити рух дорогою.', rule: '10.2', scene: { ...roadBase, ...yardScene }, path: drive('W', 'E').map((p) => ({ ...p, z: p.z + 8 })) },
];
const avenueScene = (lanes: 2 | 3, laneIn: number, laneOut = laneIn): RoadCase['scene'] => ({
  ...roadBase, site: 'avenue', lanes, laneIn, laneOut, stopLine: { x: lane(laneIn), z: -9 },
  ego: laneIn === laneOut ? undefined : [{ x: lane(laneIn), z: -6, r: 20 }, { x: lane(laneOut), z: 6, r: 20 }],
});
const mergePath = (from: number, to: number): ActorSpec['path'] => [
  { x: lane(from), z: -36 }, { x: lane(from), z: -6, r: 20 }, { x: lane(to), z: 6, r: 20 }, { x: lane(to), z: 70 },
];
const MERGES: RoadCase[] = [
  { id: 'stay-left-other-merges', title: 'Ваша смуга — ваша перевага', situation: 'Ви їдете лівою смугою двосмугового проспекту без перестроювання. Праворуч із переходом у вашу смугу —', reason: 'Той, хто перестроюється, дає дорогу транспорту, який уже рухається цільовою смугою. Розташування іншого справа не змінює цього.', rule: '10.3', scene: avenueScene(2, 0), path: mergePath(1, 0) },
  { id: 'stay-right-other-merges', title: 'Інший зліва, ви у своїй смузі', situation: 'Ви їдете правою смугою двосмугового проспекту без перестроювання. Зліва у вашу смугу хоче перейти', reason: 'Ви зберігаєте смугу, а інший учасник її змінює, тому він повинен дати вам дорогу.', rule: '10.3', scene: avenueScene(2, 1), path: mergePath(0, 1) },
  { id: 'simultaneous-from-right', title: 'Одночасне: цього разу ви справа', situation: 'Три смуги. Ви з правої та інший учасник із лівої одночасно хочете в середню. Учасник ліворуч —', reason: 'При одночасному перестроюванні в одному напрямку дорогу дає водій, який ліворуч. Ви справа й виконуєте перестроювання першим, переконавшись, що вам поступаються.', rule: '10.3', scene: avenueScene(3, 2, 1), path: mergePath(0, 1) },
  { id: 'stay-middle-other-merges', title: 'Середня смуга перед правим перестроюванням', situation: 'Ви без перестроювання в середній із трьох смуг. Із крайньої правої в середню хоче перейти', reason: 'Це не одночасне перестроювання: свою смугу змінює лише інший учасник, тому він пропускає вас.', rule: '10.3', scene: avenueScene(3, 1), path: mergePath(2, 1) },
];

function makeRoadTicket(c: RoadCase, p: Participant, difficulty: Difficulty, index: number): RankedTicketTemplate {
  return {
    ...c.scene, id: `priority-${c.id}-${p.id}`, difficulty, title: c.title,
    question: `${c.situation} ${p.name}. Він чекає й дає вам дорогу. Інших перешкод немає. Яка черговість за ПДР?`,
    options: optionsFor(undefined, index % 3),
    explanation: c.reason + ' У цій ситуації інший учасник дотримується правил; добровільна поступка не змінює встановленої черговості.',
    rule: `ПДР, п. ${c.rule}`,
    actors: [{ id: 'after', kind: p.kind, model: p.model, path: c.path, speed: p.kind === 'cyclist' ? 5 : 9, gap: p.kind === 'bus' ? 17 : 13, yieldsToEgo: true }],
  };
}

export const PRIORITY_TICKETS: RankedTicketTemplate[] = [
  ...REBALANCED_PRIORITY_TICKETS,
  ...ADDITIONAL_EASY.flatMap((c, i) => PARTICIPANTS.slice(0, 3).map((p, j) => makeTicket(c, p, 'easy', i + j))),
  ...YARDS.flatMap((c, i) => PARTICIPANTS.slice(0, 3).map((p, j) => makeRoadTicket(c, p, 'easy', i + j))),
  ...ADDITIONAL_MEDIUM.flatMap((c, i) => PARTICIPANTS.slice(0, 3).map((p, j) => makeTicket(c, p, 'medium', i + j))),
  ...MERGES.flatMap((c, i) => PARTICIPANTS.slice(0, 3).map((p, j) => makeRoadTicket(c, p, 'medium', i + j))),
  ...ADDITIONAL_HARD.flatMap((c, i) => PARTICIPANTS.map((p, j) => makeTicket(c, p, 'hard', i + j))),
];
