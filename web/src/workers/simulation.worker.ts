import { simulate, type SimulationInput } from "../core/simulation.js";
type Request={type:"run";id:number;input:SimulationInput}|{type:"cancel";id:number};
const cancelled=new Set<number>();
self.addEventListener("message",(event:MessageEvent<Request>)=>{
 const message=event.data;if(message.type==="cancel"){cancelled.add(message.id);return;}
 try{
  const controller=new AbortController();
  // Cancellation is cooperative between trial batches; worker termination remains the hard stop.
  const result=simulate(message.input,controller.signal,(done,total)=>self.postMessage({type:"progress",id:message.id,done,total}));
  if(!cancelled.has(message.id))self.postMessage({type:"result",id:message.id,result});
 }catch(error){self.postMessage({type:"error",id:message.id,message:error instanceof Error?error.message:"Simulation failed"});}
 cancelled.delete(message.id);
});
export {};
