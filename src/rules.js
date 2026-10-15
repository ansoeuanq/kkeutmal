// 룰(칸)마다 쓰는 사전과 규칙. 브라우저와 Node 가 함께 쓴다.
import { posOf, srcOf } from './engine.js';

// 구가 아니면서 품사에 명사·형용사·부사가 들어 있는 말 (의존 명사·대명사·수사·보조 형용사는 치지 않는다)
const PLAYABLE_POS = ['명사', '형용사', '부사'];
const isPlayable = (dict, word) => dict.types.get(word) < 4 && posOf(dict, word).split('·').some((p) => PLAYABLE_POS.includes(p));
const has = (dict, word, bit) => (srcOf(dict, word) & bit) !== 0;

// only: 사전을 받아 "이 룰에서 쓸 수 있는 말인가"를 돌려주는 조건을 만든다.
// allowed: 화면 맨 위에 보여 줄, 쓸 수 있는 말.
// sparring: 자가 대국으로 배운 모델 말고 스파링(표준어만 아는 상대)으로 배운 모델도 따로 있는 칸.
const WORDS = '명사, 형용사, 부사 사용 가능';
export const RULES = {
  old: {
    name: '구엜룰',
    allowed: WORDS,
    note: '표준국어대사전의 명사·형용사·부사를 씁니다. 2019년 3월 개정 이전 판은 공개된 적이 없어, 구할 수 있는 가장 오래된 2019년 6월 25일 판으로 대신했습니다. 한방단어를 쓸 수 있습니다.',
    only: (dict) => (word) => has(dict, word, 4),
    sparring: true,
  },
  new: {
    name: '신엜룰',
    allowed: WORDS,
    note: '현행 표준국어대사전의 명사·형용사·부사를 씁니다. 한방단어를 쓸 수 있습니다.',
    only: (dict) => (word) => has(dict, word, 2),
    sparring: true,
  },
  naver: {
    name: '넶룰',
    allowed: WORDS,
    note: '네이버 국어사전은 공개 자료가 없어 표준국어대사전과 우리말샘을 합친 명사·형용사·부사로 대신했습니다(고려대 한국어대사전이 빠진 근사). 한방단어를 쓸 수 있습니다.',
    only: (dict) => (word) => has(dict, word, 2) || (has(dict, word, 1) && isPlayable(dict, word)),
    sparring: true,
  },
  woosam: {
    name: '우샘룰',
    allowed: WORDS,
    note: '우리말샘의 명사·형용사·부사를 씁니다(구 제외). 한방단어를 쓸 수 있습니다.',
    only: (dict) => (word) => has(dict, word, 1) && isPlayable(dict, word),
    sparring: true,
  },
  kkt: {
    name: '쿵쿵따',
    allowed: '3글자 말, 모든 품사 사용 가능',
    note: '3글자 말만 씁니다(구 제외). 한방단어를 쓸 수 있습니다.',
    only: (dict) => (word) => word.length === 3 && has(dict, word, 1) && dict.types.get(word) < 4,
  },
};

// createContext 에 넘길 옵션
export const contextOptions = (dict, rule) => ({ hanbang: true, only: RULES[rule].only(dict) });

// 학습 모델을 가르는 이름. 스파링 모델이 있는 칸은 학습 방식으로 둘로 나뉜다.
export const modelKey = (rule, sparring = false) => (sparring && RULES[rule].sparring ? `${rule}-sparring` : rule);

// 모델 파일 이름 (data 폴더 안)
export const modelFile = (key) => `model-${key}.json`;
