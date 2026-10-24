/*
 * engine.js — calculation engine for the FERS / TSP / Social Security household retirement calculator.
 *
 * Pure and side-effect free: no DOM access, no I/O, no mutation of inputs or globals. Given the same
 * inputs (and the same seeded rng) it always returns the same result. It runs as a browser global
 * (window.RetireEngine), as a CommonJS module under Node, and inside a Web Worker built from
 * RetireEngine.source.
 *
 * Conventions (see README "Assumptions"):
 *   - Annual timestep. A person's age in calendar year Y is (Y − birthYear). Age-based events
 *     (retirement, claiming, RMDs) take effect at the start of the year that age is reached.
 *   - All money is tracked in nominal dollars. idx (cumulative inflation, 1.0 in the current year)
 *     is reported per year so callers can convert to today's dollars.
 *   - Dollar inputs are in today's dollars unless the field says otherwise.
 *   - A person alive "through" their lifespan year dies at the end of it.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RetireEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function engineFactory() {
  'use strict';

  // ---------------------------------------------------------------------------------------------
  // CONSTANTS — every statutory value lives here. Dollar amounts are for `baseYear` and are
  // inflation-indexed by the engine unless marked "not indexed". Verified October 2026.
  // ---------------------------------------------------------------------------------------------
  const CONSTANTS = Object.freeze({
    baseYear: 2026,

    tax: {
      // IRS Rev. Proc. 2025-32 §4.01 (tax year 2026). Rates made permanent by P.L. 119-21 (OBBBA).
      // Each entry: [lower bound of taxable income, marginal rate].
      brackets: {
        mfj: [[0, 0.10], [24800, 0.12], [100800, 0.22], [211400, 0.24], [403550, 0.32], [512450, 0.35], [768700, 0.37]],
        single: [[0, 0.10], [12400, 0.12], [50400, 0.22], [105700, 0.24], [201775, 0.32], [256225, 0.35], [640600, 0.37]],
      },
      // Rev. Proc. 2025-32 §4.14 (2026 standard deduction).
      standardDeduction: { mfj: 32200, single: 16100 },
      // Rev. Proc. 2025-32 §4.14: additional amount per person 65+ ($1,650 married; $2,050 unmarried).
      additional65: { mfj: 1650, single: 2050 },
      // P.L. 119-21 §70103 "senior deduction": $6,000 per person 65+, tax years 2025–2028 only.
      // Each $6,000 is reduced by 6% of MAGI above $75k single / $150k joint. Not indexed.
      seniorDeduction: { amount: 6000, rate: 0.06, phaseoutStart: { mfj: 150000, single: 75000 }, firstYear: 2025, lastYear: 2028 },
      // Rev. Proc. 2025-32 §4.03 (2026 long-term capital gains breakpoints, taxable-income based).
      ltcg: {
        mfj: [[0, 0], [98900, 0.15], [613700, 0.20]],
        single: [[0, 0], [49450, 0.15], [545500, 0.20]],
      },
      // IRC §1411 net investment income tax. Thresholds are statutory and NOT indexed.
      niit: { rate: 0.038, threshold: { mfj: 250000, single: 200000 } },
    },

    ss: {
      // IRC §86(c): provisional-income base / adjusted base amounts. Statutory, NOT indexed.
      taxThresholds: { mfj: [32000, 44000], single: [25000, 34000] },
      // SSA OACT "Exempt amounts under the earnings test", 2026, for people under NRA all year.
      // Also the limit OPM applies to the FERS supplement. Indexed with wages (modeled with inflation).
      earningsTestLimit: 24480,
      // SSA full (normal) retirement age by birth year, in months. https://www.ssa.gov/benefits/retirement/planner/agereduction.html
      fraMonths: [
        [1937, 65 * 12], [1938, 65 * 12 + 2], [1939, 65 * 12 + 4], [1940, 65 * 12 + 6], [1941, 65 * 12 + 8],
        [1942, 65 * 12 + 10], [1954, 66 * 12], [1955, 66 * 12 + 2], [1956, 66 * 12 + 4], [1957, 66 * 12 + 6],
        [1958, 66 * 12 + 8], [1959, 66 * 12 + 10], [Infinity, 67 * 12],
      ], // [last birth year in band, FRA months]; 1943–1954 = 66.
      // 20 CFR 404.410 (early reduction), 404.313 (delayed credits, born 1943+), 404.412 (spousal).
      earlyFirst36PerMonth: 5 / 9 / 100,
      earlyBeyond36PerMonth: 5 / 12 / 100,
      delayedPerMonth: (2 / 3) / 100,
      spousalFirst36PerMonth: 25 / 36 / 100,
      spousalBeyond36PerMonth: 5 / 12 / 100,
      maxClaimAge: 70,
      survivorFloorOfPia: 0.825, // 42 USC 402(e)(2)(D) "widow(er)'s limit" when the deceased claimed early.
    },

    tsp: {
      // IRS Notice 2025-67 (2026 limits). 402(g) elective deferral limit and catch-ups.
      elective402g: 24500,
      catchUp50: 8000,
      catchUp60to63: 11250, // SECURE 2.0 §109 "super catch-up" for ages 60–63.
      // SECURE 2.0 §603: catch-ups must be Roth if prior-year FICA wages exceed this (2026 value).
      rothCatchUpWageThreshold: 150000,
      agencyAutomatic: 0.01, // 5 USC 8432(c)(1)
      // 5 USC 8432(c)(2): 100% match on first 3% of pay, 50% on next 2%.
      matchTiers: [[0.03, 1.0], [0.02, 0.5]],
    },
    ira: {
      // IRS Notice 2025-67 (2026): IRA contribution limit and the age-50 catch-up (indexed since SECURE 2.0).
      limit: 7500,
      catchUp50: 1100,
      earlyPenaltyRate: 0.10, // IRC §72(t): before 59½; the model treats the year you turn 60 as the first penalty-free year
    },

    medicare: {
      // CMS 2026 Medicare Parts A & B premiums fact sheet: standard Part B $202.90/month.
      partBMonthly: 202.90,
      // CMS 2026 IRMAA: MAGI thresholds (from tax return two years prior) and total Part B premium per tier.
      irmaaThresholds: { mfj: [218000, 274000, 342000, 410000, 750000], single: [109000, 137000, 171000, 205000, 500000] },
      irmaaPartBMonthly: [202.90, 284.10, 405.80, 527.50, 649.20, 689.90],
    },

    rmd: {
      // IRS Pub 590-B (2025), Appendix B Table III (Uniform Lifetime), effective 2022+.
      uniformLifetime: {
        72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1, 80: 20.2, 81: 19.4,
        82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5,
        92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9, 96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4, 101: 6.0,
        102: 5.6, 103: 5.2, 104: 4.9, 105: 4.6, 106: 4.3, 107: 4.1, 108: 3.9, 109: 3.7, 110: 3.5, 111: 3.4,
        112: 3.3, 113: 3.1, 114: 3.0, 115: 2.9, 116: 2.8, 117: 2.7, 118: 2.5, 119: 2.3, 120: 2.0,
      },
      // IRC §401(a)(9)(C) as amended by SECURE 2.0 §107: 73 for births 1951–1959, 75 for 1960+.
      startAgeByBirthYear: [[1950, 72], [1959, 73], [Infinity, 75]],
    },

    mortality: {
      // SSA Office of the Chief Actuary, "Actuarial Life Table": 2023 period life table for the Social Security area
      // population as used in the 2026 Trustees Report (https://www.ssa.gov/oact/STATS/table4c6.html, retrieved
      // October 2026). q[x] = probability of dying within one year at exact age x, ages 0–119.
      source: 'SSA 2023 period life table (2026 Trustees Report)',
      male: [
          0.006015, 0.000479, 0.00032, 0.000249, 0.000194, 0.000159, 0.000137, 0.000125, 0.00012, 0.00012,
          0.000125, 0.00014, 0.000173, 0.000233, 0.000327, 0.000463, 0.000634, 0.000819, 0.000999, 0.001138,
          0.001235, 0.001315, 0.001378, 0.001439, 0.001509, 0.001595, 0.001685, 0.001783, 0.001876, 0.00197,
          0.002085, 0.002202, 0.002308, 0.002407, 0.00249, 0.002577, 0.002665, 0.002764, 0.002864, 0.002987,
          0.003115, 0.003253, 0.003419, 0.0036, 0.003777, 0.003931, 0.004073, 0.004245, 0.004477, 0.004795,
          0.005126, 0.005496, 0.005917, 0.006404, 0.006923, 0.007491, 0.008173, 0.008938, 0.009714, 0.010494,
          0.011337, 0.012232, 0.013196, 0.014229, 0.015316, 0.016455, 0.017574, 0.018735, 0.019981, 0.021366,
          0.022903, 0.024615, 0.026504, 0.028648, 0.031071, 0.033802, 0.03701, 0.041158, 0.045461, 0.050346,
          0.055633, 0.061757, 0.068358, 0.07542, 0.083364, 0.09268, 0.103459, 0.115502, 0.129018, 0.14381,
          0.159458, 0.176551, 0.19536, 0.216286, 0.238799, 0.262268, 0.286291, 0.310944, 0.332325, 0.349036,
          0.366568, 0.38496, 0.404252, 0.424488, 0.445712, 0.467998, 0.491398, 0.515968, 0.541766, 0.568854,
          0.597297, 0.627162, 0.65852, 0.691446, 0.726018, 0.762319, 0.800435, 0.840457, 0.88248, 0.926604,
      ],
      female: [
          0.005125, 0.000392, 0.000229, 0.000188, 0.000155, 0.000133, 0.000115, 0.000105, 0.0001, 9.8e-05,
          0.000101, 0.000111, 0.000126, 0.000152, 0.000188, 0.000229, 0.000273, 0.000323, 0.000372, 0.00041,
          0.000441, 0.000476, 0.000513, 0.000546, 0.000582, 0.000609, 0.000641, 0.000683, 0.00074, 0.000808,
          0.000878, 0.000947, 0.001018, 0.001089, 0.001154, 0.001209, 0.001263, 0.001347, 0.001438, 0.001533,
          0.001643, 0.001742, 0.001845, 0.001954, 0.002075, 0.002187, 0.002306, 0.002438, 0.002595, 0.002791,
          0.00303, 0.003288, 0.003554, 0.003847, 0.004172, 0.004532, 0.004923, 0.005365, 0.005815, 0.006333,
          0.006923, 0.007555, 0.00822, 0.008881, 0.009514, 0.010188, 0.01088, 0.011659, 0.012543, 0.013581,
          0.014769, 0.016153, 0.017705, 0.019495, 0.021533, 0.023846, 0.026458, 0.0297, 0.033135, 0.036982,
          0.041183, 0.045959, 0.051282, 0.057262, 0.064107, 0.071752, 0.08049, 0.090566, 0.102204, 0.115178,
          0.129176, 0.144229, 0.160353, 0.177635, 0.196502, 0.216846, 0.23875, 0.261359, 0.283899, 0.306491,
          0.32968, 0.353333, 0.3773, 0.401416, 0.425501, 0.451031, 0.478092, 0.506778, 0.537185, 0.568854,
          0.597297, 0.627162, 0.65852, 0.691446, 0.726018, 0.762319, 0.800435, 0.840457, 0.88248, 0.926604,
      ],
      // Period life expectancy at exact age x (used only by tests to check the sampler).
      eMale45: 34.21, eFemale55: 29.01,
    },

    fers: {
      // 5 USC 8412(h); OPM "Types of Retirement". [last birth year in band, MRA in months].
      mraMonths: [
        [1947, 55 * 12], [1948, 55 * 12 + 2], [1949, 55 * 12 + 4], [1950, 55 * 12 + 6], [1951, 55 * 12 + 8],
        [1952, 55 * 12 + 10], [1964, 56 * 12], [1965, 56 * 12 + 2], [1966, 56 * 12 + 4], [1967, 56 * 12 + 6],
        [1968, 56 * 12 + 8], [1969, 56 * 12 + 10], [Infinity, 57 * 12],
      ],
      sickLeaveHoursPerYear: 2087, // OPM: 2,087 hours = 1 year of service (computation only).
      multiplier: 0.01, // 5 USC 8415(a)
      multiplierEnhanced: 0.011, // 5 USC 8415(g): age 62+ at separation with 20+ years.
      specialFirst20: 0.017, // 5 USC 8415(e): LEO / FF / ATC, first 20 years.
      specialAfter20: 0.01,
      mra10ReductionPerYear: 0.05, // 5 USC 8415(f): 5/12 of 1% per month under 62.
      survivor: { // 5 USC 8419, 8442: [reduction to retiree, survivor share of the unreduced annuity].
        none: [0, 0],
        partial: [0.05, 0.25],
        full: [0.10, 0.50],
      },
      // 5 USC 8421(b): SS-at-62 × years of FERS service ÷ 40, the years rounded to the nearest whole number (½ rounds up)
      // and capped at 40.
      supplementDivisor: 40,
      // 5 USC 8462(b): "diet COLA".
      dietCola: { lowCap: 0.02, highFloor: 0.03, haircut: 0.01 },
      fehbYearsRequired: 5, // 5 USC 8905(b)
      colaStartAge: 62, // 5 USC 8462(c): regular retirees get COLAs only once 62.
    },
    gs: {
      // 5 CFR 531.405(a): within-grade increases after 52 weeks at steps 1–3, 104 weeks at steps 4–6 and 156 weeks at
      // steps 7–9 (18 years from step 1 to 10). Years of waiting to reach each step:
      stepWaitYears: { 2: 1, 3: 1, 4: 1, 5: 2, 6: 2, 7: 2, 8: 3, 9: 3, 10: 3 },
      // General Schedule (5 USC 5332), GS-3 to GS-15: every step adds the same amount, 1/30 of the step-1 rate, so step 10
      // pays 30% more than step 1 (2026 GS-12, Rest of U.S.: $89,508 at step 1, $116,362 at step 10).
      stepIncrement: 1 / 30,
      // 5 USC 5304(g)(1): GS pay with locality cannot exceed Executive Schedule level IV, $197,200 in 2026 (OPM 2026 EX
      // table). Level IV rises by the GS across-the-board raise, rounded to $100 (5 USC 5318), so the model grows the
      // cap with the yearly raise (2021–2026: +1.0, 2.2, 4.1, 4.6, 1.7 and 1.0% against raises of 1.0, 2.2, 4.1, 4.7, 1.7, 1.0%).
      payCap: 197200,
    },
  });

  // ---------------------------------------------------------------------------------------------
  // Inputs. Each top-level section is one input panel of the app, in the app's order, and nested objects
  // are the groups inside a panel, so a plan file reads like the screen. Panels about one person hold `you` and
  // `spouse` (the same settings for each); settings beside them apply to the household. PLAN_GUIDE (below) states the
  // conventions: rates, returns and shares are decimals; dollar amounts are today's dollars a year unless the name ends
  // in Monthly or a comment says otherwise; age-based changes happen at the start of the year the age is reached.
  // ---------------------------------------------------------------------------------------------
  // Per-person settings. `federal` makes someone a FERS employee: GS pay, the TSP (with the agency contributions set
  // by law), the FERS annuity and supplement. Anyone else has a 401(k)-style plan with its own employer contributions
  // and, optionally, a simple pension (otherPension).
  const JOB_DEFAULT = {
    federal: true,
    salary: 0, // this year's pay; 0 = not working
    annualRaise: 0.02, // general pay increase each year
    // GS within-grade step increases (CONSTANTS.gs) from currentStep (1–10); the next one comes yearsUntilNextStep
    // years from now (1 = within a year; at most that step's waiting period). Federal only.
    addStepIncreases: false,
    currentStep: 5,
    yearsUntilNextStep: 1,
    // This year's GS pay cap (Executive Schedule level IV); later years grow with annualRaise. 0 = no cap. Federal only.
    gsPayCap: CONSTANTS.gs.payCap,
    retirementAge: 62, // first age without the salary
    afterRetiring: { earnings: 0, untilAge: 62 },
  };
  const PLAN_DEFAULT = {
    // rothBasisShare: share of today's Roth balance that is contributions (the rest is earnings).
    balances: { traditional: 0, roth: 0, rothBasisShare: 1 },
    contributions: { rate: 0, rothShare: 0, catchUp: false },
    // Not federal: the employer adds `automatic` of pay plus `match` × your contribution up to `matchUpTo` of pay. The
    // TSP's agency contributions are set by law instead.
    employerContributions: { automatic: 0, match: 0.5, matchUpTo: 0.06 },
    // One fund allocation covers the traditional and Roth balances, so one return.
    returns: { beforeRetirement: 0.07, afterRetirement: 0.06 },
  };
  // Each IRA is invested on its own. basisShare: share of today's Roth IRA balance that is contributions and
  // conversions; contributionsWhileWorking is capped at the IRA limit.
  const IRAS_DEFAULT = {
    traditional: { balance: 0, returns: { beforeRetirement: 0.07, afterRetirement: 0.06 } },
    roth: { balance: 0, basisShare: 1, returns: { beforeRetirement: 0.07, afterRetirement: 0.07 }, contributionsWhileWorking: 0 },
  };
  const FERS_DEFAULT = {
    serviceYears: 20,
    sickLeaveHours: 0,
    high3Mode: 'auto',
    manualHigh3: 100000, // today's dollars (inflated to the separation year)
    survivorElection: 'full', // protects the other spouse
    postponeToAge: 0, // 0 = start as early as the retirement type allows
    specialCategory: false,
    useOpmEstimate: false,
    opmEstimateMonthly: 3000, // gross, today's dollars (inflated to the first year it is paid)
    fehbYearsBeforeRetirement: 20,
  };
  const SUPPLEMENT_DEFAULT = {
    mode: 'auto',
    // Today's $: Social Security at 62 from the FERS years' earnings only. 0 = 70% of the person's PIA, the age-62
    // benefit for anyone born in 1960 or later.
    ssAt62FromFersMonthly: 0,
    manualMonthly: 1000, // today's dollars (inflated to the retirement year, then fixed)
  };
  // A non-federal pension: monthly amount in today's dollars when it starts, then a fixed COLA; the other spouse keeps
  // survivorShare of it after a death.
  const OTHER_PENSION_DEFAULT = { monthly: 0, startAge: 65, cola: 0, survivorShare: 0.5 };
  const both = (def, you, spouse) => ({ you: { ...def, ...you }, spouse: { ...def, ...spouse } });

  // The example household: a GS-12 (step 5, Rest of U.S. locality, 2026) ten years into federal service, hired at 34,
  // planning to retire at 62 with 28 years; a spouse two years older with a private-sector job and a 401(k). Values are
  // illustrative, not advice.
  function defaultInputs() {
    const ev = (at, label, amount, direction, extra) => ({ ...EVENT_DEFAULT, at, label, amount, direction, ...extra });
    const clone = (o) => JSON.parse(JSON.stringify(o));
    return {
      version: 1,
      household: {
        currentYear: 2026,
        you: { birthYear: 1982, lifespan: 95, sex: 'male' }, // sex selects the life table for stochastic lifespans
        married: true,
        spouse: { birthYear: 1980, lifespan: 95, sex: 'female' },
        planToAge: 95,
        longevityStress: false,
        monteCarloLifespans: 'stochastic', // 'fixed' = the lifespans above; 'stochastic' = sampled from the SSA life table
      },
      inflation: { rate: 0.025 },
      employment: {
        ...clone(both(JOB_DEFAULT,
          { federal: true, salary: 101443, addStepIncreases: true, currentStep: 5, yearsUntilNextStep: 1, retirementAge: 62 },
          { federal: false, salary: 60000, retirementAge: 62 })),
        // Social Security or annuity income that starts before you retire is spent with the salaries (not saved).
        spendBenefitsThatStartBeforeRetiring: true,
      },
      workplacePlans: clone(both(PLAN_DEFAULT,
        { balances: { traditional: 120000, roth: 30000, rothBasisShare: 0.7 }, contributions: { rate: 0.10, rothShare: 0.3, catchUp: false } },
        { balances: { traditional: 80000, roth: 0, rothBasisShare: 1 }, contributions: { rate: 0.08, rothShare: 0, catchUp: false } })),
      iras: clone(both(IRAS_DEFAULT, {}, {})),
      // A taxable account of stock and bond funds. unrealizedGainShare: share of today's balance that is gain not yet
      // taxed. savingsWhileWorking is added each year until you retire.
      brokerage: { balance: 20000, unrealizedGainShare: 0.3, savingsWhileWorking: 0, returns: { beforeRetirement: 0.07, afterRetirement: 0.06 } },
      checkingAndMoneyMarket: {
        // Checking is kept at keepInChecking: topped up from surplus first, refilled from the money market, spent last.
        checking: { balance: 0, keepInChecking: 0, interestRate: 0 },
        // With keepSurplus, surplus stays in the money market up to moveToBrokerageAbove and the rest is invested in the
        // brokerage account; no limit in the first settlingInYears of retirement (0 = off).
        moneyMarket: { balance: 25000, yield: 0.03, keepSurplus: true, moveToBrokerageAbove: 50000, settlingInYears: 0 },
      },
      withdrawals: {
        // 'fixedOrder' = the order below; 'proportional' = in proportion to balances; 'bracketFill' = traditional
        // accounts first up to the top of fillToTopOfBracket, then the order below.
        strategy: 'fixedOrder',
        fillToTopOfBracket: 0.12,
        oneTimeOutflowsFromRothFirst: false,
        // By account type; the money market always goes first. Within a type, the spouse who can withdraw without a
        // penalty goes first, then the older spouse.
        order: ['brokerage', 'traditionalWorkplace', 'rothWorkplace', 'traditionalIra', 'rothIra'],
        bridgeBucket: { enabled: false, yearsCovered: 5, buildYearsBeforeRetirement: 5, return: 0.04 },
      },
      fersPension: {
        ...clone(both(FERS_DEFAULT,
          { serviceYears: 28, sickLeaveHours: 1000, manualHigh3: 110000, fehbYearsBeforeRetirement: 28 }, {})),
        // FERS policy scenarios, for everyone in the household under FERS.
        averageSalaryYears: 3, // 3 = High-3 (current law); 5 = High-5 (proposed)
        colaMode: 'diet', // 'diet' = current law; 'reduced' = diet COLA minus colaReducedBy; 'none' = no COLA
        colaReducedBy: 0.01,
      },
      fersSupplement: clone(both(SUPPLEMENT_DEFAULT,
        // 28 years of about $95,000 ≈ 70% of a $2,700 PIA.
        { ssAt62FromFersMonthly: 1900, manualMonthly: 1500 }, {})),
      otherPension: clone(both(OTHER_PENSION_DEFAULT, {}, {})),
      socialSecurity: {
        you: { piaMonthly: 2900, claimAge: 67, claimExtraMonths: 0 },
        spouse: { piaMonthly: 2200, claimAge: 67, claimExtraMonths: 0 },
        // Share of scheduled benefits actually paid from fromYear; 1 = full benefits (current law).
        trustFundShortfall: { benefitsPaidShare: 1, fromYear: 2033 },
      },
      spending: {
        baseMonthly: 5000,
        survivorShare: 0.7,
        phases: { enabled: false, goGoUntilAge: 75, goGoShare: 1.0, slowGoUntilAge: 85, slowGoShare: 0.9, noGoShare: 0.85 },
        healthcare: {
          fehbMonthly: 650, fehbSelfOnlyShare: 0.45, inflation: 0.045, medicarePartBYou: true, medicarePartBSpouse: true,
          partBMonthly: CONSTANTS.medicare.partBMonthly,
        },
        oneTimeEvents: [
          ev(62, 'Replace car', 35000, 'outflow', { when: 'age', repeat: 'everyNYears', everyNYears: 8, through: 85, deferrable: true }),
          ev(65, 'Major home repair (roof, HVAC)', 25000, 'outflow', { when: 'age', repeat: 'everyNYears', everyNYears: 10, through: 85 }),
          ev(1, 'Long-term care (you)', 60000, 'outflow', { person: 'you', when: 'yearsBeforeDeath', repeat: 'eachYearForNYears', forNYears: 2 }),
          ev(1, 'Long-term care (spouse)', 60000, 'outflow', { person: 'spouse', when: 'yearsBeforeDeath', repeat: 'eachYearForNYears', forNYears: 2 }),
        ],
        foreignCurrency: { enabled: false, code: 'MXN', baseMonthly: 92500, localPerUsd: 18.5, annualDrift: 0 },
      },
      taxes: {
        mode: 'advanced', // 'advanced' = brackets and deductions; 'simple' = the effective rates below
        simpleRateJoint: 0.12,
        simpleRateSingle: 0.15,
        seniorDeduction: true,
        // Federal brackets, standard deduction, 65+ amounts and LTCG breakpoints are indexed with chained CPI (IRC §1(f)(3)),
        // which runs below the CPI used for inflation: they grow at inflation minus this each year. 0 = with inflation.
        bracketGrowthBelowInflation: 0.0025,
        heirsRate: 0.22, // heirs' marginal rate on inherited traditional plan and IRA money (after-tax inheritance)
        // By the owner's age (see MOVES). In a year the first conversion covering its owner's age applies, and every
        // transfer covering its owner's age.
        conversionsAndTransfers: [],
      },
      // State, local and foreign income taxes (see OTHER_TAX_DEFAULT). The example household lives in a state with a flat tax.
      otherTaxes: [{ ...JSON.parse(JSON.stringify(OTHER_TAX_DEFAULT)), name: 'State income tax', flatRate: 0.04, deduction: 20000 }],
      monteCarlo: {
        enabled: true,
        runs: 1000,
        seed: 20260101,
        // Standard deviation of yearly returns by account type (both spouses' plans and IRAs use their type's). Each year
        // one market shock moves every account.
        volatility: {
          beforeRetirement: { workplacePlans: 0.15, brokerage: 0.15, traditionalIra: 0.15, rothIra: 0.15 },
          afterRetirement: { workplacePlans: 0.10, brokerage: 0.12, traditionalIra: 0.10, rothIra: 0.15 },
        },
        inflation: { volatility: 0.015, persistence: 0.6 }, // persistence = AR(1) φ; volatility stays the long-run SD
        // Rules applied in Monte Carlo runs only (the deterministic projection is the plan as written).
        adaptiveRules: {
          // Claim Social Security early if the start-of-year portfolio is below the threshold in a trigger year.
          earlySocialSecurity: { enabled: false, fromAge: 67, throughAge: 69, threshold: 'shareOfPlan', shareOfPlan: 0.8, dollarAmount: 1000000 },
          // Cut base living spending while the portfolio is below cutBelowShareOfPlan × the plan, until it recovers above
          // restoreAboveShareOfPlan; deferrable one-time events slide up to deferEventsUpToYears while the cut is on.
          spendingGuardrails: { enabled: false, cutBelowShareOfPlan: 0.8, restoreAboveShareOfPlan: 0.95, spendingCut: 0.10, deferEventsUpToYears: 3 },
        },
      },
    };
  }

  // One-time events. person: 'household' | 'you' | 'spouse' (a person's event is skipped after that person dies).
  // when: 'year' (calendar year) | 'age' (that person's age; yours for the household) | 'yearsBeforeDeath' (`at` years
  // before the person's death year). repeat: 'once' | 'everyNYears' (from `at` through `through`, 0 = end of plan, same
  // unit as `when`) | 'eachYearForNYears' (forNYears years in a row). taxed applies to inflows.
  const EVENT_DEFAULT = { label: 'Event', person: 'household', when: 'year', at: 2030, repeat: 'once', everyNYears: 5, through: 0, forNYears: 2,
    amount: 0, direction: 'outflow', taxed: 'no', inTodaysDollars: true, deferrable: false };
  // A state, local or foreign income tax (otherTaxes). It applies from fromYear through throughYear (0 = the plan's start or end)
  // to the income types checked in appliesTo, less `deduction` per return and a retirement-income exclusion per person
  // (from exclusionFromAge), at a flat rate or the brackets ([{ from, rate }]: the rate on taxable income above `from`).
  // Amounts are today's dollars and grow with inflation minus thresholdGrowthBelowInflation. filing: 'household' = one
  // return; 'separate' = each spouse's own income (joint income split evenly). rothAmountTaxed: 'earnings' (basis tracked)
  // or 'whole'. creditsFederalTax: reduced by the federal tax on the same income (federal tax is credited only once).
  const OTHER_TAX_DEFAULT = {
    name: 'Income tax', fromYear: 0, throughYear: 0, filing: 'household',
    rates: 'flat', flatRate: 0.05, brackets: [], deduction: 0, thresholdGrowthBelowInflation: 0,
    retirementExclusion: 0, exclusionFromAge: 0,
    appliesTo: {
      wages: true, fersAnnuity: true, otherPensions: true, fersSupplement: true, socialSecurity: false,
      traditionalTsp: true, traditional401k: true, traditionalIra: true, rothTsp: false, roth401k: false, rothIra: false,
      rothConversions: true, brokerageGains: true, interest: true, oneTimeIncome: true,
    },
    rothAmountTaxed: 'earnings', creditsFederalTax: false,
  };
  // A conversion or transfer row: between two accounts of `owner`. howMuch: 'fillBracket' (conversions only) |
  // 'fixedAmount' (today's $ a year) | 'wholeBalance'.
  const MOVE_DEFAULT = { owner: 'you', fromAccount: 'traditionalWorkplace', toAccount: 'rothWorkplace', fromAge: 62, throughAge: 62, howMuch: 'fillBracket',
    fillToTopOfBracket: 0.22, fixedAmount: 50000 };
  // Account types as the inputs name them (withdrawal order, conversions and transfers) and their keys inside the engine.
  // A workplace plan is the TSP for a federal employee and a 401(k)-style plan for anyone else.
  const ACCOUNT_KEY = { brokerage: 'taxable', traditionalWorkplace: 'trad', rothWorkplace: 'roth', traditionalIra: 'tradIra', rothIra: 'rothIra' };
  const ACCOUNT_NAMES = Object.keys(ACCOUNT_KEY);
  const ACCOUNT_LABELS = { brokerage: 'Brokerage investments', traditionalWorkplace: 'Traditional TSP / 401(k)', rothWorkplace: 'Roth TSP / 401(k)',
    traditionalIra: 'Traditional IRA', rothIra: 'Roth IRA' };
  // Conversions (traditional → Roth: taxed) and transfers (same tax type: not taxed) between one owner's accounts.
  const MOVES = [
    { fromAccount: 'traditionalWorkplace', toAccount: 'rothWorkplace', label: 'Traditional TSP / 401(k) → Roth TSP / 401(k) (in-plan conversion)' },
    { fromAccount: 'traditionalWorkplace', toAccount: 'rothIra', label: 'Traditional TSP / 401(k) → Roth IRA (conversion)' },
    { fromAccount: 'traditionalIra', toAccount: 'rothIra', label: 'Traditional IRA → Roth IRA (conversion)' },
    { fromAccount: 'rothWorkplace', toAccount: 'rothIra', label: 'Roth TSP / 401(k) → Roth IRA (transfer)' },
    { fromAccount: 'traditionalWorkplace', toAccount: 'traditionalIra', label: 'Traditional TSP / 401(k) → traditional IRA (transfer)' },
  ];
  const findMove = (w) => MOVES.find((m) => m.fromAccount === w.fromAccount && m.toAccount === w.toAccount) || null;
  const isConversion = (w) => /^traditional/.test(w.fromAccount) && /^roth/.test(w.toAccount);
  // Key of a move in each year's `moves`, e.g. traditionalWorkplaceToRothIra. Each move keeps one key string: building a
  // new string per run made V8 deoptimize the keyed accesses in simulate() over and over (Monte Carlo ran ~40% slower).
  const moveKey = (w) => `${w.fromAccount}To${w.toAccount[0].toUpperCase()}${w.toAccount.slice(1)}`;
  for (const m of MOVES) m.key = moveKey(m);
  // Withdrawal order: each invested account type once (a comma-separated string is accepted); missing ones are appended.
  function normalizeOrder(v) {
    const list = (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim());
    const out = list.filter((x, i) => ACCOUNT_NAMES.includes(x) && list.indexOf(x) === i);
    for (const a of ACCOUNT_NAMES) if (!out.includes(a)) out.push(a);
    return out;
  }

  const BRACKET_RATES = [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];
  // Allowed values of each enumerated setting (`[]` = every item of that list). Anything else falls back to the default.
  const ENUMS = {
    'household.you.sex': ['male', 'female'],
    'household.spouse.sex': ['male', 'female'],
    'household.monteCarloLifespans': ['fixed', 'stochastic'],
  };
  for (const who of ['you', 'spouse']) {
    ENUMS[`employment.${who}.currentStep`] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    ENUMS[`employment.${who}.yearsUntilNextStep`] = [1, 2, 3];
  }
  Object.assign(ENUMS, {
    'withdrawals.strategy': ['fixedOrder', 'proportional', 'bracketFill'],
    'withdrawals.fillToTopOfBracket': BRACKET_RATES,
    'withdrawals.order[]': ACCOUNT_NAMES,
  });
  for (const who of ['you', 'spouse']) {
    ENUMS[`fersPension.${who}.high3Mode`] = ['auto', 'manual'];
    ENUMS[`fersPension.${who}.survivorElection`] = ['none', 'partial', 'full'];
  }
  Object.assign(ENUMS, {
    'fersPension.averageSalaryYears': [3, 5],
    'fersPension.colaMode': ['diet', 'reduced', 'none'],
    'fersSupplement.you.mode': ['auto', 'manual', 'off'],
    'fersSupplement.spouse.mode': ['auto', 'manual', 'off'],
    'spending.oneTimeEvents[].person': ['household', 'you', 'spouse'],
    'spending.oneTimeEvents[].when': ['year', 'age', 'yearsBeforeDeath'],
    'spending.oneTimeEvents[].repeat': ['once', 'everyNYears', 'eachYearForNYears'],
    'spending.oneTimeEvents[].direction': ['outflow', 'inflow'],
    'spending.oneTimeEvents[].taxed': ['no', 'ordinaryIncome', 'longTermGain'],
    'taxes.mode': ['advanced', 'simple'],
    'taxes.conversionsAndTransfers[].owner': ['you', 'spouse'],
    'taxes.conversionsAndTransfers[].fromAccount': ACCOUNT_NAMES,
    'taxes.conversionsAndTransfers[].toAccount': ACCOUNT_NAMES,
    'taxes.conversionsAndTransfers[].howMuch': ['fillBracket', 'fixedAmount', 'wholeBalance'],
    'taxes.conversionsAndTransfers[].fillToTopOfBracket': BRACKET_RATES,
    'otherTaxes[].filing': ['household', 'separate'],
    'otherTaxes[].rates': ['flat', 'brackets'],
    'otherTaxes[].rothAmountTaxed': ['earnings', 'whole'],
    'monteCarlo.adaptiveRules.earlySocialSecurity.threshold': ['shareOfPlan', 'dollarAmount'],
  });
  const LIST_ITEM = { 'spending.oneTimeEvents': EVENT_DEFAULT, 'taxes.conversionsAndTransfers': MOVE_DEFAULT, otherTaxes: OTHER_TAX_DEFAULT,
    'otherTaxes[].brackets': { from: 0, rate: 0 } };
  const allowed = (enumPath, v) => ENUMS[enumPath].some((a) => (typeof a === 'number' ? Math.abs(a - v) < 1e-9 : a === v));
  // Settings that are decimals (0.07 = 7%), and the value from which one is taken to be a whole-number percent typed by
  // mistake: 100% or more for rates and returns, above 150% for shares (spending phases and guardrails go a bit above 100%).
  const decimalLimit = (path) => (/(^|\.)(\w*Share|\w*ShareOfPlan|shareOfPlan)$/.test(path) ? 1.5
    : /^monteCarlo\.volatility\./.test(path) || /(^|\.)(rate|yield|interestRate|annualRaise|beforeRetirement|afterRetirement|return|inflation|colaReducedBy|bracketGrowthBelowInflation|heirsRate|simpleRateJoint|simpleRateSingle|flatRate|thresholdGrowthBelowInflation|annualDrift|volatility|persistence|spendingCut|fillToTopOfBracket|automatic|match|matchUpTo|cola)$/.test(path) ? 1 : null);

  // How to read and edit a plan file, for people and AI assistants (in exported files and the review packet).
  const PLAN_GUIDE = [
    'Each top-level section of "inputs" is one input panel of the calculator, in the same order, and nested objects are the groups inside it. ' +
      'A missing setting takes its default and an unknown one is ignored; the app lists both when the file is imported.',
    'Panels about one person (employment, workplacePlans, iras, fersPension, fersSupplement, otherPension, socialSecurity) hold "you" and "spouse", ' +
      'with the same settings for each; settings beside them apply to the household. The spouse is used only when household.married is true.',
    'employment.<person>.federal makes that person a federal employee under FERS: GS pay, the TSP as their workplace plan (agency contributions set by law), ' +
      'and fersPension / fersSupplement. Anyone else has a 401(k)-style workplace plan (workplacePlans.<person>.employerContributions) and otherPension.',
    'Rates, returns and shares are decimals: 0.07 means 7%.',
    "Every dollar amount is in today's dollars (the plan's current year) and per year, unless the name ends in Monthly (per month). " +
      'The only exception is a one-time event with inTodaysDollars false, which is in the dollars of its year. The calculator inflates amounts to the year ' +
      'they apply to: a manual High-3 to the separation year, an OPM estimate to the first year it is paid, a manual supplement to the retirement year.',
    'Ages are whole years, and a change tied to an age happens at the start of the calendar year that age is reached. ' +
      'Spending starts when you (household.you) retire; until then the salaries are assumed to cover living costs.',
    'Account types: traditionalWorkplace and rothWorkplace (the TSP or a 401(k)), traditionalIra, rothIra and brokerage (a taxable account of stock and bond funds, ' +
      'held jointly) are invested; checking and the money market are cash (checkingAndMoneyMarket). Each spouse has their own workplace plan and IRAs; after a ' +
      'death the survivor owns them. withdrawals.order ranks the five types; the money market is always drawn first and checking last.',
    'taxes.conversionsAndTransfers: each row moves money between two accounts of its owner ("you" or "spouse"), by the owner\'s age. Conversions are taxed as income in the year (' +
      MOVES.filter(isConversion).map((m) => `${m.fromAccount} → ${m.toAccount}`).join(', ') + '); transfers are not taxed (' +
      MOVES.filter((m) => !isConversion(m)).map((m) => `${m.fromAccount} → ${m.toAccount}`).join(', ') + '). ' +
      "howMuch: fillBracket (taxable income up to the top of fillToTopOfBracket; conversions only), fixedAmount (today's $ a year) or wholeBalance. " +
      'Each year the first conversion row covering its owner\'s age applies, and every transfer row covering its owner\'s age.',
    'spending.oneTimeEvents: when is "year" (a calendar year), "age" (the person\'s age; yours for household events) or "yearsBeforeDeath"; ' +
      'repeat is "once", "everyNYears" (from at through `through`, 0 = end of plan) or "eachYearForNYears" (forNYears years in a row); ' +
      'events for "you" or "spouse" stop after that person dies; taxed applies to inflows; deferrable events can slide under spending guardrails.',
    'otherTaxes: state, local and foreign income taxes, each from fromYear through throughYear (0 = open). Each taxes the income types ' +
      'checked in appliesTo (Social Security at its federally taxable amount; Roth withdrawals as their earnings or in whole), less a deduction per ' +
      'return and up to retirementExclusion of each person\'s retirement income from exclusionFromAge, at flatRate or by brackets [{ from, rate }]. ' +
      'Amounts are today\'s dollars and grow with inflation minus thresholdGrowthBelowInflation. filing "separate" gives each spouse a return ' +
      '(joint income such as brokerage gains and interest split evenly). creditsFederalTax reduces it by the federal tax on the same income. ' +
      'traditionalTsp and rothTsp are a federal employee\'s TSP; traditional401k and roth401k anyone else\'s plan.',
    'Allowed values: ' + Object.entries(ENUMS).map(([p, v]) => `${p} = ${v.join(' | ')}`).join('; ') + '.',
  ];

  // Deep-merge user inputs over the defaults, coercing types, dropping unknown keys and replacing values that are not
  // allowed with the default. Never mutates.
  const join = (a, k) => (a ? `${a}.${k}` : k);
  function normalizeInputs(raw) {
    // `path` is the setting's path, with [] for the items of a list (as in ENUMS).
    function merge(def, val, path) {
      if (Array.isArray(def)) {
        if (path === 'withdrawals.order') return normalizeOrder(val === undefined || val === null ? def : val);
        if (!Array.isArray(val)) return def;
        return val.map((v) => merge(LIST_ITEM[path], v && typeof v === 'object' ? v : {}, path + '[]'));
      }
      if (def && typeof def === 'object') {
        const out = {};
        const src = val && typeof val === 'object' && !Array.isArray(val) ? val : {};
        for (const k of Object.keys(def)) out[k] = merge(def[k], src[k], join(path, k));
        return out;
      }
      if (val === undefined || val === null || val === '') return def;
      let v;
      if (typeof def === 'number') { const n = Number(val); v = Number.isFinite(n) ? n : def; }
      else if (typeof def === 'boolean') v = val === true || val === 'true' || val === 1;
      else v = String(val);
      return ENUMS[path] && !allowed(path, v) ? def : v;
    }
    const out = merge(defaultInputs(), raw || {}, '');
    out.version = INPUTS_VERSION;
    return out;
  }
  const INPUTS_VERSION = 1;

  // What normalizeInputs would change or drop in a plan file: unknown settings, missing ones, wrong types, values that
  // are not allowed, whole-number percents, and conversion/transfer rows that are not one of MOVES.
  // Returns [{ path, problem }] (missing fields inside list items are not reported; they take the item defaults).
  function validateInputs(raw) {
    const out = [];
    const add = (path, problem) => out.push({ path, problem });
    function walk(def, val, path, enumPath, inItem) {
      if (val === undefined || val === null) { if (!inItem && path !== 'version') add(path, 'missing: the default is used'); return; }
      if (Array.isArray(def)) {
        const list = path === 'withdrawals.order' && typeof val === 'string' ? val.split(',').map((x) => x.trim()) : val;
        if (!Array.isArray(list)) { add(path, 'should be a list: the default is used'); return; }
        if (path === 'withdrawals.order') {
          for (const x of list) if (!ACCOUNT_NAMES.includes(x)) add(path, `"${x}" is not an account (${ACCOUNT_NAMES.join(', ')}): ignored`);
          return;
        }
        list.forEach((v, i) => {
          const p = `${path}[${i}]`;
          if (!v || typeof v !== 'object' || Array.isArray(v)) { add(p, 'should be an object'); return; }
          walk(LIST_ITEM[enumPath], v, p, enumPath + '[]', true); // by the [] path, so lists inside list items work too
          if (path === 'taxes.conversionsAndTransfers' && ACCOUNT_NAMES.includes(v.fromAccount) && ACCOUNT_NAMES.includes(v.toAccount) && !findMove(v)) {
            add(p, `${v.fromAccount} → ${v.toAccount} is not a conversion or transfer the model supports: the row is ignored`);
          }
        });
        return;
      }
      if (def && typeof def === 'object') {
        if (typeof val !== 'object' || Array.isArray(val)) { add(path, 'should be an object: the defaults are used'); return; }
        for (const k of Object.keys(val)) if (!(k in def)) add(join(path, k), 'unknown setting: ignored');
        for (const k of Object.keys(def)) walk(def[k], val[k], join(path, k), join(enumPath, k), inItem);
        return;
      }
      let v = val;
      if (typeof def === 'number') {
        v = Number(val);
        if (typeof val === 'boolean' || !Number.isFinite(v)) { add(path, `should be a number, not ${JSON.stringify(val)}: the default is used`); return; }
        const lim = decimalLimit(path);
        if (lim !== null && (lim === 1 ? Math.abs(v) >= 1 : Math.abs(v) > lim)) add(path, `${v} looks like a whole-number percent; rates and shares are decimals (7% is 0.07)`);
      } else if (typeof def === 'boolean') {
        if (![true, false, 'true', 'false', 1, 0].includes(val)) { add(path, `should be true or false, not ${JSON.stringify(val)}`); return; }
      } else if (typeof val !== 'string') { add(path, `should be text, not ${JSON.stringify(val)}`); return; }
      if (ENUMS[enumPath] && !allowed(enumPath, v)) add(path, `${JSON.stringify(val)} is not allowed (${ENUMS[enumPath].join(', ')}): the default is used`);
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [{ path: '', problem: 'not a plan: expected an object of settings' }];
    walk(defaultInputs(), raw, '', '', false);
    return out;
  }

  // Revision of defaultInputs(). Share links store only the differences from the defaults, so they record the
  // revision they were made against and only links of the current revision can be decoded. Raise it whenever a
  // default changes.
  const DEFAULTS_REVISION = 1;
  function overlay(base, diff) {
    if (diff === undefined) return base;
    if (Array.isArray(diff) || !diff || typeof diff !== 'object' || !base || typeof base !== 'object') return JSON.parse(JSON.stringify(diff));
    const out = { ...base };
    for (const k of Object.keys(diff)) out[k] = overlay(base[k], diff[k]);
    return out;
  }
  // Rebuild full inputs from a share-link diff made against the current defaults.
  function inputsFromDiff(diff) {
    return normalizeInputs(overlay(defaultInputs(), diff || {}));
  }

  // ---------------------------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------------------------
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const round10 = (x) => Math.round(x * 1e10) / 1e10;
  const lookupBand = (table, birthYear) => {
    for (const [last, v] of table) if (birthYear <= last) return v;
    return table[table.length - 1][1];
  };
  const floorTo = (x, step) => Math.floor(x / step + 1e-9) * step;

  function mraMonthsForBirthYear(by) { return lookupBand(CONSTANTS.fers.mraMonths, by); }
  function mraForBirthYear(by) { return mraMonthsForBirthYear(by) / 12; }
  function fraMonthsForBirthYear(by) { return lookupBand(CONSTANTS.ss.fraMonths, by); }
  function rmdStartAge(by) { return lookupBand(CONSTANTS.rmd.startAgeByBirthYear, by); }
  function rmdDivisor(age) {
    const t = CONSTANTS.rmd.uniformLifetime;
    if (age < 72) return t[72];
    return t[Math.min(120, Math.floor(age))];
  }

  // Social Security benefit as a fraction of PIA when claimed at `claimAge` (years, may be fractional).
  function ssClaimFactor(claimAge, fraMonths) {
    const c = CONSTANTS.ss;
    const claimMonths = Math.round(Math.min(claimAge, c.maxClaimAge) * 12);
    const diff = claimMonths - fraMonths;
    if (diff < 0) {
      const e = -diff;
      return round10(1 - Math.min(e, 36) * c.earlyFirst36PerMonth - Math.max(0, e - 36) * c.earlyBeyond36PerMonth);
    }
    return round10(1 + diff * c.delayedPerMonth);
  }

  // Spousal benefit as a fraction of the spousal "excess" when it begins at `age`. No delayed credits.
  function ssSpousalFactor(age, fraMonths) {
    const c = CONSTANTS.ss;
    const e = Math.max(0, fraMonths - Math.round(age * 12));
    return round10(1 - Math.min(e, 36) * c.spousalFirst36PerMonth - Math.max(0, e - 36) * c.spousalBeyond36PerMonth);
  }

  function spousalExcess(ownPia, otherPia) { return Math.max(0, 0.5 * otherPia - ownPia); }

  // FERS "diet COLA" for a given CPI change.
  function dietCola(cpi) {
    const d = CONSTANTS.fers.dietCola;
    if (cpi <= 0) return 0;
    if (cpi <= d.lowCap) return cpi;
    if (cpi <= d.highFloor) return d.lowCap;
    return round10(cpi - d.haircut);
  }

  // Retirement type at separation. `service` is creditable service WITHOUT sick leave.
  function fersRetirementType(age, service, mra, special) {
    const eps = 1e-9;
    if (special && ((age >= 50 && service >= 20) || service >= 25)) {
      return { type: 'immediate', rule: 'Special category (50+20 / 25)', supplementEligible: true };
    }
    if (age >= 62 && service >= 5) return { type: 'immediate', rule: '62+5', supplementEligible: false };
    if (age >= 60 && service >= 20) return { type: 'immediate', rule: '60+20', supplementEligible: true };
    if (age >= mra - eps && service >= 30) return { type: 'immediate', rule: 'MRA+30', supplementEligible: true };
    if (age >= mra - eps && service >= 10) return { type: 'mra10', rule: 'MRA+10', supplementEligible: false };
    if (service >= 5) return { type: 'deferred', rule: 'Deferred', supplementEligible: false };
    return { type: 'none', rule: 'Not vested (under 5 years)', supplementEligible: false };
  }

  function fersMultiplier(ageAtSeparation, service) {
    const f = CONSTANTS.fers;
    return ageAtSeparation >= 62 && service >= 20 ? f.multiplierEnhanced : f.multiplier;
  }

  // Basic annual annuity before any age or survivor reduction.
  function fersBasicAnnuity({ high3, compService, ageAtSeparation, service, special }) {
    const f = CONSTANTS.fers;
    if (special) {
      return high3 * (f.specialFirst20 * Math.min(compService, 20) + f.specialAfter20 * Math.max(0, compService - 20));
    }
    return high3 * compService * fersMultiplier(ageAtSeparation, service);
  }

  // Annuity commencement age for a retirement type (whole years). `requested` 0 = automatic.
  function fersStartAge(rt, retireAge, service, mra, requested) {
    if (rt.type === 'immediate') return retireAge;
    if (rt.type === 'mra10') return Math.max(retireAge, requested || retireAge);
    if (rt.type === 'deferred') {
      const earliest = service >= 10 ? Math.ceil(mra - 1e-9) : 62;
      const unreduced = service >= 30 ? Math.ceil(mra - 1e-9) : service >= 20 ? 60 : 62;
      return requested ? Math.max(earliest, requested) : Math.max(earliest, unreduced);
    }
    return null;
  }

  // Permanent MRA+10 age reduction (also applies to deferred annuities with 10–29 years started early).
  function fersAgeReduction(rt, startAge, service) {
    if (rt.type !== 'mra10' && rt.type !== 'deferred') return 0;
    if (service >= 30) return 0;
    if (service >= 20 && startAge >= 60) return 0;
    return round10(Math.max(0, 62 - startAge) * CONSTANTS.fers.mra10ReductionPerYear);
  }

  // 5 USC 8421(b)(3): years of FERS service rounded to the nearest whole number (½ rounds up), at most 40.
  function fersSupplementYears(service) {
    return Math.min(CONSTANTS.fers.supplementDivisor, Math.round(Math.max(0, service) + 1e-9));
  }

  // ss62Monthly is the age-62 benefit, i.e. the PIA after the maximum early-claiming reduction (70% for births 1960+).
  function fersSupplementMonthly(ss62Monthly, service) {
    return ss62Monthly * fersSupplementYears(service) / CONSTANTS.fers.supplementDivisor;
  }

  // Taxable portion of Social Security (IRS Pub 915 worksheet). otherIncome = AGI excluding SS.
  function taxableSocialSecurity(otherIncome, ssBenefits, status) {
    if (ssBenefits <= 0) return 0;
    const [base, adj] = CONSTANTS.ss.taxThresholds[status];
    const pi = otherIncome + 0.5 * ssBenefits;
    if (pi <= base) return 0;
    if (pi <= adj) return Math.min(0.5 * ssBenefits, 0.5 * (pi - base));
    return Math.min(0.85 * ssBenefits, 0.85 * (pi - adj) + Math.min(0.5 * ssBenefits, 0.5 * (adj - base)));
  }

  function bracketTax(income, brackets, scale) {
    let tax = 0;
    for (let i = 0; i < brackets.length; i++) {
      const lo = brackets[i][0] * scale;
      const hi = i + 1 < brackets.length ? brackets[i + 1][0] * scale : Infinity;
      if (income <= lo) break;
      tax += (Math.min(income, hi) - lo) * brackets[i][1];
    }
    return tax;
  }

  function marginalRate(income, brackets, scale) {
    let r = 0;
    for (const [lo, rate] of brackets) if (income > lo * scale) r = rate;
    return r;
  }

  // Top of the bracket whose rate is `rate` (taxable income), or Infinity for the top bracket.
  function bracketTop(rate, status, scale) {
    const b = CONSTANTS.tax.brackets[status];
    for (let i = 0; i < b.length; i++) {
      if (Math.abs(b[i][1] - rate) < 1e-9) return i + 1 < b.length ? b[i + 1][0] * scale : Infinity;
    }
    return 0;
  }

  // The year's federal brackets and deductions for tax index `scale` (× the 2026 amounts): each bracket's taxable-income
  // range (`to` null for the top bracket), LTCG breakpoints, the standard deduction and the 65+ amount per person.
  function federalBrackets(scale) {
    const C = CONSTANTS.tax;
    const ranges = (b) => b.map(([lo, rate], i) => ({ rate, from: lo * scale, to: i + 1 < b.length ? b[i + 1][0] * scale : null }));
    const out = { scale };
    for (const st of ['mfj', 'single']) {
      out[st] = {
        brackets: ranges(C.brackets[st]), ltcg: ranges(C.ltcg[st]),
        standardDeduction: C.standardDeduction[st] * scale, additional65: C.additional65[st] * scale,
      };
    }
    return out;
  }

  // Capital gains stacked on top of ordinary taxable income.
  function ltcgStackTax(ordTaxable, gains, brackets, scale) {
    let tax = 0;
    const start = ordTaxable, end = ordTaxable + gains;
    for (let i = 0; i < brackets.length; i++) {
      const lo = brackets[i][0] * scale;
      const hi = i + 1 < brackets.length ? brackets[i + 1][0] * scale : Infinity;
      const overlap = Math.min(end, hi) - Math.max(start, lo);
      if (overlap > 0) tax += overlap * brackets[i][1];
    }
    return tax;
  }

  /**
   * Federal income tax for one year (state, local and foreign taxes are otherTaxes, in simulate).
   * p.ordinary: ordinary income excluding Social Security; p.ltcg: long-term gains; p.ss: total SS benefits.
   * p.interest: the interest included in p.ordinary (net investment income for the NIIT, like the gains).
   * p.scale: inflation index of statutory dollar amounts relative to CONSTANTS.baseYear.
   */
  // The bracket a year's ordinary taxable income falls in. A constructor rather than object literals: V8 kept
  // deoptimizing computeTaxes on literals whose fields mix null, small integers and doubles (Monte Carlo ran ~40% slower).
  function Bracket(from, to, headroom) { this.from = from; this.to = to; this.headroom = headroom; }
  function computeTaxes(p) {
    const C = CONSTANTS.tax;
    const status = p.status;
    const s = p.scale || 1;
    const ltcg = Math.max(0, p.ltcg || 0);
    const ordinary = Math.max(0, p.ordinary || 0);
    const taxableSS = taxableSocialSecurity(ordinary + ltcg, p.ss || 0, status);
    const agi = ordinary + ltcg + taxableSS;
    const nOver65 = p.nOver65 || 0;
    let deduction = (C.standardDeduction[status] + C.additional65[status] * nOver65) * s;
    let senior = 0;
    const sd = C.seniorDeduction;
    if (p.seniorDeduction !== false && nOver65 > 0 && p.year >= sd.firstYear && p.year <= sd.lastYear) {
      const each = Math.max(0, sd.amount - sd.rate * Math.max(0, agi - sd.phaseoutStart[status]));
      senior = each * nOver65;
    }
    deduction += senior;
    const ordInc = ordinary + taxableSS;
    const ordTaxable = Math.max(0, ordInc - deduction);
    const gainsTaxable = Math.max(0, ltcg - Math.max(0, deduction - ordInc));
    let ordinaryTax, ltcgTax, niit, federal, marginal;
    // The bracket ordinary taxable income falls in: its taxable-income range (`to` null for the top bracket) and the room
    // left in it. Below the deduction there is no bracket yet (from/to null) and the room is the unused deduction.
    // Null in simple mode.
    let bracket = null;
    if (p.mode === 'simple') {
      const rate = status === 'mfj' ? p.simpleMfj : p.simpleSingle;
      federal = agi * rate;
      ordinaryTax = federal; ltcgTax = 0; niit = 0; marginal = rate;
    } else {
      const B = C.brackets[status];
      ordinaryTax = bracketTax(ordTaxable, B, s);
      ltcgTax = ltcgStackTax(ordTaxable, gainsTaxable, C.ltcg[status], s);
      // IRC §1411: interest and gains are net investment income; TSP and IRA distributions are not.
      const nii = ltcg + Math.min(ordinary, Math.max(0, p.interest || 0));
      niit = C.niit.rate * Math.min(nii, Math.max(0, agi - C.niit.threshold[status]));
      federal = ordinaryTax + ltcgTax + niit;
      marginal = ordTaxable > 0 ? marginalRate(ordTaxable, B, s) : 0;
      if (ordTaxable > 0) {
        let i = 0;
        while (i + 1 < B.length && ordTaxable > B[i + 1][0] * s) i++;
        const to = i + 1 < B.length ? B[i + 1][0] * s : null;
        bracket = new Bracket(B[i][0] * s, to, to === null ? null : to - ordTaxable);
      } else bracket = new Bracket(null, null, Math.max(0, deduction - ordInc));
    }
    return {
      taxableSS, agi, magi: agi, deduction, seniorDeduction: senior, ordTaxable, gainsTaxable, taxableIncome: ordTaxable + gainsTaxable,
      ordinaryTax, ltcgTax, niit, federal, total: federal, marginal, bracket,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Random numbers (Monte Carlo)
  // ---------------------------------------------------------------------------------------------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normal(rng) {
    const u1 = 1 - rng(), u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  // Lognormal gross return with arithmetic mean `mean` and standard deviation `sd`, for standard normal shock z.
  function lognormalFromZ(mean, sd, z) {
    if (!(sd > 0)) return mean;
    const g = 1 + mean;
    const s2 = Math.log(1 + (sd * sd) / (g * g));
    return Math.exp(Math.log(g) - s2 / 2 + Math.sqrt(s2) * z) - 1;
  }
  function lognormalReturn(rng, mean, sd) {
    if (!(sd > 0)) return mean;
    return lognormalFromZ(mean, sd, normal(rng));
  }

  // GS within-grade increases. gsStepStartYears gives the first calendar year at each step (index 1–10) for someone at
  // `step` in Y0 whose next step comes `yearsUntilNext` years from now (1 = within a year; capped at that step's waiting
  // period). Earlier steps are back-projected with the same waiting periods (for a High-3 that reaches before today);
  // step 10 is taken to have been reached at least three years ago.
  const gsStep = (v) => Math.min(10, Math.max(1, Math.round(Number(v)) || 1));
  const gsStepPay = (step) => 1 + (step - 1) * CONSTANTS.gs.stepIncrement; // pay at a step, step 1 = 1
  function gsStepStartYears(step, yearsUntilNext, Y0) {
    const W = CONSTANTS.gs.stepWaitYears, s0 = gsStep(step), start = [];
    if (s0 < 10) {
      start[s0 + 1] = Y0 + Math.min(W[s0 + 1], Math.max(1, Math.round(Number(yearsUntilNext)) || 1));
      for (let s = s0 + 2; s <= 10; s++) start[s] = start[s - 1] + W[s];
      start[s0] = start[s0 + 1] - W[s0 + 1];
    } else start[10] = Y0 - 3;
    for (let s = s0 - 1; s >= 1; s--) start[s] = start[s + 1] - W[s + 1];
    return start;
  }

  // One entry per occurrence (with its calendar `year`), so inflation and guardrail deferral apply per occurrence.
  // people: { you: { by, deathYear }, spouse: { by, deathYear } | null } (a number is accepted as your birth year).
  function expandEvents(list, people) {
    const P = typeof people === 'number' ? { you: { by: people, deathYear: Infinity }, spouse: null } : people;
    const out = [];
    for (const ev of list || []) {
      const who = ev.person === 'spouse' ? P.spouse : P.you;
      if (ev.person === 'spouse' && !P.spouse) continue; // no spouse: the spouse's events never happen
      const toYear = (v) => (ev.when === 'age' ? who.by + Math.round(v) : ev.when === 'yearsBeforeDeath' ? who.deathYear - Math.round(v) : Math.round(v));
      const start = toYear(ev.at);
      if (ev.repeat === 'everyNYears') {
        const step = Math.max(1, Math.round(ev.everyNYears || 1));
        const last = ev.through > 0 ? toYear(ev.through) : start + 150;
        for (let y = start; y <= last; y += step) out.push({ ...ev, year: y });
      } else if (ev.repeat === 'eachYearForNYears') {
        for (let k = 0; k < Math.max(1, Math.round(ev.forNYears || 1)); k++) out.push({ ...ev, year: start + k });
      } else out.push({ ...ev, year: start });
    }
    return out;
  }

  // Death age for someone alive at the start of `currentAge`, sampled year by year from the SSA period life table.
  // The model's convention: a person lives through the year of their death age.
  function sampleDeathAge(rng, sex, currentAge) {
    const q = CONSTANTS.mortality[sex === 'female' ? 'female' : 'male'];
    for (let a = Math.max(0, Math.floor(currentAge)); a < q.length; a++) if (rng() < q[a]) return a;
    return q.length - 1;
  }

  // Accounts: money market (`cash`), brokerage (`taxable`, joint), checking, and each spouse's workplace plan and IRAs:
  // yours are `trad`, `roth` (traditional and Roth TSP / 401(k)), `tradIra` and `rothIra`; your spouse's carry an S
  // (`tradS`, ...). The money market is always drawn first and checking last; the order of the five account types is
  // configurable (see orderFor in simulate for the order of the two spouses' accounts of a type).
  const PERSON_KEYS = { you: { trad: 'trad', roth: 'roth', tradIra: 'tradIra', rothIra: 'rothIra' },
    spouse: { trad: 'tradS', roth: 'rothS', tradIra: 'tradIraS', rothIra: 'rothIraS' } };
  const KEY_TYPE = { taxable: 'taxable', trad: 'trad', roth: 'roth', tradIra: 'tradIra', rothIra: 'rothIra', tradS: 'trad', rothS: 'roth', tradIraS: 'tradIra', rothIraS: 'rothIra' };
  const KEY_HOLDER = { trad: 'you', roth: 'you', tradIra: 'you', rothIra: 'you', tradS: 'spouse', rothS: 'spouse', tradIraS: 'spouse', rothIraS: 'spouse' };
  const INVESTED = ['taxable', 'trad', 'roth', 'tradIra', 'rothIra', 'tradS', 'rothS', 'tradIraS', 'rothIraS'];
  const ACCOUNTS = ['cash', ...INVESTED, 'checking'];
  const TRADITIONAL = ['trad', 'tradIra', 'tradS', 'tradIraS'];
  const ROTH_ACCOUNTS = ['roth', 'rothIra', 'rothS', 'rothIraS'];
  const WORKPLACE_TRAD = ['trad', 'tradS'], IRA_TRAD = ['tradIra', 'tradIraS'];
  // Conversion tax is paid from the money market, brokerage, traditional, Roth, then checking.
  const TAX_ORDER = ['cash', 'taxable', 'trad', 'tradS', 'tradIra', 'tradIraS', 'roth', 'rothS', 'rothIra', 'rothIraS', 'checking'];
  const noFlows = () => ({ cash: 0, taxable: 0, trad: 0, roth: 0, tradIra: 0, rothIra: 0, tradS: 0, rothS: 0, tradIraS: 0, rothIraS: 0, checking: 0, unmet: 0 });
  function allocate(need, avail, order) {
    const out = noFlows();
    let rem = Math.max(0, need);
    for (const k of order) {
      if (rem <= 0) break;
      const take = Math.min(rem, Math.max(0, avail[k]));
      out[k] = take;
      rem -= take;
    }
    out.unmet = rem;
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Bridge bucket plan: the deterministic projection's (no bucket) net portfolio draws for the first `yearsCovered`
  // retirement years. Computed once and shared by every Monte Carlo run so all runs fund the same bucket.
  // ---------------------------------------------------------------------------------------------
  function computeBucketPlan(rawInputs) {
    const inp = normalizeInputs(rawInputs);
    const WD = inp.withdrawals;
    if (!WD.bridgeBucket.enabled || !(WD.bridgeBucket.yearsCovered > 0)) return null;
    const base = simulate(inp, { lite: true, noBucket: true });
    const retireYear = base.summary.retireYear;
    const draws = {};
    for (let y = retireYear; y < retireYear + Math.round(WD.bridgeBucket.yearsCovered); y++) {
      const r = base.years.find((x) => x.year === y);
      draws[y] = r ? r.netWithdrawal : 0;
    }
    return { fundYear: retireYear - Math.max(0, Math.round(WD.bridgeBucket.buildYearsBeforeRetirement)), retireYear, endYear: retireYear + Math.round(WD.bridgeBucket.yearsCovered) - 1, draws, g: WD.bridgeBucket.return };
  }
  // Present value at the start of year Y (at the bucket rate) of the planned draws in years ≥ Y.
  function bucketPV(plan, Y) {
    let pv = 0;
    for (const [y, d] of Object.entries(plan.draws)) if (+y >= Y) pv += d / Math.pow(1 + plan.g, +y - Y);
    return pv;
  }

  // ---------------------------------------------------------------------------------------------
  // simulate(inputs, opts?) -> { years, summary, warnings, milestones }
  //   opts.rng      seeded uniform generator → stochastic returns (and inflation if inflationSd > 0)
  //   opts.fxMult   multiplier on the USD cost of foreign-currency spending (currency shock)
  //   opts.lite     skip warnings / milestones (Monte Carlo)
  // ---------------------------------------------------------------------------------------------
  function simulate(rawInputs, opts) {
    opts = opts || {};
    const inp = normalizeInputs(rawInputs);
    const rng = typeof opts.rng === 'function' ? opts.rng : null;
    const fxMult = opts.fxMult || 1;
    const C = CONSTANTS;
    const H = inp.household, BR = inp.brokerage;
    const CK = inp.checkingAndMoneyMarket.checking, MM = inp.checkingAndMoneyMarket.moneyMarket, WD = inp.withdrawals;
    const FP = inp.fersPension, SS = inp.socialSecurity, SP = inp.spending, TX = inp.taxes;
    const MC = inp.monteCarlo;

    const Y0 = Math.round(H.currentYear);
    const infl = inp.inflation.rate;
    const idxBase = Math.pow(1 + infl, Y0 - C.baseYear); // statutory $ from baseYear to current year
    // Federal tax amounts (chained CPI): grow at inflation minus the gap, from baseYear.
    const taxGap = TX.mode === 'advanced' ? TX.bracketGrowthBelowInflation : 0;
    let taxIdx = Math.pow(1 + infl - taxGap, Y0 - C.baseYear);
    const typeOrder = normalizeOrder(WD.order).map((a) => ACCOUNT_KEY[a]);

    // People -------------------------------------------------------------------------------------
    const hasSp = !!H.married;
    const mkPerson = (key, by, lifespan, pia, claimY, claimM) => {
      const claimAge = clamp(claimY + clamp(claimM, 0, 11) / 12, 62, C.ss.maxClaimAge);
      const fra = fraMonthsForBirthYear(by);
      return {
        key, by, deathYear: Math.max(Y0, by + lifespan), pia, claimAge, fra,
        factor: ssClaimFactor(claimAge, fra), claimTime: by + claimAge,
      };
    };
    const you = mkPerson('you', H.you.birthYear, H.you.lifespan, SS.you.piaMonthly, SS.you.claimAge, SS.you.claimExtraMonths);
    const sp = hasSp ? mkPerson('spouse', H.spouse.birthYear, H.spouse.lifespan, SS.spouse.piaMonthly, SS.spouse.claimAge, SS.spouse.claimExtraMonths) : null;
    const people = sp ? [you, sp] : [you];
    const otherOf = (p) => (p === you ? sp : you);
    const planEndYear = you.by + H.planToAge;
    if (opts.deathYears) { // stochastic mortality: this run's sampled death years
      you.deathYear = Math.max(Y0, opts.deathYears.you);
      if (sp && opts.deathYears.spouse != null) sp.deathYear = Math.max(Y0, opts.deathYears.spouse);
    } else if (H.longevityStress) {
      if (!sp || you.deathYear >= sp.deathYear) you.deathYear = Math.max(you.deathYear, planEndYear);
      else sp.deathYear = Math.max(sp.deathYear, planEndYear);
    }
    const lastDeathYear = sp ? Math.max(you.deathYear, sp.deathYear) : you.deathYear;
    const firstDeathYear = sp ? Math.min(you.deathYear, sp.deathYear) : null;
    // Fixed lifespans stop at the plan-to age; stochastic runs continue until the last death.
    const endYear = Math.max(Y0, opts.toLastDeath ? lastDeathYear : Math.min(planEndYear, lastDeathYear));

    // Employment of each person ------------------------------------------------------------------
    // Federal pay follows GS steps and the pay cap; other pay grows with the raise only.
    for (const p of people) {
      const J = inp.employment[p.key];
      p.J = J; p.fed = !!J.federal; p.plan = inp.workplacePlans[p.key]; p.ira = inp.iras[p.key]; p.K = PERSON_KEYS[p.key];
      p.retirementAge = J.retirementAge;
      p.retireYear = p.by + J.retirementAge; // first calendar year without salary
      // Today's salary is at the current step; other years move with the raises and with the step held that year.
      const s0 = gsStep(J.currentStep);
      const stepStart = p.fed && J.addStepIncreases ? gsStepStartYears(s0, J.yearsUntilNextStep, Y0) : null;
      const stepIn = (y) => { let s = 1; if (!stepStart) return s0; for (let k = 2; k <= 10; k++) if (stepStart[k] <= y) s = k; return s; };
      const uncappedIn = p.fed ? (y) => J.salary * Math.pow(1 + J.annualRaise, y - Y0) * gsStepPay(stepIn(y)) / gsStepPay(s0)
        : (y) => J.salary * Math.pow(1 + J.annualRaise, y - Y0);
      // The GS pay cap (Executive Schedule level IV) grows with the raise, as level IV follows the GS across-the-board raise.
      const capIn = (y) => (p.fed && J.gsPayCap > 0 ? J.gsPayCap * Math.pow(1 + J.annualRaise, y - Y0) : Infinity);
      p.salaryIn = (y) => Math.min(uncappedIn(y), capIn(y));
      p.stepStart = stepStart; p.stepIn = stepIn;
      p.payCapFromYear = null; // first working year whose pay is held at the cap
      for (let y = Y0; y < p.retireYear && p.payCapFromYear === null; y++) if (uncappedIn(y) > capIn(y) + 0.005) p.payCapFromYear = y;
    }
    const retireYear = you.retireYear; // spending starts when you retire

    // Annuities ------------------------------------------------------------------------------------
    // Inflation index of year y at the expected inflation (1 up to this year), built the way the year loop builds it.
    const detIdx = (y) => { let x = 1; for (let k = Y0; k < y; k++) x *= 1 + infl; return x; };
    // FERS: the annuity (with the survivor election protecting the other spouse) and the supplement.
    const fersSetup = (p) => {
      const P = FP[p.key], SU = inp.fersSupplement[p.key], other = otherOf(p);
      const service = Math.max(0, P.serviceYears);
      const compService = Math.floor((service + Math.max(0, P.sickLeaveHours) / C.fers.sickLeaveHoursPerYear) * 12 + 1e-9) / 12;
      const mra = mraForBirthYear(p.by);
      const rt = fersRetirementType(p.retirementAge, service, mra, P.specialCategory);
      // Average of the highest N consecutive projected salaries before retirement (N = 3 under current law, 5 if High-5).
      const highN = FP.averageSalaryYears === 5 ? 5 : 3;
      let high3Auto = 0;
      {
        const last = p.retireYear - 1;
        const first = Math.min(Y0, last - (highN - 1));
        for (let y = first; y + highN - 1 <= last; y++) {
          let tot = 0;
          for (let k = 0; k < highN; k++) tot += p.salaryIn(y + k);
          high3Auto = Math.max(high3Auto, tot / highN);
        }
      }
      // A manual High-3 is in today's dollars: in the dollars of the separation year here.
      const high3 = P.high3Mode === 'manual' ? P.manualHigh3 * detIdx(p.retireYear) : high3Auto;
      const pensionStartAge = fersStartAge(rt, p.retirementAge, service, mra, Math.round(P.postponeToAge || 0));
      const pensionStartYear = pensionStartAge === null ? null : p.by + pensionStartAge;
      const ageReduction = pensionStartAge === null ? 0 : fersAgeReduction(rt, pensionStartAge, service);
      const specialFormula = P.specialCategory && rt.rule.startsWith('Special');
      const multiplier = specialFormula ? null : fersMultiplier(p.retirementAge, service);
      const basicAnnuity = rt.type === 'none' ? 0 : fersBasicAnnuity({
        high3, compService, ageAtSeparation: p.retirementAge, service, special: specialFormula,
      });
      const firstPayYear = pensionStartYear === null ? null : Math.max(pensionStartYear, Y0);
      const otherAliveAtPension = other && firstPayYear !== null && firstPayYear <= other.deathYear;
      const election = other && otherAliveAtPension ? (C.fers.survivor[P.survivorElection] ? P.survivorElection : 'none') : 'none';
      const [survRed, survPct] = C.fers.survivor[election];
      // Annuity after any age reduction, before the survivor reduction (the survivor base). Nominal $ at commencement; an
      // OPM estimate is in today's dollars, inflated to the first year paid.
      const initialAnnuity = rt.type === 'none' ? 0 : (P.useOpmEstimate ? P.opmEstimateMonthly * 12 * detIdx(firstPayYear) : basicAnnuity * (1 - ageReduction));
      // The year a today's-dollar input was inflated to at the expected inflation; each run rescales it by its own index.
      const todayYear = rt.type === 'none' ? null : P.useOpmEstimate ? firstPayYear : P.high3Mode === 'manual' ? Math.max(p.retireYear, Y0) : null;
      const suppEligible = SU.mode !== 'off' && rt.supplementEligible && p.retirementAge < 62 && pensionStartAge === p.retirementAge;
      // 0 = 70% of the PIA: claiming at 62 with an FRA of 67 (births 1960+, so everyone who can still get the supplement).
      const ss62Today = SU.ssAt62FromFersMonthly > 0 ? SU.ssAt62FromFersMonthly : 0.70 * SS[p.key].piaMonthly;
      const idxAtRetireDet = Math.pow(1 + infl, p.retireYear - Y0);
      const suppAnnualDet = suppEligible ? (SU.mode === 'manual' ? SU.manualMonthly * 12 * Math.max(1, idxAtRetireDet) : fersSupplementMonthly(ss62Today * idxAtRetireDet, service) * 12) : 0;
      return { fed: true, P, SU, service, compService, mra, rt, highN, high3Auto, high3, pensionStartAge, pensionStartYear, ageReduction, specialFormula,
        multiplier, basicAnnuity, firstPayYear, election, survRed, survPct, initialAnnuity, todayYear, suppEligible, ss62Today, suppAnnualDet,
        annBase: null, suppMonthly: null, colaApplied: 0 }; // annBase: annuity incl. COLAs; suppMonthly: fixed when first paid
    };
    // Any other pension: today's dollars when it starts, then its own COLA; the survivor keeps survivorShare of it.
    const otherPensionSetup = (p) => {
      const O = inp.otherPension[p.key];
      return { fed: false, O, startYear: O.monthly > 0 ? p.by + Math.round(O.startAge) : null, survPct: otherOf(p) ? clamp(O.survivorShare, 0, 1) : 0,
        annBase: null, colaApplied: 0 };
    };
    for (const p of people) p.pen = p.fed ? fersSetup(p) : otherPensionSetup(p);

    // Conversions, transfers & bridge -------------------------------------------------------------
    // Rows covering their owner's age: the first taxable conversion applies, and every transfer applies in list order.
    // Rows use the engine's account keys of their owner (from, to) and keep their type's key in each year's `moves`.
    const moveRows = TX.conversionsAndTransfers.filter(findMove).filter((w) => w.owner !== 'spouse' || sp)
      .map((w) => {
        const o = w.owner === 'spouse' ? sp : you;
        return { ...w, ownerP: o, from: o.K[ACCOUNT_KEY[w.fromAccount]], to: o.K[ACCOUNT_KEY[w.toAccount]], key: findMove(w).key, conversion: isConversion(w) };
      });
    const covers = (w, Y) => Y <= w.ownerP.deathYear && Y - w.ownerP.by >= w.fromAge && Y - w.ownerP.by <= w.throughAge;
    const conversionFor = (Y) => moveRows.find((w) => w.conversion && covers(w, Y)) || null;
    const transfersFor = (Y) => moveRows.filter((w) => !w.conversion && w.howMuch !== 'fillBracket' && covers(w, Y));

    // Bridge bucket: pre-funds the deterministic plan's net portfolio draws for the first `yearsCovered` years of retirement.
    const bucketPlan = opts.noBucket ? null : (opts.bucketPlan !== undefined ? opts.bucketPlan : computeBucketPlan(inp));
    let bucket = null; // start-of-year bucket balance (nominal); null until funded

    const events = expandEvents(SP.oneTimeEvents, { you, spouse: sp });

    // State --------------------------------------------------------------------------------------
    const bal = { cash: Math.max(0, MM.balance), taxable: Math.max(0, BR.balance), checking: Math.max(0, CK.balance) };
    // Roth basis (contributions + conversions) by account, for a tax on only the earnings share of Roth withdrawals,
    // and the Roth IRA basis under the US ordering rules (contributions and conversions come out before earnings), for
    // the before-59½ check. The 5-year rules are assumed met.
    const basis = {}, usBasis = {};
    for (const who of ['you', 'spouse']) {
      const K = PERSON_KEYS[who], on = who === 'you' || hasSp, PL = inp.workplacePlans[who], IA = inp.iras[who];
      bal[K.trad] = on ? Math.max(0, PL.balances.traditional) : 0;
      bal[K.roth] = on ? Math.max(0, PL.balances.roth) : 0;
      bal[K.tradIra] = on ? Math.max(0, IA.traditional.balance) : 0;
      bal[K.rothIra] = on ? Math.max(0, IA.roth.balance) : 0;
      basis[K.roth] = bal[K.roth] * clamp(PL.balances.rothBasisShare, 0, 1);
      basis[K.rothIra] = bal[K.rothIra] * clamp(IA.roth.basisShare, 0, 1);
      usBasis[K.rothIra] = basis[K.rothIra];
    }
    const total = (o) => ACCOUNTS.reduce((t, k) => t + o[k], 0);
    // Who holds each account (the person whose plan or IRA it is), and who owns it this year: the holder, or the
    // survivor after the holder's death (RMDs and the 59½ rule follow the owner).
    const holderOf = (k) => (KEY_HOLDER[k] === 'spouse' ? sp : you);
    const ownerOf = (k) => { const h = holderOf(k) || you; if (h.alive) return h; const o = otherOf(h); return o && o.alive ? o : h; };
    // Expected return and volatility by account, before and after its holder retires (the brokerage account: before and
    // after you retire). A workplace plan's traditional and Roth balances share one allocation, so one return.
    const VOL_KEY = { trad: 'workplacePlans', roth: 'workplacePlans', tradIra: 'traditionalIra', rothIra: 'rothIra' };
    const specFor = (phase) => {
      const out = { taxable: [BR.returns[phase], MC.volatility[phase].brokerage] };
      for (const who of ['you', 'spouse']) {
        const K = PERSON_KEYS[who], PL = inp.workplacePlans[who], IA = inp.iras[who];
        out[K.trad] = [PL.returns[phase], MC.volatility[phase].workplacePlans];
        out[K.roth] = [PL.returns[phase], MC.volatility[phase].workplacePlans];
        out[K.tradIra] = [IA.traditional.returns[phase], MC.volatility[phase][VOL_KEY.tradIra]];
        out[K.rothIra] = [IA.roth.returns[phase], MC.volatility[phase][VOL_KEY.rothIra]];
      }
      return out;
    };
    const specPre = specFor('beforeRetirement'), specPost = specFor('afterRetirement');
    const holderRetireYear = {};
    for (const k of INVESTED) holderRetireYear[k] = k === 'taxable' || KEY_HOLDER[k] === 'you' || !sp ? you.retireYear : sp.retireYear;
    // Accounts whose volatility can draw a market shock (the spouse's only in a married household).
    const LIVE = sp ? INVESTED : INVESTED.filter((k) => KEY_HOLDER[k] !== 'spouse');
    // Taxable-account cost basis (average cost): deposits add to it, withdrawals take it pro rata, growth does not.
    let taxBasis = bal.taxable * (1 - clamp(BR.unrealizedGainShare, 0, 1));

    // State, local and foreign income taxes (otherTaxes) -----------------------------------------
    // Income each tax can count, by type and by whose it is: [yours, your spouse's, joint]. Joint income (brokerage
    // gains, interest, one-time income) is split evenly between the living spouses on separate returns. Income from an
    // account belongs to its owner (the survivor after a death) and an annuity to whoever receives it. Social Security
    // counts at its federally taxable amount, shared pro rata; a Roth withdrawal as its earnings share or in whole.
    const OT = inp.otherTaxes;
    const OT_TYPES = Object.keys(OTHER_TAX_DEFAULT.appliesTo);
    const OT_RETIREMENT = { fersAnnuity: 1, otherPensions: 1, fersSupplement: 1, socialSecurity: 1, traditionalTsp: 1, traditional401k: 1,
      traditionalIra: 1, rothTsp: 1, roth401k: 1, rothIra: 1 }; // what the retirement-income exclusion covers
    const OT_ROTH = { rothTsp: 1, roth401k: 1, rothIra: 1 }; // not in federal AGI
    const otBrackets = OT.map((e) => e.brackets.slice().sort((a, b) => a.from - b.from));
    const otIdx = OT.map(() => 1); // each tax's dollar amounts: today's dollars, grown by inflation minus its gap
    const otActive = (Y) => OT.map((e, k) => k).filter((k) => (!(OT[k].fromYear > 0) || Y >= OT[k].fromYear) && (!(OT[k].throughYear > 0) || Y <= OT[k].throughYear));
    const pIdx = (p) => (p === sp ? 1 : 0);
    const otType = (k) => {
      const t = KEY_TYPE[k], h = holderOf(k), fed = !!(h && h.fed);
      return t === 'trad' ? (fed ? 'traditionalTsp' : 'traditional401k') : t === 'roth' ? (fed ? 'rothTsp' : 'roth401k') : t === 'tradIra' ? 'traditionalIra' : 'rothIra';
    };
    const NO_FLOWS = noFlows();
    const bracketTaxOf = (taxable, brackets, g) => {
      let t = 0;
      for (let i = 0; i < brackets.length; i++) {
        const lo = brackets[i].from * g, hi = i + 1 < brackets.length ? brackets[i + 1].from * g : Infinity;
        if (taxable <= lo) break;
        t += (Math.min(taxable, hi) - lo) * brackets[i].rate;
      }
      return t;
    };
    // q: { active (entry indexes), fixed (income by type that does not depend on withdrawals), w, rmdBy, share, conv, convOwner,
    //      gains, oneTime, ssBy: [yours, spouse's gross SS], alive: [you, spouse], ages, detail }. us: the federal tax.
    const otherTaxCalc = (q, us) => {
      const out = { total: 0, credit: 0, byEntry: q.detail ? OT.map(() => null) : null };
      if (!q.active.length) return out;
      const inc = {}, earn = {};
      for (const t of OT_TYPES) inc[t] = q.fixed[t].slice();
      for (const t in OT_ROTH) earn[t] = [0, 0, 0];
      const w = q.w || NO_FLOWS, rm = q.rmdBy || NO_FLOWS, sh = q.share || {};
      for (const k of TRADITIONAL) { const v = (rm[k] || 0) + (w[k] || 0); if (v) inc[otType(k)][pIdx(ownerOf(k))] += v; }
      for (const k of ROTH_ACCOUNTS) {
        const v = w[k] || 0;
        if (!v) continue;
        const t = otType(k), i = pIdx(ownerOf(k));
        inc[t][i] += v; earn[t][i] += v * (1 - (sh[k] === undefined ? 1 : sh[k]));
      }
      if (q.conv) inc.rothConversions[q.convOwner] += q.conv;
      inc.brokerageGains[2] += q.gains || 0;
      inc.oneTimeIncome[2] += q.oneTime || 0;
      const ssTot = q.ssBy[0] + q.ssBy[1];
      if (ssTot > 0 && us.taxableSS > 0) { const f = us.taxableSS / ssTot; inc.socialSecurity[0] += q.ssBy[0] * f; inc.socialSecurity[1] += q.ssBy[1] * f; }
      let fedUsed = 0; // federal tax already credited: each tax credits only the part of its own share not yet used
      for (const k of q.active) {
        const e = OT[k], A = e.appliesTo, g = otIdx[k];
        const cov = [0, 0, 0], ret = [0, 0];
        let inAgi = 0;
        for (const t of OT_TYPES) {
          if (!A[t]) continue;
          const v = OT_ROTH[t] && e.rothAmountTaxed === 'earnings' ? earn[t] : inc[t];
          cov[0] += v[0]; cov[1] += v[1]; cov[2] += v[2];
          if (OT_RETIREMENT[t]) { ret[0] += v[0]; ret[1] += v[1]; }
          if (!OT_ROTH[t]) inAgi += v[0] + v[1] + v[2];
        }
        const excl = (i) => (e.retirementExclusion > 0 && q.alive[i] && q.ages[i] >= e.exclusionFromAge ? Math.min(ret[i], e.retirementExclusion * g) : 0);
        const taxOn = (income) => {
          const t = Math.max(0, income - Math.max(0, e.deduction) * g);
          return e.rates === 'brackets' ? bracketTaxOf(t, otBrackets[k], g) : t * e.flatRate;
        };
        // One return for the household, or one for each living spouse.
        const gross = e.filing === 'separate' && q.alive[0] && q.alive[1]
          ? taxOn(cov[0] + cov[2] / 2 - excl(0)) + taxOn(cov[1] + cov[2] / 2 - excl(1))
          : taxOn(cov[0] + cov[1] + cov[2] - excl(0) - excl(1));
        let credit = 0;
        if (e.creditsFederalTax && gross > 0 && us.agi > 0) {
          credit = Math.min(gross, Math.max(0, us.federal * Math.min(1, inAgi / us.agi) - fedUsed));
          fedUsed += credit;
        }
        out.total += gross - credit; out.credit += credit;
        if (q.detail) {
          const byType = {};
          for (const t of OT_TYPES) if (A[t]) { const v = OT_ROTH[t] && e.rothAmountTaxed === 'earnings' ? earn[t] : inc[t]; byType[t] = v[0] + v[1] + v[2]; }
          out.byEntry[k] = { tax: gross - credit, gross, credit, income: cov[0] + cov[1] + cov[2], excluded: excl(0) + excl(1), byType };
        }
      }
      return out;
    };
    let idx = 1, hcIdx = 1, prevInfl = infl;
    let inflDev = 0; // AR(1) inflation deviation from the mean
    // Adaptive rules (Monte Carlo only): compare this run's real portfolio with the deterministic plan's.
    const RU = opts.rules ? inp.monteCarlo.adaptiveRules : null;
    let guardActive = false, guardYears = 0, deferrals = 0;
    const magiByYear = {};
    const idxHist = {}; // start-of-year inflation index by year (this run's)
    const years = [];
    let depletionYear = null;

    for (let Y = Y0; Y <= endYear; Y++) {
      const ageY = Y - you.by;
      const ageS = sp ? Y - sp.by : null;
      const youAlive = Y <= you.deathYear;
      const spAlive = !!sp && Y <= sp.deathYear;
      if (!youAlive && !spAlive) break;
      for (const p of people) { p.age = Y - p.by; p.alive = Y <= p.deathYear; p.working = p.alive && Y < p.retireYear; }
      idxHist[Y] = idx;
      const status = youAlive && spAlive ? 'mfj' : 'single';
      const working = you.working; // before you retire, the salaries cover living costs
      const scale = idxBase * idx; // CPI-indexed statutory amounts (402(g), earnings test, IRMAA)
      const taxScale = taxIdx; // federal brackets and deductions

      // Random draws: return first, then inflation, every year (keeps streams reproducible). Every account's return
      // comes from one market shock z per year, with the account's own mean and SD.
      const spec = {};
      for (const k of INVESTED) spec[k] = Y < holderRetireYear[k] ? specPre[k] : specPost[k];
      const z = rng && LIVE.some((k) => spec[k][1] > 0) ? normal(rng) : 0;
      const rAcct = {};
      for (const k of INVESTED) rAcct[k] = rng ? lognormalFromZ(spec[k][0], spec[k][1], z) : spec[k][0];
      const r = rAcct.trad; // the TSP return, reported as the market return
      let yrInfl = infl;
      if (opts.inflationPath) {
        if (opts.inflationPath[Y - Y0] !== undefined) yrInfl = opts.inflationPath[Y - Y0];
      } else if (rng && MC.inflation.volatility > 0) {
        // AR(1): dev_t = φ·dev_{t−1} + σ·√(1−φ²)·z, started from the stationary distribution (φ = 0 is i.i.d. noise).
        const phi = clamp(MC.inflation.persistence || 0, 0, 0.99);
        const z = normal(rng);
        inflDev = Y === Y0 ? MC.inflation.volatility * z : phi * inflDev + MC.inflation.volatility * Math.sqrt(1 - phi * phi) * z;
        yrInfl = Math.max(-0.03, infl + inflDev);
      }

      // Rules use the start-of-year portfolio in today's dollars vs. the plan's (null beyond the plan's horizon).
      const realNow = total(bal) / idx;
      const planReal = RU ? opts.rules.detReal[Y] : undefined;
      const ratio = RU && planReal > 1 ? realNow / planReal : null;
      if (RU && RU.earlySocialSecurity.enabled) {
        const cs = RU.earlySocialSecurity;
        const breach = cs.threshold === 'dollarAmount' ? realNow < cs.dollarAmount : ratio !== null && ratio < cs.shareOfPlan;
        for (const [p, alive] of [[you, youAlive], [sp, spAlive]]) {
          const age = p ? Y - p.by : 0;
          if (!p || !alive || p.claimTime <= Y || !breach || age < Math.max(62, cs.fromAge) || age > cs.throughAge) continue;
          p.claimTime = Y; p.claimAge = age; p.factor = ssClaimFactor(age, p.fra); p.triggered = true;
        }
      }
      if (RU && RU.spendingGuardrails.enabled && !working && ratio !== null) {
        if (!guardActive && ratio < RU.spendingGuardrails.cutBelowShareOfPlan) guardActive = true;
        else if (guardActive && ratio > RU.spendingGuardrails.restoreAboveShareOfPlan) guardActive = false;
      }
      const guardCut = !!(RU && RU.spendingGuardrails.enabled && guardActive && !working);
      if (guardCut) {
        guardYears++;
        for (const ev of events) {
          if (ev.year === Y && ev.deferrable && ev.amount > 0 && (ev.deferred || 0) < RU.spendingGuardrails.deferEventsUpToYears) { ev.year = Y + 1; ev.deferred = (ev.deferred || 0) + 1; deferrals++; }
        }
      }

      // 1) Income streams ------------------------------------------------------------------------
      // Each person's pay, earnings after retiring, workplace-plan contributions (employee and employer) and Roth IRA
      // contributions, all paid from the salary.
      for (const p of people) {
        const PL = p.plan;
        p.salary = p.working ? p.salaryIn(Y) : 0;
        p.post = !p.working && p.alive && Y >= p.retireYear && p.age < p.J.afterRetiring.untilAge ? p.J.afterRetiring.earnings * idx : 0;
        let empTrad = 0, empRoth = 0, agency = 0, catchUp = 0, catchUpRoth = false, capped = false;
        if (p.working && p.salary > 0) {
          const lim = floorTo(C.tsp.elective402g * scale, 500);
          let emp = p.salary * PL.contributions.rate;
          if (emp > lim) { emp = lim; capped = true; }
          const eff = emp / p.salary;
          if (p.fed) { // TSP agency contributions (5 USC 8432)
            let match = 0, used = 0;
            for (const [width, rate] of C.tsp.matchTiers) { match += Math.min(Math.max(eff - used, 0), width) * rate; used += width; }
            agency = p.salary * (C.tsp.agencyAutomatic + match);
          } else {
            const EC = PL.employerContributions;
            agency = p.salary * (Math.max(0, EC.automatic) + Math.max(0, EC.match) * Math.min(eff, Math.max(0, EC.matchUpTo)));
          }
          if (PL.contributions.catchUp && p.age >= 50) {
            const base = p.age >= 60 && p.age <= 63 ? C.tsp.catchUp60to63 : C.tsp.catchUp50;
            catchUp = floorTo(base * scale, 500);
            catchUpRoth = p.salaryIn(Y - 1) > C.tsp.rothCatchUpWageThreshold * scale;
          }
          empTrad = emp * (1 - PL.contributions.rothShare) + (catchUpRoth ? 0 : catchUp);
          empRoth = emp * PL.contributions.rothShare + (catchUpRoth ? catchUp : 0);
        }
        p.empTrad = empTrad; p.empRoth = empRoth; p.agency = agency; p.catchUp = catchUp; p.catchUpRoth = catchUpRoth; p.capped = capped;
        // Capped at the IRA limit; the income limit for Roth IRA contributions is not checked.
        const iraLimit = floorTo(C.ira.limit * scale, 500) + (p.age >= 50 ? floorTo(C.ira.catchUp50 * scale, 100) : 0);
        p.contribRothIra = p.working && p.ira.roth.contributionsWhileWorking > 0 ? Math.min(p.ira.roth.contributionsWhileWorking * idx, iraLimit) : 0;
      }
      const sumP = (f) => people.reduce((t, p) => t + f(p), 0);
      const salary = you.salary, spouseEarned = sp ? sp.salary : 0, postEarned = sumP((p) => p.post);
      const empTrad = sumP((p) => p.empTrad), empRoth = sumP((p) => p.empRoth), agency = sumP((p) => p.agency), catchUp = sumP((p) => p.catchUp);
      const catchUpRoth = people.some((p) => p.catchUpRoth), capped = people.some((p) => p.capped);
      const contribRothIra = sumP((p) => p.contribRothIra);

      // Annuities of each person: FERS (the annuity, the survivor annuity paid to the other spouse, and the supplement:
      // no COLA, earnings test, ends at 62), or another pension with its own COLA and survivor share.
      for (const p of people) {
        const A = p.pen, other = otherOf(p), otherAlive = !!other && other.alive;
        p.pension = 0; p.survivorAnnuity = 0; p.supplement = 0; p.suppReduction = 0; A.colaApplied = 0;
        if (A.fed) {
          if (A.firstPayYear !== null && Y >= A.firstPayYear && (p.alive || (otherAlive && A.survPct > 0))) {
            if (A.annBase === null) {
              // A today's-dollar input follows this run's inflation (a deterministic run's ratio is exactly 1).
              A.annBase = A.todayYear === null ? A.initialAnnuity : A.initialAnnuity * idxHist[A.todayYear] / detIdx(A.todayYear);
            } else {
              const retireeAliveLastYear = Y - 1 <= p.deathYear;
              const colaEligible = !retireeAliveLastYear || A.P.specialCategory || p.age - 1 >= C.fers.colaStartAge;
              if (colaEligible) {
                const diet = dietCola(prevInfl);
                A.colaApplied = FP.colaMode === 'none' ? 0 : FP.colaMode === 'reduced' ? Math.max(0, diet - FP.colaReducedBy) : diet;
                A.annBase *= 1 + A.colaApplied;
              }
            }
            if (p.alive) p.pension = A.annBase * (1 - (otherAlive ? A.survRed : 0));
            else p.survivorAnnuity = A.annBase * A.survPct;
          }
          if (A.suppEligible && p.alive && Y >= p.retireYear && p.age < 62) {
            if (A.suppMonthly === null) {
              const idxRet = p.retireYear >= Y0 ? idx : Math.pow(1 + infl, p.retireYear - Y0);
              // A manual amount is today's dollars: in the dollars of the first year paid (this year), then fixed.
              A.suppMonthly = A.SU.mode === 'manual' ? A.SU.manualMonthly * idx : fersSupplementMonthly(A.ss62Today * idxRet, A.service);
            }
            const annual = A.suppMonthly * 12;
            const testApplies = !A.P.specialCategory || p.age >= A.mra;
            if (testApplies && p.post > 0) {
              p.suppReduction = Math.min(annual, Math.max(0, (p.post - C.ss.earningsTestLimit * scale) / 2));
            }
            p.supplement = annual - p.suppReduction;
          }
        } else if (A.startYear !== null && Y >= A.startYear && (p.alive || (otherAlive && A.survPct > 0))) {
          if (A.annBase === null) A.annBase = A.O.monthly * 12 * idx;
          else { A.colaApplied = A.O.cola; A.annBase *= 1 + A.colaApplied; }
          if (p.alive) p.pension = A.annBase;
          else p.survivorAnnuity = A.annBase * A.survPct;
        }
      }
      const pension = sumP((p) => p.pension), survivorAnnuity = sumP((p) => p.survivorAnnuity);
      const supplement = sumP((p) => p.supplement), suppReduction = sumP((p) => p.suppReduction);
      const colaApplied = (you.pen.fed || !sp || !sp.pen.fed ? you.pen : sp.pen).colaApplied; // a FERS annuity's COLA when there is one

      // Social Security (own, spousal, survivor)
      const frac = (start) => clamp(Y + 1 - start, 0, 1);
      const ssFor = (me, other, meAlive, otherAlive) => {
        if (!meAlive) return { own: 0, spousal: 0, survivor: 0, total: 0 };
        const own = me.pia * idx * me.factor * 12 * frac(me.claimTime);
        let spousal = 0, survivor = 0;
        if (other && otherAlive) {
          const excess = spousalExcess(me.pia, other.pia);
          if (excess > 0) {
            const start = Math.max(me.claimTime, other.claimTime);
            spousal = excess * idx * ssSpousalFactor(start - me.by, me.fra) * 12 * frac(start);
          }
        } else if (other && !otherAlive) {
          const deathAge = other.deathYear - other.by;
          const claimed = other.claimTime < other.deathYear + 1;
          let f;
          if (claimed) f = Math.max(other.factor, C.ss.survivorFloorOfPia);
          else f = deathAge * 12 >= other.fra ? ssClaimFactor(Math.min(deathAge, C.ss.maxClaimAge), other.fra) : 1;
          const start = Math.max(other.deathYear + 1, me.by + me.fra / 12);
          survivor = other.pia * idx * f * 12 * frac(start);
        }
        const total = Math.max(own + spousal, survivor);
        return { own, spousal, survivor: total > own + spousal ? survivor : 0, total };
      };
      // Trust-fund shortfall scenario: only `payablePct` of scheduled benefits are paid from `cutFromYear`.
      const ssPay = Y >= SS.trustFundShortfall.fromYear ? clamp(SS.trustFundShortfall.benefitsPaidShare, 0, 1) : 1;
      const scaleSs = (o) => ({ own: o.own * ssPay, spousal: o.spousal * ssPay, survivor: o.survivor * ssPay, total: o.total * ssPay });
      const ssY = scaleSs(ssFor(you, sp, youAlive, spAlive));
      const ssS = sp ? scaleSs(ssFor(sp, you, spAlive, youAlive)) : { own: 0, spousal: 0, survivor: 0, total: 0 };
      const ssYou = ssY.total, ssSpouse = ssS.total, ssTotal = ssYou + ssSpouse;

      // Interest on the start-of-year money market and checking balances, paid out as income
      const cashInterest = bal.cash * MM.yield;
      const checkingInterest = bal.checking * CK.interestRate;
      const interest = cashInterest + checkingInterest;
      // Share of each Roth workplace balance that is basis, at the start of the year (withdrawals are pro rata).
      const share = {};
      for (const k of ['roth', 'rothS']) share[k] = bal[k] > 0 ? clamp(basis[k] / bal[k], 0, 1) : 1;
      // Share of each taxable-account withdrawal that is long-term gain this year (1 − basis ÷ balance at the start of
      // the year). After a loss the basis can exceed the balance: then nothing is gain and the excess basis stays to
      // shelter later gains (losses are not deducted).
      const gainShare = bal.taxable > 0 ? clamp(1 - taxBasis / bal.taxable, 0, 1) : 0;

      // One-time events
      let oneIn = 0, oneOut = 0, oneOrd = 0, oneLtcg = 0;
      const eventLabels = [];
      for (const ev of events) {
        if (ev.year !== Y || !(ev.amount > 0)) continue;
        if ((ev.person === 'you' && !youAlive) || (ev.person === 'spouse' && !spAlive)) continue; // tied person has died
        const amt = ev.amount * (ev.inTodaysDollars ? idx : 1);
        eventLabels.push(ev.label);
        if (ev.direction === 'inflow') {
          oneIn += amt;
          if (ev.taxed === 'ordinaryIncome') oneOrd += amt;
          else if (ev.taxed === 'longTermGain') oneLtcg += amt;
        } else oneOut += amt;
      }

      // 2) Required minimum distributions, by each account's owner (the survivor after a death) -----------------
      // A workplace plan's RMDs wait while its holder still works there (still-working exception); IRA RMDs do not.
      // Both use the same table.
      const rmdBy = {};
      for (const k of TRADITIONAL) {
        const o = ownerOf(k), age = Y - o.by, h = holderOf(k);
        const wait = WORKPLACE_TRAD.includes(k) && !!h && h.working;
        rmdBy[k] = !wait && age >= rmdStartAge(o.by) && bal[k] > 0 ? Math.min(bal[k], bal[k] / rmdDivisor(age)) : 0;
      }
      const rmdTsp = rmdBy.trad + rmdBy.tradS, rmdIra = rmdBy.tradIra + rmdBy.tradIraS;
      const rmd = rmdTsp + rmdIra;

      // Transfers between accounts of the same tax type (not taxed), at the start of the year after the RMDs. `av` is
      // what each account has left for the conversion and withdrawals.
      const av = { ...bal };
      for (const k of TRADITIONAL) av[k] = bal[k] - rmdBy[k];
      const moved = {};
      for (const m of MOVES) moved[m.key] = 0;
      const xIn = noFlows(), xOut = noFlows();
      const toIraBasis = { rothIra: 0, rothIraS: 0 };
      for (const w of transfersFor(Y)) {
        const amt = Math.max(0, w.howMuch === 'wholeBalance' ? av[w.from] : Math.min(av[w.from], w.fixedAmount * idx));
        if (!(amt > 0)) continue;
        av[w.from] -= amt; av[w.to] += amt; xOut[w.from] += amt; xIn[w.to] += amt; moved[w.key] += amt;
        if (KEY_TYPE[w.from] === 'roth') toIraBasis[w.to] += amt * share[w.from];
      }
      for (const k of ['rothIra', 'rothIraS']) share[k] = av[k] > 0 ? clamp((basis[k] + toIraBasis[k]) / av[k], 0, 1) : 1;

      // Spending (retired years; while working, salary is assumed to cover living costs)
      let baseSpend = 0, fehb = 0, partB = 0, phaseMult = 1, irmaaTier = 0, spendCut = 0, irmaaCost = 0;
      const survivorMode = !!sp && !(youAlive && spAlive);
      const baseSpendNominal = SP.foreignCurrency.enabled
        ? (SP.foreignCurrency.baseMonthly * 12 * idx) / (SP.foreignCurrency.localPerUsd * Math.pow(1 + SP.foreignCurrency.annualDrift, Y - Y0)) * fxMult
        : SP.baseMonthly * 12 * idx;
      if (!working) {
        phaseMult = SP.phases.enabled ? (ageY < SP.phases.goGoUntilAge ? SP.phases.goGoShare : ageY < SP.phases.slowGoUntilAge ? SP.phases.slowGoShare : SP.phases.noGoShare) : 1;
        baseSpend = baseSpendNominal * phaseMult * (survivorMode ? SP.survivorShare : 1);
        if (guardCut) { spendCut = baseSpend * RU.spendingGuardrails.spendingCut; baseSpend -= spendCut; }
        fehb = SP.healthcare.fehbMonthly * 12 * hcIdx * (survivorMode ? SP.healthcare.fehbSelfOnlyShare : 1);
        const look = magiByYear[Y - 2];
        if (look) {
          const th = C.medicare.irmaaThresholds[look.status];
          for (let i = 0; i < th.length; i++) if (look.magi > th[i] * scale) irmaaTier = i + 1;
        }
        const tierRatio = C.medicare.irmaaPartBMonthly[irmaaTier] / C.medicare.irmaaPartBMonthly[0];
        const enrolled = [[youAlive, ageY, SP.healthcare.medicarePartBYou], [spAlive, ageS, SP.healthcare.medicarePartBSpouse]];
        for (const [alive, age, on] of enrolled) {
          if (on && alive && age >= 65) {
            partB += SP.healthcare.partBMonthly * 12 * hcIdx * tierRatio;
            irmaaCost += SP.healthcare.partBMonthly * 12 * hcIdx * (tierRatio - 1); // extra premium above the standard amount
          }
        }
      }
      const otherOut = baseSpend + fehb + partB + oneOut;
      const extraSave = working ? BR.savingsWhileWorking * idx : 0;
      // While you work, the salaries cover living costs; optionally benefits that start early are spent the same way.
      const coverBenefits = working && inp.employment.spendBenefitsThatStartBeforeRetiring;
      const benefits = pension + survivorAnnuity + supplement + ssTotal;
      const coveredIncome = coverBenefits ? benefits : 0;
      // Take-home pay that reaches the household once you retire (a spouse still working): salary less plan and Roth IRA
      // contributions, which go to their accounts.
      const netPay = sumP((p) => p.salary - p.empTrad - p.empRoth - p.contribRothIra);
      const cashIn = (working ? 0 : netPay + postEarned) + benefits - coveredIncome + oneIn + rmd + extraSave + interest;

      // 3–6) Roth conversion, taxes, spending, withdrawals — solved as a fixed point -------------
      const nOver65 = (youAlive && ageY >= 65 ? 1 : 0) + (spAlive && ageS >= 65 ? 1 : 0);
      const taxCtx = {
        status, year: Y, nOver65, scale: taxScale, ss: ssTotal, interest, mode: TX.mode, simpleMfj: TX.simpleRateJoint,
        simpleSingle: TX.simpleRateSingle, seniorDeduction: TX.seniorDeduction,
      };
      const taxOf = (ordinary, ltcg) => computeTaxes({ ...taxCtx, ordinary, ltcg }); // US only
      // Taxable pay: salaries less traditional plan contributions, plus earnings after retiring. While you work it is all
      // in `wages` (taxed with the salaries that pay for living costs).
      const wages = sumP((p) => p.salary - p.empTrad) + (working ? postEarned : 0);
      const ordinaryFixed = wages + (working ? 0 : postEarned) + pension + survivorAnnuity + supplement + rmd + oneOrd + interest;
      // State, local and foreign taxes this year, and the income they can count that does not depend on withdrawals.
      const otNow = otActive(Y);
      const otFixed = {};
      if (otNow.length) {
        for (const t of OT_TYPES) otFixed[t] = [0, 0, 0];
        for (const p of people) {
          const i = pIdx(p), oi = pIdx(otherOf(p) || p);
          otFixed.wages[i] += p.salary - p.empTrad + p.post;
          const ann = p.pen.fed ? otFixed.fersAnnuity : otFixed.otherPensions;
          ann[i] += p.pension; ann[oi] += p.survivorAnnuity; // a survivor annuity is the other spouse's income
          otFixed.fersSupplement[i] += p.supplement;
        }
        otFixed.interest[2] = interest;
      }
      const ssBy = [ssYou, ssSpouse], alive = [youAlive, spAlive], ages = [ageY, ageS];
      const otQuery = (w, conv, noOneTime, detail) => ({ active: otNow, fixed: otFixed, w, rmdBy, share, conv, convOwner: convWin ? pIdx(convWin.ownerP) : 0,
        gains: gainShare * w.taxable, oneTime: noOneTime ? 0 : oneOrd + oneLtcg, ssBy, alive, ages, detail });
      // Federal and other income tax for a candidate set of withdrawals `w` (by account, beyond the RMDs) and conversion.
      // Traditional IRA withdrawals before 59½ add the 10% early-withdrawal penalty (federal, not an income tax that another
      // tax credits).
      const earlyIra = { tradIra: Y - ownerOf('tradIra').by < 60, tradIraS: Y - ownerOf('tradIraS').by < 60 };
      const taxFull = (w, conv, noOneTime) => {
        const ltcg = gainShare * w.taxable + (noOneTime ? 0 : oneLtcg);
        const us = taxOf(ordinaryFixed - (noOneTime ? oneOrd : 0) + w.trad + w.tradS + w.tradIra + w.tradIraS + conv, ltcg);
        const pen = earlyIra.tradIra || earlyIra.tradIraS
          ? C.ira.earlyPenaltyRate * ((earlyIra.tradIra ? w.tradIra : 0) + (earlyIra.tradIraS ? w.tradIraS : 0)) : 0;
        const ot = otherTaxCalc(otQuery(w, conv, noOneTime, false), us);
        return Object.assign(us, { earlyPenalty: pen, federal: us.federal + pen, other: ot.total, otherCredit: ot.credit, total: us.total + pen + ot.total });
      };
      // Tax on the income that pays for living costs while working (wages, plus early benefits if they are spent too).
      let wageTax = 0;
      if (working) {
        const annuity = coverBenefits ? pension + survivorAnnuity + supplement : 0;
        const ss = coverBenefits ? ssTotal : 0;
        const us = computeTaxes({ ...taxCtx, ss, ordinary: wages + annuity, ltcg: 0, interest: 0 });
        wageTax = us.total;
        if (otNow.length) {
          const f = {};
          for (const t of OT_TYPES) f[t] = t === 'wages' || (coverBenefits && (t === 'fersAnnuity' || t === 'otherPensions' || t === 'fersSupplement')) ? otFixed[t] : [0, 0, 0];
          wageTax += otherTaxCalc({ active: otNow, fixed: f, conv: 0, convOwner: 0, gains: 0, oneTime: 0, ssBy: coverBenefits ? ssBy : [0, 0], alive, ages, detail: false }, us).total;
        }
      }
      const convWin = conversionFor(Y);
      const convActive = !!convWin;
      const convFrom = convActive ? convWin.from : 'trad', convTo = convActive ? convWin.to : 'roth';
      const convTop = convActive && convWin.howMuch === 'fillBracket' ? bracketTop(convWin.fillToTopOfBracket, status, taxScale) : 0;

      // This year's account order: the money market, then each type in the chosen order. Within a type, the account of a
      // spouse who can withdraw without a penalty goes first (a workplace plan once its holder has left that job; an IRA
      // from 59½, the year they turn 60 here), then the older owner's.
      const order = ['cash'];
      for (const t of typeOrder) {
        if (t === 'taxable') { order.push(t); continue; }
        const free = (k) => (KEY_TYPE[k] === 'trad' || KEY_TYPE[k] === 'roth' ? !(holderOf(k) && holderOf(k).working) : Y - ownerOf(k).by >= 60);
        const ks = [PERSON_KEYS.you[t], PERSON_KEYS.spouse[t]];
        if (sp && (free(ks[1]) && !free(ks[0]) || (free(ks[1]) === free(ks[0]) && ownerOf(ks[1]).by < ownerOf(ks[0]).by))) ks.reverse();
        order.push(...ks);
      }

      // Withdrawals for spending and taxes. Cash always goes first. Optionally one-time outflows come from Roth first.
      // Then the strategy: fixed order; proportional to balances; or traditional first up to the top of a bracket.
      const fillRoomTop = WD.strategy === 'bracketFill' ? bracketTop(WD.fillToTopOfBracket, status, taxScale) : 0;
      const allocateMain = (need, cAl) => {
        const avail = av;
        const out = noFlows();
        let rem = Math.max(0, need);
        const take = (k, amt) => { const t = Math.max(0, Math.min(rem, amt, avail[k] - out[k])); out[k] += t; rem -= t; return t; };
        // Take up to `amt` from these accounts in withdrawal order.
        const takeFrom = (keys, amt) => { let left = amt; for (const k of order) if (keys.includes(k)) left -= take(k, left); };
        if (WD.oneTimeOutflowsFromRothFirst && oneOut > 0) takeFrom(ROTH_ACCOUNTS, Math.min(rem, oneOut));
        take('cash', rem);
        if (WD.strategy === 'proportional') {
          const left = INVESTED.map((k) => Math.max(0, avail[k] - out[k]));
          const tot = left.reduce((a, b) => a + b, 0);
          if (tot > 0) { const r0 = rem; INVESTED.forEach((k, i) => take(k, r0 * left[i] / tot)); }
        } else if (WD.strategy === 'bracketFill' && fillRoomTop !== Infinity) {
          // Traditional TSP and IRA up to the top of the bracket, given the rest of the year's ordinary income.
          const base = ordinaryFixed + cAl.trad + cAl.tradS + cAl.tradIra + cAl.tradIraS, ltcg = gainShare * (out.taxable + cAl.taxable) + oneLtcg;
          const room = TRADITIONAL.reduce((t, k) => t + Math.max(0, avail[k] - out[k]), 0);
          const f = (c) => taxOf(base + c, ltcg).ordTaxable - fillRoomTop;
          let fill = 0;
          if (room > 0 && f(0) < 0) {
            if (f(room) <= 0) fill = room;
            else { let lo = 0, hi = room; for (let i = 0; i < 50 && hi - lo > 0.25; i++) { const mid = (lo + hi) / 2; if (f(mid) <= 0) lo = mid; else hi = mid; } fill = lo; }
          }
          takeFrom(TRADITIONAL, fill);
        }
        for (const k of order) if (k !== 'cash') take(k, rem);
        take('checking', rem); // checking is kept for everyday spending: used only when everything else is empty
        out.unmet = rem;
        return out;
      };

      // Conversion `c` with the main withdrawals fixed. Its tax (the extra tax it causes) is paid from the surplus first,
      // then cash, taxable, traditional and Roth TSP; that withdrawal can be taxable too, so the conversion tax is a small
      // fixed point. It converges fast: only the difference between the marginal rates with and without `c` feeds back.
      // Solving the conversion together with its own tax payment keeps the outer loop from oscillating.
      // fundGap = conversion tax due − what the accounts can still pay (≤ 0 when the tax can be paid in full).
      const ZERO = noFlows();
      const plus = (a, b) => { const o = noFlows(); for (const k of ACCOUNTS) o[k] = a[k] + b[k]; return o; };
      const withConversion = (c, main, needMain, ct0) => {
        const avail = {};
        for (const k of ACCOUNTS) avail[k] = av[k] - main[k];
        avail[convFrom] -= c;
        const capacity = ACCOUNTS.reduce((t, k) => t + Math.max(0, avail[k]), 0);
        let ct = c > 0 ? ct0 : 0, need = 0, cA = ZERO, t;
        for (let k = 0; k < 60; k++) {
          need = needMain < 0 ? Math.max(0, ct + needMain) : ct;
          cA = allocate(need, avail, TAX_ORDER);
          const w = plus(main, cA);
          t = taxFull(w, c, false);
          if (!(c > 0)) return { c: 0, tx: t, convTax: 0, cAlloc: cA, fundGap: -capacity };
          const nct = t.total - taxFull(w, 0, false).total;
          const done = Math.abs(nct - ct) < 0.005;
          ct = nct;
          if (done) break;
        }
        return { c, tx: t, convTax: ct, cAlloc: cA, fundGap: need - capacity };
      };
      // Largest conversion up to `hi` whose `excess` is ≤ 0: for a fill, the larger of ordinary taxable income (including
      // the withdrawal paying the conversion's tax) over the bracket top and the fund gap; for a fixed amount, the fund gap
      // (a conversion is never larger than its tax can be paid for). Both rise at least $1 per $1 converted, so stepping
      // by the excess crosses zero and brackets the root; regula falsi (Illinois variant) then stops within $0.50 of it.
      // The search starts from `c0` (the previous pass's conversion, or the fixed amount), kept while within tolerance.
      const largestConversion = (main, needMain, hi, c0, ct0, excess) => {
        const at = (c, ct) => withConversion(c, main, needMain, ct);
        const g = at(clamp(c0, 0, hi), ct0), fg = excess(g);
        let a, b;
        if (fg <= 0) {
          if (fg >= -0.5 || g.c >= hi) return g;
          a = g; b = at(Math.min(hi, g.c - fg), g.convTax);
          if (excess(b) <= 0) {
            if (b.c >= hi) return b;
            a = b; b = at(hi, b.convTax);
            if (excess(b) <= 0) return b;
          }
        } else {
          b = g; a = at(Math.max(0, g.c - fg), g.convTax);
          if (excess(a) > 0) {
            if (a.c <= 0) return a;
            b = a; a = at(0, 0);
            if (excess(a) >= 0) return a;
          }
        }
        let fa = excess(a), fb = excess(b), side = 0;
        for (let i = 0; i < 100 && fa < -0.5 && b.c - a.c > 0.25; i++) {
          let c = (a.c * fb - b.c * fa) / (fb - fa);
          if (!(c > a.c && c < b.c)) c = (a.c + b.c) / 2;
          const r = at(c, a.convTax + (b.convTax - a.convTax) * (c - a.c) / (b.c - a.c));
          const fr = excess(r);
          if (fr <= 0) { a = r; fa = fr; if (side < 0) fb /= 2; side = -1; } else { b = r; fb = fr; if (side > 0) fa /= 2; side = 1; }
        }
        return a;
      };
      const fillExcess = (r) => Math.max(r.tx.ordTaxable - convTop, r.fundGap);
      const fundExcess = (r) => r.fundGap;

      let tx = taxFull(ZERO, 0, false);
      let convTax = 0, conv = 0;
      let main = ZERO, cAlloc = ZERO;
      for (let it = 0; it < 80; it++) {
        const needMain = otherOut + (tx.total - wageTax - convTax) - cashIn;
        main = allocateMain(needMain, cAlloc);
        const room = Math.max(0, av[convFrom] - main[convFrom]);
        const fixedAmt = !convActive ? 0 : convWin.howMuch === 'fixedAmount' ? Math.min(room, convWin.fixedAmount * idx) : room;
        const r = !convActive ? withConversion(0, main, needMain, 0)
          : convWin.howMuch === 'fillBracket' ? largestConversion(main, needMain, room, conv, convTax, fillExcess)
          : largestConversion(main, needMain, fixedAmt, fixedAmt, convTax, fundExcess); // fixed amount or whole balance
        const done = Math.abs(r.tx.total - tx.total) < 0.005 && Math.abs(r.c - conv) < 0.005 && Math.abs(r.convTax - convTax) < 0.005;
        tx = r.tx; conv = r.c; convTax = r.convTax; cAlloc = r.cAlloc;
        if (done && it > 0) break;
      }

      const W = plus(main, cAlloc);
      if (conv > 0) moved[convWin.key] += conv;
      const wSum = total(W);
      // Each other tax's amount, credit and income by type, for the year row.
      const otDetail = otNow.length
        ? otherTaxCalc(otQuery(W, conv, false, true), taxOf(ordinaryFixed + W.trad + W.tradS + W.tradIra + W.tradIraS + conv, gainShare * W.taxable + oneLtcg)) : null;
      // Roth basis: withdrawals and transfers take basis pro rata; contributions and conversions add to it.
      // US ordering rules: Roth IRA withdrawals come from contributions and conversions first; earnings withdrawn before
      // 59½ would be taxed and penalized (flagged in a warning, not added).
      let rothBasisOut = 0, rothIraBasisOut = 0, rothIraEarlyEarnings = 0;
      for (const who of ['you', 'spouse']) {
        const K = PERSON_KEYS[who], P = who === 'you' ? you : sp;
        const outR = W[K.roth] * share[K.roth];
        basis[K.roth] = Math.max(0, basis[K.roth] - outR - toIraBasis[K.rothIra]) + (P ? P.empRoth : 0) + (convTo === K.roth ? conv : 0);
        const outI = W[K.rothIra] * share[K.rothIra];
        const inI = toIraBasis[K.rothIra] + (P ? P.contribRothIra : 0) + (convTo === K.rothIra ? conv : 0);
        basis[K.rothIra] = Math.max(0, basis[K.rothIra] - outI) + inI;
        if (Y - ownerOf(K.rothIra).by < 60) rothIraEarlyEarnings += Math.max(0, W[K.rothIra] - (usBasis[K.rothIra] + inI));
        usBasis[K.rothIra] = Math.max(0, usBasis[K.rothIra] + inI - W[K.rothIra]);
        rothBasisOut += outR; rothIraBasisOut += outI;
      }
      const portfolioTax = tx.total - wageTax;
      const cashBalance = cashIn + wSum - otherOut - portfolioTax;
      const deposit = cashBalance > 0 ? cashBalance : 0;
      // Surplus tops checking up to its target first, then the money market up to its cap (if holding surplus), and the
      // rest goes to the brokerage account. Checking above its target moves to the money market, and checking below it
      // is refilled from what is left in the money market. Money market above the cap is invested, except in the
      // settling-in years at the start of retirement, when the money market has no cap.
      const chkTarget = Math.max(0, CK.keepInChecking) * idx;
      const chkLeft = bal.checking - W.checking;
      const toChecking = Math.min(deposit, Math.max(0, chkTarget - chkLeft));
      const chkOut = Math.max(0, chkLeft - chkTarget);
      const cashLeft = bal.cash - W.cash + chkOut;
      const chkIn = Math.min(Math.max(0, chkTarget - chkLeft - toChecking), Math.max(0, cashLeft));
      const settling = Y >= retireYear && Y < retireYear + Math.max(0, Math.round(MM.settlingInYears));
      let toCash = 0, sweep = 0;
      if (MM.keepSurplus) {
        const capNom = settling ? Infinity : Math.max(0, MM.moveToBrokerageAbove) * idx;
        toCash = Math.min(deposit - toChecking, Math.max(0, capNom - (cashLeft - chkIn)));
        sweep = Math.max(0, cashLeft - chkIn - capNom);
      }
      const toTaxable = deposit - toChecking - toCash;
      // Taxable basis: withdrawals take the basis share; surplus deposits and cash swept in are after-tax money (basis).
      const taxGain = W.taxable * gainShare;
      taxBasis = Math.max(0, taxBasis - (W.taxable - taxGain)) + toTaxable + sweep;
      const shortfall = cashBalance < -0.5 ? -cashBalance : 0;
      // Cash-flow check: sources (non-salary income incl. RMD + withdrawals) − uses (spending + taxes paid from this
      // cash flow + saved − unfunded). Salary-funded living costs while working are outside it. Should be ~0.
      const cashCheck = (cashIn + wSum) - (otherOut + portfolioTax + deposit - shortfall);
      // Tax caused by taxable one-time inflows (excluded from the core withdrawal rate).
      const oneTimeTax = oneOrd + oneLtcg > 0.5 ? Math.max(0, tx.total - taxFull(W, conv, true).total) : 0;
      if (shortfall > 1 && depletionYear === null && !working) depletionYear = Y;

      // 7) Account flows (start-of-year convention), then growth --------------------------------
      const startBal = { ...bal };
      const startTotal = total(startBal);
      const flows = {};
      // Each account's year: start + contrib + deposit + convIn − convOut + xferIn − xferOut − withdraw + growth = end.
      for (const k of ACCOUNTS) flows[k] = { start: startBal[k], contrib: 0, deposit: 0, convIn: 0, convOut: 0, xferIn: xIn[k], xferOut: xOut[k], withdraw: W[k], growth: 0, end: 0 };
      flows.cash.deposit = toCash; flows.cash.xferIn += chkOut; flows.cash.xferOut += sweep + chkIn;
      flows.taxable.deposit = toTaxable; flows.taxable.xferIn += sweep;
      for (const p of people) {
        flows[p.K.trad].contrib = p.empTrad + p.agency;
        flows[p.K.roth].contrib = p.empRoth;
        flows[p.K.rothIra].contrib = p.contribRothIra;
      }
      for (const k of TRADITIONAL) flows[k].withdraw += rmdBy[k];
      flows.checking.deposit = toChecking; flows.checking.xferIn += chkIn; flows.checking.xferOut += chkOut;
      flows[convFrom].convOut += conv; flows[convTo].convIn += conv;
      const pre = {};
      for (const k of ACCOUNTS) {
        const f = flows[k];
        let v = bal[k] + f.contrib + f.deposit + f.convIn - f.convOut + f.xferIn - f.xferOut - f.withdraw;
        if (v < 0 && v > -1e-6) v = 0;
        pre[k] = v;
      }
      // Bridge bucket sleeve: overlays the invested accounts and earns bridgeReturn with no volatility. Before
      // retirement it is held at the present value of the planned draws; in the bridge years the year's net draw
      // comes out of it first; it is not refilled, and any remainder rejoins the portfolio after the last bridge year.
      let f = 0, g = 0, bucketStart = 0, bucketDraw = 0, bucketHeld = 0, bucketEnd = 0;
      const investedPre = INVESTED.reduce((t, k) => t + pre[k], 0);
      if (bucketPlan && Y >= bucketPlan.fundYear && Y <= bucketPlan.endYear) {
        g = bucketPlan.g;
        let b;
        if (Y < bucketPlan.retireYear || bucket === null) b = bucketPV(bucketPlan, Y);
        else b = bucket;
        bucketStart = b;
        if (Y >= bucketPlan.retireYear) {
          bucketDraw = Math.min(b, Math.max(0, wSum + rmd - deposit));
          b -= bucketDraw;
        }
        b = Math.max(0, Math.min(b, investedPre)); // can't hold more than the invested portfolio
        bucketHeld = b;
        f = investedPre > 0 ? b / investedPre : 0;
        bucketEnd = Y < bucketPlan.endYear ? b * (1 + g) : 0;
        bucket = Y < bucketPlan.endYear ? bucketEnd : null;
      }
      const growthBy = { cash: 0 }; // interest is paid out as income (see cashInterest, checkingInterest)
      bal.cash = pre.cash;
      bal.checking = pre.checking;
      const rByAcct = {};
      for (const k of INVESTED) {
        rByAcct[k] = f * g + (1 - f) * rAcct[k];
        growthBy[k] = pre[k] * rByAcct[k];
        bal[k] = pre[k] + growthBy[k];
      }
      for (const k of ACCOUNTS) { flows[k].growth = growthBy[k] || 0; flows[k].end = bal[k]; }
      const growth = INVESTED.reduce((t, k) => t + growthBy[k], 0);
      const rEff = investedPre > 0 ? growth / investedPre : f * g + (1 - f) * r;
      const endTotal = total(bal);
      const grossW = wSum + rmd;
      const netW = Math.max(0, grossW - deposit);

      magiByYear[Y] = { magi: tx.magi, status };
      const personRow = (p) => ({
        salary: p.salary, post: p.post, step: p.working && p.stepStart ? p.stepIn(Y) : null,
        contribTrad: p.empTrad, contribRoth: p.empRoth, contribEmployer: p.agency, contribRothIra: p.contribRothIra,
        pension: p.pension, survivorAnnuity: p.survivorAnnuity, supplement: p.supplement, suppReduction: p.suppReduction, colaApplied: p.pen.colaApplied,
        rmd: rmdBy[p.K.trad] + rmdBy[p.K.tradIra], wWorkplace: rmdBy[p.K.trad] + W[p.K.trad] + W[p.K.roth],
        balTrad: bal[p.K.trad], balRoth: bal[p.K.roth], balTradIra: bal[p.K.tradIra], balRothIra: bal[p.K.rothIra],
      });

      // Keep this row under 128 properties: V8 builds larger object literals in slow dictionary mode, which makes
      // Monte Carlo roughly 1.7× slower. Group related new fields into a nested object (like `bracket`, `flows`).
      years.push({
        year: Y, ageYou: youAlive ? ageY : null, ageSpouse: spAlive ? ageS : null, youAlive, spAlive, idxEnd: idx * (1 + yrInfl),
        phase: working ? 'Working' : survivorMode ? 'Survivor' : 'Retired', status, idx, inflation: yrInfl,
        returnRate: rEff, marketReturn: r, returnTsp: rByAcct.trad, returnTaxable: rByAcct.taxable,
        bucketStart, bucketDraw, bucketHeld, bucket: bucketEnd,
        salary, step: working && you.stepStart ? you.stepIn(Y) : null, spouseEarned, postEarned, earned: salary + spouseEarned + postEarned,
        contribEmpTrad: empTrad, contribEmpRoth: empRoth, contribAgency: agency, catchUp, catchUpRoth, capped402g: capped,
        pension, survivorAnnuity, colaApplied, supplement, suppReduction,
        ssYou, ssSpouse, ssPayable: ssPay,
        // The spousal and survivor parts of each person's benefit (in ssYou / ssSpouse).
        ssDetail: { youSpousal: ssY.spousal, spouseSpousal: ssS.spousal, youSurvivor: ssY.survivor, spouseSurvivor: ssS.survivor },
        oneTimeIn: oneIn, oneTimeOut: oneOut, events: eventLabels,
        // Workplace plans (TSP / 401(k)) and IRAs below are both spouses' together; `per` has each person's.
        rmd, wTrad: W.trad + W.tradS, wRoth: W.roth + W.rothS, wTaxable: W.taxable, wCash: W.cash, cashInterest, tradTotal: rmdTsp + W.trad + W.tradS, conversion: conv,
        spendBase: baseSpend, phaseMult, fehb, partB, irmaaTier, irmaaCost, spending: otherOut,
        taxableSS: tx.taxableSS, agi: tx.agi, deduction: tx.deduction, ordTaxable: tx.ordTaxable, gainsTaxable: tx.gainsTaxable,
        taxableIncome: tx.taxableIncome, bracket: tx.bracket,
        federalTax: tx.federal,
        // End-of-year cost basis, and the earnings / gain part of this year's withdrawals.
        basis: { roth: basis.roth + basis.rothS, rothEarnings: W.roth + W.rothS - rothBasisOut, rothIra: basis.rothIra + basis.rothIraS,
          rothIraEarnings: W.rothIra + W.rothIraS - rothIraBasisOut, taxable: taxBasis, taxableGain: taxGain },
        // Traditional and Roth IRA: balances, RMD, withdrawals beyond it, growth, return, early-withdrawal penalty,
        // contributions, and Roth IRA earnings withdrawn before 59½ (US ordering rules).
        ira: {
          trad: { start: startBal.tradIra + startBal.tradIraS, bal: bal.tradIra + bal.tradIraS, rmd: rmdIra, withdraw: W.tradIra + W.tradIraS,
            growth: growthBy.tradIra + growthBy.tradIraS, ret: rByAcct.tradIra, penalty: tx.earlyPenalty },
          roth: { start: startBal.rothIra + startBal.rothIraS, bal: bal.rothIra + bal.rothIraS, withdraw: W.rothIra + W.rothIraS,
            growth: growthBy.rothIra + growthBy.rothIraS, ret: rByAcct.rothIra, contrib: contribRothIra, earlyEarnings: rothIraEarlyEarnings },
        },
        // Each person's pay, contributions, annuities (survivorAnnuity: paid to the other spouse after this person's
        // death), RMDs and end-of-year balances.
        per: { you: personRow(you), spouse: sp ? personRow(sp) : null },
        // Conversions and transfers this year by move (MOVES keys, e.g. tradToRothIra); `conversion` is the taxable total.
        moves: moved,
        ordinaryIncome: ordinaryFixed + W.trad + W.tradS + W.tradIra + W.tradIraS + conv, ltcgIncome: taxGain + oneLtcg, nOver65, taxScale,
        // State, local and foreign tax (after any credit for federal tax), the credit, and each tax's detail (by entry;
        // null when none applies): { tax, gross, credit, income, excluded, byType }.
        otherTax: tx.other, otherCredit: tx.otherCredit, otherByEntry: otDetail ? otDetail.byEntry : null,
        totalTax: tx.total, wageTax, portfolioTax, conversionTax: convTax, marginal: tx.marginal,
        deposit, depositCash: toCash, depositTaxable: toTaxable, sweep, shortfall, cashIn, extraSavings: extraSave, coveredIncome,
        startCash: startBal.cash, startTaxable: startBal.taxable, startTrad: startBal.trad + startBal.tradS, startRoth: startBal.roth + startBal.rothS, startTotal,
        growthTaxable: growthBy.taxable, growthTrad: growthBy.trad + growthBy.tradS, growthRoth: growthBy.roth + growthBy.rothS,
        growth,
        balCash: bal.cash, balTaxable: bal.taxable, balTrad: bal.trad + bal.tradS, balRoth: bal.roth + bal.rothS, total: endTotal,
        // Checking: start/end balance, interest, withdrawals, surplus in, refill from and excess to the money market.
        checking: { start: startBal.checking, bal: bal.checking, interest: checkingInterest, withdraw: W.checking, deposit: toChecking,
          fromMoneyMarket: chkIn, toMoneyMarket: chkOut },
        flows,
        withdrawalRate: !working && startTotal > 0 ? netW / startTotal : null,
        netWithdrawal: netW,
        // Core draw: what the portfolio supplies for recurring spending and taxes, excluding one-time events and the
        // tax caused by Roth conversions and taxable one-time inflows.
        coreWithdrawal: working ? 0 : Math.max(0, (otherOut - oneOut) + (portfolioTax - convTax - oneTimeTax) - (cashIn - oneIn - rmd)),
        coreWithdrawalRate: !working && startTotal > 0
          ? Math.max(0, (otherOut - oneOut) + (portfolioTax - convTax - oneTimeTax) - (cashIn - oneIn - rmd)) / startTotal : null,
        cashCheck, oneTimeTax, guardCut, spendCut,
        // Unfunded amount split pro rata between recurring spending (living + healthcare) and one-time outflows.
        shortfallOneTime: shortfall > 0 && baseSpend + fehb + partB + oneOut > 0 ? shortfall * oneOut / (baseSpend + fehb + partB + oneOut) : 0,
        shortfallBase: shortfall > 0 ? shortfall - (baseSpend + fehb + partB + oneOut > 0 ? shortfall * oneOut / (baseSpend + fehb + partB + oneOut) : 0) : 0,
      });

      prevInfl = yrInfl;
      idx *= 1 + yrInfl;
      taxIdx *= 1 + yrInfl - taxGap;
      for (let k = 0; k < OT.length; k++) otIdx[k] *= 1 + yrInfl - OT[k].thresholdGrowthBelowInflation;
      hcIdx *= 1 + SP.healthcare.inflation + (yrInfl - infl);
    }

    // Summary ------------------------------------------------------------------------------------
    const byYear = (y) => years.find((r) => r.year === y);
    const tspAt = (y) => {
      const r = byYear(y);
      if (r) return r.startTrad + r.startRoth;
      const last = years[years.length - 1];
      return y > last.year ? last.balTrad + last.balRoth : null;
    };
    // GS step increases still to come before a person retires: [{ step, year }] (empty when steps are off).
    const stepsOf = (p) => (p.stepStart ? p.stepStart.map((year, step) => ({ step, year })).filter((x) => x.year > Y0 && x.year < p.retireYear) : []);
    const fersSummary = (p) => {
      const A = p.pen;
      return {
        mra: A.mra, mraYear: p.by + Math.ceil(A.mra - 1e-9), retirementType: A.rt.type, rule: A.rt.rule, supplementEligible: A.suppEligible,
        service: A.service, compService: A.compService, high3: A.high3, high3Auto: A.high3Auto, highN: A.highN, colaMode: FP.colaMode,
        colaReduction: FP.colaReducedBy, multiplier: A.multiplier, specialFormula: A.specialFormula,
        basicAnnuity: A.basicAnnuity, ageReduction: A.ageReduction, pensionStartAge: A.pensionStartAge, pensionStartYear: A.pensionStartYear, election: A.election,
        survivorReduction: A.survRed, survivorPct: A.survPct, initialAnnuity: A.initialAnnuity,
        initialMonthlyToRetiree: A.initialAnnuity * (1 - A.survRed) / 12,
        supplementMonthly: A.suppMonthly !== null ? A.suppMonthly : (A.suppEligible ? A.suppAnnualDet / 12 : 0),
        supplementEndYear: A.suppEligible ? p.by + 62 : null,
        ss62Today: A.ss62Today, supplementYears: fersSupplementYears(A.service),
      };
    };
    const personSummary = (p) => ({
      birthYear: p.by, fraMonths: p.fra, claimAge: p.claimAge, claimYear: Math.floor(p.claimTime), factor: p.factor, pia: p.pia, rmdStartAge: rmdStartAge(p.by),
      federal: p.fed, retirementAge: p.retirementAge, retireYear: p.retireYear, payCapFromYear: p.payCapFromYear, stepIncreases: stepsOf(p),
      fers: p.fed ? fersSummary(p) : null,
      // Other pension: the first year paid and the yearly amount then (nominal; null if none).
      otherPension: p.fed ? null : { startYear: p.pen.startYear, startAge: p.pen.startYear === null ? null : p.pen.startYear - p.by,
        annualAtStart: p.pen.startYear === null ? 0 : p.pen.O.monthly * 12 * Math.pow(1 + infl, Math.max(0, p.pen.startYear - Y0)), cola: p.pen.O.cola, survivorShare: p.pen.survPct },
    });
    const rmdOwner = you.deathYear >= you.by + rmdStartAge(you.by) || !sp ? you : sp;
    const rmdStartYear = rmdOwner.by + rmdStartAge(rmdOwner.by);
    const last = years[years.length - 1];
    const tradOf = (r) => r.balTrad + r.ira.trad.bal;
    const afterTaxOf = (r) => r.balRoth + r.ira.roth.bal + r.balCash + r.checking.bal + r.balTaxable + tradOf(r) * (1 - TX.heirsRate);
    const claimYears = [Math.floor(you.claimTime)];
    if (sp) claimYears.push(Math.floor(sp.claimTime));
    const bridgeEnd = Math.max(...claimYears);
    let bridgeTsp = 0, bridgePortfolio = 0;
    for (const r of years) {
      if (r.year >= retireYear && r.year < bridgeEnd) {
        bridgeTsp += r.tradTotal + r.wRoth;
        bridgePortfolio += r.netWithdrawal;
      }
    }
    const retiredRows = years.filter((r) => r.phase !== 'Working');
    const peak = retiredRows.reduce((m, r) => (r.withdrawalRate !== null && r.withdrawalRate > m.rate ? { rate: r.withdrawalRate, year: r.year } : m), { rate: 0, year: null });
    const peakCore = retiredRows.reduce((m, r) => (r.coreWithdrawalRate !== null && r.coreWithdrawalRate > m.rate ? { rate: r.coreWithdrawalRate, year: r.year } : m), { rate: 0, year: null });
    const sum = (f, rows) => (rows || years).reduce((s, r) => s + f(r), 0);
    const summary = {
      startYear: Y0, endYear: last ? last.year : Y0, retireYear,
      // GS step increases still to come before retirement: [{ step, year }] (empty when steps are off).
      stepIncreases: stepsOf(you),
      payCapFromYear: you.payCapFromYear, // first working year held at the GS pay cap (null if never)
      tspAtRetirement: tspAt(retireYear),
      rmdStartYear, rmdStartAge: rmdStartAge(rmdOwner.by), tspAtRmdStart: tspAt(rmdStartYear),
      endingBalance: last ? last.total : 0,
      endingBalanceReal: last ? last.total / last.idxEnd : 0,
      depletionYear, depletionAge: depletionYear === null ? null : depletionYear - you.by,
      peakWithdrawalRate: peak.rate, peakWithdrawalYear: peak.year,
      peakCoreWithdrawalRate: peakCore.rate, peakCoreWithdrawalYear: peakCore.year,
      maxCashCheck: years.reduce((m, r) => Math.max(m, Math.abs(r.cashCheck)), 0),
      guardYears, deferrals,
      ssTriggered: { you: !!you.triggered, spouse: !!(sp && sp.triggered) },
      lifetimeFederalTax: sum((r) => r.federalTax),
      retirementFederalTax: sum((r) => r.federalTax, retiredRows),
      lifetimeTax: sum((r) => r.totalTax),
      // State, local and foreign tax, in all and by entry, and the credit for federal tax that reduced it.
      lifetimeOtherTax: sum((r) => r.otherTax),
      lifetimeOtherCredit: sum((r) => r.otherCredit),
      lifetimeOtherByEntry: OT.map((e, k) => sum((r) => (r.otherByEntry && r.otherByEntry[k] ? r.otherByEntry[k].tax : 0))),
      lifetimeIrmaa: sum((r) => r.irmaaCost),
      // Left to heirs after tax: Roth TSP and IRA, money market, checking and taxable (stepped-up basis) pass tax-free;
      // traditional TSP and IRA are taxed at the heirs' rate.
      inheritance: last ? {
        roth: last.balRoth + last.ira.roth.bal, cash: last.balCash, checking: last.checking.bal, taxable: last.balTaxable, trad: tradOf(last),
        tradAfterTax: tradOf(last) * (1 - TX.heirsRate), tradTax: tradOf(last) * TX.heirsRate,
        afterTax: afterTaxOf(last), heirRate: TX.heirsRate,
      } : null,
      afterTaxInheritance: last ? afterTaxOf(last) : 0,
      afterTaxInheritanceReal: last ? afterTaxOf(last) / last.idxEnd : 0,
      // Recurring spending (living + FEHB + Part B) in retired years, and one-time outflows over the whole plan.
      lifetimeSpending: sum((r) => r.spending - r.oneTimeOut, retiredRows),
      lifetimeOneTimeOut: sum((r) => r.oneTimeOut),
      maxCash: years.reduce((m, r) => Math.max(m, r.balCash), 0),
      bridgeStartYear: retireYear, bridgeEndYear: bridgeEnd, bridgeTspUsed: bridgeTsp, bridgePortfolioUsed: bridgePortfolio,
      totalShortfall: sum((r) => r.shortfall),
      totalConversions: sum((r) => r.conversion),
      firstDeathYear, lastDeathYear, youDeathYear: you.deathYear, spouseDeathYear: sp ? sp.deathYear : null,
      people: { you: personSummary(you), spouse: sp ? personSummary(sp) : null },
      // Your FERS annuity and supplement (null unless you are a federal employee); people.<person>.fers / .otherPension
      // have each person's.
      fers: you.fed ? fersSummary(you) : null,
      bucket: bucketPlan ? {
        fundYear: Math.max(bucketPlan.fundYear, Y0), retireYear: bucketPlan.retireYear, endYear: bucketPlan.endYear, rate: bucketPlan.g,
        sizeAtFund: bucketPV(bucketPlan, Math.max(bucketPlan.fundYear, Y0)),
        plannedDraws: Object.values(bucketPlan.draws).reduce((a, b) => a + b, 0),
        drawn: years.reduce((t, r) => t + r.bucketDraw, 0),
      } : null,
    };

    const out = { inputs: inp, years, summary };
    if (!opts.lite) {
      out.warnings = buildWarnings(inp, out, { you, sp, people, retireYear });
      out.milestones = buildMilestones(inp, out, { you, sp, people, retireYear });
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Warnings (plain English) and milestones
  // ---------------------------------------------------------------------------------------------
  const usd = (x) => '$' + Math.round(x).toLocaleString('en-US');
  const pctTxt = (x) => (Math.round(x * 1000) / 10).toString() + '%';

  function buildWarnings(inp, res, ctx) {
    const W = [];
    const add = (level, code, text) => W.push({ level, code, text });
    const { you, sp, people, retireYear } = ctx;
    const S = res.summary, years = res.years;
    const SP = inp.spending;
    // Wording for the person a warning is about.
    const N = (p) => (p.key === 'you'
      ? { who: 'you', Who: 'You', your: 'your', Your: 'Your', s: '', have: 'have', are: 'are', plan: p.fed ? 'TSP' : '401(k)' }
      : { who: 'your spouse', Who: 'Your spouse', your: "your spouse's", Your: "Your spouse's", s: 's', have: 'has', are: 'is', plan: p.fed ? 'TSP' : '401(k)' });

    // FERS, for each federal employee.
    for (const p of people.filter((x) => x.fed)) {
      const A = p.pen, F = S.people[p.key].fers, n = N(p), rt = A.rt, P = A.P, J = p.J;
      if (rt.type === 'none') {
        add('danger', 'notVested', `With ${A.service} years of service ${n.who} ${n.are} not vested (5 years required): no FERS annuity, no supplement, no FEHB in retirement.`);
      } else if (rt.type === 'deferred') {
        add('danger', 'deferred', `${n.Who} separate${n.s} at ${p.retirementAge} with ${A.service} years: a deferred retirement (before ${n.your} MRA of ${fmtAgeYM(A.mra)}). The annuity starts at age ${A.pensionStartAge}` +
          `${F.ageReduction > 0 ? ` reduced ${pctTxt(F.ageReduction)}` : ''}; there is no FERS supplement, and ${n.who} cannot carry FEHB into retirement.`);
      } else if (rt.type === 'mra10') {
        const at = `MRA+10 retirement at ${p.retirementAge}${p.key === 'spouse' ? ' for your spouse' : ''}`;
        if (F.ageReduction > 0) {
          add('warn', 'mra10', `${at}: the annuity is permanently reduced ${pctTxt(F.ageReduction)} (5% for each year under 62 when it starts at ${A.pensionStartAge}) and there is no FERS supplement.` +
            ` Postponing the start to ${A.service >= 20 ? 60 : 62} removes the reduction (FEHB is suspended until the annuity starts).`);
        } else {
          add('warn', 'mra10', `${at} with the annuity postponed to ${A.pensionStartAge}: no age reduction, but no FERS supplement, and FEHB is suspended until the annuity begins in ${F.pensionStartYear}.`);
        }
      }
      if (p.payCapFromYear !== null) {
        const capYear = years.find((r) => r.year === p.payCapFromYear);
        const capPay = capYear ? capYear.per[p.key].salary : 0;
        add('info', 'payCap', `${p.payCapFromYear === S.startYear ? `${n.Your} salary is above this year’s` : `From ${p.payCapFromYear} ${n.your} pay reaches the`} GS pay cap ` +
          `(Executive Schedule level IV, ${usd(J.gsPayCap)} in ${S.startYear}, growing with the raise), so it is held there${capYear && p.payCapFromYear > S.startYear ? ` (${usd(capPay)} in ${capYear.year})` : ''}. ` +
          'Step increases add nothing above the cap, and the High-3 uses the capped pay.');
      }
      if (A.SU.mode === 'off' && rt.supplementEligible && !W.some((w) => w.code === 'suppOff')) {
        add('info', 'suppOff', 'FERS supplement turned off ("eliminated by Congress" scenario).');
      }
      const suppRed = years.filter((r) => r.per[p.key].suppReduction > 0);
      if (suppRed.length) {
        const tot = suppRed.reduce((t, r) => t + r.per[p.key].suppReduction, 0);
        add('warn', 'suppEarnings', `Supplement earnings test${p.key === 'spouse' ? ' (your spouse)' : ''}: post-retirement earnings exceed the annual limit (${usd(CONSTANTS.ss.earningsTestLimit)} in 2026, indexed), cutting the supplement by ${usd(tot)} over ${suppRed.length} year(s) ($1 for every $2 over the limit).`);
      }
      if (rt.type !== 'none' && rt.type !== 'deferred' && P.fehbYearsBeforeRetirement < CONSTANTS.fers.fehbYearsRequired) {
        add('danger', 'fehb5', `Only ${P.fehbYearsBeforeRetirement} year(s) of FEHB enrollment before ${n.your} retirement: ${n.who} need${n.s} 5 continuous years immediately before retiring to keep FEHB.`);
      }
      const other = p === you ? sp : you;
      if (other && A.election === 'none' && P.survivorElection === 'none' && rt.type !== 'none') {
        add('danger', 'noSurvivor', p.key === 'you'
          ? 'Survivor election is "none": if you die first your spouse gets no FERS survivor annuity and loses FEHB coverage (FEHB continuation requires a survivor annuity).'
          : 'Your spouse\'s survivor election is "none": if your spouse dies first you get no FERS survivor annuity, and you lose FEHB if it came through your spouse (FEHB continuation requires a survivor annuity).');
      }
    }
    // Part B special enrollment period: someone turns 65 while covered by a federal employee's active FEHB.
    const fedWorker = people.find((x) => x.fed && x.retireYear > S.startYear);
    if (fedWorker) {
      for (const p of people) {
        const y65 = p.by + 65, n = N(p);
        if (y65 < fedWorker.retireYear && y65 <= p.deathYear && y65 >= S.startYear - 1 && y65 <= fedWorker.deathYear) {
          add('warn', 'partBSep', `${n.Who} turn${n.s} 65 in ${y65} while covered by active-employee FEHB. Delaying Part B is fine then, but the Part B Special Enrollment Period ends 8 months after the federal job ends (around ${fedWorker.retireYear}); enrolling later means a permanent 10%-per-year premium penalty.`);
        }
      }
    }
    // Workplace-plan withdrawals before 59½ after separating before 55 (50 for special category): the 10% penalty is
    // not added. Traditional IRA withdrawals before 59½: the penalty is added (no separation-at-55 exception for IRAs).
    // Roth IRA earnings before 59½ are flagged only. Moves out of a workplace plan while still working there need 59½.
    const sepAgeOk = (p) => p.retirementAge >= (p.fed && p.pen.P.specialCategory ? 50 : 55);
    for (const p of people) {
      const n = N(p);
      const early = years.filter((r) => r.year >= p.retireYear && r.year - p.by < 59.5 && r.year <= p.deathYear && r.per[p.key].wWorkplace > 1);
      if (early.length && !sepAgeOk(p)) {
        add('warn', 'earlyPenalty', `${n.Your} ${n.plan} withdrawals before 59½ (first in ${early[0].year}) after separating before age ${p.fed && p.pen.P.specialCategory ? 50 : 55} usually incur a 10% early-withdrawal penalty, which this model does not add.`);
      }
    }
    const pen = years.filter((r) => r.ira.trad.penalty > 0.5);
    if (pen.length) {
      add('warn', 'iraPenalty', `Traditional IRA withdrawals before 59½ (${pen[0].year}${pen.length > 1 ? `–${pen[pen.length - 1].year}` : ''}) include ${usd(pen.reduce((t, r) => t + r.ira.trad.penalty, 0))} of 10% early-withdrawal penalty. ` +
        (sepAgeOk(you) ? `Money left in your ${N(you).plan} can be withdrawn without it, because you separate at 55 or later; IRAs have no such exception.` : 'Consider spending other accounts first until 59½.'));
    }
    const rothEarly = years.filter((r) => r.ira.roth.earlyEarnings > 0.5);
    if (rothEarly.length) {
      add('warn', 'rothIraEarly', `Roth IRA withdrawals before 59½ (first in ${rothEarly[0].year}) exceed the contributions and conversions by ${usd(rothEarly.reduce((t, r) => t + r.ira.roth.earlyEarnings, 0))}. ` +
        'Those earnings are taxable and get the 10% penalty, which the model does not add.');
    }
    for (const w of inp.taxes.conversionsAndTransfers) {
      const p = w.owner === 'spouse' ? sp : you, mv = findMove(w);
      if (!p || !mv || w.fromAccount === 'traditionalIra' || w.toAccount === 'rothWorkplace') continue;
      const hit = years.find((r) => r.year < p.retireYear && r.year - p.by < 60 && r.year - p.by >= w.fromAge && r.year - p.by <= w.throughAge && r.moves[mv.key] > 0.5);
      if (hit && !W.some((x) => x.code === 'tspRollWorking')) {
        const n = N(p);
        add('warn', 'tspRollWorking', `Money moves from ${n.your} ${n.plan} to an IRA in ${hit.year}, while ${n.who} still work${n.s} and ${n.are} under 59½. The plan allows that only after separating (or from 59½); an in-plan conversion to Roth is allowed any time.`);
      }
    }
    // RMD pushes into a higher bracket or IRMAA tier
    const rmdRows = years.filter((r) => r.rmd > 0);
    if (rmdRows.length) {
      const before = years.filter((r) => r.year < rmdRows[0].year && r.phase !== 'Working').slice(-3);
      // An RMD "pushes" income into a higher bracket only if, without the part of it that is not needed for spending
      // (and is reinvested), taxable income would sit in a lower bracket. Filing-status changes are not attributed to RMDs.
      const TXi = inp.taxes;
      const withoutExcess = (r) => computeTaxes({ ordinary: r.ordinaryIncome - Math.min(r.deposit, r.rmd), ltcg: r.ltcgIncome, ss: r.ssYou + r.ssSpouse,
        status: r.status, year: r.year, scale: r.taxScale, nOver65: r.nOver65, mode: TXi.mode, simpleMfj: TXi.simpleRateJoint, simpleSingle: TXi.simpleRateSingle,
        seniorDeduction: TXi.seniorDeduction }).marginal;
      const hit = rmdRows.find((r) => r.deposit > 1 && r.marginal > withoutExcess(r) + 1e-9);
      if (hit) {
        add('warn', 'rmdBracket', `The ${hit.year} RMD of ${usd(hit.rmd)} pushes taxable income from the ${pctTxt(withoutExcess(hit))} into the ${pctTxt(hit.marginal)} bracket: ` +
          `${usd(Math.min(hit.deposit, hit.rmd))} of it is not needed for spending and is taxed and reinvested. Roth conversions before RMD age can smooth this.`);
      }
      const irmaaHit = rmdRows.find((r) => r.irmaaTier > 0 && r.partB > 0);
      const preIrmaa = before.some((r) => r.irmaaTier > 0 && r.partB > 0);
      if (irmaaHit && !preIrmaa) {
        const cost = years.filter((r) => r.year >= irmaaHit.year).reduce((t, r) => t + r.irmaaCost, 0);
        const yrs = years.filter((r) => r.irmaaCost > 0.5 && r.year >= irmaaHit.year).length;
        add('warn', 'rmdIrmaa', `RMD-era income triggers Medicare IRMAA surcharges from ${irmaaHit.year} (tier ${irmaaHit.irmaaTier}; based on MAGI two years earlier): ` +
          `${usd(irmaaHit.irmaaCost)} extra Part B premium that year and ${usd(cost)} over ${yrs} year(s) (future dollars).`);
      }
    }
    const irmaaAny = years.find((r) => r.irmaaTier > 0 && r.partB > 0);
    if (irmaaAny && !W.some((w) => w.code === 'rmdIrmaa')) {
      const yrs = years.filter((r) => r.irmaaCost > 0.5).length;
      add('warn', 'irmaa', `Income crosses a Medicare IRMAA tier: Part B surcharges start in ${irmaaAny.year} (tier ${irmaaAny.irmaaTier}, ${usd(irmaaAny.irmaaCost)} extra that year) ` +
        `and total ${usd(S.lifetimeIrmaa)} over ${yrs} year(s) (future dollars).`);
    }
    if (S.depletionYear !== null) {
      add('danger', 'depleted', `Portfolio is depleted in ${S.depletionYear} (your age ${S.depletionAge}). Unfunded spending through the plan end totals ${usd(S.totalShortfall)} (future dollars).`);
    }
    // Widow(er) tax bracket jump
    if (sp && S.firstDeathYear !== null && S.firstDeathYear < S.endYear) {
      const lastJoint = years.find((r) => r.year === S.firstDeathYear);
      const firstSingle = years.find((r) => r.year === S.firstDeathYear + 1);
      if (lastJoint && firstSingle && firstSingle.marginal > lastJoint.marginal + 1e-9) {
        const incChange = lastJoint.agi > 0 ? 1 - firstSingle.agi / lastJoint.agi : 0;
        add('warn', 'widow', `Widow(er) tax jump: after the first death (${S.firstDeathYear}) the survivor files single. The marginal bracket rises from ${pctTxt(lastJoint.marginal)} to ${pctTxt(firstSingle.marginal)} even though AGI falls ${pctTxt(Math.max(0, incChange))}.`);
      }
    }
    // Benefits arriving before you retire are saved, because salary is assumed to cover living costs.
    const ww = years.filter((r) => r.phase === 'Working' && r.ssYou + r.ssSpouse + r.pension + r.survivorAnnuity + r.supplement > 0.5);
    if (ww.length) {
      const what = [];
      if (ww.some((r) => r.ssSpouse > 0.5)) what.push('your spouse’s Social Security');
      if (ww.some((r) => r.ssYou > 0.5)) what.push('your Social Security');
      if (ww.some((r) => r.pension + r.survivorAnnuity + r.supplement > 0.5)) what.push('annuity income');
      const lead = `${what.join(' and ').replace(/^./, (c) => c.toUpperCase())} starts in ${ww[0].year}, while you are still working (through ${retireYear - 1}).`;
      if (inp.employment.spendBenefitsThatStartBeforeRetiring) {
        add('info', 'incomeWhileWorking', `${lead} It is assumed to be spent on living costs along with the salaries, so it is not saved ` +
          `(${usd(ww.reduce((t, r) => t + r.coveredIncome, 0))} over ${ww.length} year(s); turn off “Spend benefits that start before you retire” to save it instead).`);
      } else {
        const saved = ww.reduce((t, r) => t + r.deposit, 0);
        add('info', 'incomeWhileWorking', `${lead} The salaries are assumed to cover living costs before you retire, so this income is saved rather than spent: ${usd(saved)} over ${ww.length} year(s), ` +
          `${inp.checkingAndMoneyMarket.moneyMarket.keepSurplus ? 'kept in the money market up to the limit and invested in brokerage investments above it' : 'invested in brokerage investments'}.`);
      }
    }

    // State, local and foreign income taxes
    const OT = inp.otherTaxes;
    if (!OT.length) {
      add('info', 'noOtherTax', 'No state, local or foreign income tax is included. Add one under “State, local & foreign tax” if any applies to you.');
    }
    const span = (k) => { const ys = years.filter((r) => r.otherByEntry && r.otherByEntry[k]); return ys.length ? [ys[0].year, ys[ys.length - 1].year] : null; };
    OT.forEach((e, k) => {
      const yrs = span(k), name = e.name || `Tax ${k + 1}`;
      if (!yrs) return;
      const credit = years.reduce((t, r) => t + (r.otherByEntry && r.otherByEntry[k] ? r.otherByEntry[k].credit : 0), 0);
      add('info', 'otherTax', `${name}: ${usd(S.lifetimeOtherByEntry[k])} in future dollars over ${yrs[0]}–${yrs[1]}` +
        (e.creditsFederalTax ? `, after ${usd(credit)} of credit for federal tax on the same income.` : '.'));
      const roth = years.reduce((t, r) => { const d = r.otherByEntry && r.otherByEntry[k]; return t + (d ? (d.byType.rothTsp || 0) + (d.byType.roth401k || 0) + (d.byType.rothIra || 0) : 0); }, 0);
      if (roth > 0.5) {
        add('warn', 'otherRoth', `${name} counts ${usd(roth)} of Roth withdrawals${e.rothAmountTaxed === 'earnings' ? ' (their earnings, after contributions and conversions)' : ''} as income. ` +
          'There is no federal tax on qualified Roth money to credit, so that money is not tax-free there.');
      }
    });
    const crediting = OT.map((e, k) => k).filter((k) => OT[k].creditsFederalTax);
    if (crediting.length > 1 && years.some((r) => r.otherByEntry && crediting.filter((k) => r.otherByEntry[k]).length > 1)) {
      add('info', 'otherCreditOverlap', `${crediting.map((k) => OT[k].name || `Tax ${k + 1}`).join(' and ')} both credit federal tax in some years; federal tax is credited only once, to the first in the list.`);
    }
    const badCheck = years.filter((r) => Math.abs(r.cashCheck) > 5);
    if (badCheck.length) {
      add('danger', 'cashCheck', `Cash-flow check fails in ${badCheck.length} year(s) (first ${badCheck[0].year}: off by ${usd(badCheck[0].cashCheck)}). This is a model bug; please report it with this scenario.`);
    }
    for (const p of people) {
      if (p.deathYear < p.retireYear && p.J.salary > 0) {
        add('info', 'deathBeforeRetire', `${N(p).Your} assumed lifespan ends before retirement; death-in-service benefits are not modeled.`);
      }
    }
    if (years.some((r) => r.capped402g)) {
      add('info', 'cap402g', `Employee plan contributions are capped at the 402(g) limit (${usd(CONSTANTS.tsp.elective402g)} in 2026, indexed) in some years.`);
    }
    if (years.some((r) => r.catchUpRoth)) {
      add('info', 'rothCatchUp', 'Catch-up contributions must go to Roth because prior-year wages exceed the SECURE 2.0 threshold ($150,000 in 2026, indexed).');
    }
    return W;
  }

  function fmtAgeYM(years) {
    const m = Math.round(years * 12);
    const y = Math.floor(m / 12), mm = m % 12;
    return mm ? `${y}y ${mm}m` : `${y}`;
  }

  function buildMilestones(inp, res, ctx) {
    const { you, sp, people, retireYear } = ctx;
    const S = res.summary;
    const M = [];
    const add = (year, key, label, detail, who) => { if (year >= S.startYear && year <= S.endYear) M.push({ year, key, label, detail, who: who || 'you' }); };
    for (const p of people) {
      const A = p.pen, isYou = p === you, who = isYou ? 'you' : 'spouse', Who = isYou ? 'You' : 'Your spouse';
      const sfx = isYou ? '' : 'Spouse';
      if (isYou) add(retireYear, 'retire', 'Retire', `You retire at ${p.retirementAge}${A.fed ? ` (${A.rt.rule})` : ''}.`);
      else if (p.J.salary > 0 && p.retireYear <= p.deathYear) add(p.retireYear, 'retireSpouse', 'Spouse retires', `Your spouse retires at ${p.retirementAge}${A.fed ? ` (${A.rt.rule})` : ''}.`, who);
      if (A.fed) {
        if (A.pensionStartYear !== null && A.pensionStartYear !== p.retireYear) add(A.pensionStartYear, 'pension' + sfx, 'Annuity starts', `${isYou ? 'Your' : "Your spouse's"} FERS annuity begins at ${A.pensionStartAge}.`, who);
        add(p.by + Math.ceil(A.mra - 1e-9), 'mra' + sfx, isYou ? 'MRA' : 'Spouse MRA', `${isYou ? 'Your' : "Your spouse's"} FERS minimum retirement age is ${fmtAgeYM(A.mra)}.`, who);
        if (A.suppEligible) add(p.by + 62, 'suppEnd' + sfx, 'Supplement ends', `${isYou ? 'The' : "Your spouse's"} FERS supplement stops at 62.`, who);
      } else if (A.startYear !== null) {
        add(A.startYear, 'pension' + sfx, 'Pension starts', `${Who === 'You' ? 'Your' : "Your spouse's"} pension begins at ${A.startYear - p.by}.`, who);
      }
    }
    add(Math.floor(you.claimTime), 'ssYou', 'Your SS', `You claim Social Security at ${fmtAgeYM(you.claimAge)} (${pctTxt(you.factor)} of PIA).`);
    if (sp) add(Math.floor(sp.claimTime), 'ssSpouse', 'Spouse SS', `Spouse claims Social Security at ${fmtAgeYM(sp.claimAge)} (${pctTxt(sp.factor)} of PIA).`, 'spouse');
    if (you.by + 65 <= you.deathYear) add(you.by + 65, 'medYou', 'Medicare (you)', 'You turn 65: Medicare eligibility.');
    if (sp && sp.by + 65 <= sp.deathYear) add(sp.by + 65, 'medSpouse', 'Medicare (spouse)', 'Spouse turns 65: Medicare eligibility.', 'spouse');
    add(S.rmdStartYear, 'rmd', 'RMDs begin', `Required minimum distributions start at age ${S.rmdStartAge}.`);
    // The spouse's own RMDs, when they start on a different schedule and there is traditional money to take them from.
    const spPlan = inp.workplacePlans.spouse;
    const spTrad = sp && (spPlan.balances.traditional > 0 || inp.iras.spouse.traditional.balance > 0 || (sp.J.salary > 0 && spPlan.contributions.rate > 0));
    if (spTrad) {
      const y = sp.by + rmdStartAge(sp.by);
      if (y !== S.rmdStartYear && y <= sp.deathYear) add(y, 'rmdSpouse', 'Spouse RMDs', `Your spouse's required minimum distributions start at age ${rmdStartAge(sp.by)}.`, 'spouse');
    }
    for (const w of inp.taxes.conversionsAndTransfers) {
      const o = w.owner === 'spouse' ? sp : you;
      if (!o) continue;
      const a = o.by + w.fromAge, b = o.by + w.throughAge, mv = findMove(w);
      if (mv && b >= S.startYear && a <= S.endYear) {
        const conv = isConversion(w);
        const how = w.howMuch === 'fillBracket' && conv ? `fill the ${pctTxt(w.fillToTopOfBracket)} bracket` : w.howMuch === 'wholeBalance' ? 'the whole balance' : `${usd(w.fixedAmount)}/yr (today's $)`;
        M.push({ year: Math.max(a, S.startYear), endYear: Math.min(b, S.endYear), key: 'roth', label: conv ? 'Roth conversions' : 'Transfer',
          detail: `${o === sp ? "Your spouse's " : ''}${mv.label} at ages ${w.fromAge}–${w.throughAge}: ${how}.`, who: o === sp ? 'spouse' : 'you', range: true });
      }
    }
    for (const e of inp.otherTaxes) {
      if (e.fromYear > S.startYear) add(e.fromYear, 'otherTax', `${e.name || 'Tax'} starts`, `${e.name || 'This tax'} applies from ${e.fromYear}${e.throughYear > 0 ? ` through ${e.throughYear}` : ''}.`);
    }
    add(you.deathYear, 'deathYou', 'Your death', `Assumed lifespan: you live through age ${you.deathYear - you.by}.`);
    if (sp) add(sp.deathYear, 'deathSpouse', 'Spouse death', `Assumed lifespan: spouse lives through age ${sp.deathYear - sp.by}.`, 'spouse');
    if (S.depletionYear !== null) add(S.depletionYear, 'depleted', 'Depleted', 'The portfolio runs out this year.');
    return M.sort((a, b) => a.year - b.year);
  }

  // ---------------------------------------------------------------------------------------------
  // Monte Carlo
  // ---------------------------------------------------------------------------------------------
  function percentileSorted(sorted, p) {
    if (!sorted.length) return 0;
    const i = (sorted.length - 1) * p;
    const lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }

  // Each run gets its own random streams (returns/inflation and lifespans), so run i sees the same market path in
  // fixed and stochastic mortality modes and results are reproducible per run.
  const runSeed = (seed, i, salt) => (Math.imul((seed >>> 0) ^ salt, 0x9E3779B1) + Math.imul(i + 1, 0x85EBCA77)) >>> 0;

  function monteCarlo(rawInputs, opts) {
    opts = opts || {};
    const inp = normalizeInputs(rawInputs);
    const H = inp.household;
    const runs = Math.max(1, Math.round(opts.runs || inp.monteCarlo.runs));
    const seed = Math.round(opts.seed != null ? opts.seed : inp.monteCarlo.seed);
    const mode = (opts.mortality || H.monteCarloLifespans) === 'stochastic' ? 'stochastic' : 'fixed';
    const bucketPlan = computeBucketPlan(inp);
    const det = simulate(inp, { lite: true, bucketPlan });
    const detReal = {};
    for (const r of det.years) detReal[r.year] = r.startTotal / r.idx;
    const rules = inp.monteCarlo.adaptiveRules.earlySocialSecurity.enabled || inp.monteCarlo.adaptiveRules.spendingGuardrails.enabled ? { detReal } : null;
    const Y0 = H.currentYear;

    const perYear = new Map(); // year -> { nominal: [], real: [] } (only runs where someone is alive that year)
    const end = { nominal: [], real: [], afterTax: [], afterTaxReal: [] };
    const sf = { years: [], totalReal: [], worstReal: [], base: 0, oneTime: 0 };
    const rule = { guardRuns: 0, guardYears: [], deferRuns: 0, deferrals: 0, trigYou: [], trigSpouse: [] };
    const deaths = { you: [], spouse: [], lastYear: [] };
    let successes = 0;
    const depletionAges = [];
    for (let i = 0; i < runs; i++) {
      const rng = mulberry32(runSeed(seed, i, 0x5EED));
      let deathYears = null;
      if (mode === 'stochastic') {
        const mrng = mulberry32(runSeed(seed, i, 0xDEAD));
        deathYears = { you: H.you.birthYear + sampleDeathAge(mrng, H.you.sex, Y0 - H.you.birthYear) };
        if (H.married) deathYears.spouse = H.spouse.birthYear + sampleDeathAge(mrng, H.spouse.sex, Y0 - H.spouse.birthYear);
        deaths.you.push(deathYears.you - H.you.birthYear);
        if (H.married) deaths.spouse.push(deathYears.spouse - H.spouse.birthYear);
      }
      const res = simulate(inp, { rng, lite: true, bucketPlan, rules, deathYears, toLastDeath: mode === 'stochastic' });
      const S = res.summary;
      if (S.depletionYear === null) successes++;
      else depletionAges.push(S.depletionAge);
      let uy = 0, tot = 0, worst = 0;
      for (const r of res.years) {
        let slot = perYear.get(r.year);
        if (!slot) { slot = { nominal: [], real: [] }; perYear.set(r.year, slot); }
        slot.nominal.push(r.total);
        slot.real.push(r.total / r.idxEnd);
        if (r.shortfall > 1) {
          uy++;
          const v = r.shortfall / r.idx;
          tot += v; worst = Math.max(worst, v);
          sf.base += r.shortfallBase / r.idx; sf.oneTime += r.shortfallOneTime / r.idx;
        }
      }
      sf.years.push(uy); sf.totalReal.push(tot); sf.worstReal.push(worst);
      end.nominal.push(S.endingBalance); end.real.push(S.endingBalanceReal);
      end.afterTax.push(S.afterTaxInheritance); end.afterTaxReal.push(S.afterTaxInheritanceReal);
      deaths.lastYear.push(S.endYear);
      if (S.guardYears > 0) { rule.guardRuns++; rule.guardYears.push(S.guardYears); }
      if (S.deferrals > 0) { rule.deferRuns++; rule.deferrals += S.deferrals; }
      if (S.ssTriggered.you) rule.trigYou.push(S.people.you.claimAge);
      if (S.ssTriggered.spouse) rule.trigSpouse.push(S.people.spouse.claimAge);
      if (opts.onProgress && (i + 1) % 50 === 0) opts.onProgress(i + 1, runs);
    }

    const sorted = (a) => Array.from(a).sort((x, z) => x - z);
    const pct = (a, p) => percentileSorted(sorted(a), p);
    // Percentile paths. In stochastic mode a year's percentiles cover the runs where someone is still alive; the path
    // stops once fewer than 5% of runs remain.
    const yearsAll = Array.from(perYear.keys()).sort((a, b) => a - b);
    const shown = yearsAll.filter((y) => mode === 'fixed' || perYear.get(y).nominal.length >= Math.max(1, runs * 0.05));
    const ps = [0.10, 0.25, 0.50, 0.75, 0.90];
    const bands = {};
    for (const p of ps) bands[p] = { nominal: [], real: [] };
    const alive = [];
    for (const y of shown) {
      const slot = perYear.get(y);
      const a = sorted(slot.nominal), b = sorted(slot.real);
      for (const p of ps) { bands[p].nominal.push(percentileSorted(a, p)); bands[p].real.push(percentileSorted(b, p)); }
      alive.push(slot.nominal.length / runs);
    }
    const failing = sf.years.map((n, i) => i).filter((i) => sf.years[i] > 0);
    const hist = [[0, 0, '0 years'], [1, 2, '1–2 years'], [3, 5, '3–5 years'], [6, 10, '6–10 years'], [11, Infinity, '11+ years']]
      .map(([lo, hi, label]) => ({ label, runs: sf.years.filter((n) => n >= lo && n <= hi).length }));
    const pick = (arr, idxs) => idxs.map((i) => arr[i]);
    const dist = (a) => (a.length ? { p10: pct(a, 0.1), p50: pct(a, 0.5), p90: pct(a, 0.9) } : null);
    // The middle run by after-tax inheritance in today's $ (the middle two, averaged, for an even number of runs), with
    // the same runs' nominal amount: the two medians taken separately can come from different runs.
    const byReal = end.afterTaxReal.map((v, i) => i).sort((a, b) => end.afterTaxReal[a] - end.afterTaxReal[b]);
    const mid = (runs - 1) / 2, mLo = byReal[Math.floor(mid)], mHi = byReal[Math.ceil(mid)], mW = mid - Math.floor(mid);
    const between = (a) => a[mLo] + (a[mHi] - a[mLo]) * mW;
    return {
      mode, runs, seed, successRate: successes / runs, failures: runs - successes,
      years: shown, ages: shown.map((y) => y - H.you.birthYear), alive,
      p10: bands[0.10], p25: bands[0.25], p50: bands[0.50], p75: bands[0.75], p90: bands[0.90],
      endingBalance: { p10: pct(end.nominal, 0.1), p50: pct(end.nominal, 0.5), p90: pct(end.nominal, 0.9) },
      endingBalanceReal: { p10: pct(end.real, 0.1), p50: pct(end.real, 0.5), p90: pct(end.real, 0.9) },
      afterTax: { p10: pct(end.afterTax, 0.1), p50: pct(end.afterTax, 0.5), p90: pct(end.afterTax, 0.9) },
      afterTaxReal: { p10: pct(end.afterTaxReal, 0.1), p50: pct(end.afterTaxReal, 0.5), p90: pct(end.afterTaxReal, 0.9) },
      afterTaxMiddleRun: { real: between(end.afterTaxReal), nominal: between(end.afterTax), runs: mLo === mHi ? 1 : 2 },
      medianDepletionAge: depletionAges.length ? pct(depletionAges, 0.5) : null,
      shortfall: {
        anyRate: failing.length / runs,
        durationHistogram: hist,
        durationFailing: failing.length ? { p50: pct(pick(sf.years, failing), 0.5), p90: pct(pick(sf.years, failing), 0.9) } : null,
        totalRealAll: { p50: pct(sf.totalReal, 0.5), p90: pct(sf.totalReal, 0.9), p95: pct(sf.totalReal, 0.95) },
        totalRealFailing: failing.length ? { p50: pct(pick(sf.totalReal, failing), 0.5), p90: pct(pick(sf.totalReal, failing), 0.9) } : null,
        worstYearReal: { p95: pct(sf.worstReal, 0.95), max: Math.max(0, ...sf.worstReal) },
        cause: { baseReal: sf.base, oneTimeReal: sf.oneTime, baseShare: sf.base + sf.oneTime > 0 ? sf.base / (sf.base + sf.oneTime) : null },
      },
      rules: {
        on: !!rules,
        guardrails: { runsWithCut: rule.guardRuns / runs, cutYears: dist(rule.guardYears), runsWithDeferral: rule.deferRuns / runs, deferrals: rule.deferrals },
        contingentSS: {
          you: { triggeredRate: rule.trigYou.length / runs, claimAge: dist(rule.trigYou) },
          spouse: H.married ? { triggeredRate: rule.trigSpouse.length / runs, claimAge: dist(rule.trigSpouse) } : null,
        },
      },
      mortality: mode === 'stochastic' ? { youDeathAge: dist(deaths.you), spouseDeathAge: H.married ? dist(deaths.spouse) : null, lastYear: dist(deaths.lastYear) } : null,
    };
  }

  // Runs Monte Carlo under fixed lifespans and stochastic mortality (same seeds, same market paths per run).
  // `selected` is the household's chosen mode, used for the fan chart and the headline.
  function monteCarloSuite(rawInputs, opts) {
    opts = opts || {};
    const inp = normalizeInputs(rawInputs);
    const runs = Math.max(1, Math.round(opts.runs || inp.monteCarlo.runs));
    const progress = (offset) => (opts.onProgress ? (d) => opts.onProgress(offset + d, runs * 2) : undefined);
    const fixed = monteCarlo(inp, { ...opts, runs, mortality: 'fixed', onProgress: progress(0) });
    const stochastic = monteCarlo(inp, { ...opts, runs, mortality: 'stochastic', onProgress: progress(runs) });
    return { fixed, stochastic, selected: inp.household.monteCarloLifespans === 'stochastic' ? 'stochastic' : 'fixed' };
  }

  // Compare scenarios side by side at one seed and run count. list: [{ name, inputs }]. `mode` picks the lifespan mode
  // whose Monte Carlo metrics are reported (success is reported for both).
  function compareScenarios(list, opts) {
    opts = opts || {};
    const runs = Math.max(1, Math.round(opts.runs || 1000)), seed = Math.round(opts.seed != null ? opts.seed : 1);
    const mode = opts.mode === 'stochastic' ? 'stochastic' : 'fixed';
    const total = list.length * runs * 2;
    return list.map(({ name, inputs }, i) => {
      const inp = normalizeInputs(inputs);
      const S = simulate(inp, { lite: true }).summary;
      const suite = monteCarloSuite(inp, { runs, seed, onProgress: opts.onProgress ? (d) => opts.onProgress(i * runs * 2 + d, total) : undefined });
      const m = suite[mode];
      return {
        name, runs, seed, mode, modeLabel: mode === 'stochastic' ? 'stochastic mortality' : 'fixed lifespans',
        fixed: { successRate: suite.fixed.successRate }, stochastic: { successRate: suite.stochastic.successRate },
        sel: {
          successRate: m.successRate, anyRate: m.shortfall.anyRate, unfundedP95: m.shortfall.totalRealAll.p95,
          durationP50: m.shortfall.durationFailing ? m.shortfall.durationFailing.p50 : null,
          worstYearMax: m.shortfall.worstYearReal.max, afterTaxRealP50: m.afterTaxReal.p50, endingRealP50: m.endingBalanceReal.p50,
        },
        det: {
          endingBalance: S.endingBalance, endingBalanceReal: S.endingBalanceReal, afterTax: S.afterTaxInheritance, afterTaxReal: S.afterTaxInheritanceReal,
          lifetimeFederalTax: S.lifetimeFederalTax, lifetimeOtherTax: S.lifetimeOtherTax, depletionYear: S.depletionYear,
        },
      };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Planning tools. Every candidate plan is scored with Monte Carlo at the same seed and run count, in the household's
  // selected lifespan mode, so candidates are compared on identical market paths (and lifespans).
  // ---------------------------------------------------------------------------------------------
  const cloneInputs = (o) => JSON.parse(JSON.stringify(o));
  // A candidate's score. Inheritance is the after-tax amount left in the middle Monte Carlo run (today's $, and the same
  // run's nominal amount: dollars of the year it is left); lifetime income tax and det* come from the projection at
  // average returns.
  function evaluatePlan(inp, o) {
    const mc = monteCarlo(inp, { runs: o.runs, seed: o.seed, mortality: o.mode });
    const det = simulate(inp, { lite: true });
    const taxReal = det.years.reduce((t, r) => t + r.totalTax / r.idx, 0);
    return { success: mc.successRate, anyUnfunded: mc.shortfall.anyRate, inheritanceReal: mc.afterTaxMiddleRun.real, inheritance: mc.afterTaxMiddleRun.nominal,
      inheritanceRuns: mc.afterTaxMiddleRun.runs, endingReal: mc.endingBalanceReal.p50, lifetimeTaxReal: taxReal, lifetimeTax: det.summary.lifetimeTax,
      detAfterTaxReal: det.summary.afterTaxInheritanceReal, detAfterTax: det.summary.afterTaxInheritance, detEndYear: det.summary.endYear };
  }
  function toolOpts(inp, opts) {
    opts = opts || {};
    return { runs: Math.max(50, Math.round(opts.runs || 500)), seed: Math.round(opts.seed != null ? opts.seed : inp.monteCarlo.seed),
      mode: (opts.mode || inp.household.monteCarloLifespans) === 'stochastic' ? 'stochastic' : 'fixed', target: opts.target != null ? opts.target : 0.9 };
  }

  // Highest base monthly spending (today's $, or local currency in currency mode) whose Monte Carlo success meets
  // `target`. With a fixed seed each run sees the same markets, so success falls monotonically as spending rises.
  function solveMaxSpending(raw, opts) {
    const inp = normalizeInputs(raw), o = toolOpts(inp, opts);
    // Base spending: in local currency in currency mode, else in US dollars (both `baseMonthly`).
    const where = (x) => (inp.spending.foreignCurrency.enabled ? x.spending.foreignCurrency : x.spending);
    const base = where(inp).baseMonthly;
    const trace = [];
    let evals = 0;
    const score = (v) => {
      const c = cloneInputs(inp); where(c).baseMonthly = v;
      const r = evaluatePlan(c, o); trace.push({ monthly: v, success: r.success }); evals++;
      if (opts && opts.onProgress) opts.onProgress(Math.min(evals, 24), 24);
      return r.success;
    };
    const baseSuccess = score(base);
    let lo, hi;
    if (baseSuccess >= o.target) {
      lo = base; hi = base * 1.5;
      while (score(hi) >= o.target && hi < base * 30) { lo = hi; hi *= 1.5; }
    } else {
      hi = base; lo = base / 1.5;
      while (lo > base / 200 && score(lo) < o.target) { hi = lo; lo /= 1.5; }
      if (lo <= base / 200) lo = 0;
    }
    const tol = Math.max(10, base * 0.002);
    while (hi - lo > tol) { const mid = (lo + hi) / 2; if (score(mid) >= o.target) lo = mid; else hi = mid; }
    const found = trace.filter((t) => t.monthly <= lo + 1e-9).sort((a, b) => b.monthly - a.monthly)[0];
    return { kind: 'spending', currency: inp.spending.foreignCurrency.enabled ? inp.spending.foreignCurrency.code : 'USD', target: o.target, mode: o.mode, runs: o.runs, seed: o.seed,
      base: { monthly: base, success: baseSuccess }, monthly: lo, success: found ? found.success : null, trace: trace.sort((a, b) => a.monthly - b.monthly) };
  }

  // Earliest retirement age (yours) whose Monte Carlo success meets `target`. Each candidate age adjusts your service at
  // separation (service − (planned age − candidate age)), so FERS eligibility, the annuity and the supplement follow.
  function solveEarliestRetirement(raw, opts) {
    const inp = normalizeInputs(raw), o = toolOpts(inp, opts);
    const planned = inp.employment.you.retirementAge, cur = inp.household.currentYear - inp.household.you.birthYear;
    const from = Math.max(cur, planned - 10), to = Math.max(planned, Math.min(75, (opts && opts.maxAge) || planned + 8));
    const rows = [];
    for (let a = from; a <= to; a++) {
      const c = cloneInputs(inp);
      c.employment.you.retirementAge = a;
      c.fersPension.you.serviceYears = Math.max(0, inp.fersPension.you.serviceYears - (planned - a));
      const r = evaluatePlan(c, o), S = simulate(c, { lite: true }).summary;
      rows.push({ age: a, year: inp.household.you.birthYear + a, service: S.fers ? c.fersPension.you.serviceYears : null,
        rule: S.fers ? S.fers.rule : null, retirementType: S.fers ? S.fers.retirementType : null,
        success: r.success, inheritanceReal: r.inheritanceReal });
      if (opts && opts.onProgress) opts.onProgress(rows.length, to - from + 1);
    }
    const ok = rows.find((r) => r.success >= o.target);
    return { kind: 'retire', target: o.target, mode: o.mode, runs: o.runs, seed: o.seed, planned, earliest: ok ? ok.age : null, rows };
  }

  // Optimizer: searches Social Security claim ages (both spouses, whole years) and/or Roth conversion windows.
  // goal 'success' (tie-break: median after-tax inheritance), 'inheritance' (median after-tax inheritance, today's $)
  // or 'tax' (lowest lifetime income tax, today's $). Claim ages are searched first, then conversions with the best ages.
  function optimizePlan(raw, opts) {
    opts = opts || {};
    const inp = normalizeInputs(raw), o = toolOpts(inp, opts);
    const goal = ['inheritance', 'tax'].includes(opts.goal) ? opts.goal : 'success';
    const H = inp.household, Y0 = H.currentYear;
    const better = (a, b) => {
      if (goal === 'tax') return a.lifetimeTaxReal < b.lifetimeTaxReal - 1;
      if (goal === 'inheritance') return a.inheritanceReal > b.inheritanceReal + 1;
      // Strict (transitive) ranking: success, then median inheritance. Differences of about one run are noise; the UI
      // and export say so rather than fudging the order (a tolerance-based tie would not be a consistent ordering).
      return a.success > b.success + 1e-9 || (Math.abs(a.success - b.success) <= 1e-9 && a.inheritanceReal > b.inheritanceReal);
    };
    const rank = (list) => list.sort((a, b) => (better(a.metrics, b.metrics) ? -1 : better(b.metrics, a.metrics) ? 1 : 0));
    const ssCands = [], rothCands = [];
    if (opts.ss !== false) {
      const youMin = Math.max(62, Y0 - H.you.birthYear), spMin = H.married ? Math.max(62, Y0 - H.spouse.birthYear) : 0;
      const youAges = [], spAges = [];
      for (let a = youMin; a <= 70; a++) youAges.push(a);
      if (H.married) for (let a = spMin; a <= 70; a++) spAges.push(a); else spAges.push(null);
      for (const a of youAges) for (const b of spAges) ssCands.push({ a, b });
    }
    const retire = inp.employment.you.retirementAge, youClaim = inp.socialSecurity.you.claimAge, rmdAge = rmdStartAge(H.you.birthYear);
    const ends = [retire, retire + 2, youClaim - 1, rmdAge - 1];
    // Also convert up to the year before a tax that starts later (a move).
    for (const e of inp.otherTaxes) if (e.fromYear > Y0 && e.fromYear - 1 - H.you.birthYear >= retire) ends.push(e.fromYear - 1 - H.you.birthYear);
    if (opts.roth !== false) {
      // Candidates replace the plan's conversions and keep its transfers; conversions go where the plan's first one goes
      // (your traditional TSP / 401(k) to Roth if there is none), at your ages.
      const keep = (inp.taxes.conversionsAndTransfers || []).filter((w) => !isConversion(w));
      const first = (inp.taxes.conversionsAndTransfers || []).find((w) => isConversion(w) && w.owner !== 'spouse');
      const from = first ? first.fromAccount : 'traditionalWorkplace', to = first ? first.toAccount : 'rothWorkplace';
      rothCands.push({ windows: keep, label: 'No conversions' });
      for (const br of [0.12, 0.22, 0.24, 0.32]) {
        for (const e of [...new Set(ends.filter((x) => x >= retire))].sort((x, y) => x - y)) {
          rothCands.push({ windows: [...keep, { ...MOVE_DEFAULT, owner: 'you', fromAccount: from, toAccount: to, fromAge: retire, throughAge: e, howMuch: 'fillBracket', fillToTopOfBracket: br }], label: `Fill ${Math.round(br * 100)}% at ages ${retire}–${e}` });
        }
      }
    }
    const total = ssCands.length + rothCands.length + 1;
    let done = 0;
    const tick = () => { done++; if (opts.onProgress) opts.onProgress(done, total); };
    const base = evaluatePlan(inp, o); tick();
    let cur = cloneInputs(inp);
    const ssResults = [];
    for (const c of ssCands) {
      const t = cloneInputs(cur); t.socialSecurity.you.claimAge = c.a; t.socialSecurity.you.claimExtraMonths = 0;
      if (c.b !== null) { t.socialSecurity.spouse.claimAge = c.b; t.socialSecurity.spouse.claimExtraMonths = 0; }
      ssResults.push({ label: `You claim at ${c.a}${c.b !== null ? `, spouse at ${c.b}` : ''}`, patch: { socialSecurity: { you: { claimAge: c.a, claimExtraMonths: 0 }, ...(c.b !== null ? { spouse: { claimAge: c.b, claimExtraMonths: 0 } } : {}) } }, metrics: evaluatePlan(t, o) });
      tick();
    }
    rank(ssResults);
    if (ssResults.length) cur = overlay(cur, ssResults[0].patch);
    const rothResults = [];
    for (const c of rothCands) {
      const t = cloneInputs(cur); t.taxes.conversionsAndTransfers = c.windows;
      rothResults.push({ label: c.label, patch: { taxes: { conversionsAndTransfers: c.windows } }, metrics: evaluatePlan(t, o) });
      tick();
    }
    rank(rothResults);
    const bestPatch = overlay(ssResults.length ? ssResults[0].patch : {}, rothResults.length ? rothResults[0].patch : {});
    // currentYear (today's $) and adaptiveRules describe the inputs this result was computed from.
    const adaptiveRules = inp.monteCarlo.adaptiveRules.earlySocialSecurity.enabled || inp.monteCarlo.adaptiveRules.spendingGuardrails.enabled;
    return { kind: 'optimize', goal, mode: o.mode, runs: o.runs, seed: o.seed, currentYear: Y0, adaptiveRules, base, ss: ssResults.slice(0, 10), roth: rothResults.slice(0, 10),
      ssCount: ssResults.length, rothCount: rothResults.length, bestPatch,
      best: (ssResults.length || rothResults.length) ? evaluatePlan(overlay(inp, bestPatch), o) : base };
  }

  // One-at-a-time sensitivity: each assumption moved down and up from the plan, everything else held, scored with
  // Monte Carlo at the same seed. Returns entries sorted by the swing in success.
  function sensitivityAnalysis(raw, opts) {
    opts = opts || {};
    const inp = normalizeInputs(raw), o = toolOpts(inp, opts);
    const pt = (x) => `${Math.round(x * 1000) / 10}%`.replace('-', '−');
    const mod = (f) => (c) => { f(c); return c; };
    // Every account's return before or after retirement, and every volatility, move together.
    const shift = (phase, d) => mod((c) => {
      c.brokerage.returns[phase] += d;
      for (const who of ['you', 'spouse']) {
        c.workplacePlans[who].returns[phase] += d; c.iras[who].traditional.returns[phase] += d; c.iras[who].roth.returns[phase] += d;
      }
    });
    const shiftPost = (d) => shift('afterRetirement', d), shiftPre = (d) => shift('beforeRetirement', d);
    const shiftVol = (d) => mod((c) => {
      for (const when of Object.values(c.monteCarlo.volatility)) for (const k of Object.keys(when)) when[k] = Math.max(0, when[k] + d);
    });
    const retireShift = (d) => mod((c) => { c.employment.you.retirementAge += d; c.fersPension.you.serviceYears = Math.max(0, c.fersPension.you.serviceYears + d); });
    const vars = [
      { key: 'returnPost', label: 'Return after retirement', lo: shiftPost(-0.01), hi: shiftPost(0.01), loText: '−1 pt', hiText: '+1 pt' },
      { key: 'returnPre', label: 'Return before retirement', lo: shiftPre(-0.01), hi: shiftPre(0.01), loText: '−1 pt', hiText: '+1 pt' },
      { key: 'vol', label: 'Return volatility', lo: shiftVol(-0.03), hi: shiftVol(0.03), loText: '−3 pts', hiText: '+3 pts' },
      { key: 'inflation', label: 'Inflation (healthcare moves with it)', lo: mod((c) => { c.inflation.rate -= 0.01; c.spending.healthcare.inflation -= 0.01; }), hi: mod((c) => { c.inflation.rate += 0.01; c.spending.healthcare.inflation += 0.01; }), loText: pt(inp.inflation.rate - 0.01), hiText: pt(inp.inflation.rate + 0.01) },
      { key: 'health', label: 'Healthcare inflation', lo: mod((c) => { c.spending.healthcare.inflation -= 0.01; }), hi: mod((c) => { c.spending.healthcare.inflation += 0.01; }), loText: '−1 pt', hiText: '+1 pt' },
      { key: 'spending', label: 'Base spending', lo: mod((c) => { c.spending.baseMonthly *= 0.9; c.spending.foreignCurrency.baseMonthly *= 0.9; }), hi: mod((c) => { c.spending.baseMonthly *= 1.1; c.spending.foreignCurrency.baseMonthly *= 1.1; }), loText: '−10%', hiText: '+10%' },
      { key: 'retire', label: 'Your retirement age (service adjusted)', lo: retireShift(-1), hi: retireShift(1), loText: '1 year earlier', hiText: '1 year later' },
      { key: 'ss', label: 'Social Security paid', lo: mod((c) => { c.socialSecurity.trustFundShortfall.benefitsPaidShare = Math.min(c.socialSecurity.trustFundShortfall.benefitsPaidShare, 0.78); c.socialSecurity.trustFundShortfall.fromYear = Math.min(c.socialSecurity.trustFundShortfall.fromYear, 2033); }), hi: mod((c) => { c.socialSecurity.trustFundShortfall.benefitsPaidShare = 1; }), loText: '78% from 2033', hiText: '100%' },
    ];
    const feds = ['you', 'spouse'].filter((w) => inp.employment[w].federal && (w === 'you' || inp.household.married));
    if (feds.length) vars.push({ key: 'cola', label: 'FERS COLA', lo: mod((c) => { c.fersPension.colaMode = 'none'; }), hi: mod((c) => { c.fersPension.colaMode = 'diet'; }), loText: 'none', hiText: 'current law' });
    if (o.mode === 'fixed') vars.push({ key: 'life', label: 'Lifespans', lo: mod((c) => { c.household.you.lifespan -= 5; c.household.spouse.lifespan -= 5; }), hi: mod((c) => { c.household.you.lifespan += 5; c.household.spouse.lifespan += 5; c.household.planToAge += 5; }), loText: '−5 years', hiText: '+5 years' });
    if (feds.some((w) => inp.fersSupplement[w].mode !== 'off')) {
      vars.push({ key: 'supp', label: 'FERS supplement', lo: mod((c) => { for (const w of feds) c.fersSupplement[w].mode = 'off'; }), hi: (c) => c, loText: 'eliminated', hiText: 'as planned' });
    }
    if (inp.otherTaxes.length) vars.push({ key: 'otherTax', label: 'State, local & foreign tax', lo: (c) => c, hi: mod((c) => { c.otherTaxes = []; }), loText: 'as planned', hiText: 'none' });
    if (inp.spending.foreignCurrency.enabled) vars.push({ key: 'fx', label: `${inp.spending.foreignCurrency.code || 'Currency'} drift per year`, lo: mod((c) => { c.spending.foreignCurrency.annualDrift -= 0.01; }), hi: mod((c) => { c.spending.foreignCurrency.annualDrift += 0.01; }), loText: pt(inp.spending.foreignCurrency.annualDrift - 0.01), hiText: pt(inp.spending.foreignCurrency.annualDrift + 0.01) });
    const total = vars.length * 2 + 1;
    let done = 0;
    const tick = () => { done++; if (opts.onProgress) opts.onProgress(done, total); };
    const base = evaluatePlan(inp, o); tick();
    const entries = vars.map((v) => {
      const lo = evaluatePlan(normalizeInputs(v.lo(cloneInputs(inp))), o); tick();
      const hi = evaluatePlan(normalizeInputs(v.hi(cloneInputs(inp))), o); tick();
      return { key: v.key, label: v.label, loText: v.loText, hiText: v.hiText, lo, hi,
        swingSuccess: Math.abs(hi.success - lo.success), swingInheritance: Math.abs(hi.inheritanceReal - lo.inheritanceReal) };
    });
    entries.sort((a, b) => b.swingSuccess - a.swingSuccess || b.swingInheritance - a.swingInheritance);
    return { kind: 'sensitivity', mode: o.mode, runs: o.runs, seed: o.seed, base, entries };
  }

  // ---------------------------------------------------------------------------------------------
  // Social Security claim-age comparison (today's dollars, own benefit only, undiscounted)
  // ---------------------------------------------------------------------------------------------
  function ssClaimComparison(rawInputs, claimAges) {
    const inp = normalizeInputs(rawInputs);
    claimAges = claimAges || [62, 67, 70];
    const people = [{ key: 'you', label: 'You', by: inp.household.you.birthYear, pia: inp.socialSecurity.you.piaMonthly }];
    if (inp.household.married) people.push({ key: 'spouse', label: 'Spouse', by: inp.household.spouse.birthYear, pia: inp.socialSecurity.spouse.piaMonthly });
    const ages = [];
    for (let a = 62; a <= 100; a++) ages.push(a);
    return people.map((p) => {
      const fra = fraMonthsForBirthYear(p.by);
      const series = claimAges.map((c) => {
        const annual = p.pia * 12 * ssClaimFactor(c, fra);
        return { claimAge: c, annual, factor: ssClaimFactor(c, fra), cumulative: ages.map((a) => annual * Math.max(0, a - c)) };
      });
      const breakEvens = [];
      for (let i = 0; i < series.length; i++) {
        for (let j = i + 1; j < series.length; j++) {
          const e = series[i], l = series[j];
          if (l.annual <= e.annual) continue;
          // Cumulative benefits at exact age a: annual × (a − claimAge). Solve for equality.
          const a = (l.annual * l.claimAge - e.annual * e.claimAge) / (l.annual - e.annual);
          breakEvens.push({ early: e.claimAge, late: l.claimAge, age: a });
        }
      }
      return { key: p.key, label: p.label, pia: p.pia, fraMonths: fra, ages, series, breakEvens };
    });
  }

  const api = {
    CONSTANTS, defaultInputs, normalizeInputs, simulate, monteCarlo, ssClaimComparison,
    DEFAULTS_REVISION, INPUTS_VERSION, inputsFromDiff, validateInputs, gsStepStartYears, gsStepPay, PLAN_GUIDE, ENUMS, computeBucketPlan, monteCarloSuite, sampleDeathAge,
    compareScenarios, expandEvents, solveMaxSpending, solveEarliestRetirement, optimizePlan, sensitivityAnalysis, evaluatePlan,
    mraForBirthYear, mraMonthsForBirthYear, fraMonthsForBirthYear, rmdStartAge, rmdDivisor,
    ssClaimFactor, ssSpousalFactor, spousalExcess, dietCola,
    fersRetirementType, fersMultiplier, fersBasicAnnuity, fersStartAge, fersAgeReduction, fersSupplementYears, fersSupplementMonthly,
    taxableSocialSecurity, computeTaxes, bracketTop, federalBrackets, mulberry32, lognormalReturn, normalizeOrder, fmtAgeYM,
    ACCOUNT_NAMES, ACCOUNT_LABELS, MOVES, findMove, isConversion, moveKey, overlay,
  };
  // Source text, so the UI can build a Web Worker from a Blob even when opened from file://.
  api.source = '(' + engineFactory.toString() + ')()';
  return api;
});
