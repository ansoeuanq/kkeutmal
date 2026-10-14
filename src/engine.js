// 끝말잇기 규칙·사전 색인·필승 분석·수 선택. 브라우저와 Node 가 함께 쓰므로 DOM·파일을 건드리지 않는다.
import { scorer } from './learn.js';

const I_YA = new Set([2, 6, 7, 12, 17, 20]); // ㅑ ㅕ ㅖ ㅛ ㅠ ㅣ
const A_EU = new Set([0, 1, 8, 11, 13, 18]); // ㅏ ㅐ ㅗ ㅚ ㅜ ㅡ

export function dueum(ch) {
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return ch;
  const cho = Math.floor(code / 588);
  const jung = Math.floor((code % 588) / 28);
  let to = cho;
  if (cho === 5) to = I_YA.has(jung) ? 11 : A_EU.has(jung) ? 2 : cho; // ㄹ → ㅇ / ㄴ
  else if (cho === 2 && I_YA.has(jung)) to = 11; // ㄴ → ㅇ
  return String.fromCharCode(0xac00 + code + (to - cho) * 588);
}

// 글자 ch 를 받은 사람이 시작할 수 있는 글자들
export function startsOf(ch) {
  const d = dueum(ch);
  return d === ch ? [ch] : [ch, d];
}

export const lastCharOf = (word) => word.at(-1);

// 사전 파일의 한 줄은 "단어<TAB>구분[<TAB>품사[<TAB>출처]]".
// 품사는 명사가 아닌 말에만, 출처는 우리말샘에만 있는 말(1)이 아닐 때만 적혀 있다.
// 출처는 비트 합: 1 우리말샘에서 뽑은 말, 2 표준국어대사전 현행판의 명사, 4 표준국어대사전 2019년 판의 명사.
export function buildDict(text) {
  const types = new Map();
  const byFirst = new Map();
  const pos = new Map();
  const src = new Map();
  for (const line of text.split(/\r?\n/)) {
    const [word, type, part, source] = line.split('\t');
    if (!word) continue;
    types.set(word, Number(type));
    if (part) pos.set(word, part);
    if (source) src.set(word, Number(source));
    if (!byFirst.has(word[0])) byFirst.set(word[0], []);
    byFirst.get(word[0]).push(word);
  }
  return { types, byFirst, pos, src };
}

export const srcOf = (dict, word) => dict.src.get(word) ?? 1;

// 단어의 품사. 구(구분 코드 4 이상)와 사전에 없는 말은 빈 문자열.
export function posOf(dict, word) {
  const code = dict.types.get(word);
  return code === undefined || code >= 4 ? '' : dict.pos.get(word) ?? '명사';
}

// 구분 코드: 0 표준, 1 방언, 2 북한어, 3 옛말. 띄어 쓰는 말을 붙인 '구'는 여기에 4를 더한 값이다.
// phrases 를 끄면 구를, exclude 에 구분 코드를 넣으면 그 구분의 단어를 이번 판에서 없는 말로 친다.
// only 는 룰이 쓰는 사전을 고르는 조건(단어 → 참·거짓). 주지 않으면 우리말샘에서 뽑은 말만 쓴다.
export function createContext(full, { hanbang = false, phrases = true, exclude = [], only = null } = {}) {
  const inRule = only ?? ((word) => (srcOf(full, word) & 1) !== 0);
  const optionAllows = (code) => (phrases || code < 4) && !exclude.includes(code & 3);
  const allows = (word) => optionAllows(full.types.get(word)) && inRule(word);
  let byFirst = full.byFirst;
  if (!phrases || exclude.length || only || full.src.size) { // 걸러 낼 것이 없으면 복사하지 않는다
    byFirst = new Map();
    for (const [first, words] of full.byFirst) {
      const kept = words.filter(allows);
      if (kept.length) byFirst.set(first, kept);
    }
  }
  const dict = { types: full.types, byFirst, pos: full.pos, src: full.src }; // types·pos·src 는 조회용이라 걸러 내지 않고 함께 쓴다
  const dead = new Set(); // 이을 단어가 하나도 없는 글자
  for (const words of byFirst.values()) {
    for (const word of words) {
      const end = lastCharOf(word);
      if (!startsOf(end).some((c) => byFirst.has(c))) dead.add(end);
    }
  }
  // groups, ends, replies: 수 선택에서 쓰는 색인 (필요할 때 채운다)
  return { dict, inRule, optionAllows, hanbang, dead, ...analyze(dict, hanbang, dead), groups: new Map(), ends: new Map(), replies: new Map() };
}

// 글자마다 "받으면 짐(L) / 받으면 이김(W)"을 역방향으로 푼다. 어느 쪽도 아니면 미정이라 맵에 없다.
// ponytail: 단어가 소모되는 것은 무시한 정적 분석. 미정 구간이 약하면 남은 단어로 얕은 탐색을 붙인다.
function analyze(dict, hanbang, dead) {
  const endsByFirst = new Map();
  for (const [first, words] of dict.byFirst) {
    const ends = new Set();
    for (const word of words) {
      const end = lastCharOf(word);
      if (hanbang || !dead.has(end)) ends.add(end);
    }
    endsByFirst.set(first, ends);
  }
  const nodes = new Set(endsByFirst.keys());
  for (const ends of endsByFirst.values()) for (const end of ends) nodes.add(end);

  const preds = new Map(); // 끝 글자 → 그 글자를 넘길 수 있는 글자들
  const remaining = new Map(); // 아직 '이김'으로 판정되지 않은 갈 곳의 수
  for (const ch of nodes) {
    const succ = new Set();
    for (const s of startsOf(ch)) for (const end of endsByFirst.get(s) ?? []) succ.add(end);
    remaining.set(ch, succ.size);
    for (const end of succ) {
      if (!preds.has(end)) preds.set(end, []);
      preds.get(end).push(ch);
    }
  }

  const status = new Map();
  const depth = new Map();
  const queue = [];
  const settle = (ch, s, d) => { status.set(ch, s); depth.set(ch, d); queue.push(ch); };
  for (const ch of nodes) if (remaining.get(ch) === 0) settle(ch, 'L', 0);
  // 큐는 깊이 순이라 '이김'은 가장 짧은 길로, '짐'은 가장 긴 길로 깊이가 정해진다.
  for (let i = 0; i < queue.length; i++) {
    const ch = queue[i];
    const d = depth.get(ch) + 1;
    for (const p of preds.get(ch) ?? []) {
      if (status.has(p)) continue;
      if (status.get(ch) === 'L') settle(p, 'W', d);
      else if (remaining.set(p, remaining.get(p) - 1).get(p) === 0) settle(p, 'L', d);
    }
  }
  return { status, depth };
}

const allowed = (ctx, word) => ctx.hanbang || !ctx.dead.has(lastCharOf(word));

// 판의 처음 10단어(사람·봇 각자 5번) 동안은 한방단어를 낼 수 없다. 한방단어를 허용하는 규칙에서만 달라진다.
// 대결 화면과 자가 대국이 { early: isEarly(used) } 로 넘긴다. 추천 탭은 다른 게임용이라 넘기지 않는다.
export const EARLY_PLIES = 10;
export const isEarly = (used) => used.size < EARLY_PLIES;
const earlyBlocked = (ctx, end, early) => early && ctx.dead.has(end);

export function candidates(ctx, lastChar, used, { early = false } = {}) {
  const pools = lastChar === null
    ? ctx.dict.byFirst.values()
    : startsOf(lastChar).map((c) => ctx.dict.byFirst.get(c) ?? []);
  const out = [];
  for (const pool of pools) {
    for (const word of pool) if (!used.has(word) && allowed(ctx, word) && !earlyBlocked(ctx, lastCharOf(word), early)) out.push(word);
  }
  return out;
}

// 지금 룰의 사전에 있는 말인가. 옵션으로 꺼 둔 종류(방언 등)라도 사전에 있으면 참이다.
export const knows = (ctx, word) => ctx.dict.types.has(word) && ctx.inRule(word);

export function validate(ctx, input, lastChar, used, { early = false } = {}) {
  const word = input.trim();
  const code = ctx.dict.types.get(word);
  if (code === undefined) return 'NOT_IN_DICT';
  if (!ctx.inRule(word)) return 'NOT_IN_RULE'; // 이 룰이 쓰는 사전에 없는 말
  if (!ctx.optionAllows(code)) return 'EXCLUDED'; // 옵션으로 끈 종류의 말
  if (lastChar !== null && !startsOf(lastChar).includes(word[0])) return 'WRONG_START';
  if (used.has(word)) return 'USED';
  if (!allowed(ctx, word)) return 'HANBANG';
  if (earlyBlocked(ctx, lastCharOf(word), early)) return 'EARLY_HANBANG';
  return null;
}

// ── 수 선택 ──

const byEnd = (a, b) => (a.end < b.end ? -1 : 1); // 동점일 때 순서를 고정한다

// 글자 first 로 시작하는, 낼 수 있는 단어를 끝 글자별로 묶는다. 판과 무관하므로 한 번만 만든다.
function groupsOf(ctx, first) {
  let groups = ctx.groups.get(first);
  if (!groups) {
    groups = new Map();
    for (const word of ctx.dict.byFirst.get(first) ?? []) {
      if (!allowed(ctx, word)) continue;
      const end = lastCharOf(word);
      if (!groups.has(end)) groups.set(end, []);
      groups.get(end).push(word);
    }
    ctx.groups.set(first, groups);
  }
  return groups;
}

// 글자 lastChar 를 받았을 때 넘길 수 있는 끝 글자들. 판정과 깊이도 판과 무관하므로 좋은 순서로 미리 정렬해 둔다.
// 매 수마다 단어 전체를 훑지 않고 이 묶음만 훑는다 (단어 수만 개 → 끝 글자 수백 개).
function endsFor(ctx, lastChar) {
  const key = lastChar ?? '';
  let ends = ctx.ends.get(key);
  if (!ends) {
    const merged = new Map(); // 끝 글자 → 단어 묶음들 (두음법칙으로 시작 글자가 둘이면 묶음도 둘)
    for (const first of lastChar === null ? ctx.dict.byFirst.keys() : startsOf(lastChar)) {
      for (const [end, words] of groupsOf(ctx, first)) {
        if (!merged.has(end)) merged.set(end, []);
        merged.get(end).push(words);
      }
    }
    ends = { win: [], open: [], risk: [] };
    for (const [end, pools] of merged) {
      const s = ctx.status.get(end);
      ends[s === 'L' ? 'win' : s === 'W' ? 'risk' : 'open'].push({ end, pools, depth: ctx.depth.get(end) ?? 0 });
    }
    ends.win.sort((a, b) => a.depth - b.depth || byEnd(a, b)); // 빨리 이기는 것부터
    ends.open.sort(byEnd);
    ends.risk.sort((a, b) => b.depth - a.depth || byEnd(a, b)); // 오래 버티는 것부터
    ends.all = [...ends.win, ...ends.open, ...ends.risk];
    ctx.ends.set(key, ends);
  }
  return ends;
}

// standardOnly: 구가 아닌 표준어(구분 코드 0)만 쓴다. 쉬움 난이도와, 학습 상대인 '표준어만 아는 봇'이 쓴다.
const usable = (ctx, word, used, standardOnly) => !used.has(word) && (!standardOnly || ctx.dict.types.get(word) === 0);

const hasUnused = (ctx, group, used, standardOnly) =>
  group.pools.some((pool) => pool.some((word) => usable(ctx, word, used, standardOnly)));

function unusedWords(ctx, group, used, standardOnly = false) {
  const out = [];
  for (const pool of group.pools) for (const word of pool) if (usable(ctx, word, used, standardOnly)) out.push(word);
  return out;
}

// 글자 end 를 받은 사람이 이을 수 있는 표준어(구 제외) 수. 사람이 이을 만한 글자인지 가늠하는 데 쓴다.
function replies(ctx, end) {
  let count = ctx.replies.get(end);
  if (count === undefined) {
    count = 0;
    for (const first of startsOf(end)) {
      for (const words of groupsOf(ctx, first).values()) for (const word of words) if (ctx.dict.types.get(word) === 0) count++;
    }
    ctx.replies.set(end, count);
  }
  return count;
}

// 낼 수 있는 단어를 끝 글자로 묶어 좋은 순서로: 필승(빠른 것) → 미정(점수 높은 것) → 위험(점수 높은 것, 같으면 오래 버티는 것)
export function rankEnds(ctx, lastChar, used, model, { explore = false, standardOnly = false, early = false } = {}) {
  const value = scorer(model, explore);
  const ends = endsFor(ctx, lastChar);
  const out = [];
  for (const verdict of ['win', 'open', 'risk']) {
    const ranked = [];
    for (const group of ends[verdict]) {
      if (earlyBlocked(ctx, group.end, early)) continue;
      const words = unusedWords(ctx, group, used, standardOnly);
      if (words.length) ranked.push({ end: group.end, verdict, depth: group.depth, score: value(group.end), words });
    }
    if (verdict !== 'win') ranked.sort((a, b) => b.score - a.score); // 안정 정렬이라 동점은 미리 정해 둔 순서를 따른다
    out.push(...ranked);
  }
  return out;
}

// ── 게임 트리 분석 ──
// 필승 분석은 단어가 소모되는 것을 보지 못한다. 갈 수 있는 끝 글자가 몇 안 되는 '좁은 자리'는
// 단어를 실제로 써 가며 끝까지 읽을 수 있으므로, 그런 자리만 골라 읽는다 (넓은 자리는 '모름').
const NARROW = 3; // 갈 수 있는 끝 글자가 이 이하인 자리만 읽는다
const STATIC_LIMIT = 12; // 사전상 갈 곳이 이보다 많은 글자는 좁아질 일이 드물어 아예 읽지 않는다
const DEPTH = 6; // 읽는 깊이(수)

function firstUnused(group, used) {
  for (const pool of group.pools) for (const word of pool) if (!used.has(word)) return word;
  return null;
}

// 글자 ch 를 받은 쪽의 결과: 1 이김, -1 짐, 0 모름. used 는 읽는 동안 잠깐 바꿨다가 되돌린다.
function solve(ctx, ch, used, depth) {
  const all = endsFor(ctx, ch).all;
  if (all.length > STATIC_LIMIT) return 0;
  const moves = [];
  for (const group of all) {
    const word = firstUnused(group, used);
    if (word !== null && moves.push([group.end, word]) > NARROW) return 0;
  }
  if (!moves.length) return -1;
  if (depth === 0) return 0;
  let best = -1;
  for (const [end, word] of moves) {
    used.add(word);
    const result = -solve(ctx, end, used, depth - 1);
    used.delete(word);
    if (result === 1) return 1;
    if (result === 0) best = 0;
  }
  return best;
}

// 최강의 선택: 필승 분석의 필승 → 읽어서 이기는 길 → 모르는 길(학습 점수 높은 것, 미정 먼저) → 읽어서 지는 길.
// rankEnds 를 통째로 만들지 않고, 정렬해 둔 순서를 따라가며 필요한 묶음만 본다.
// ponytail: 초반(early)에는 한방단어 묶음만 건너뛴다. 6수 읽기 안에서는 초반 제한을 따지지 않는 근사다.
function bestEnd(ctx, lastChar, used, model, explore, standardOnly, depth, early) {
  const value = scorer(model, explore);
  const ends = endsFor(ctx, lastChar);
  const win = ends.win.find((group) => !earlyBlocked(ctx, group.end, early) && hasUnused(ctx, group, used, standardOnly));
  if (win) return win;
  let lost = null;
  let lostScore = -Infinity;
  for (const groups of [ends.open, ends.risk]) {
    let best = null;
    let bestScore = -Infinity;
    for (const group of groups) {
      if (earlyBlocked(ctx, group.end, early)) continue;
      let result = 0;
      if (depth > 0 && (group.fan ??= endsFor(ctx, group.end).all.length) <= STATIC_LIMIT) {
        const word = firstUnused(group, used);
        if (word === null) continue;
        used.add(word);
        result = -solve(ctx, group.end, used, depth - 1);
        used.delete(word);
        if (result === 1) return group;
      }
      const s = value(group.end);
      if (result === -1) {
        if (s > lostScore) [lost, lostScore] = [group, s];
      } else if (s > bestScore && hasUnused(ctx, group, used, standardOnly)) {
        [best, bestScore] = [group, s];
      }
    }
    if (best) return best;
  }
  return lost;
}

const PLAYABLE = 100; // 이을 표준어가 이만큼은 있어야 사람이 이을 만한 글자로 본다

export function chooseMove(ctx, lastChar, used, model, level, { explore = false, rng = Math.random, standardOnly = false, playable = PLAYABLE, depth = DEPTH, early = false } = {}) {
  const pick = (list) => list[Math.floor(rng() * list.length)];
  if (level === 'hard') {
    // 표준어만 아는 상대는 읽지 않는다 (읽기는 모든 말을 안다고 가정한다)
    const best = bestEnd(ctx, lastChar, used, model, explore, standardOnly, standardOnly ? 0 : depth, early);
    return best ? pick(unusedWords(ctx, best, used, standardOnly)) : null;
  }
  // 쉬움·보통은 사람이 이을 만한 글자만 넘긴다. 그런 글자가 없을 때만 가진 수 전체에서 고른다.
  const all = rankEnds(ctx, lastChar, used, model, { explore, standardOnly: level === 'easy', early });
  if (!all.length) return null;
  const friendly = all.filter((g) => replies(ctx, g.end) >= playable);
  const ends = friendly.length ? friendly : all;
  if (level === 'normal') {
    return pick(pick(ends.sort((a, b) => b.score - a.score || byEnd(a, b)).slice(0, 5)).words);
  }
  const gentle = ends.filter((g) => g.verdict !== 'win');
  return pick(pick(gentle.length ? gentle : ends).words);
}

// 추천 목록. 최강의 수 선택과 같은 순서로 보여 준다:
// 필승 분석의 필승 → 읽어서 이기는 길 → 모르는 길 → 읽어서 지는 길. read 는 읽은 결과(1 이김, -1 짐, 0 안 읽음·모름).
// 한 끝 글자에서 perEnd 개까지만 싣고, 전체 개수(total)와 함께 offset 부터 limit 개를 돌려준다.
export function recommend(ctx, lastChar, used, model, { offset = 0, limit = 30, perEnd = 3, depth = DEPTH } = {}) {
  const type = (word) => ctx.dict.types.get(word);
  const tiers = [[], [], [], []];
  for (const g of rankEnds(ctx, lastChar, used, model)) {
    let read = 0;
    if (g.verdict !== 'win' && depth > 0 && endsFor(ctx, g.end).all.length <= STATIC_LIMIT) {
      used.add(g.words[0]); // 같은 묶음의 말은 어느 것을 내도 판세가 같다
      read = -solve(ctx, g.end, used, depth - 1) || 0; // -0 을 0 으로
      used.delete(g.words[0]);
    }
    const verdict = read === 1 ? 'win' : read === -1 ? 'risk' : g.verdict;
    tiers[g.verdict === 'win' ? 0 : read === 1 ? 1 : read === 0 ? 2 : 3].push({ ...g, verdict, read });
  }
  const all = [];
  for (const g of tiers.flat()) {
    // 다른 곳에서도 통할 표준어를 먼저 보여 준다
    for (const word of [...g.words].sort((x, y) => type(x) - type(y)).slice(0, perEnd)) all.push([g, word]);
  }
  const items = all.slice(offset, offset + limit).map(([g, word]) => ({
    word, type: type(word), verdict: g.verdict, read: g.read, depth: g.depth, score: g.score,
    replies: candidates(ctx, g.end, new Set(used).add(word)).length,
  }));
  return { total: all.length, items };
}

// 사람이 흔히 낼 법한 응수: 구가 아닌 표준어 가운데 가장 짧고, 그 뒤에 이을 표준어가 가장 많은 글자로 끝나는 말.
// 표준어가 없으면 다른 말 가운데서 같은 기준으로 고른다.
function likelyReply(ctx, lastChar, used) {
  let best = null;
  let bestKey = [Infinity, Infinity, Infinity];
  for (const group of endsFor(ctx, lastChar).all) {
    for (const pool of group.pools) {
      for (const word of pool) {
        if (used.has(word)) continue;
        const key = [ctx.dict.types.get(word) === 0 ? 0 : 1, word.length, -replies(ctx, group.end)];
        if ((key[0] - bestKey[0] || key[1] - bestKey[1] || key[2] - bestKey[2]) < 0) [best, bestKey] = [word, key];
      }
    }
  }
  return best;
}

// 내가 word 를 낸 뒤의 예상 수순(주 변화). 상대는 흔한 말로 받고 나는 추천 1순위로 받는다고 보고, 한쪽이 못 이을 때까지 간다.
// 상대가 달리 받으면 달라지는 예상이지, 보장이 아니다. winner: 'me' | 'them' | null(maxPlies 안에 승부가 안 남).
export function forecast(ctx, word, used, model, { maxPlies = 40, depth = DEPTH } = {}) {
  const seen = new Set(used).add(word);
  const line = [{ word, who: 'me' }];
  let last = lastCharOf(word);
  while (line.length < maxPlies) {
    const who = line.length % 2 ? 'them' : 'me';
    const next = who === 'them'
      ? likelyReply(ctx, last, seen)
      : recommend(ctx, last, seen, model, { limit: 1, depth }).items[0]?.word ?? null;
    if (next === null) return { line, winner: who === 'them' ? 'me' : 'them' };
    seen.add(next);
    line.push({ word: next, who });
    last = lastCharOf(next);
  }
  return { line, winner: null };
}

// 뜻풀이 파일 조각 번호(0–511). 앞 두 글자로 정해서, 누른 단어의 조각만 읽으면 되게 한다.
export const shardOf = (word) => (word.charCodeAt(0) * 31 + word.charCodeAt(1)) % 512;
