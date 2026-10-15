// 글자별 승률 통계. chars[c] = [n, w]: 글자 c 를 상대에게 넘긴 횟수와 그 판을 이긴 횟수.

export const emptyModel = () => ({ version: 1, games: 0, chars: {} });

const NONE = [0, 0];
const stat = (model, ch) => model.chars[ch] ?? NONE;

export function score(model, ch) {
  const [n, w] = stat(model, ch);
  return (w + 1) / (n + 2);
}

// 자가 대국용: 덜 써 본 글자에 탐색 보너스를 준다.
export function ucb(model, ch) {
  return score(model, ch) + Math.sqrt((2 * Math.log(model.games + 1)) / (stat(model, ch)[0] + 1));
}

// 한 수에서 여러 글자를 채점할 때 쓴다. score·ucb 와 같은 값을 주되 로그는 한 번만 계산한다.
export function scorer(model, explore) {
  const bonus = explore ? 2 * Math.log(model.games + 1) : 0;
  return (ch) => {
    const [n, w] = stat(model, ch);
    const s = (w + 1) / (n + 2);
    return explore ? s + Math.sqrt(bonus / (n + 1)) : s;
  };
}

function add(model, ch, n, w) {
  const [n0, w0] = stat(model, ch);
  model.chars[ch] = [n0 + n, w0 + w];
}

export function update(model, givenByWinner, givenByLoser) {
  model.games++;
  for (const ch of givenByWinner) add(model, ch, 1, 1);
  for (const ch of givenByLoser) add(model, ch, 1, 0);
}

export function merge(a, b) {
  const out = { version: 1, games: a.games + b.games, chars: {} };
  for (const m of [a, b]) for (const [ch, [n, w]] of Object.entries(m.chars)) add(out, ch, n, w);
  return out;
}

// a 의 통계에 w 를 곱해 b 에 더한다. 자가 대국 모델(a)과 스파링 모델(b)을 봇 하나로 합칠 때 쓴다(README "학습").
export function blend(a, b, w) {
  const out = merge(emptyModel(), b);
  out.games += a.games;
  for (const [ch, [n, v]] of Object.entries(a.chars)) add(out, ch, Math.round(n * w), Math.round(v * w));
  return out;
}

// 같은 base 에서 출발해 따로 배운 모델들을 합친다: base + Σ(part − base)
export function combine(base, parts) {
  const out = merge(base, emptyModel());
  for (const part of parts) {
    out.games += part.games - base.games;
    for (const [ch, [n, w]] of Object.entries(part.chars)) {
      const [n0, w0] = stat(base, ch);
      add(out, ch, n - n0, w - w0);
    }
  }
  return out;
}

export function parseModel(json) {
  try {
    const m = JSON.parse(json);
    const ok = m?.version === 1 && Number.isFinite(m.games) && m.chars !== null && typeof m.chars === 'object' && !Array.isArray(m.chars)
      && Object.values(m.chars).every((v) => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite));
    return ok ? { version: 1, games: m.games, chars: m.chars } : emptyModel();
  } catch {
    return emptyModel();
  }
}
