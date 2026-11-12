import { simulateComplete, type SimulationInput } from "../core/simulation.js";
type Request={type:"run"|"baseline";id:number;input:SimulationInput}|{type:"cancel";id:number};
const scope=self as unknown as DedicatedWorkerGlobalScope;
const controllers=new Map<number,AbortController>();
scope.addEventListener("message",async(event:MessageEvent<Request>)=>{
 const message=event.data;
 if(message.type==="cancel"){controllers.get(message.id)?.abort();return;}
 const controller=new AbortController();controllers.set(message.id,controller);
 try{
  const progress=(done:number,total:number)=>scope.postMessage({type:"progress",id:message.id,done,total});
  const result=message.type==="baseline"?await simulate(message.input,controller.signal,progress):await simulateComplete(message.input,controller.signal,progress);
  if(!controller.signal.aborted)scope.postMessage({type:"result",id:message.id,result});
 }catch(error){scope.postMessage({type:"error",id:message.id,message:error instanceof Error?error.message:"Simulation failed"});}
 finally{controllers.delete(message.id);}
});
export {};
