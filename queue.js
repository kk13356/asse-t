export function sleep(ms,signal) {
  return new Promise((resolve,reject)=>{
    signal?.throwIfAborted();
    const abort=()=>{clearTimeout(timer);reject(signal.reason);};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
    signal?.addEventListener('abort',abort,{once:true});
  });
}
// Wait AFTER completion, never between request start times. A failed job pauses the batch.
export async function runJobs(jobs,{execute,wait=sleep,interval,signal,onUpdate=()=>{},onFailure=async()=>false}) {
  for(let i=0;i<jobs.length;i++) {
    signal?.throwIfAborted();const job=jobs[i];
    while(true) {
      onUpdate({phase:'running',index:i,total:jobs.length,job});
      try {await execute(job,i);break;}
      catch(error) {if(signal?.aborted)throw error;onUpdate({phase:'error',index:i,total:jobs.length,job,error});if(!(await onFailure(error,job)))throw error;}
    }
    if(i<jobs.length-1) {onUpdate({phase:'waiting',index:i+1,total:jobs.length,job,until:Date.now()+interval*1000});await wait(interval*1000,signal);}
  }
  onUpdate({phase:'done',index:jobs.length,total:jobs.length});
}
