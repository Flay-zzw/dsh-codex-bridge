import { createInterface } from 'node:readline';
const lines=createInterface({input:process.stdin});
for await (const line of lines) {
  const request=JSON.parse(line);
  if(request.id===undefined)continue;
  let result={};
  if(request.method==='initialize')result={userAgent:'mock-codex'};
  else if(request.method==='account/rateLimits/read')result={rateLimits:{limitId:'codex',primary:{usedPercent:25,windowDurationMins:300,resetsAt:2000000000}}};
  else if(request.method==='thread/start')result={thread:{id:'thread-rpc'}};
  else if(request.method==='turn/start') {
    result={turn:{id:'turn-rpc'}};
    process.stdout.write(JSON.stringify({method:'item/completed',params:{threadId:'thread-rpc',item:{type:'agentMessage',text:'RPC fixture output'}}})+'\n');
    process.stdout.write(JSON.stringify({method:'turn/completed',params:{threadId:'thread-rpc',turn:{id:'turn-rpc',status:'completed'}}})+'\n');
  }
  process.stdout.write(JSON.stringify({id:request.id,result})+'\n');
}
