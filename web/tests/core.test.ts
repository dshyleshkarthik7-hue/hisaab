import { calculateEmi } from "../src/core/emi.js";
import { computeTax, estimateSalary, compareRegimes } from "../src/core/tax.js";
import { simulate, nudge, targetSip } from "../src/core/simulation.js";
import { createRandomStreams } from "../src/core/random.js";
const assert=(ok:boolean,message:string)=>{if(!ok)throw new Error(message);};
const close=(a:number,b:number,message:string,tol=1e-8)=>assert(Math.abs(a-b)<=tol,`${message}: expected ${b}, got ${a}`);
async function main(){
 close(calculateEmi(100000,0,1).emi,100000/12,"zero-rate EMI");
 close(calculateEmi(100000,10,1).emi,100000*(10/1200)/(1-Math.pow(1+10/1200,-12)),"EMI");
 assert(computeTax(1200000).total_tax===0,"87A rebate threshold");
 assert(computeTax(1300000).total_tax>0,"tax above rebate threshold");
 const marginal=computeTax(1200001);assert(marginal.total_tax<=1.04,"marginal relief before cess");
 assert(compareRegimes(1500000).new&&compareRegimes(1500000).old,"regime comparison");
 const salary=estimateSalary(1500000,40,200);assert(salary.inhand>0&&salary.employeePf===7200,"legacy payroll PF cap");
 const py=createRandomStreams(42).market,reference=[0.6394267984578837,0.025010755222666936,0.27502931836911926,0.22321073814882275,0.7364712141640124];
 reference.forEach((v)=>close(py(),v,"CPython MT19937 random stream"));
 const gauss=createRandomStreams(42).market.gauss,gaussRef=-0.14409032957792836;close(gauss(),gaussRef,"CPython gauss");
 const input={years:2,savings:500000,income:100000,sip:20000,expense:50000,ret:8,vol:12,income_growth:5,medical_shock:100000,seed:42,shocks:true,trials:100,goals:[{name:"Goal",at:2,cost:100000,kind:"general" as const,flex:true}]};
 const a=await simulate(input),b=await simulate(input);assert(JSON.stringify(a)===JSON.stringify(b),"seed reproducibility");
 assert(a.sample_paths.length===25&&a.diagnostics.goal_failure_share.length===1,"Python result shape");
 const comparison=await nudge(input,a);assert(comparison.scenarios.length===4,"four scenarios");
 assert(comparison.shock_counterfactuals.unemployment.paired_trials===100,"paired shock counterfactual");
 const target=await targetSip(input,a);assert(target.trials===100,"target SIP trials");
 console.log("Core parity tests passed");
}
void main().catch(error=>{console.error(error);throw error;});
