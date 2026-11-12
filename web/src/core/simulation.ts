import { createRandomStreams } from "./random.js";
import { integer, finiteNumber, boundedText } from "../security/validation.js";
export type GoalKind="general"|"education"|"medical"|"home";
export interface Goal {name:string;at:number;cost:number;kind:GoalKind;flex:boolean}
export interface LifeEvent {label:string;year:number;kind:"income_change"|"expense_change"|"one_time_cost";amount:number}
export interface SimulationInput {years:number;savings:number;income:number;sip:number;expense:number;ret:number;vol:number;income_growth:number;medical_shock:number;seed:number;shocks:boolean;trials?:number;goals:Goal[];events?:LifeEvent[]}
export interface SimulationResult {score:number;trials:number;seed:number;goals:{name:string;at:number;odds:number}[];fan:{p10:number;p50:number;p90:number}[];ending:{p10:number;p50:number;p90:number};depletion_odds:number;sample_paths:{ok:boolean;shocked:boolean;shock_events:{month:number;kind:string;amount?:number}[];values:number[];label:string}[];diagnostics:{weakest_goal:{name:string;odds:number};failed_lives_with_shock_share:number};nudge:null}
const INFLATION:Record<GoalKind,[number,number]>={general:[6,1.2],education:[10,2],medical:[8,2],home:[5.5,1.2]};
const clamp=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));
function percentile(values:number[],q:number){const a=[...values].sort((x,y)=>x-y),p=(a.length-1)*q,l=Math.floor(p);return a[l]+(a[Math.min(l+1,a.length-1)]-a[l])*(p-l);}
function validate(p:SimulationInput){
 integer(p.years,"Years",1,40); integer(p.seed,"Seed",0,0xffffffff); integer(p.trials??2000,"Trials",100,10000);
 for(const [k,lo,hi] of [["savings",0,1e12],["income",0,1e8],["sip",0,1e8],["expense",0,1e8],["ret",-50,40],["vol",0,80],["income_growth",-30,50],["medical_shock",0,1e8]] as const) finiteNumber(p[k],k,lo,hi);
 if(!Array.isArray(p.goals)||p.goals.length<1||p.goals.length>12) throw new Error("Add between 1 and 12 goals");
 p.goals.forEach((g,i)=>{boundedText(g.name,`Goal ${i+1}`,60);integer(g.at,"Goal year",1,p.years);finiteNumber(g.cost,"Goal cost",1,1e11);if(!(g.kind in INFLATION))throw new Error("Unsupported goal inflation category");});
}
function gaussian(r:()=>number){const u=Math.max(Number.EPSILON,r()),v=r();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
export async function simulate(input:SimulationInput,signal?:AbortSignal,onProgress?:(done:number,total:number)=>void):Promise<SimulationResult>{
 validate(input);const n=input.trials??2000,years=input.years,goalHits=input.goals.map(()=>0),yearly=Array.from({length:years+1},()=>[] as number[]),samples:{ok:boolean;shocked:boolean;shock_events:{month:number;kind:string;amount?:number}[];values:number[];ending:number}[]=[];
 let depleted=0,failedShock=0,allHit=0;
 for(let t=0;t<n;t++){
  if(signal?.aborted)throw new DOMException("Simulation cancelled","AbortError");
  const seed=(input.seed+t*1000003)>>>0,rng=createRandomStreams(seed),streams=[rng.inflation,rng.market,rng.debt,rng.unemployment,rng.medical];
  let corpus=input.savings,safe=0,income=input.income,sip=input.sip,expense=input.expense,unemployed=0,shocked=false;
  const indexes:Record<GoalKind,number>={general:1,education:1,medical:1,home:1},success=input.goals.map(()=>true),events=input.events??[],shock_events:{month:number;kind:string;amount?:number}[]=[],path=[corpus];
  yearly[0].push(corpus);let expenseIndex=1;
  for(let m=1;m<=years*12;m++){
   const y=Math.ceil(m/12);
   if(m%12===1){
    for(const ev of events.filter(e=>e.year===y)){if(ev.kind==="income_change")income+=ev.amount;else if(ev.kind==="expense_change")expense+=ev.amount;else corpus-=ev.amount*indexes.general;}
    for(const k of Object.keys(INFLATION) as GoalKind[]){const [mean,sd]=INFLATION[k];indexes[k]*=1+Math.max(-.02,(mean+sd*gaussian(streams[0]))/100);}
   }
   const logMean=Math.log1p(input.ret/100)-.5*(input.vol/100)**2;
   corpus*=1+Math.expm1(logMean/12+input.vol/100/Math.sqrt(12)*gaussian(streams[1]));
   safe*=1+Math.expm1(Math.log1p(.065)/12+.005/Math.sqrt(12)*gaussian(streams[2]));
   if(input.shocks&&unemployed===0&&streams[3]()<1-Math.pow(.93,1/12)){unemployed=6;shocked=true;shock_events.push({month:m,kind:"unemployment"});}
   const monthlyIncome=unemployed>0?0:income;if(unemployed>0)unemployed--;
   corpus+=Math.min(sip,Math.max(0,monthlyIncome-expense*expenseIndex))-Math.max(0,expense*expenseIndex-monthlyIncome);
   if(input.shocks&&input.medical_shock>0&&streams[4]()<1-Math.pow(.95,1/12)){const cost=input.medical_shock*indexes.medical;corpus-=cost;shocked=true;shock_events.push({month:m,kind:"medical",amount:cost});}
   if(corpus<0){safe=Math.max(0,safe+corpus);corpus=0;}
   expenseIndex*=Math.pow(indexes.general,1/12);
   if(monthlyIncome>0){const growth=Math.pow(1+input.income_growth/100,1/12);income*=growth;sip*=growth;}
   if(m%12===0){
    input.goals.forEach((g,i)=>{if(g.at===y){const target=g.cost*indexes[g.kind],available=corpus+safe;if(available>=target){const fromSafe=Math.min(safe,target);safe-=fromSafe;corpus=Math.max(0,corpus-(target-fromSafe));}else{success[i]=false;if(!g.flex)corpus=safe=0;}}});
    yearly[y].push((corpus+safe)/indexes.general);path.push((corpus+safe)/indexes.general);
   }
  }
  success.forEach((ok,i)=>{if(ok)goalHits[i]++;});const ok=success.every(Boolean);if(ok)allHit++;else if(shocked)failedShock++;if(corpus+safe<=.01)depleted++;
  samples.push({ok,shocked,shock_events,values:path,ending:corpus+safe});
  if((t+1)%100===0){onProgress?.(t+1,n);await new Promise<void>(resolve=>setTimeout(resolve,0));}
 }
 const fan=yearly.map(v=>({p10:percentile(v,.1),p50:percentile(v,.5),p90:percentile(v,.9)}));
 const ordered=[...samples].sort((a,b)=>a.ending-b.ending),median=ordered[Math.floor(n/2)];
 const selected=[ordered[0],median, ...samples.filter(s=>s.shocked).slice(0,22)].slice(0,25);
 const goals=input.goals.map((g,i)=>({name:g.name,at:g.at,odds:goalHits[i]/n}));
 const weakest=[...goals].sort((a,b)=>a.odds-b.odds)[0];
 return {score:allHit/n,trials:n,seed:input.seed,goals,fan,ending:fan[years],depletion_odds:depleted/n,sample_paths:selected.map((s,i)=>({...s,label:i===0?"low":s===median?"median":"sample"})),diagnostics:{weakest_goal:{name:weakest.name,odds:weakest.odds},failed_lives_with_shock_share:allHit===n?0:failedShock/(n-allHit)},nudge:null};
}
