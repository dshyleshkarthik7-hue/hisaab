import { createRandomStreams } from "./random.js";
import { integer, finiteNumber, boundedText } from "../security/validation.js";
export type GoalKind="general"|"education"|"medical"|"home";
export interface Goal {name:string;at:number;cost:number;kind:GoalKind;flex:boolean}
export interface LifeEvent {label:string;year:number;kind:"income_change"|"expense_change"|"one_time_cost";amount:number}
export interface SimulationInput {years:number;savings:number;income:number;sip:number;expense:number;ret:number;vol:number;income_growth:number;medical_shock:number;seed:number;shocks:boolean;trials?:number;goals:Goal[];events?:LifeEvent[]}
export interface SimulationOptions {trials?:number;seed?:number;sip_boost?:number;sip_amount?:number;delay?:number;glide_path?:boolean;job_loss_enabled?:boolean;medical_shock_enabled?:boolean}
export interface Fan {p10:number;p50:number;p90:number}
export interface ScenarioCard {label:string;score:number;depletion_odds:number;ending_median:number;goals:{name:string;odds:number}[]}
export interface ShockCounterfactual {failures_prevented_if_removed:number;new_failures_in_counterfactual:number;net_failure_reduction:number;paired_trials:number}
export interface NudgePayload {scenarios:ScenarioCard[];best:{text:string;score:number}|null;shock_counterfactuals:Record<string,ShockCounterfactual>;target_sip:{target_score:number;monthly_sip:number;additional_monthly_sip:number;reachable:boolean;achieved_score?:number;trials:number;precision_rupees?:number;reason?:string}}
export interface SimulationResult {score:number;trials:number;seed:number;goals:{name:string;at:number;odds:number}[];fan:Fan[];ending:Fan;depletion_odds:number;sample_paths:{ok:boolean;shocked:boolean;shock_events:{month:number;kind:string;amount?:number}[];values:number[];label:string;tags:string[]}[];diagnostics:{weakest_goal:{name:string;odds:number};failed_lives_with_shock_share:number;shock_cooccurrence_note:string;goal_failure_share:{name:string;failed_trials:number;failure_share:number}[]};nudge:NudgePayload|null;assumptions:Record<string,unknown>;_trial_success:boolean[]}
const INFLATION:Record<GoalKind,[number,number]>={general:[6,1.2],education:[10,2],medical:[8,2],home:[5.5,1.2]};
const KINDS=Object.keys(INFLATION) as GoalKind[];
function percentile(values:number[],q:number){if(!values.length)return 0;const a=[...values].sort((x,y)=>x-y),p=(a.length-1)*q,lo=Math.floor(p),hi=Math.min(lo+1,a.length-1);return a[lo]*(hi-p)+a[hi]*(p-lo);}
function validate(p:SimulationInput){
 if(!p||typeof p!=="object")throw new Error("Request must be a JSON object");
 integer(p.years,"Years",1,40);integer(p.seed,"Seed",0,0xffffffff);integer(p.trials??2000,"Trials",100,10000);
 for(const [k,lo,hi] of [["savings",0,1e12],["income",0,1e8],["sip",0,1e8],["expense",0,1e8],["ret",-50,40],["vol",0,80],["income_growth",-30,50],["medical_shock",0,1e8]] as const)finiteNumber(p[k],k,lo,hi);
 if(typeof p.shocks!=="boolean")throw new Error("shocks must be true or false");
 if(!Array.isArray(p.goals)||p.goals.length<1||p.goals.length>12)throw new Error("Add between 1 and 12 goals");
 p.goals.forEach((g,i)=>{boundedText(g.name,`Goal ${i+1}`,60);integer(g.at,"Goal year",1,p.years);finiteNumber(g.cost,"Goal cost",1,1e11);if(!KINDS.includes(g.kind))throw new Error("Unsupported goal inflation category");if(typeof g.flex!=="boolean")throw new Error("Goal flex must be true or false");});
 const events=p.events??[];if(!Array.isArray(events)||events.length>20)throw new Error("Add no more than 20 life events");
 events.forEach((e,i)=>{if(!["income_change","expense_change","one_time_cost"].includes(e.kind))throw new Error(`Life event ${i+1} has an unsupported type`);integer(e.year,"Life event year",1,p.years);finiteNumber(e.amount,"Life event amount",1,1e8);});
}
function validateOptions(p:SimulationInput,o:SimulationOptions){
 const n=o.trials??p.trials??2000;integer(n,"Trials",100,10000);
 const seed=o.seed??p.seed;integer(seed,"Seed",0,0xffffffff);
 if(o.glide_path!==undefined&&typeof o.glide_path!=="boolean")throw new Error("glide_path must be true or false");
 if(o.job_loss_enabled!==undefined&&typeof o.job_loss_enabled!=="boolean")throw new Error("job_loss_enabled must be true or false");
 if(o.medical_shock_enabled!==undefined&&typeof o.medical_shock_enabled!=="boolean")throw new Error("medical_shock_enabled must be true or false");
 if(o.sip_amount!==undefined)finiteNumber(o.sip_amount,"sip_amount",0,1e8);
 if(o.sip_boost!==undefined)finiteNumber(o.sip_boost,"sip_boost",0,100);
 integer(o.delay??0,"delay",0,40);
 return {n,seed};
}
function trialSeed(seed:number,t:number){return (seed+t*1000003)>>>0;}
export async function simulate(input:SimulationInput,signal?:AbortSignal,onProgress?:(done:number,total:number)=>void,options:SimulationOptions={}):Promise<SimulationResult>{
 validate(input);const {n,seed}=validateOptions(input,options),years=input.years,goals=input.goals;
 const adjusted=goals.map(g=>({...g,at:Math.min(years,g.at+((g.flex)?(options.delay??0):0))}));
 const eventsByYear=new Map<number,LifeEvent[]>();for(const e of input.events??[]){const list=eventsByYear.get(e.year)??[];list.push(e);eventsByYear.set(e.year,list);}
 const yearly=Array.from({length:years+1},()=>[] as number[]),hits=goals.map(()=>0),failures=goals.map(()=>0);
 let depleted=0,allHits=0,shockFailures=0;
 const samples:{ok:boolean;shocked:boolean;shock_events:{month:number;kind:string;amount?:number}[];values:number[];ending:number}[]=[];
 const glide=options.glide_path??false,jobEnabled=options.job_loss_enabled??true,medicalEnabled=options.medical_shock_enabled??true;
 for(let trial=0;trial<n;trial++){
  if(signal?.aborted)throw new DOMException("Simulation cancelled","AbortError");
  const trialSeed=trialSeed(seed,trial),rng=createRandomStreams(trialSeed);
  let equity=input.savings,safe=0,reserves=goals.map(()=>0),income=input.income,sip=options.sip_amount??input.sip*(options.sip_boost??1),expense=input.expense;
  const infl:Record<GoalKind,number>={general:1,education:1,medical:1,home:1};
  const monthlyInfl:Record<GoalKind,number>={general:1,education:1,medical:1,home:1};
  let expenseIndex=1;const success=goals.map(()=>true);let unemployed=0,hadShock=false;
  const shockEvents:{month:number;kind:string;amount?:number}[]=[],path=[Math.round(equity*100)/100];yearly[0].push(equity);
  for(let month=1;month<=years*12;month++){
   if(month%12===1){
    const year=Math.floor((month-1)/12)+1;
    for(const ev of eventsByYear.get(year)??[]){if(ev.kind==="income_change")income+=ev.amount;else if(ev.kind==="expense_change")expense+=ev.amount;else equity-=ev.amount*infl.general;}
    for(const kind of KINDS){const [mean,sd]=INFLATION[kind];const rate=Math.max(-.02,rng.inflation.gauss(mean,sd))/100;infl[kind]*=1+rate;monthlyInfl[kind]=Math.pow(1+rate,1/12);}
    if(glide){
     for(let i=0;i<goals.length;i++){const g=adjusted[i],left=g.at-year;if(!g.flex&&left>=0&&left<=3){const target=g.cost*infl[g.kind]*Math.pow(1+INFLATION[g.kind][0]/100,left),pv=target/Math.pow(1.065,left),move=Math.min(Math.max(0,equity),Math.max(0,pv-reserves[i]));equity-=move;reserves[i]+=move;}}
    }
   }
   const logMean=Math.log1p(input.ret/100)-.5*Math.pow(input.vol/100,2);
   equity*=1+Math.expm1(rng.market.gauss(logMean/12,input.vol/Math.sqrt(12)/100));
   const debtVol=.005,debtLogMean=Math.log1p(.065)-.5*debtVol*debtVol;
   const debtReturn=Math.expm1(rng.debt.gauss(debtLogMean/12,debtVol/Math.sqrt(12)));safe*=1+debtReturn;reserves=reserves.map(v=>v*(1+debtReturn));
   const monthlyExpense=expense*expenseIndex;
   if(input.shocks&&jobEnabled&&unemployed===0&&rng.unemployment()<1-Math.pow(1-.07,1/12)){unemployed=6;hadShock=true;shockEvents.push({month,kind:"unemployment"});}
   let monthlyIncome:number,contribution:number;
   if(unemployed){unemployed--;monthlyIncome=0;contribution=0;}
   else{monthlyIncome=income;contribution=Math.min(sip,Math.max(0,monthlyIncome-monthlyExpense));}
   equity+=contribution-Math.max(0,monthlyExpense-monthlyIncome);
   if(input.shocks&&medicalEnabled&&input.medical_shock&&rng.medical()<1-Math.pow(1-.05,1/12)){const cost=input.medical_shock*infl.medical;equity-=cost;hadShock=true;shockEvents.push({month,kind:"medical",amount:Math.round(cost*100)/100});}
   if(equity<0){safe=Math.max(0,safe+equity);equity=0;}
   expenseIndex*=monthlyInfl.general;
   if(monthlyIncome>0){const growth=Math.pow(1+input.income_growth/100,1/12)-1;income*=1+growth;sip*=1+growth;}
   if(month%12===0){
    const year=month/12;
    for(let i=0;i<goals.length;i++){const g=adjusted[i];if(g.at===year){const target=g.cost*infl[g.kind],available=equity+safe+reserves[i];if(available+.01>=target){const reserveUsed=Math.min(reserves[i],target);reserves[i]-=reserveUsed;const remaining=target-reserveUsed,fromSafe=Math.min(safe,remaining);safe-=fromSafe;equity=Math.max(0,equity-(remaining-fromSafe));}else{success[i]=false;if(!g.flex){equity=safe=0;reserves=reserves.map(()=>0);}}}}
    const real=(equity+safe+reserves.reduce((a,b)=>a+b,0))/infl.general;yearly[year].push(real);path.push(Math.round(real*100)/100);
   }
  }
  for(let i=0;i<success.length;i++){if(success[i])hits[i]++;else failures[i]++;}
  const ok=success.every(Boolean);if(ok)allHits++;if(!ok&&hadShock)shockFailures++;
  if(equity+safe+reserves.reduce((a,b)=>a+b,0)<=.01)depleted++;
  samples.push({ok,shocked:hadShock,shock_events:shockEvents,values:path,ending:equity+safe+reserves.reduce((a,b)=>a+b,0)});
  if((trial+1)%100===0){onProgress?.(trial+1,n);await new Promise<void>(resolve=>setTimeout(resolve,0));}
 }
 const fan=yearly.map(v=>({p10:Math.round(percentile(v,.1)*100)/100,p50:Math.round(percentile(v,.5)*100)/100,p90:Math.round(percentile(v,.9)*100)/100}));
 const ordered=Array.from({length:n},(_,i)=>i).sort((a,b)=>samples[a].ending-samples[b].ending);
 const survivors=Array.from({length:n},(_,i)=>i).filter(i=>samples[i].ok);
 const worstSurvivor=survivors.length?survivors.reduce((best,i)=>samples[i].ending<samples[best].ending?i:best,survivors[0]):null;
 const mid=ordered[Math.floor(n/2)],special=new Set([worstSurvivor,mid].filter((v):v is number=>v!==null));
 let stress=Array.from({length:n},(_,i)=>i).find(i=>(samples[i].shocked||!samples[i].ok||samples[i].ending<=.01)&&!special.has(i));
 if(stress===undefined)stress=Array.from({length:n},(_,i)=>i).find(i=>samples[i].shocked||!samples[i].ok||samples[i].ending<=.01);
 if(stress!==undefined)special.add(stress);
 const quantiles=new Set(Array.from({length:25},(_,k)=>ordered[Math.round(k*(ordered.length-1)/24)])),chosen=new Set([...special,...quantiles]);
 while(chosen.size>25){const removable=[...chosen].sort((a,b)=>b-a).find(i=>!special.has(i));if(removable===undefined)break;chosen.delete(removable);}
 if(chosen.size<25){for(const i of ordered){chosen.add(i);if(chosen.size===25)break;}}
 const selected=[...chosen].sort((a,b)=>a-b).map(i=>{const x=samples[i],tags:string[]=[];if(worstSurvivor!==null&&i===worstSurvivor)tags.push("worst_surviving");if(i===mid)tags.push("median");if(stress!==undefined&&i===stress)tags.push("depleted_or_shocked");return {...x,tags,label:tags[0]??"sample"};});
 const goalResults=goals.map((g,i)=>({name:g.name,at:adjusted[i].at,odds:hits[i]/n}));
 const weakest=goalResults.reduce((a,b)=>b.odds<a.odds?b:a,goalResults[0]);
 const failed=Math.max(1,n-allHits);
 return {score:allHits/n,trials:n,seed,goals:goalResults,fan,ending:fan[years],depletion_odds:depleted/n,sample_paths:selected,diagnostics:{failed_lives_with_shock_share:allHits<n?Math.round(shockFailures/failed*1000)/1000:0,shock_cooccurrence_note:"Share of failed trials that also experienced at least one shock; this is association, not causal attribution.",weakest_goal:{name:weakest.name,odds:weakest.odds},goal_failure_share:goals.map((g,i)=>({name:g.name,failed_trials:failures[i],failure_share:Math.round(failures[i]/n*1000)/1000}))},nudge:null,assumptions:{monthly_cashflow:true,expense_inflation:"general",goal_inflation:"category-specific",job_loss_months:6,job_loss_annual_probability:.07,medical_event_annual_probability:.05,glide_path_enabled:glide,debt_bucket_return:.065,debt_bucket_volatility:.005,life_events:input.events??[],return_model:"lognormal monthly returns calibrated to annual arithmetic mean and volatility"},_trial_success:samples.map(x=>x.ok)};
}
export async function targetSip(p:SimulationInput,base:SimulationResult,signal?:AbortSignal,onProgress?:(done:number,total:number)=>void,target=.85){
 finiteNumber(target,"target",Number.EPSILON,1);
 if(base.score>=target)return {target_score:target,monthly_sip:Math.round(p.sip*100)/100,additional_monthly_sip:0,reachable:true,achieved_score:base.score,trials:base.trials};
 let income=p.income,maxIncome=income;const incomeEvents=new Map<number,number>();for(const e of p.events??[])if(e.kind==="income_change")incomeEvents.set(e.year,(incomeEvents.get(e.year)??0)+e.amount);
 for(let y=1;y<=p.years;y++){income+=incomeEvents.get(y)??0;maxIncome=Math.max(maxIncome,income);income*=1+p.income_growth/100;maxIncome=Math.max(maxIncome,income);}
 let high=Math.max(p.sip,Math.min(1e8,maxIncome));
 if(high<=p.sip+.005)return {target_score:target,monthly_sip:Math.round(p.sip*100)/100,additional_monthly_sip:0,reachable:false,achieved_score:base.score,trials:base.trials,reason:"No higher planned SIP is feasible within the modelled income ceiling."};
 const upper=await simulate(p,signal,onProgress,{trials:p.trials,seed:p.seed,sip_amount:high});
 if(upper.score<target)return {target_score:target,monthly_sip:Math.round(high*100)/100,additional_monthly_sip:Math.round(Math.max(0,high-p.sip)*100)/100,reachable:false,achieved_score:upper.score,trials:base.trials,reason:"Target not reached even when planned SIP is set to the modelled income ceiling."};
 let low=p.sip;
 for(let i=0;i<48;i++){if(signal?.aborted)throw new DOMException("Simulation cancelled","AbortError");if(high-low<=.005)break;const mid=(low+high)/2;const r=await simulate(p,signal,onProgress,{trials:p.trials,seed:p.seed,sip_amount:mid});if(r.score>=target)high=mid;else low=mid;}
 let monthly=Math.ceil(high*100-1e-9)/100,verified=await simulate(p,signal,onProgress,{trials:p.trials,seed:p.seed,sip_amount:monthly});
 if(verified.score<target){monthly=Math.round((monthly+.01)*100)/100;verified=await simulate(p,signal,onProgress,{trials:p.trials,seed:p.seed,sip_amount:monthly});}
 return {target_score:target,monthly_sip:Math.round(monthly*100)/100,additional_monthly_sip:Math.round(Math.max(0,monthly-p.sip)*100)/100,reachable:verified.score>=target,achieved_score:verified.score,trials:base.trials,precision_rupees:.01};
}
export async function nudge(p:SimulationInput,base:SimulationResult,signal?:AbortSignal,onProgress?:(done:number,total:number)=>void):Promise<NudgePayload>{
 const seed=p.seed,trials=p.trials??2000;
 const options:[string,SimulationOptions][]=[["Baseline",{}],["3-Yr Debt Glide-Path",{glide_path:true}],["SIP +15%",{sip_boost:1.15}],["SIP +30% + Glide-Path",{sip_boost:1.30,glide_path:true}]];
 const scenarios:ScenarioCard[]=[];
 for(const [label,change] of options){const r=label==="Baseline"?base:await simulate(p,signal,onProgress,{...change,trials,seed});scenarios.push({label,score:r.score,depletion_odds:r.depletion_odds,ending_median:r.ending.p50,goals:r.goals.map(g=>({name:g.name,odds:g.odds}))});}
 const best=scenarios.slice(1).reduce((a,b)=>b.score>a.score?b:a,scenarios[1]);
 const causal:Record<string,ShockCounterfactual>={};
 if(base._trial_success.length===trials){
  const withoutJob=await simulate(p,signal,onProgress,{trials,seed,job_loss_enabled:false});
  const withoutMedical=await simulate(p,signal,onProgress,{trials,seed,medical_shock_enabled:false});
  for(const [label,cf] of [["unemployment",withoutJob],["medical",withoutMedical]] as const){
   let prevented=0,newlyFailed=0;for(let i=0;i<trials;i++){const b=base._trial_success[i],a=cf._trial_success[i];if(!b&&a)prevented++;if(b&&!a)newlyFailed++;}
   causal[label]={failures_prevented_if_removed:prevented,new_failures_in_counterfactual:newlyFailed,net_failure_reduction:prevented-newlyFailed,paired_trials:trials};
  }
 }
 const target=await targetSip(p,base,signal,onProgress);
 return {scenarios,best:best.score>base.score+.005?{text:best.label,score:best.score}:null,shock_counterfactuals:causal,target_sip:target};
}
export async function simulateComplete(input:SimulationInput,signal?:AbortSignal,onProgress?:(done:number,total:number)=>void):Promise<SimulationResult>{
 const base=await simulate(input,signal,onProgress);base.nudge=await nudge(input,base,signal,onProgress);return base;
}
