import { finiteNumber } from "../security/validation.js";
export type Regime="new"|"old";
type Slab={upto:number|null;rate:number};
type Rules={tax_year:string;regime:Regime;source:string;source_url:string;effective_from:string;verified_on:string;status:string;slabs:Slab[];standard_deduction:number;rebate_87a_limit:number;cess:number;notes:string[]};
const RULES:Record<Regime,Rules>={
 new:{tax_year:"2026-27",regime:"new",source:"Income Tax Department",source_url:"https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/income-tax-calculator-um",effective_from:"2026-04-01",verified_on:"2026-11-12",status:"illustrative",slabs:[{upto:400000,rate:0},{upto:800000,rate:.05},{upto:1200000,rate:.1},{upto:1600000,rate:.15},{upto:2000000,rate:.2},{upto:2400000,rate:.25},{upto:null,rate:.3}],standard_deduction:75000,rebate_87a_limit:1200000,cess:.04,notes:["Assumes a resident individual eligible for Section 87A; taxpayer-category and residential-status checks are not implemented.","Surcharge is not applied; this rule pack is restricted to taxable income up to ₹50 lakh.","Simplified estimate only; special-rate income, all deductions, credits and detailed payroll components are not modelled.","Professional tax is user-supplied and treated as deductible for take-home estimate."]},
 old:{tax_year:"2026-27",regime:"old",source:"Income Tax Department",source_url:"https://wm.incometaxindia.gov.in/w/tax-rates-and-computation",effective_from:"2026-04-01",verified_on:"2026-11-12",status:"illustrative",slabs:[{upto:250000,rate:0},{upto:500000,rate:.05},{upto:1000000,rate:.2},{upto:null,rate:.3}],standard_deduction:50000,rebate_87a_limit:500000,cess:.04,notes:["Illustrative old-regime path. Assumes a resident non-senior individual eligible for Section 87A; age and residential-status checks are not implemented. Chapter VI-A deductions are user-supplied aggregate.","Assumes a non-senior individual; age-specific slab differences are not modelled. Exact eligibility depends on individual facts; this is not a filing computation."]}
};
function pyRound(value:number,places=2){const factor=10**places,x=value*factor,lo=Math.floor(x),fraction=x-lo;const rounded=Math.abs(fraction-.5)<1e-9?(lo%2===0?lo:lo+1):Math.round(x);return rounded/factor;}
export interface TaxResult {tax_year:string;regime:Regime;taxable_income:number;tax_before_cess:number;rebate_87a:number;cess:number;total_tax:number;slab_breakdown:{from:number;to:number|null;rate:number;taxable_in_slab:number;tax:number}[];rules:{source:string;source_url:string;effective_from:string;verified_on:string;standard_deduction:number;rebate_87a_limit:number;cess:number;notes:string[]}}
export function getRules(taxYear="2026-27",regime:Regime="new"){if(taxYear!=="2026-27"||!(regime in RULES))throw new Error(`No verified tax rules for ${taxYear} / ${regime}`);return RULES[regime];}
export function listRulePacks(){return Object.values(RULES).map(r=>({tax_year:r.tax_year,regime:r.regime,source:r.source,effective_from:r.effective_from,verified_on:r.verified_on,status:r.status}));}
export function computeTax(taxableIncome:number,regime:Regime="new",chapterVIA=0){
 finiteNumber(taxableIncome,"Taxable income",0,5_000_000);finiteNumber(chapterVIA,"Chapter VI-A deductions",0,5_000_000);
 const rules=getRules("2026-27",regime),base=Math.max(0,taxableIncome-(regime==="old"?chapterVIA:0));let tax=0,lower=0;
 const breakdown:TaxResult["slab_breakdown"]=[];
 for(const slab of rules.slabs){if(base<=lower)break;const top=slab.upto===null?base:Math.min(base,slab.upto),band=Math.max(0,top-lower),amount=band*slab.rate;tax+=amount;breakdown.push({from:lower,to:slab.upto,rate:slab.rate,taxable_in_slab:pyRound(band),tax:pyRound(amount)});if(slab.upto===null)break;lower=slab.upto;}
 let rebate=0;if(base<=rules.rebate_87a_limit){rebate=tax;tax=0;}
 if(regime==="new"&&base>rules.rebate_87a_limit){const before=tax;tax=Math.min(tax,base-rules.rebate_87a_limit);rebate+=before-tax;}
 const cess=tax*rules.cess;
 return {tax_year:rules.tax_year,regime,taxable_income:pyRound(base),tax_before_cess:pyRound(tax),rebate_87a:pyRound(rebate),cess:pyRound(cess),total_tax:pyRound(tax+cess),slab_breakdown:breakdown,rules:{source:rules.source,source_url:rules.source_url,effective_from:rules.effective_from,verified_on:rules.verified_on,standard_deduction:rules.standard_deduction,rebate_87a_limit:rules.rebate_87a_limit,cess:rules.cess,notes:rules.notes}};
}
export function compareRegimes(grossTaxableBeforeSd:number,chapterVIA=0){
 finiteNumber(grossTaxableBeforeSd,"Gross taxable income",0,5_000_000);finiteNumber(chapterVIA,"Chapter VI-A deductions",0,5_000_000);
 const nr=getRules("2026-27","new"),or=getRules("2026-27","old");
 const newResult=computeTax(Math.max(0,grossTaxableBeforeSd-nr.standard_deduction),"new"),oldResult=computeTax(Math.max(0,grossTaxableBeforeSd-or.standard_deduction),"old",chapterVIA);
 const recommended=newResult.total_tax<=oldResult.total_tax?"new":"old";
 return {new:newResult,old:oldResult,recommended_regime:recommended,savings_if_recommended:pyRound(Math.abs(newResult.total_tax-oldResult.total_tax))};
}
/** Mirrors the legacy Java /api/tax payroll estimate exactly. */
export function estimateSalary(ctc:number,basicPercent:number,professionalTaxMonthly:number){
 finiteNumber(ctc,"CTC",0,5_000_000);finiteNumber(basicPercent,"Basic pay",0,100);finiteNumber(professionalTaxMonthly,"Professional tax",0,50_000);
 const basic=ctc*basicPercent/100,employeePf=Math.min(basic*.12,1800*12),professionalTax=professionalTaxMonthly*12;
 const taxable=Math.max(0,ctc-employeePf-75_000-professionalTax),tax=computeTax(taxable,"new").total_tax;
 const inhand=Math.max(0,ctc-tax-employeePf-professionalTax);
 return {ctc,basic,employeePf,employerPf:0,tax,professionalTax,inhand,taxable};
}
