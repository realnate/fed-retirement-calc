# FERS household retirement planner

A self-contained, client-side retirement cash-flow calculator for US federal employees under FERS and their spouses.
It projects the FERS annuity, FERS supplement, TSP (traditional and Roth), brokerage investments, checking and a money market account, both spouses' Social
Security, federal and state income tax, RMDs, Roth conversions and account transfers, traditional and Roth IRAs,
survivor scenarios, and an optional Monte Carlo run.

> **Educational estimate only — not financial, tax, investment, or legal advice.** Confirm annuity figures with OPM,
> Social Security estimates with SSA, and decisions with a qualified professional.

## Built with AI assistance

Much of this project's code, its tests and this documentation were written by Claude, Anthropic's AI model, using
Claude Code, working from the author's requirements, questions and corrections. The test suite covers each rule
(see "Tests"), but the code has not been independently audited. Treat its numbers as estimates to verify, not as
authoritative figures.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The app: UI, charts (Chart.js 4 from cdnjs), scenarios. Contains no financial math. |
| `engine.js` | Pure, side-effect-free calculation engine. `simulate(inputs, opts?) → { years, summary, warnings, milestones }`, plus `monteCarlo`, `ssClaimComparison`, and every rule as a small exported function. All statutory values live in one `CONSTANTS` object. |
| `report.js` | Pure, DOM-free report builder: `buildPlanReport(result, opts) → { story, markdown }`, the plain-English narrative and the full review packet. |
| `engine.test.js` | Engine and report tests. Runs under Node (`node engine.test.js`) and in the browser via `tests.html`. |
| `tests.html` | Browser test runner. |

No build step and no backend: open `index.html` straight from disk. Charts need an internet connection to load
Chart.js from cdnjs; without it everything else (cards, warnings, timeline, table, CSV) still works.

## Using it

1. **Inputs (left column).** Panels are collapsible: Household, Inflation, Employment, one panel per account (TSP,
   IRAs, Brokerage investments, Checking & money market, each with its balance, contributions and returns),
   Withdrawals, then FERS, Social Security, Spending, Taxes (with conversions and transfers), Foreign tax and Monte
   Carlo. Each numeric input has a slider, a number box (type any value,
   arrow keys step it), and a **?** help popover that explains the rule. Results recalculate about 150 ms after
   each change.
2. **Nominal $ / Today's $** (top bar) switches every card, chart, and table value. Flows in year *Y* are deflated
   by cumulative inflation to the start of *Y*; end-of-year balances are deflated to the end of *Y*.
3. **Scenarios.** Name the plan and **Save** (stored in this browser's `localStorage`). **Duplicate**, **Delete**,
   and load saved plans from the dropdown. **Compare with (B)** overlays a saved scenario's portfolio balance on the
   current inputs (A). **Export/Import JSON** moves scenarios between machines; the file is laid out like the input
   panels (see "Plan file" below), so it can be edited by hand or by an AI assistant and imported back. Importing lists
   any setting that was ignored, missing or not allowed. The URL hash always encodes the
   current inputs (as a diff from the defaults), so **Copy link** reproduces the scenario anywhere. A link may not
   open after an update that changes the defaults, so keep the exported file for anything you want to keep. Your
   working inputs are also autosaved and restored on reload.
4. **Monte Carlo.** Enable it in its panel and press **Run Monte Carlo**. It runs in a Web Worker (built from the
   engine's own source, so it works from `file://`) and falls back to the main thread if workers are blocked.
   It does not rerun automatically on input changes; a "stale" badge appears instead. Every run computes both
   lifespan modes, fixed and stochastic, and shows them side by side. The household's "Lifespans in Monte Carlo"
   setting picks which one drives the fan chart and the headline card.
5. **Year-by-year table** has a sticky header and first column, scrolls horizontally, and **Export CSV** writes the
   values in the currently selected dollar basis. Its tax columns trace each year's federal tax: deduction, ordinary
   taxable income, taxable gains, federal taxable income, the bracket rate with its from/to range, the headroom left
   in that bracket, and the bracket index. The gain in each brokerage withdrawal and the brokerage cost basis
   are columns too. Hover a column header for its definition.
   **Federal tax brackets** (just above the table) shows any year's projected brackets, deductions and gains
   thresholds for joint and single filers, marks the plan's bracket, and downloads every year's thresholds as CSV.
6. **Plan narrative / review report.** A plain-English walkthrough sits above the year table. **Copy for AI review** (top bar)
   or **Copy full report** copies a Markdown review packet; **Download .md** saves it. The packet has reviewer
   instructions, the narrative, key results, every input, the rules applied with their numbers, milestones, warnings,
   Monte Carlo results (if run), the full year-by-year table, model limitations, tailored review questions, and the
   plan's settings file. It is meant to be pasted into an AI assistant or sent to an advisor for an independent
   check; the reviewer is asked to return an edited settings file for any change it recommends, ready to import.
   The Inputs section follows the input panels and names each panel's section of the settings file.
7. **Planning tools.** These run in the background, and every candidate is scored by Monte Carlo at the same seed in
   the selected lifespan mode:
   - **What can we afford?** finds the highest base monthly spending that still meets a target success rate
     (bisection; with a fixed seed, success can only fall as spending rises). It also finds the earliest retirement
     age that meets the target, adjusting service for each candidate age so FERS eligibility, the annuity and the
     supplement follow. Both have **Apply** buttons.
   - The **optimizer** searches both spouses' Social Security claim ages (whole years, 62–70), then Roth conversion
     windows (fill 12/22/24/32% from retirement to several end ages, or none). The goal can be highest success, largest
     median after-tax inheritance, or lowest lifetime tax. It ranks strictly and can apply any option or the best
     combination. Differences of about one run (1 ÷ runs) are noise. Median inheritance (the middle Monte Carlo run:
     at the last death with stochastic lifespans, at the end of the plan with fixed ones) and lifetime tax (the
     projection at average returns) are shown in today's dollars with future (nominal) dollars under them; both
     figures for the inheritance come from the same run (the middle two averaged for an even number of runs). A note
     compares them with the "Left to heirs" card, which is the projection at average returns, and says whether the
     median is lower or higher and why: volatile returns compound to less than the average, stochastic lifespans move
     the year the money is left, and adaptive rules apply only in Monte Carlo.
   - **Sensitivity** moves one assumption at a time (returns, volatility, inflation, healthcare inflation, spending,
     retirement age, Social Security 78% from 2033, FERS COLA, supplement, lifespans, Mexico tax, peso drift). It shows
     a tornado chart of success or median inheritance (today's dollars), with a table.
8. **Compare scenarios** runs 2–4 plans (saved scenarios and/or the current inputs). Each runs deterministically and in
   both Monte Carlo lifespan modes, at the current inputs' seed and run count. The results appear in a side-by-side
   table and the export.
9. **Print** gives a results-only layout (the year table prints its 17 key columns; use CSV for everything).

## Outputs

- **Summary cards:** TSP at retirement; TSP when RMDs start; left to heirs (the ending balance, nominal and today's $,
  with the pre-tax traditional-TSP share; real estate is not included); lifetime spending (living + healthcare in
  retired years, plus one-time outflows); depletion age or "Never"; peak withdrawal rate; lifetime income taxes
  (federal + state + foreign, with the breakdown and the retirement-only share; includes tax on salary while
  working); TSP used during the bridge years (retirement → the later SS claim); Monte Carlo success %. Status cards
  use an icon and text, not color alone.
- **Warnings panel** (plain English): MRA+10 reduction / no supplement; deferred retirement (no supplement, no FEHB);
  not vested; supplement earnings test; under 5 years of FEHB; Part B special-enrollment deadline when someone turns
  65 on active-employee FEHB; survivor election "none"; RMDs pushing into a higher bracket or IRMAA tier; IRMAA
  surcharges; depletion; widow(er) bracket jump; 10% early-withdrawal penalty risk; 402(g) cap; Roth catch-up rule.
- **Milestone timeline:** retirement, annuity start (if postponed), MRA, supplement end, each SS claim, Medicare at
  65 for each spouse, RMD start, conversions and transfers, each assumed death, and depletion. Markers can be
  hovered or keyboard-focused.
- **Plan narrative:** about ten paragraphs covering the working years, retirement and the annuity, supplement, Social
  Security, spending and the bridge years, cash handling, RMDs and taxes (including foreign), the survivor phase, and
  the outcome. See "Using it" for the full review packet.
- **Charts:** income by source (stacked bars, survivor annuity and cash hatched) with a dashed spending + taxes line; account
  balances (stacked area); spending per month (living, FEHB, Part B, with a dashed line showing the same spending in
  today's dollars when viewing nominal); checking & money market (money kept in and spent from each, moved to brokerage above the limit, their balances and
  the limit, with a tooltip explaining where each year's surplus came from); federal, state, and foreign tax with the marginal bracket in the tooltip; withdrawal rate with a 4%
  reference; SS claim-age comparison (62 / 67 / 70, one panel per spouse, break-even ages labeled); Monte Carlo fan
  chart (10–90th and 25–75th percentile bands, median, deterministic path); scenario A vs B. Legends are HTML
  buttons that toggle series. The palette is colorblind-validated; lines use dash patterns as a second cue.

## Default household

The defaults are a made-up but typical household, meant as a starting point to replace with your own numbers:

- **Household:** current year 2026. You were born in 1982 (44) and your spouse in 1980 (46). Both lifespans are 95,
  the plan runs to your age 95, and Monte Carlo lifespans are stochastic (you male, spouse female).
- **Work:** a GS-12, step 5 in the Rest of U.S. locality ($101,443 in 2026), hired at 34 and ten years in. Raises are
  2% a year, plus GS step increases: step 6 in 2027 (the next one is within a year), 7 in 2029, 8 in 2032, 9 in 2035
  and 10 in 2038. You retire at 62 (2044) with 28 years of service and 1,000 hours of sick leave. Your spouse earns $60,000 (today's $) until 62 and saves $6,000 a year in brokerage investments.
- **FERS:** retiring at 62 with 20+ years earns the 1.1% multiplier: High-3 ≈ $159.8k, so the basic annuity is
  ≈ $49,938/yr, less 10% for the full survivor annuity. There is no FERS supplement (it ends at 62).
- **TSP:** $120k traditional and $30k Roth. You contribute 10% (30% of it Roth); the agency adds 5%. It returns 7%
  before retirement (SD 15%) and 6% after (SD 10%).
- **Other accounts:** $20k of brokerage investments (30% unrealized gain) and a $25k money market at 3% (limit
  $50k, today's $). No IRAs.
- **Social Security:** PIAs of $2,900 (you) and $2,200 (spouse), both claimed at 67.
- **Spending:** $5,000/mo plus FEHB of $650/mo and Medicare Part B for both from 65, with healthcare costs rising
  4.5% a year (inflation is 2.5%, SD 1.5%, persistence 0.6). The survivor keeps 70%.
- **One-time events:** a $35k car every 8 years from 62 through 85 (deferrable), $25k of home repairs at 65, 75 and
  85, and $60k a year of long-term care in the last two years of each person's life.
- **Taxes:** advanced federal tax and a 4% flat state tax. No Roth conversions and no foreign tax.
- **Outcome:** the projection never runs short; Monte Carlo success is about 85% with fixed lifespans and 82% with
  stochastic ones. The warnings flag the 2066 RMD pushing taxable income from the 12% into the 22% bracket.

## Plan file (JSON)

Export JSON saves `{ app, name, exported, howToRead, inputs }`. `inputs` holds every setting, laid out like the input
panels so a person or an AI assistant can find and change a setting without the app:

- Each top-level section is one panel, in the panels' order: `household`, `inflation`, `employment`, `tsp`, `iras`,
  `brokerage`, `checkingAndMoneyMarket`, `withdrawals`, `fersPension`, `fersSupplement`, `socialSecurity`,
  `spending`, `taxes`, `foreignTax`, `monteCarlo`. Nested objects are the groups inside a panel, e.g.
  `tsp.returns.afterRetirement`, `iras.roth.basisShare`, `checkingAndMoneyMarket.moneyMarket.moveToBrokerageAbove`,
  `monteCarlo.adaptiveRules.spendingGuardrails.enabled`. Names follow the panel labels.
- Rates, returns and shares are decimals (0.07 = 7%). Dollar amounts are today's dollars a year unless the name ends
  in `Monthly`; the few nominal amounts (manual High-3, OPM estimate, manual supplement, events not in today's $) are
  named in `howToRead`.
- Accounts are named `traditionalTsp`, `rothTsp`, `traditionalIra`, `rothIra` and `brokerage`; `withdrawals.order` is
  a list of them (the money market always goes first and checking last).
- `taxes.conversionsAndTransfers` is a list of `{ fromAccount, toAccount, fromAge, throughAge, howMuch, fillToTopOfBracket,
  fixedAmount }`, where `howMuch` is `fillBracket` (conversions only), `fixedAmount` (today's $ a year) or `wholeBalance`.
- `spending.oneTimeEvents` is a list of `{ label, person, when, at, repeat, everyNYears, through, forNYears, amount,
  direction, taxed, inTodaysDollars, deferrable }`.
- `howToRead` restates these conventions and lists every allowed value (`PLAN_GUIDE` and `ENUMS` in `engine.js`).
  Settings with a fixed list of values use readable names, e.g. `withdrawals.strategy`: `fixedOrder | proportional |
  bracketFill`; `foreignTax.relief`: `foreignCountryCreditsUsTax | usCreditsForeignTax | none`.

On import, `validateInputs` reports unknown settings (ignored), missing ones (defaults used), wrong types, values that
are not allowed (default used), likely whole-number percents (7 instead of 0.07) and unsupported conversion rows. A
missing section is reported once. A test checks that every setting has a control in the panel of its section, in
the same order, so the file and the screen stay in step.

## Statutory constants (`CONSTANTS` in `engine.js`)

All 2026 values, checked in October 2026. Each entry in the code carries its own source comment.

| Item | Value | Source |
| --- | --- | --- |
| Federal brackets, MFJ | 10% to $24,800; 12% to $100,800; 22% to $211,400; 24% to $403,550; 32% to $512,450; 35% to $768,700; 37% above | IRS Rev. Proc. 2025-32 (rates permanent under P.L. 119-21, "OBBBA") |
| Federal brackets, single | 10% to $12,400; 12% to $50,400; 22% to $105,700; 24% to $201,775; 32% to $256,225; 35% to $640,600; 37% above | Rev. Proc. 2025-32 |
| Standard deduction | $32,200 MFJ, $16,100 single; +$1,650 per spouse 65+ (MFJ), +$2,050 (single) | Rev. Proc. 2025-32 |
| Senior deduction | $6,000 per person 65+, 2025–2028 only, reduced 6% of MAGI over $75k / $150k (not indexed) | P.L. 119-21 §70103 |
| LTCG 0/15/20% breakpoints | MFJ $98,900 / $613,700; single $49,450 / $545,500 | Rev. Proc. 2025-32 |
| NIIT | 3.8% over $250k MFJ / $200k single (not indexed) | IRC §1411 |
| SS taxation thresholds | $32k / $44k MFJ; $25k / $34k single (not indexed) | IRC §86 |
| Earnings-test limit | $24,480 (2026), indexed | SSA OACT |
| SS FRA table; early, delayed, spousal factors | 5/9% and 5/12% per month early; 2/3% per month delayed; spousal 25/36% and 5/12% | SSA; 20 CFR 404.410, .313 |
| 402(g) / catch-up | $24,500; $8,000 at 50+; $11,250 at 60–63; Roth catch-up if prior-year wages > $150,000 | IRS Notice 2025-67; SECURE 2.0 §§109, 603 |
| Agency contributions | 1% automatic + 100% match on first 3% + 50% on next 2% | 5 USC 8432 |
| GS step increases | After 1 year at steps 1–3, 2 years at steps 4–6, 3 years at steps 7–9; each step is 1/30 of step 1 | 5 CFR 531.405; 5 USC 5332 |
| GS pay cap | $197,200 (Executive Schedule level IV), growing with the GS across-the-board raise | 5 USC 5304(g), 5318; OPM 2026 EX table |
| Part B and IRMAA | $202.90/mo standard; tiers at $109k / $137k / $171k / $205k / $500k single and $218k / $274k / $342k / $410k / $750k joint → $284.10 / $405.80 / $527.50 / $649.20 / $689.90 | CMS 2026 fact sheet |
| RMD Uniform Lifetime Table | 72: 27.4 … 75: 24.6 … 100: 6.4 … 120: 2.0 | IRS Pub 590-B Table III |
| RMD start age | 73 for births 1951–1959, 75 for 1960+ | SECURE 2.0 §107 |
| Mexico ISR annual tariff | 11 brackets, 1.92%–35%; top bracket from MXN 5,107,703.93 (fixed fee 1,601,862.46) | SAT, Anexo 8 RMF 2026 (DOF 28-12-2025), art. 152 LISR |
| UMA | MXN 117.31/day from Feb 1, 2026; pension exemption 15 × UMA/day | INEGI; LISR art. 93 fr. IV |
| Foreign tax credit carryforward | 10 years | IRC §904(c) |
| FERS MRA table | 55 (≤1947) → 56 (1953–1964) → 57 (1970+) | 5 USC 8412(h) |
| FERS multiplier, survivor, supplement, diet COLA | 1% / 1.1% (62+ with 20 yrs) / special 1.7% first 20; −5% & 25% or −10% & 50%; SS62 × yrs (rounded, ≤ 40) ÷ 40; CPI ≤2% → CPI, 2–3% → 2%, >3% → CPI−1 | 5 USC 8415, 8419, 8421, 8442, 8462 |

Dollar amounts are indexed from 2026 with your inflation assumption, except those marked "not indexed". The federal
brackets, standard deduction, 65+ amounts and LTCG breakpoints grow at inflation minus a chained-CPI gap (Taxes →
"Brackets grow slower than inflation by", default 0.25%/yr): IRC §1(f)(3) indexes them with chained CPI, which runs
below the CPI used elsewhere. Each year's amounts are the 2026 amounts × that year's bracket index (shown in the year
table); the IRS's rounding to $25/$50 is not applied. The 402(g) and catch-up limits (indexed with CPI) are rounded
down to $500; IRMAA thresholds and the earnings-test limit grow with inflation.

## Assumptions (how the engine works)

**Timeline**
- Annual steps from the current year (treated as a full year). Your age in year *Y* is *Y − birth year*. Age-based
  events (retirement, pension start, SS claims, RMDs, Medicare, conversion windows) take effect at the start of the
  year that age is reached.
- Each spouse lives through the year they reach their lifespan and dies at the end of it. The projection ends when
  you reach the plan-to age or both spouses have died, whichever comes first. **Longevity stress** extends the last
  survivor to the plan-to age.
- Filing status is MFJ while both are alive (including the year of the first death) and single from the next year.
- Each year is processed in this order: ages and alive flags → income → RMD → Roth conversion → taxes → spending
  (including one-time items) → shortfall withdrawals or surplus deposits → growth. Taxes, conversions, and
  withdrawals depend on each other, so they are solved together as a fixed point (converges to under $0.01).
- All flows happen at the start of the year; growth applies to the balance after flows. The balance identity
  *start + contributions + deposits + conversions in − conversions out − withdrawals + growth = end* holds for every
  account and every year, and cash sources equal uses (both tested).

**Working years**
- Salary grows by the yearly raise. With GS step increases on, it also moves up one step at a time from your current
  step: after 1 year at steps 1–3, 2 years at steps 4–6 and 3 years at steps 7–9 (5 CFR 531.405; 18 years from step 1
  to 10), with the next one when you say it is due (at most that step's waiting period away). Every step adds 1/30
  of the step-1 rate (the General Schedule's equal step increments), so step 10 pays 30% more than step 1. Today's
  salary is taken to be at the current step; for a High-3 that reaches back before today, earlier years are
  back-projected the same way (step 10 is taken to have been reached at least three years ago). Promotions and
  quality step increases are not modeled.
- GS pay with locality is capped at Executive Schedule level IV (5 USC 5304(g); "GS pay cap this year", $197,200 in
  2026, 0 = no cap). By law level IV rises with the GS across-the-board raise, rounded to $100 (5 USC 5318), so the
  cap grows with your annual raise. Pay is held at the cap, step increases add nothing above it, and the High-3 uses
  the capped pay. A note says when the cap starts to apply. Salary is assumed to cover living costs, payroll taxes, and income
  tax on wages; the spending input applies only after you retire. The optional "extra savings" goes to the taxable
  account. One-time events and any income besides wages (e.g. a spouse's SS) still flow through the portfolio, and
  only the *extra* tax they cause is paid from it.
- Benefits that start before you retire, such as a spouse's Social Security claimed while you still work, are by
  default spent along with your salary, so they and their taxes do not touch the portfolio. Turn off "Spend benefits
  that start before you retire" to save them instead (to the money market up to the limit). The warnings panel notes either
  case.
- Employee contributions are capped at 402(g). Agency 1% plus the match goes to traditional. Catch-up is "full
  catch-up in addition to the regular %", and goes to Roth when prior-year salary exceeds the indexed $150,000.
- Spouse earnings are optional wages in today's dollars (no spouse retirement plan is modeled).

**FERS annuity**
- Retirement type is detected from your retirement age, creditable service (without sick leave), and MRA:
  62+5, 60+20, MRA+30 (immediate unreduced); MRA+10 (5% per year under 62, permanent, unless 20+ years and the start
  is postponed to 60+); deferred (separated before eligibility, 5+ years) starting at the earliest unreduced age
  (MRA with 30+ years, 60 with 20+, else 62) or a postponed age you choose; under 5 years means no annuity.
- Special category (LEO/FF/ATC): eligible at 50+20 or any age with 25; 1.7% for the first 20 years and 1% after;
  COLAs from the start; supplement earnings test only after MRA. The mandatory retirement age is not modeled.
- Annuity = multiplier × High-3 × (service + sick leave ÷ 2,087, truncated to whole months). 1.1% applies when you
  separate at 62+ with 20+ years of creditable service; sick leave does not count toward that test.
- Auto High-3 is the highest 3 consecutive projected salaries before retirement (back-projected if retirement is
  under 3 years away). The manual override is the gross monthly annuity *before* the survivor reduction and *after*
  any MRA+10 reduction, in dollars of the first year it is paid. Current retirees should enter their current annuity.
- Survivor election: the retiree's annuity is reduced 5% (partial) or 10% (full) while the spouse is alive. The
  reduction stops the year after the spouse dies. If the retiree dies first, the survivor gets 25% or 50% of the
  unreduced annuity (after any MRA+10 reduction, with all COLAs to date), starting the next year. The election is
  forced to "none" if there is no spouse or the spouse died before the annuity starts.
- Diet COLA uses the previous year's inflation. Regular retirees first get it the year after they turn 62. Survivor
  annuitants and special-category retirees get it every year. The first-year prorated COLA is ignored.

**FERS supplement**
- Paid only for immediate unreduced retirements (MRA+30, 60+20, special category) that begin before 62. It stops in
  the year you turn 62, has no COLA, and is fixed at retirement.
- Auto amount = SS-at-62 (today's $, inflated to the retirement year) × years of FERS civilian service ÷ 40
  (5 USC 8421(b); OPM CSRS/FERS Handbook ch. 51). The years are rounded to the nearest whole year, with ½ rounding up,
  and capped at 40; sick leave doesn't count.
- SS-at-62 is the Social Security benefit you would get by claiming at 62: your PIA (the full-retirement-age benefit)
  reduced for claiming early, which is 70% of the PIA for anyone born in 1960 or later. OPM computes it from your
  FERS earnings only, so enter that figure if you have it. The 70% is not a separate cut to the supplement: for
  example, a $2,700 PIA gives $1,890 at 62, and 28 years of service pay $1,890 × 28 ÷ 40 = $1,323/mo. The default
  SS-at-62 of $1,900/mo is about 70% of a $2,700 PIA from 28 years of FERS earnings. Set it to 0 to use 70% of your
  PIA.
- Earnings test: post-retirement earned income above the indexed limit cuts it $1 for every $2.

**Social Security**
- PIA is entered in today's dollars and grows with inflation, a simplification that stands in for wage indexing
  before 62 and COLAs after.
- FRA comes from the SSA table. Claim ages run from 62 to 70 in whole years plus optional months. In the claim year
  only the months after the claim age are paid.
- Spousal excess = max(0, 50% of the other's PIA − own PIA). It is payable once both have filed and is reduced by the
  spousal factor at the age it starts. There are no delayed credits on it.
- **Survivor benefit:** the larger of the survivor's own benefit or the deceased's actual benefit. That includes
  delayed credits, or credits earned up to death if the deceased had not claimed, with an 82.5%-of-PIA floor if the
  deceased claimed early. **Simplification:** survivor benefits are assumed to start at or after the survivor's own
  FRA, so no survivor-benefit reduction applies. Before that FRA the survivor keeps their own benefit.
- The claim-age chart compares own benefits only, in today's dollars, undiscounted. Break-even is the exact age at
  which cumulative benefits match.

**Taxes**
- Advanced mode covers federal ordinary brackets, the standard deduction plus 65+ amounts, the 2025–2028 senior
  deduction, Social Security taxation via provisional income (AGI excluding SS + 50% of SS; thresholds not indexed;
  up to 85% taxable), long-term gains stacked at 0/15/20%, and the 3.8% NIIT on interest and gains. Simple mode applies one effective rate (MFJ or
  single) to AGI. State tax is a flat rate on federal taxable income.
- Ordinary income includes wages minus traditional contributions, spouse and post-retirement earnings, annuity,
  survivor annuity, supplement, RMDs and other traditional withdrawals, Roth conversions, and taxable one-time
  inflows.
- Brokerage investments track their cost basis at average cost. Money put in (surpluses, one-time inflows, cash moved
  above the limit) is basis and growth is gain. Each withdrawal realizes gain = withdrawal × (1 − basis ÷ balance at the
  start of the year), taxed as a long-term gain; the rest is basis coming back, untaxed. `gainsPct` is the
  unrealized-gain share of today's balance. After a loss (balance below basis) withdrawals realize no gain and the
  extra basis offsets later gains; capital losses are not deducted from other income.
- **Conversions and transfers** happen at the start of the year, after the RMDs. A conversion moves traditional money
  (TSP or IRA) to a Roth account (Roth TSP in-plan, or a Roth IRA) and is ordinary income that year. A transfer moves
  money between accounts of the same tax type (Roth TSP → Roth IRA, traditional TSP → traditional IRA) and is not
  taxed; a Roth TSP transfer carries its basis share into the Roth IRA. Each row is a fixed amount (today's $) per
  year, the whole balance, or (conversions only) "fill to the top of bracket N": the headroom left in that bracket
  after the year's other income. In a year the first conversion row covering your age applies; every transfer
  applies. It is solved numerically,
  together with the withdrawal that pays the conversion's own tax, so ordinary taxable income (including any SS the
  conversion makes taxable and any traditional TSP withdrawn to pay the conversion tax) lands within $0.50 below the
  bracket top. Conversion tax is paid from surplus income first, then the money market, brokerage, traditional TSP
  and IRA, then Roth, whatever the general withdrawal order is. A conversion is never larger than its tax can be paid for: if those accounts can't
  cover it, the conversion is reduced.
- RMDs: Uniform Lifetime Table on the prior year-end traditional TSP and traditional IRA balances, from age 73/75 (by
  birth year). The TSP's RMD waits while you still work; the IRA's does not. On the owner's death the accounts pass to
  the surviving spouse, whose age and birth year then drive RMDs. Roth TSP and Roth IRA have no RMDs.
- **TSP vs IRAs:** the TSP's traditional and Roth balances share one fund allocation, so one return (before and after
  retirement). Withdrawals can be traditional-only or Roth-only (5 CFR 1650), so they are separate steps in the
  withdrawal order. Each IRA is invested on its own, with its own returns. Traditional IRA withdrawals before 59½ add
  the 10% penalty (the year you turn 60 is the first penalty-free year; conversions are exempt): the TSP's
  separation-at-55 exception does not apply to IRAs. Roth IRA 5-year rules are assumed met; Roth IRA withdrawals
  before 59½ beyond contributions and conversions (US ordering rules) raise a warning but are not taxed. Optional
  Roth IRA contributions while working come from salary, capped at the IRA limit ($7,500 + $1,100 at 50+, 2026,
  indexed); the income limit is not checked. Moving TSP money to an IRA while still working and under 59½ raises a
  warning (the TSP allows it after separation or from 59½).
- IRMAA: Part B premiums use MAGI from two years earlier against indexed thresholds. With fewer than two years of
  history, no surcharge applies.

**Spending and withdrawals**
- Base spending (today's $) × phase multiplier (go-go / slow-go / no-go by your age, optional) × survivor % after the
  first death. FEHB (separate line, healthcare inflation, self-only % after the first death) and Part B (per enrolled
  spouse 65+, with IRMAA) are added on top. One-time events can be in today's dollars (inflated) or nominal, can be
  inflows or outflows, and can be taxable as ordinary income or long-term gain.
- Foreign-currency mode: local-currency spending × inflation ÷ (FX rate × (1 + drift)^years). The ±20% shock reruns
  the whole projection with the USD cost of local spending 20% higher or lower.
- Shortfalls are withdrawn in the chosen order (default brokerage → traditional → Roth). Any surplus, including an RMD
  beyond what's needed, is deposited after tax into checking up to its target, the money market up to its limit, then brokerage investments. If the accounts run dry, the depletion year
  is flagged and the projection keeps going with the unmet amount shown as **Unfunded**.
- **Bridge bucket** (`bridgeYears`, `bridgeStartYearsBefore`, `bridgeReturn`): a low-risk sleeve like the G Fund.
  - **Sizing:** a deterministic projection without the bucket gives the net portfolio draws for the first
    `bridgeYears` of retirement, including taxes, conversion tax, and one-time events.
  - **Before retirement:** from `bridgeStartYearsBefore` years before retirement, the bucket is held at the present
    value of those draws at `bridgeReturn`, so it grows into them.
  - **In the bridge years:** each year's net draw comes out of the bucket first. It is never refilled, and anything
    left after the last bridge year rejoins the portfolio.
  - **Returns:** the bucket earns `bridgeReturn` with no volatility, including in Monte Carlo, where every run funds
    the same planned bucket and spends it according to that run's actual draws.
  - **Overlay:** the bucket can't hold more than the invested balance. It overlays the accounts: each account's
    return is blended by bucket ÷ invested balance, so which account is withdrawn, and the tax, are unchanged. Real
    TSP withdrawals come out pro rata across funds, so "spend G first" means withdraw, then rebalance.
- **Events tied to a person:** an event can belong to you or your spouse. It is skipped in any year after that person
  has died, including in Monte Carlo runs with stochastic lifespans, and a deferred occurrence is dropped if its person
  dies first. A tied event's age is that person's age. "Years before death" timing places it relative to the person's
  death year, so end-of-life costs follow each run's sampled death. The default plan ties each person's long-term care
  to that person, in the last two years of their life.
- **Social Security shortfall:** a share of scheduled benefits (own, spousal and survivor) paid from a chosen year.
  A preset applies the 2026 Trustees projection: retirement-fund reserves depleted in late 2032, then about 78% payable.
- **FERS policy scenarios:** High-5 instead of High-3 (auto averages the highest 5 consecutive projected salaries). The
  COLA can be current-law diet COLA, the diet COLA minus X points (floored at 0), or none; this applies to the annuity
  and the survivor annuity. The supplement can be switched off ("eliminated by Congress").
- **Withdrawal strategies:** after cash, either the fixed order, proportional to the taxable/traditional/Roth balances,
  or traditional TSP and IRA up to the top of a chosen bracket (solved against the year's taxable income) and then
  the order. Optionally, one-time outflows are paid from the Roth accounts first. The order is a list you rearrange
  with up/down buttons.
- **Recurring and multi-year events:** each event repeats once, every N years from its start through an end
  year/age (0 = to the end of the plan), or each year for N consecutive years. Every occurrence is inflated from
  today's dollars to its own year and is deferred independently under guardrails.
- **Conversions and transfers** (`taxes.conversionsAndTransfers`): a list of moves by your age (see "Plan file"); for
  example move the whole Roth TSP to a Roth IRA at 57 and fill 24% converting traditional TSP into it. The UI flags
  overlapping conversions.
- **Returns by account:** mean and SD before and after retirement for the TSP, brokerage, traditional IRA and Roth
  IRA. In Monte Carlo all share one market shock per year (perfect rank correlation).
- **After-tax inheritance** = Roth (TSP and IRA) + money market + checking + brokerage (stepped-up basis) +
  traditional (TSP and IRA) × (1 − heirs' rate, default 22%). It is shown deterministically, with its composition and Monte Carlo percentiles. It ignores estate and
  inheritance taxes, the timing of heirs' withdrawals, and real estate.
- **IRMAA cost:** each year's extra Part B premium above the standard amount (a table column). The warnings state the
  dollar amounts.
- **Withdrawal rates:**
  - *All-in* = net portfolio draw (every withdrawal including RMDs, minus amounts saved back) ÷ start-of-year
    portfolio.
  - *Core* = what the portfolio must supply for recurring spending plus taxes beyond guaranteed income, excluding
    one-time events and the tax caused by Roth conversions and taxable one-time inflows, ÷ start-of-year portfolio.
  - The card shows the core peak first.
- **Cash-flow check** (year table, CSV, export): (non-salary income including RMDs + all withdrawals) − (spending +
  taxes paid from this cash flow + saved − unfunded). It should be about $0. Any year off by more than $5 is flagged
  and raises a critical warning. While you're working, salary, benefits spent with it, and the tax on them are
  outside this flow, because pre-retirement living costs aren't modeled.

**Checking, money market and brokerage investments**
- **Checking** (optional) is the everyday account. "Keep in checking" sets the cushion (today's $, indexed). Each
  year leftover money tops checking up to it first; checking above it moves to the money market, and checking below
  it is refilled from what is left in the money market. Spending comes out of the money market and investments, so
  checking stays at its target, the way you spend from checking and top it up from the money market during the year.
  Checking is spent only when every other account is empty. It earns its own rate (usually about 0%). Both checking
  fields at 0 leave it out, which is the default.
- **Money market** is money market funds (e.g. Schwab SWVXX) and savings: money that holds its value. A money market
  fund belongs here even when it sits inside a brokerage account. It is always drawn first for shortfalls and for
  conversion tax, before the configured order of the three invested accounts.
- **Brokerage investments** is a regular (non-retirement, taxable) brokerage account holding stock or bond funds or
  ETFs. It earns the investment return ("…brokerage investments" when returns differ by account), is randomized in
  Monte Carlo, and is taxed only on gains when withdrawn (see cost basis above). The inputs are
  `checkingAndMoneyMarket.checking`, `checkingAndMoneyMarket.moneyMarket` and `brokerage`; inside the engine and in
  the year rows the money market is `cash` and the brokerage `taxable` (checking is the row's `checking` object).
- With **Keep surplus in the money market** on, each year's surplus (after checking) goes to the money market until
  it reaches the limit (**Move money market above this to brokerage**). The limit is in today's dollars and indexed.
  Surplus above it, and any money market balance already above it, is invested in brokerage investments. With the
  option off, every surplus is invested in brokerage investments.
- **Settling-in years after retiring:** for the first N years of retirement the money market has no limit, so
  money waiting for large purchases (such as home-sale proceeds) stays out of the market. From the next year the
  limit applies again and anything above it moves to brokerage. Before retirement the limit applies as usual.
- Checking and the money market earn only their interest rates, on the start-of-year balance, paid out as ordinary
  income (US-taxable, optionally foreign-taxable). They get no market return, so Monte Carlo doesn't randomize them,
  and their real value erodes when the rate is below inflation.

**Foreign residence tax (Mexico engine)**
- **When it applies:** from the "tax resident from" year, on the income types you tick:
  - traditional TSP withdrawals and RMDs
  - Roth TSP withdrawals
  - Roth conversions
  - Social Security
  - FERS annuity (including the survivor annuity) and FERS supplement
  - brokerage investment gains, money market interest, and earned income
- **Method:**
  - *Mexico ISR* applies the 2026 annual tariff (art. 152 LISR, Anexo 8 RMF 2026; 1.92%
    to 35% in 11 brackets) in pesos. Its limits and fixed fees are indexed at `isrIndex` per year from 2026. Income
    is converted at the FX rate × (1 + drift)^years from the foreign-currency section, and the tax is converted back.
    A weakening peso therefore raises the dollar tax, because the same dollars become more pesos against the brackets.
  - *Flat* applies one effective rate above an optional exempt amount.
- **Retirement-income exemption** (ISR, optional): TSP, Roth, FERS and supplement income is exempt up to UMA × multiple
  × 365. The UMA is MXN 117.31/day in 2026, the multiple defaults to 15 (LISR art. 93 fr. IV), and the UMA is indexed
  like the tariff. Gains, interest, wages and conversions are not exempt.
- **Treaty art. 20 toggle** (optimistic bookend): TSP (traditional and Roth), the FERS annuity and the supplement are
  treated as US-only government-service pensions.
- **Roth:** in *earnings* mode, basis starts at `rothBasisPct` of today's Roth balance and grows with Roth contributions
  and every conversion. Each withdrawal is part basis, part earnings, in proportion at the start of the year (the TSP's
  own pro rata rule), and only the earnings share is foreign-taxable. Converted dollars are never taxed again.
  *Share* mode taxes a fixed share of withdrawals.
- **Double-tax relief:**
  - *US credits foreign tax:* Mexico taxes in full as the residence country. The US foreign
    tax credit reduces US federal tax, limited to the US tax attributable to the same income (US federal tax × that
    income's share of AGI; one basket). This year's Mexican tax is used first, then the oldest carryforwards. Unused
    credits carry forward 10 years and then expire (IRC §904(c); the 1-year carryback is not modeled). Each year shows
    US tax before and after the credit, Mexican tax, the credit, the carryforward and expiries.
  - *Foreign country credits US tax:* only the excess over the US tax on that income is paid abroad.
  - *None:* both countries tax in full.
- **Roth exposure:** qualified Roth withdrawals have no US tax to credit under any relief mode, which is the main
  exposure for Roth money abroad.
- **Payment:** foreign tax is paid from the portfolio like other taxes. It feeds into the conversion-tax calculation,
  so the "tax due to conversion" figure includes it.
- **Treaty:** US Social Security is taxable only by the US (art. 19). US government pensions paid to a US citizen are
  taxable only by the US (art. 20). Whether TSP distributions fall under art. 20 or the private-pension rule of art. 19
  is not settled. The art. 20 toggle and the checkboxes bracket that; they are not a statement of law.

**Monte Carlo**
- **Returns:** lognormal annual returns whose arithmetic mean is the pre- or post-retirement expected return, with
  your standard deviations. One draw per year applies to all accounts. The bridge bucket keeps its fixed return.
- **Seeding:** each run has its own mulberry32 streams, derived from the seed and the run number. Run *i* therefore
  sees the same market path in both lifespan modes, and results are reproducible.
- **Inflation:** optionally random, floored at −3%, with optional AR(1) persistence φ:
  dev_t = φ·dev_{t−1} + σ·√(1−φ²)·z. So `inflationSd` stays the long-run SD, and φ = 0 gives
  independent draws. Each run's inflation path drives everything: the FERS diet COLA (from the prior year's CPI), SS
  COLA, bracket/deduction/limit indexing, spending, and healthcare (simulated CPI + healthInflation − inflation).
  A test feeds a fixed path through each of these.
- **Lifespans:** *fixed* uses the lifespans and stops at the plan-to age. *Stochastic* samples each spouse's death
  age per run from the SSA 2023 period life table (2026 Trustees Report), given current ages, and runs until the last
  death. Survivor phase, filing status, survivor annuity, survivor SS, FEHB self-only, spending drop and RMD owner
  all follow that run's deaths. In stochastic mode the fan chart's percentiles cover runs where someone is still
  alive, and they stop once fewer than 5% remain.
- **Metrics (both modes):**
  - success: no unfunded retirement year
  - frequency of any unfunded year
  - duration: a histogram, plus the median and 90th percentile among failing runs
  - size: total unfunded in today's dollars, 50th/90th/95th across all runs and among failing runs
  - worst single year: 95th percentile and maximum
  - cause: unfunded dollars split pro rata between base spending and one-time outflows
  - ending balance, nominal and in today's dollars
  - death-age percentiles in stochastic mode
- **Adaptive rules** (off by default; Monte Carlo runs only, so the deterministic projection stays the plan as
  written). Both compare the run's start-of-year portfolio in today's dollars with the deterministic projection's.
  - *Contingent SS claiming:* in a trigger-age year, a spouse who hasn't claimed yet claims at that age's factor if
    the portfolio is below X% of plan or below $Y.
  - *Guardrails:* below *lower*% of plan, base living spending (not FEHB or Part B) is cut by Z% until the portfolio
    recovers above *upper*%. While the cut is on, events marked **Deferrable** slide one year at a time, up to N
    years.
  - *Caution:* the deterministic projection uses mean returns, so the median Monte Carlo path trails it. Thresholds
    near 100% of plan trigger in most runs.

## Known simplifications (not modeled)

- Partial years: no mid-year retirement month, birthday month, or prorated first COLA. The current year counts as a
  full year.
- Social Security: no wage-indexed PIA projection (PIA × inflation), no WEP/GPO (repealed in 2025 anyway), no SS
  earnings test for early claimers, no reduced survivor benefits before the survivor's FRA, no family maximum, no
  disability, and no SS on the deceased's record before 60.
- Pay: no promotions, grade changes or quality step increases; GS step increases assume acceptable performance, and the
  uneven steps of GS-1 and GS-2 are not modeled. Non-GS pay plans have no step schedule (turn step increases off).
- FERS: no death-in-service benefits, no basic employee death benefit, no deposit/redeposit service, no part-time
  proration, no CSRS-component computation, no 1% FERS-FRAE contribution differences, no recovery of employee
  contributions (the small tax-free portion of the annuity is taxed in full), no mandatory LEO retirement age, and
  no FEHB premium change at retirement.
- TSP: one blended return per year for all funds and accounts; no 10% early-withdrawal penalty (a warning is shown);
  no Roth 5-year rule; installment and annuity options are not modeled; brokerage investments are not taxed annually
  on dividends or interest; its basis is average cost (no tax-lot selection), and capital losses are never deducted
  from other income.
- Taxes: no itemized deductions, credits, AMT, or FICA/payroll tax outputs. State tax is a flat rate. No qualifying
  surviving spouse status (it requires a dependent child). The IRMAA top tier is indexed like the others (by law it
  isn't indexed until 2028).
- Medicare Part D/IRMAA-D and Medigap are not modeled (FEHB usually covers drugs); Part B is assumed to cost the same
  wherever you live.
- Stochastic mortality uses a period life table, with no projected mortality improvement and no health or wealth
  adjustment. The spouses' deaths are independent of each other. Returns are independent of inflation, with no fat
  tails.
- **Mexico ISR** is indexed smoothly. In reality Mexico updates it in steps after more than 10% cumulative inflation.
  The model ignores Mexican personal deductions, annual Mexican tax on brokerage dividends and interest,
  currency gains, and residency tie-breakers. Mexican inflation is not randomized in Monte Carlo.
- **Foreign tax credit** is simplified:
  - one basket (no passive/general split), with the limitation = US tax × the income's share of AGI
  - no carryback
  - income the US may tax as the source country (such as US dividends) is not credited by Mexico first

## Tests

```sh
node engine.test.js     # or open tests.html
```

The suite covers SS claim factors (62 → 0.70, 64 → 0.80, 67 → 1.00, 70 → 1.24), FRA lookup, spousal excess and
factors, provisional-income taxation, diet COLA, pension formula and 1.1% multiplier, MRA table, MRA+10 25%
reduction and postponement, retirement types, supplement amount and service rounding / end at 62 / zero for MRA+10 / earnings test,
survivor reduction and restoration, survivor annuity with COLA, the COLA start age, RMD ages and divisors, 2026 tax
math, LTCG stacking, the NIIT on interest and gains, GS step increases (schedule, pay ratio, High-3 back-projection) and the pay cap, brokerage cost basis (deposits as basis, gains conserved through losses), IRAs (RMDs, the 10%
penalty, Roth IRA contributions and basis, art. 20 covering only the TSP), conversions vs. untaxed transfers, one TSP
return with separate IRA returns, filing-status switch, Roth bracket fill, conversion tax paid from taxable, withdrawal order,
depletion, mass and cash conservation across eight scenarios (including stochastic, cash, and foreign tax), Monte Carlo
reproducibility, SS break-even, input normalization, the cash account (off, cap, sweep,
drawn-first, interest taxed), foreign tax (Roth with no credit, credit offset, exemption, residency start, default
income types), the plan report (every section present, one table row per year, no "undefined"/"NaN" text across
seven household variants), chained-CPI bracket indexing, the per-year bracket range and headroom, bracket fill under
double taxation (deterministic and random markets, no unfunded tax), and the year-row size limit (under 128 properties,
which keeps V8 from building rows in its slow dictionary mode). Plan-file tests check that every setting has a
control in its panel in the same order, that validation catches typos, wrong types, values that are not allowed and
whole-number percents, and that the review packet's settings file imports back to the same plan. The test households are made up and frozen in the test file, so changing the defaults
doesn't move the tests' numbers.

## License

Released into the public domain under [The Unlicense](LICENSE). Use it at your own risk: it comes with no warranty of
any kind, and it is not financial, tax, investment or legal advice.
