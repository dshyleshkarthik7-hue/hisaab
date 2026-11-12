import { finiteNumber } from "../security/validation.js";
export interface EmiResult { emi: number; interest: number; total: number }
export function calculateEmi(principal: number, annualRate: number, years: number): EmiResult {
  finiteNumber(principal, "Loan amount", 0, 1e12);
  finiteNumber(annualRate, "Annual interest rate", 0, 100);
  finiteNumber(years, "Tenure", 0.01, 40);
  const months = Math.round(years * 12), rate = annualRate / 1200;
  const emi = rate === 0 ? principal / months : principal * rate * (1 + rate) ** months / ((1 + rate) ** months - 1);
  const total = emi * months;
  return { emi, total, interest: total - principal };
}
