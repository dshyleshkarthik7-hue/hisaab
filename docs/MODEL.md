# Hisaab simulation model

## Purpose

Hisaab is a production household-finance digital twin. It estimates how often a set of goals is funded under a transparent collection of assumptions. Outputs are probabilistic scenario results, not guarantees of future market or personal outcomes, and do not constitute regulated investment advice.

## Monthly portfolio process

For each trial and month:

1. Apply a monthly investment return drawn from a lognormal model. The annual arithmetic return assumption is converted to an annual log-return parameter using `ln(1 + mean_return) - 0.5 × volatility²`, then divided by 12. Annual volatility is scaled by `1 / sqrt(12)`.
2. Update general, education, medical and home inflation once per simulated year. Each annual rate is sampled from its configured normal distribution and compounded monthly.
3. Calculate household expenses using the general-inflation index.
4. If employed, calculate the contribution as the lower of planned SIP and income remaining after household expenses. If expenses exceed income, withdraw the deficit from the corpus. Any surplus above the planned SIP is intentionally not added to the corpus; this keeps the input SIP meaningful and is a conservative omission.
5. A job-loss event can occur with a 7% annual probability. It lasts six months; income and SIP stop during that period while household expenses continue.
6. A medical event can occur with a 5% annual probability and withdraws the configured medical amount inflated by the medical index.
7. At each goal year, inflate the goal's present-day cost by its category index. Pay it if the corpus can cover it; otherwise mark that goal unsuccessful and, for a mandatory goal, set remaining portfolio funds to zero. With glide-path enabled, a modelled debt reserve is built for mandatory goals within 36 months of their due year.

## Outputs

- **All-goals success rate:** fraction of trials in which every goal is funded in its scheduled year.
- **Goal odds:** fraction of trials in which an individual goal is funded.
- **Ending corpus percentiles:** 10th, 50th and 90th percentile values, deflated by general inflation into today's purchasing-power rupees.
- **Ending-at-zero rate:** fraction of trials with no corpus at the end of the horizon.
- **What-if comparison:** alternative SIP increases and, when the horizon permits, a two-year delay for flexible goals. Alternatives reuse the same random seed and trial count as the baseline to reduce noise in the comparison.

## Reproducibility and interpretation

A fixed seed recreates the same scenario stream. Separate deterministic random streams are used for market returns, debt returns, inflation, unemployment and medical events, so counterfactual shock-removal runs retain identical market and inflation paths. Changing the seed generates another plausible sample; it does not change the assumptions. The displayed percentage is a model result conditional on the entered assumptions, not the real-world probability that a household will succeed.

## Important omissions

The model does not include taxes on investments, fees, asset allocation, debt repayments, insurance payouts, government benefits, changing household size, variable job-loss duration, medical-cost coverage, correlated inflation/market shocks, fat-tailed market returns or volatility clustering. The independent normal inflation and lognormal return assumptions are simplifications. It does not model bank deposits and investment assets separately. SIP contributions are capped at monthly surplus; excess surplus is not accumulated. The model assumes the same job-loss and medical-event probabilities for every household. The optional 36-month mandatory-goal glide path transfers an estimated present value into a debt reserve modelled with 6.5% annual arithmetic return and 0.5% annual volatility; the reserve is not a guaranteed deposit or RBI-linked product.

## Inflation assumptions

Configured annual mean and standard deviation, in percent:

| Category | Mean | Standard deviation |
|---|---:|---:|
| General | 6.0 | 1.2 |
| Education | 10.0 | 2.0 |
| Medical | 8.0 | 2.0 |
| Home | 5.5 | 1.2 |

These are configurable modelling assumptions, not official forecasts or guarantees. Replace them with suitable, sourced assumptions before using the model for a specific decision.

## Salary estimate

The Java salary tool is a simplified Tax Year 2026–27 new-regime estimate for CTC up to ₹50 lakh. It assumes a resident individual eligible for Section 87A, employer and employee PF at 12% of basic pay, a ₹75,000 standard deduction, and user-entered professional tax withheld from take-home pay. It excludes surcharge (the CTC cap is set below the taxable-income surcharge threshold), special-rate income, and detailed CTC components. It should not be used as a tax filing or payroll calculation.

Official reference pages used for the displayed tax assumptions:

- [Income Tax Department — tax rates and computation](https://wm.incometax.gov.in/w/tax-rates-and-computation)
- [Income Tax Department — deductions and standard deduction](https://wm.incometax.gov.in/w/deductions-allowable-to-tax-payer)
- [Ministry of Finance — Budget 2026 tax-rate FAQ](https://www.incometaxindia.gov.in/documents/20117/15766092/FAQs-Budget-2026.pdf/ff3d0e10-88a0-b11f-3c27-b58375974227?download=true&t=1770036575267&version=1.0)


## Parallel trajectories and shock counterfactuals

The response returns 25 representative household trajectories, including the lowest-ending successful path when one exists, the median-ending path and a stressed/depleted/shocked example when available. These are selected from the full trial population; they are illustrative samples, not 25 additional trials.

The diagnostic `failed_lives_with_shock_share` is an association statistic only. The Scenario Lab additionally compares each baseline trial with a paired run that removes unemployment or medical events while retaining the same deterministic market, debt and inflation streams. `failures_prevented_if_removed` and `net_failure_reduction` are counterfactual differences conditional on this model. They do not establish real-world causality and may not add up because shocks can interact.

The target-SIP search uses the configured trial count for every bisection evaluation and returns the achieved score and trial count. Its result is conditional on the fixed seed and model assumptions; it is not an exact real-world required contribution.
