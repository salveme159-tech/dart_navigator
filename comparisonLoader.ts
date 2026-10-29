/** Bounded, progressive comparison requests. Cancelling suppresses even late, non-abortable results. */
export function startComparisonLoad<TTask, TResult>(options: {
  tasks: TTask[];
  load: (task:TTask, signal:AbortSignal)=>Promise<TResult>;
  onResult:(task:TTask, result:TResult)=>void;
  onError:(task:TTask, error:unknown)=>void;
  onProgress?:(progress:{completed:number;total:number;failed:number})=>void;
  onComplete?:(progress:{completed:number;total:number;failed:number})=>void;
  concurrency?:number;
  timeoutMs?:number;
}) {
  const controllers=new Set<AbortController>();
  const tasks=[...options.tasks];
  let active=true, next=0, completed=0, failed=0;
  const progress=()=>({completed,total:tasks.length,failed});
  const worker=async()=>{
    while(active && next<tasks.length){
      const task=tasks[next++], controller=new AbortController();controllers.add(controller);
      let timeout:ReturnType<typeof setTimeout> | undefined;
      let expired=false;
      // Racing with abort guarantees queue completion even if a fetch wrapper ignores cancellation.
      const aborted=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error(expired ? '조회 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.' : '조회 취소')),{once:true}));
      timeout=setTimeout(()=>{expired=true;controller.abort();},options.timeoutMs ?? 45_000);
      try {
        const result=await Promise.race([Promise.resolve().then(()=>{if(controller.signal.aborted)throw new Error("조회 취소");return options.load(task,controller.signal);}),aborted]);
        if(active)options.onResult(task,result);
      } catch(error) {
        if(active){failed++;options.onError(task,error);}
      } finally {
        clearTimeout(timeout);controllers.delete(controller);
        if(active){completed++;options.onProgress?.(progress());}
      }
    }
  };
  options.onProgress?.(progress());
  const done=Promise.all(Array.from({length:Math.min(tasks.length,Math.max(1,Math.floor(options.concurrency ?? 4)))},worker)).then(()=>{if(active)options.onComplete?.(progress());});
  return {done,cancel:()=>{active=false;for(const controller of controllers)controller.abort();controllers.clear();}};
}
