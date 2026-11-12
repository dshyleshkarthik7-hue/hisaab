import { finiteNumber } from "../security/validation.js";
export type Regime = "new" | "old";
type Slab = { upto: number | null; rate: number };
const RULES: Record<Regime, { slabs: Slab[]; rebate: number; cess: number; standardDeduction: number }> = {
  new: { slabs: [{upto:400000,rate:0},{upto:800000,rate:.05},{upto:1200000,rate:.10},{upto:1600000,rate:.15},{upto:2000000,rate:.20},{upto:2400000,rate:.25},{upto:null,rate:.30}], rebate:1200000, cess:.04, standardDeduction:75000 },
  old: { slabs: [{upto:250000,rate:0},{upto:500000,rate:.05},{upto:1000000,rate:.20},{upto:null,rate:.30}], rebate:500000, cess:.04, standardDeduction:50000 }
};
export interface TaxResult { taxableIncome:number; taxBeforeCess:number; rebate87A:number; cess:number; totalTax:number }
export function computeTax(taxableIncome: number, regime: Regime = "new", chapterVIA = 0): TaxResult {
  finiteNumber(taxableIncome,"Taxable income",0,5_000_000);
  finiteNumber(chapterVIA,"Chapter VI-A deductions",0,5_000_000);
  const rules=RULES[regime], base=Math.max(0,taxableIncome-(regime==="old"?chapterVIA:0));
  let tax=0, lower=0;
  for (const slab of rules.slabs) {
    if (base<=lower) break;
    const top=slab.upto===null?base:Math.min(base,slab.upto);
    tax+=(top-lower)*slab.rate;
    if (slab.upto===null) break;
    lower=slab.upto;
  }
  let rebate=0;
  if(base<=rules.rebate){rebate=tax;tax=0;}
  if(regime==="new"&&base>rules.rebate){const before=tax;tax=Math.min(tax,base-rules.rebate);rebate+=before-tax;}
  const cess=tax*rules.cess;
  return {taxableIncome:base,taxBeforeCess:tax,rebate87A:rebate,cess,totalTax:tax+cess};
}
export function estimateSalary(ctc:number,basicPercent:number,professionalTaxMonthly:number) {
  finiteNumber(ctc,"CTC",0,5_000_000); finiteNumber(basicPercent,"Basic pay",0,100);
  finiteNumber(professionalTaxMonthly,"Professional tax",0,5000);
  const rules=RULES.new, basic=ctc*basicPercent/100, employeePf=basic*.12, employerPf=basic*.12;
  const grossForTax=Math.max(0,ctc-employerPf-rules.standardDeduction);
  const tax=computeTax(grossForTax,"new").totalTax;
  const inhand=ctc-employerPf-employeePf-tax-professionalTaxMonthly*12;
  return {ctc,basic,employeePf,employerPf,tax,professionalTax:professionalTaxMonthly*12,inhand};
}
