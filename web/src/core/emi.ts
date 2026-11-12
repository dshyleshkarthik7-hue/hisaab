import { finiteNumber } from "../security/validation.js";
export interface EmiResult {emi:number;interest:number;total:number}
export function calculateEmi(principal:number,annualRate:number,years:number):EmiResult{
 finiteNumber(principal,"Loan amount",0,1e12);finiteNumber(annualRate,"Annual interest rate",0,100);finiteNumber(years,"Tenure",1/12,40);
 const months=years*12,rate=annualRate/1200;
 const emi=rate===0?principal/months:principal*rate/(1-Math.pow(1+rate,-months));
 const total=emi*months,interest=Math.max(0,total-principal);
 return {emi,interest,total};
}
