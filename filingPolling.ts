// 완료 후 다음 조회를 예약해 느린 네트워크에서도 요청이 겹치지 않도록 합니다.
export const FILING_POLL_MS = 15_000;
export function startFilingPolling(task: (signal: AbortSignal) => Promise<void>) {
  let stopped=false, busy=false, rerun=false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const run=async()=>{
    if(stopped)return;
    if(busy){rerun=true;return;}
    if(timer)clearTimeout(timer);
    busy=true; controller=new AbortController();
    try { await task(controller.signal); } catch { /* 호출자가 사용자용 오류 상태를 처리합니다. */ }
    finally {
      busy=false;
      if(!stopped){const delay=rerun?0:document.visibilityState==='hidden'?60_000:FILING_POLL_MS;rerun=false;timer=setTimeout(()=>void run(),delay);}
    }
  };
  const wake=()=>{if(document.visibilityState!=='hidden')void run();};
  window.addEventListener('focus',wake);window.addEventListener('online',wake);document.addEventListener('visibilitychange',wake);
  void run();
  return ()=>{stopped=true;if(timer)clearTimeout(timer);controller?.abort();window.removeEventListener('focus',wake);window.removeEventListener('online',wake);document.removeEventListener('visibilitychange',wake);};
}
