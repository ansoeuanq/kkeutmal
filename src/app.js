// 화면 동작. 규칙과 수 선택은 engine.js, 학습은 learn.js 에 있다.
import { buildDict, candidates, chooseMove, createContext, isEarly, lastCharOf, posOf, shardOf, startsOf, validate } from './engine.js';
import { merge, parseModel, update } from './learn.js';
import { RULES, contextOptions, modelFile, modelKey } from './rules.js';
import { cleanName, createReporter } from './stats.js';
import { VERSION } from './version.js';

const $ = (id) => document.getElementById(id);
const TYPE_LABEL = ['', '방언', '북한어', '옛말'];
// 구분 코드 → 표시할 이름들. 구는 구분 코드에 4가 더해져 있다.
const kinds = (code) => [TYPE_LABEL[code & 3], code >= 4 ? '구' : ''].filter(Boolean);
// 룰마다 좋은 글자가 달라 모델을 따로 둔다. 스파링으로 배운 모델이 따로 있는 칸은 '<룰>-sparring' 이 하나 더 있다.
const MODEL_KEYS = Object.entries(RULES).flatMap(([rule, def]) => (def.sparring ? [rule, `${rule}-sparring`] : [rule]));
// 봇이 배운 방식. 스파링 모델이 있는 칸에서만 고를 수 있다.
const TRAINED = {
  self: { name: '자가 대국으로 배운 봇', note: '모든 말을 아는 상대와 두며 배웠어요. 봇끼리의 대결에서 강해요.' },
  sparring: { name: '스파링으로 배운 봇', note: '표준어만 아는 상대와 두며 배웠어요. 사람처럼 아는 말이 한정된 상대에게 강해요.' },
};
// 이 브라우저에 쌓는 누적의 저장 이름. 형용사·부사를 허용하며 사전이 바뀌어 v2 부터 새로 쌓는다.
const storageKey = (key) => `kkeutmal.model.${key}.v2`;
const SETTINGS_KEY = 'kkeutmal.settings.v1';
const CHOICES = { level: ['easy', 'normal', 'hard'], first: ['me', 'bot'], tab: ['play', 'hint'], rule: Object.keys(RULES), trained: Object.keys(TRAINED) };

// 저장소가 막혀 있어도(사생활 보호 모드 등) 게임은 그대로 되어야 한다.
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* 누적만 건너뛴다 */ } },
};

function loadSettings() {
  const settings = { level: 'normal', first: 'me', tab: 'play', rule: Object.keys(RULES)[0], trained: 'self' };
  try {
    const saved = JSON.parse(storage.get(SETTINGS_KEY)) ?? {};
    for (const [key, allowed] of Object.entries(CHOICES)) if (allowed.includes(saved[key])) settings[key] = saved[key];
  } catch { /* 깨진 값은 기본값으로 */ }
  settings.first = 'me'; // 처음 들어올 때는 늘 플레이어가 먼저 한다
  return settings;
}

const settings = loadSettings();
const saveSettings = () => storage.set(SETTINGS_KEY, JSON.stringify(settings));

// ── 플레이어와 판 결과 모으기 ──
// 처음 열 때 이름을 한 번 정한다(바꿀 수 없다). 같은 이름이 여럿일 수 있어 기기마다 무작위 번호도 둔다.
const PLAYER_KEY = 'kkeutmal.player.v1';
const reporter = createReporter({ storage, endpointList: 'https://ansoeuanq.github.io/kkeutmal/stats-endpoint.txt' });
let player = null;
try { player = JSON.parse(storage.get(PLAYER_KEY)); } catch { /* 처음 온 사람 */ }

let dict;
const fileModels = {}; // 미리 학습해 둔 모델
const localModels = {}; // 이 브라우저에서 사람과 둔 판의 누적
const modelFor = (key) => merge(fileModels[key], localModels[key]);
const contexts = new Map();
// 지금 고른 룰로 정해지는 판의 조건: 쓸 사전(ctx)과 모델 이름(key)
function playOf() {
  if (!contexts.has(settings.rule)) {
    if (contexts.size >= 2) contexts.delete(contexts.keys().next().value); // 걸러 낸 사전은 크므로 둘만 둔다
    contexts.set(settings.rule, createContext(dict, contextOptions(dict, settings.rule)));
  }
  return { ctx: contexts.get(settings.rule), key: modelKey(settings.rule, settings.trained === 'sparring') };
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// '역'으로 / '가'로
const ro = (ch) => { const jong = (ch.charCodeAt(0) - 0xac00) % 28; return jong === 0 || jong === 8 ? '로' : '으로'; };
const startText = (last) => {
  const starts = startsOf(last);
  return starts.map((c) => `'${c}'`).join(' 또는 ') + ro(starts.at(-1));
};

function wordCells(word, linkFirst) {
  const box = el('span', { className: 'word' });
  box.setAttribute('aria-hidden', 'true');
  [...word].forEach((ch, i) => {
    const linked = (i === 0 && linkFirst) || i === word.length - 1;
    box.append(el('span', { className: linked ? 'cell link' : 'cell', textContent: ch }));
  });
  return box;
}

function showLearned() {
  const n = (count) => count.toLocaleString('ko-KR');
  const { key } = playOf();
  const how = RULES[settings.rule].sparring ? `(${key.endsWith('-sparring') ? '스파링' : '자가 대국'})` : '';
  $('learned').textContent = `봇이 배운 판: ${RULES[settings.rule].name}${how} ${n(fileModels[key].games)}판, 이 브라우저에서 ${n(localModels[key].games)}판`;
}

// ── 대결 ──

let game = null;

function newGame(event) {
  event?.preventDefault();
  checkVersion();
  const form = new FormData($('setup'));
  Object.assign(settings, { level: form.get('level'), first: form.get('first') });
  saveSettings();
  const play = playOf();
  showLearned();
  game = {
    ctx: play.ctx,
    level: settings.level,
    first: settings.first,
    key: play.key,
    model: modelFor(play.key),
    used: new Set(),
    last: null,
    given: { me: [], bot: [] },
    over: false,
  };
  lockHintTab();
  $('chain').replaceChildren();
  $('result').hidden = true;
  $('move').hidden = false;
  $('move-input').value = '';
  $('move-error').textContent = '';
  if (settings.first === 'bot') botTurn();
  else myTurn();
}

function place(word, who) {
  const linkFirst = game.last !== null;
  game.used.add(word);
  game.last = lastCharOf(word);
  game.given[who].push(game.last);
  lockHintTab();
  const name = who === 'me' ? '나' : '봇';
  const label = el('span', { className: 'who', textContent: name });
  for (const kind of kinds(game.ctx.dict.types.get(word))) label.append(el('span', { className: 'tag', textContent: kind }));
  const part = posOf(game.ctx.dict, word);
  if (part) label.append(el('span', { className: 'tag part', textContent: part }));
  // 단어마다 '뜻' 버튼: 누르면 그 단어의 뜻풀이를 아래에 펼친다
  const def = el('p', { className: 'def', hidden: true });
  const toggle = el('button', { type: 'button', className: 'def-toggle', textContent: '뜻' });
  toggle.setAttribute('aria-label', `${word}의 뜻 보기`);
  toggle.addEventListener('click', () => {
    def.hidden = !def.hidden;
    if (!def.hidden && !def.dataset.word) fillDef(def, word);
  });
  label.append(toggle);
  const turn = el('li', { className: `turn ${who}` },
    el('span', { className: 'sr', textContent: `${name}: ${word}` }), label, wordCells(word, linkFirst), def);
  $('chain').append(turn);
  turn.scrollIntoView({ block: 'nearest' });
}

function setBusy(busy) {
  for (const control of $('move').querySelectorAll('input, button')) control.disabled = busy;
}

// 처음 6단어(각자 3번)는 한방단어를 낼 수 없다 (한방단어를 허용하는 규칙에서만 달라진다)
const early = () => ({ early: isEarly(game.used) });

function myTurn() {
  if (!candidates(game.ctx, game.last, game.used, early()).length) {
    finish('bot', `${startText(game.last)} 시작하는 단어가 사전에 남아 있지 않아요.`, 'me-stuck');
    return;
  }
  $('start-hint').textContent = (game.last === null
    ? '아무 단어로나 시작하세요.'
    : `${startText(game.last)} 시작하는 단어를 내세요.`)
    + (game.ctx.hanbang && isEarly(game.used) ? ' 처음 3번은 한방단어를 쓸 수 없어요.' : '');
  setBusy(false);
  $('move-input').focus();
}

function botTurn() {
  const current = game;
  setBusy(true);
  $('start-hint').textContent = '봇이 생각하고 있어요…';
  setTimeout(() => {
    if (current !== game) return; // 그사이 새 판을 시작했다
    const word = chooseMove(game.ctx, game.last, game.used, game.model, game.level, early());
    if (word === null) {
      finish('me', `봇이 ${startText(game.last)} 시작하는 단어를 찾지 못했어요.`, 'bot-stuck');
      return;
    }
    place(word, 'bot');
    myTurn();
  }, 300);
}

const REASON = {
  NOT_IN_DICT: () => '사전에 없는 단어예요.',
  NOT_IN_RULE: (word) => {
    if (settings.rule === 'kkt' && word.length !== 3) return '쿵쿵따는 3글자 말만 쓸 수 있어요.';
    return `${RULES[settings.rule].name}의 사전에 없는 말이에요 (${RULES[settings.rule].allowed}).`;
  },
  WRONG_START: () => `${startText(game.last)} 시작해야 해요.`,
  USED: () => '이미 나온 단어예요.',
  HANBANG: () => '한방단어는 쓸 수 없어요.',
  EARLY_HANBANG: () => '처음 3번은 한방단어를 쓸 수 없어요.',
};

function submitMove(event) {
  event.preventDefault();
  const word = $('move-input').value.trim();
  if (!word) return;
  const reason = validate(game.ctx, word, game.last, game.used, early());
  if (reason) {
    $('move-error').textContent = REASON[reason](word);
    $('move-input').select();
    return;
  }
  $('move-error').textContent = '';
  $('move-input').value = '';
  place(word, 'me');
  botTurn();
}

function giveUp() {
  const type = (word) => game.ctx.dict.types.get(word);
  const examples = game.last === null ? [] : candidates(game.ctx, game.last, game.used, early())
    .sort((a, b) => type(a) - type(b)).slice(0, 3);
  finish('bot', examples.length ? `낼 수 있었던 단어: ${examples.join(', ')}` : '포기했어요.', 'give-up');
}

// end: 'me-stuck'(내가 이을 말이 없음) | 'bot-stuck'(봇이 이을 말이 없음) | 'give-up'(포기)
function finish(winner, reason, end) {
  const loser = winner === 'me' ? 'bot' : 'me';
  game.over = true;
  lockHintTab();
  report(winner, end);
  update(localModels[game.key], game.given[winner], game.given[loser]);
  storage.set(storageKey(game.key), JSON.stringify(localModels[game.key]));
  showLearned();
  $('result').textContent = `${winner === 'me' ? '이겼어요.' : '졌어요.'} ${reason}`;
  $('result').classList.toggle('lost', winner === 'bot');
  $('result').hidden = false;
  $('move').hidden = true;
  $('again').focus();
}

// 끝난 판을 승률 서버로 보낼 목록에 넣고 보낸다. 서버가 꺼져 있으면 기기에 남았다가 다음에 간다.
function report(winner, end) {
  if (!player) return;
  reporter.enqueue({
    v: 2,
    ver: VERSION, // 서버는 지금 배포된 버전의 판만 받는다
    id: player.id,
    name: player.name,
    at: new Date().toISOString(),
    rule: settings.rule,
    trained: RULES[settings.rule].sparring ? settings.trained : null,
    level: game.level,
    first: game.first,
    winner,
    end,
    words: [...game.used], // 나온 순서대로
    client: /; wv\)/.test(navigator.userAgent) ? 'app' : 'web', // 안드로이드 앱(웹뷰)인지
  });
  reporter.flush();
}

function showPlayer() {
  $('player').textContent = player ? `플레이어: ${player.name}` : '';
  $('stats-off').checked = reporter.isOff();
}

// 이름을 정할 때까지 닫히지 않는 창. 정한 이름은 바꿀 수 없다.
function askName() {
  const dialog = $('name-dialog');
  dialog.addEventListener('cancel', (event) => event.preventDefault()); // Esc 로 닫지 못하게
  $('name-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = cleanName($('name-input').value);
    if (!name) {
      $('name-error').textContent = '1~12자의 한글·영문·숫자로 정해 주세요. 공백, _, - 도 쓸 수 있어요.';
      $('name-input').focus();
      return;
    }
    player = { id: crypto.randomUUID(), name };
    storage.set(PLAYER_KEY, JSON.stringify(player));
    showPlayer();
    dialog.close();
    $('move-input').focus();
  });
  dialog.showModal();
}

// ── 뜻풀이 ──
// 뜻풀이는 512조각으로 나뉘어 있다. 누른 단어의 조각만 읽고, 읽은 조각은 기억해 둔다.

const defShards = new Map(); // 조각 번호 → Promise<Map<단어, 뜻>>

function defOf(word) {
  const id = shardOf(word);
  if (!defShards.has(id)) {
    defShards.set(id, fetch(`data/defs/${String(id).padStart(3, '0')}.txt`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((text) => new Map(text.split(/\r?\n/).filter(Boolean).map((line) => {
        const tab = line.indexOf('\t');
        return [line.slice(0, tab), line.slice(tab + 1)];
      }))));
  }
  return defShards.get(id).then((defs) => defs.get(word) ?? null, () => {
    defShards.delete(id); // 다음에 다시 읽어 본다
    return undefined;
  });
}

async function fillDef(node, word) {
  node.dataset.word = word;
  node.textContent = '뜻을 읽는 중이에요…';
  const def = await defOf(word);
  if (node.dataset.word !== word) return; // 그사이 다른 단어로 바뀌었다
  node.textContent = def === undefined ? '뜻풀이를 읽지 못했어요.' : def ?? '사전에 뜻풀이가 없는 말이에요.';
}

// ── 탭 ──

// 추천 탭이 있으면 hint.js 가 돌려준 { refresh, reset }. 공개 배포판의 첫 화면에는 탭 줄도 추천 탭도 없어 null 로 남는다.
let hints = null;

function showTab(name) {
  if (!hints) return; // 대결 화면 하나뿐이다
  if ($(`tab-${name}`).disabled) return;
  for (const tab of CHOICES.tab) {
    const on = tab === name;
    $(`tab-${tab}`).setAttribute('aria-selected', on);
    $(`tab-${tab}`).tabIndex = on ? 0 : -1;
    $(`panel-${tab}`).hidden = !on;
  }
  settings.tab = name;
  saveSettings();
}

// 봇과 대결하는 동안(첫 단어가 나온 뒤 판이 끝나기 전)에는 추천 탭에 들어갈 수 없다.
function lockHintTab() {
  if (!hints) return;
  const locked = game.used.size > 0 && !game.over;
  $('tab-hint').disabled = locked;
  $('tab-hint').title = locked ? '대결이 끝나면 볼 수 있어요' : '';
}

// ── 룰(칸) ──

// 룰을 바꾸면 사전과 모델이 통째로 바뀌므로 판과 추천 기록을 새로 시작한다.
function showRule(rule) {
  settings.rule = rule;
  saveSettings();
  for (const button of $('rulebar').querySelectorAll('button')) {
    const on = button.value === rule;
    button.setAttribute('aria-pressed', on);
  }
  $('rule-note').textContent = RULES[rule].note;
  $('allowed').textContent = RULES[rule].allowed; // 맨 위에 '명사, 형용사, 부사 사용 가능'처럼 보여 준다
  $('trainbox').hidden = !RULES[rule].sparring; // 모델이 하나뿐인 칸에서는 고를 것이 없다
  showTrained(settings.trained);
}

// 봇이 배운 방식(자가 대국 / 스파링)을 고른다. 같은 룰이라도 참고하는 승률표가 달라진다.
function showTrained(kind) {
  settings.trained = kind;
  saveSettings();
  for (const button of $('trainbar').querySelectorAll('button')) button.setAttribute('aria-pressed', button.value === kind);
  $('train-note').textContent = TRAINED[kind].note;
}

function buildTrainBar() {
  $('trainbar').replaceChildren(...Object.entries(TRAINED).map(([kind, { name }]) => {
    const button = el('button', { type: 'button', value: kind, textContent: name });
    button.addEventListener('click', () => {
      showTrained(kind);
      newGame();
      hints?.refresh();
    });
    return button;
  }));
}

function buildRuleBar() {
  $('rulebar').replaceChildren(...Object.entries(RULES).map(([rule, { name }]) => {
    const button = el('button', { type: 'button', value: rule, textContent: name });
    button.addEventListener('click', () => {
      showRule(rule);
      hints?.reset();
      newGame();
    });
    return button;
  }));
}

function wire() {
  if (hints) {
    for (const tab of CHOICES.tab) $(`tab-${tab}`).addEventListener('click', () => showTab(tab));
    document.querySelector('.tabs').addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const next = settings.tab === 'play' ? 'hint' : 'play';
      if ($(`tab-${next}`).disabled) return;
      showTab(next);
      $(`tab-${next}`).focus();
    });
  }
  $('setup').addEventListener('submit', newGame);
  $('move').addEventListener('submit', submitMove);
  $('give-up').addEventListener('click', giveUp);
  // 단어를 긁어 복사하지 못하게 한다 (입력 칸에 직접 친 글은 예외)
  document.querySelector('main').addEventListener('copy', (event) => {
    if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
  });
}

// ── 업데이트 잠금 ──
// 배포할 때 공개 사이트의 version.json 을 먼저 잠그고(locked), 새 파일을 올리며 새 버전으로 푼다(tools/deploy.mjs).
// 잠겨 있거나 이 화면이 옛 버전이면 게임을 막는다. 읽지 못하면(오프라인, 개발 중) 막지 않는다.
async function checkVersion() {
  if (VERSION === 'dev') return;
  let live;
  try {
    const response = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;
    live = await response.json();
  } catch { return; }
  if (live.locked) showLock('업데이트 중이에요', '앱과 웹을 새 버전으로 바꾸고 있어요. 잠시 뒤에 다시 확인해 주세요.', '다시 확인', checkVersion);
  else if (live.version !== VERSION) showLock('새 버전이 나왔어요', '새로 고친 뒤에 계속할 수 있어요.', '새로 고침', () => location.reload());
  else if ($('lock-dialog').open) $('lock-dialog').close();
}

function showLock(title, text, action, onClick) {
  $('lock-title').textContent = title;
  $('lock-text').textContent = text;
  $('lock-action').textContent = action;
  $('lock-action').onclick = onClick;
  if (!$('lock-dialog').open) $('lock-dialog').showModal();
}

// ── 앱으로 쓰기 ──

// 서비스 워커(sw.js)를 켜서 인터넷이 없어도 열리게 하고, 설치할 수 있는 브라우저에서는 설치 버튼을 보여 준다.
function setupApp() {
  navigator.serviceWorker?.register('sw.js').catch(() => {});
  let offer = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // 브라우저가 띄우는 안내 대신 우리 버튼으로 묻는다
    offer = event;
    $('install').hidden = false;
  });
  $('install').addEventListener('click', async () => {
    offer.prompt();
    await offer.userChoice;
    $('install').hidden = true; // 같은 제안은 한 번만 쓸 수 있다
  });
  window.addEventListener('appinstalled', () => { $('install').hidden = true; });
  // navigator.standalone 은 아이폰·아이패드에만 있고, 홈 화면에서 연 것이 아니면 false 다
  $('install-ios').hidden = navigator.standalone !== false;
}

async function init() {
  setupApp();
  try {
    const response = await fetch('data/words.txt');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    dict = buildDict(await response.text());
  } catch (error) {
    $('status').textContent = `사전을 읽지 못했어요 (${error.message}). 프로젝트 폴더에서 npm run serve 를 실행하고 나오는 주소로 열어 주세요.`;
    $('status').classList.add('error');
    return;
  }
  // 모델 파일이 없으면 빈 모델로 시작한다.
  await Promise.all(MODEL_KEYS.map(async (key) => {
    fileModels[key] = parseModel(await fetch(`data/${modelFile(key)}`).then((r) => (r.ok ? r.text() : null)).catch(() => null));
    localModels[key] = parseModel(storage.get(storageKey(key)));
  }));

  // 표준국어대사전에만 있는 명사(출처에 우리말샘 비트가 없는 말)는 사전 룰에서만 쓰이므로 세지 않는다
  let outside = 0;
  for (const source of dict.src.values()) if (!(source & 1)) outside++;
  $('status').textContent = `우리말샘에서 뽑은 말 ${(dict.types.size - outside).toLocaleString('ko-KR')}개를 아는 봇이에요. 방언, 북한어, 옛말도 알아요.`;
  $('setup').elements.level.value = settings.level;
  $('setup').elements.first.value = settings.first;
  // 추천 화면 코드는 첫 화면에 추천 탭이 있을 때만 불러온다
  if ($('panel-hint')) hints = (await import('./hint.js')).setupHints({ $, el, settings, playOf, modelFor, startText, fillDef, TYPE_LABEL });
  buildRuleBar();
  buildTrainBar();
  showRule(settings.rule);
  wire();
  document.querySelector('main').inert = false;
  showTab(settings.tab);
  newGame();
  $('stats-off').addEventListener('change', (event) => reporter.setOff(event.target.checked));
  window.addEventListener('online', () => reporter.flush());
  showPlayer();
  if (!player) askName();
  reporter.flush(); // 전에 못 보낸 판
  $('lock-dialog').addEventListener('cancel', (event) => event.preventDefault()); // Esc 로 닫지 못하게
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });
  setInterval(checkVersion, 2 * 60 * 1000);
  // 서비스 워커가 켜지기 전에 받은 파일(이 화면, 스크립트, 사전, 모델)도 저장해 두게 목록을 넘긴다
  navigator.serviceWorker?.ready.then(({ active }) => active.postMessage(
    [location.href, ...performance.getEntriesByType('resource').map((entry) => entry.name)],
  ));
}

init();
