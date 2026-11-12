import { readFileSync } from "node:fs";
import { simulate, nudge, type SimulationResult } from "../src/core/simulation.js";
const fixture=JSON.parse(readFileSync(new URL("./python-fixture.json",import.meta.url),"utf8"));
const assert=(condition:boolean,message:string)=>{if(!condition)throw new Error(message);};
function compare(actual:any,expected:any,path="root"){
 if(typeof expected==="number"){assert(typeof actual==="number"&&Math.abs(actual-expected)<=1e-7,`${path}: expected ${expected}, got ${actual}`);return;}
 if(expected===null||typeof expected!=="object"){assert(actual===expected,`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);return;}
 assert(actual!==null&&typeof actual==="object",`${path}: expected object`);
 if(Array.isArray(expected)){assert(Array.isArray(actual)&&actual.length===expected.length,`${path}: array length mismatch`);expected.forEach((v,i)=>compare(actual[i],v,`${path}[${i}]`));return;}
 const keys=Object.keys(expected);for(const key of keys){assert(key in actual,`${path}.${key}: missing`);compare(actual[key],expected[key],`${path}.${key}`);}
}
async function main(){
 const base=await simulate(fixture.input,undefined,undefined,fixture.options);
 compare(base,((({nudge,...rest}:any)=>rest)(fixture.expected)),"simulation");
 const complete=await nudge(fixture.input,base);
 compare(complete,fixture.expected.nudge,"nudge");
 fixture.tax_cases.forEach((item:any,i:number)=>compare(computeTax(item.income,item.regime,item.via),fixture.tax_expected[i],`tax[${i}]`));
 compare(compareRegimes(1500000,150000),fixture.regime_comparison,"regime comparison");
 console.log("Python ↔ TypeScript engine parity passed (including paths, glide path, four scenarios, paired shocks and target SIP).");
}
void main().catch(error=>{console.error(error);throw error;});
