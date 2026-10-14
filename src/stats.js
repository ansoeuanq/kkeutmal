// 판 결과를 승률 서버로 보낸다. 서버는 이 PC의 WSL 에서 돌고 Cloudflare 빠른 터널로 열려 있어 주소가 가끔 바뀐다.
// 그래서 지금 주소는 공개 저장소의 stats-endpoint.txt 에서 읽는다(서버를 켤 때 서버가 고쳐 적는다).
// 못 보낸 결과는 기기에 쌓아 두었다가 다음에 보낸다.

export const OUTBOX_LIMIT = 200;
const OUTBOX_KEY = 'kkeutmal.outbox.v1';
const OFF_KEY = 'kkeutmal.stats.off.v1';

// 플레이어 이름: 앞뒤 공백을 떼고 1~12자의 한글 음절·영문·숫자·공백·_·- 만. 맞지 않으면 null.
export function cleanName(input) {
  if (typeof input !== 'string') return null;
  const name = input.trim();
  return /^[가-힣A-Za-z0-9 _-]{1,12}$/.test(name) ? name : null;
}

// storage: { get, set } (app.js 의 막혀도 안 죽는 저장소). endpointList: 서버 주소가 적힌 파일의 주소.
export function createReporter({ storage, fetch = globalThis.fetch, endpointList }) {
  const read = () => {
    try { return JSON.parse(storage.get(OUTBOX_KEY)) ?? []; } catch { return []; }
  };
  const write = (list) => storage.set(OUTBOX_KEY, JSON.stringify(list));
  const isOff = () => storage.get(OFF_KEY) === '1';
  let flushing = null;

  async function send() {
    const list = read();
    if (!list.length) return;
    // 주소 파일은 공개 주소의 캐시를 피해서 매번 새로 읽는다
    const base = (await (await fetch(`${endpointList}?t=${Date.now()}`, { cache: 'no-store' })).text()).trim();
    if (!/^https:\/\/[\w.-]+$/.test(base)) return; // 서버가 아직 주소를 적지 않았다
    while (list.length) {
      const response = await fetch(`${base}/api/games`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(list[0]),
        keepalive: true,
      });
      if (response.status >= 500) break; // 서버 문제: 다음에 다시
      list.shift(); // 받았거나(2xx) 잘못된 결과라 거절당했다(4xx): 다시 보내지 않는다
      write(list);
    }
  }

  return {
    enqueue(result) {
      if (isOff()) return;
      write([...read(), result].slice(-OUTBOX_LIMIT));
    },
    // 한 번에 하나만 돈다. 네트워크가 끊겨 있으면 조용히 다음으로 미룬다.
    flush() {
      if (isOff()) return Promise.resolve();
      flushing ??= send().catch(() => {}).finally(() => { flushing = null; });
      return flushing;
    },
    pending: () => read().length,
    isOff,
    setOff(off) {
      storage.set(OFF_KEY, off ? '1' : '0');
      if (off) write([]);
    },
  };
}
