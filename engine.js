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

    mexico: {
      // SAT, Anexo 8 de la RMF 2026 (DOF 28-12-2025): annual ISR tariff for individuals (art. 152 LISR), MXN.
      // [lower limit, fixed fee, rate on the excess over the lower limit]. Limits were raised by factor 1.1321 for 2026.
      isrYear: 2026,
      isrAnnual: [
        [0, 0, 0.0192], [10135.12, 194.59, 0.064], [86022.12, 5051.37, 0.1088], [151176.20, 12140.13, 0.16],
        [175735.67, 16069.64, 0.1792], [210403.70, 22282.14, 0.2136], [424353.98, 67981.92, 0.2352],
        [668840.15, 125485.07, 0.30], [1276925.99, 307910.81, 0.32], [1702567.98, 444116.23, 0.34], [5107703.93, 1601862.46, 0.35],
      ],
      // INEGI: UMA daily value in force from February 1, 2026.
      umaDaily2026: 117.31,
      // LISR art. 93 fr. IV: retirement income exempt up to 15 × the daily UMA (× 365 per year).
      pensionExemptUmaMultiple: 15,
    },
    // IRC §904(c): excess foreign tax credits carry forward 10 years (the 1-year carryback is not modeled).
    ftcCarryforwardYears: 10,

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
  // are the groups inside a panel, so a plan file reads like the screen. PLAN_GUIDE (below) states the conventions:
  // rates, returns and shares are decimals; dollar amounts are today's dollars a year unless the name ends in Monthly
  // or a comment says otherwise; age-based changes happen at the start of the year the age is reached.
  // ---------------------------------------------------------------------------------------------
  // The example household: a GS-12 (step 5, Rest of U.S. locality, 2026) ten years into federal service, hired at 34,
  // planning to retire at 62 with 28 years; a working spouse two years older. Values are illustrative, not advice.
  function defaultInputs() {
    const ev = (at, label, amount, direction, extra) => ({ ...EVENT_DEFAULT, at, label, amount, direction, ...extra });
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
        salary: 101443,
        annualRaise: 0.02, // general pay-table increase each year
        // GS within-grade step increases (CONSTANTS.gs) from currentStep (1–10); the next one comes yearsUntilNextStep
        // years from now (1 = within a year; at most that step's waiting period). Off: no step increases.
        addStepIncreases: true,
        currentStep: 5,
        yearsUntilNextStep: 1,
        // This year's GS pay cap (Executive Schedule level IV); later years grow with annualRaise. 0 = no cap.
        gsPayCap: CONSTANTS.gs.payCap,
        retirementAge: 62,
        extraSavings: 6000, // saved a year while working, into the brokerage account (here, the spouse's savings)
        // Social Security or annuity income that starts before you retire is spent with your salary (not saved).
        spendBenefitsThatStartBeforeRetiring: true,
        afterRetiring: { earnings: 0, untilAge: 62 },
        spouse: { hasEarnings: true, earnings: 60000, stopsAtAge: 62 },
      },
      tsp: {
        // rothBasisShare: share of today's Roth TSP balance that is contributions (the rest is earnings).
        balances: { traditional: 120000, roth: 30000, rothBasisShare: 0.7 },
        contributions: { rate: 0.10, rothShare: 0.3, catchUp: false },
        // One fund allocation covers the traditional and Roth balances, so one return.
        returns: { beforeRetirement: 0.07, afterRetirement: 0.06 },
      },
      // Each IRA is invested on its own. basisShare: share of today's Roth IRA balance that is contributions and
      // conversions; contributionsWhileWorking is capped at the IRA limit.
      iras: {
        traditional: { balance: 0, returns: { beforeRetirement: 0.07, afterRetirement: 0.06 } },
        roth: { balance: 0, basisShare: 1, returns: { beforeRetirement: 0.07, afterRetirement: 0.07 }, contributionsWhileWorking: 0 },
      },
      // A taxable account of stock and bond funds. unrealizedGainShare: share of today's balance that is gain not yet taxed.
      brokerage: { balance: 20000, unrealizedGainShare: 0.3, returns: { beforeRetirement: 0.07, afterRetirement: 0.06 } },
      checkingAndMoneyMarket: {
        // Checking is kept at keepInChecking: topped up from surplus first, refilled from the money market, spent last.
        checking: { balance: 0, keepInChecking: 0, interestRate: 0 },
        // With keepSurplus, surplus stays in the money market up to moveToBrokerageAbove and the rest is invested in the
        // brokerage account; no limit in the first settlingInYears of retirement (0 = off).
        moneyMarket: { balance: 25000, yield: 0.03, keepSurplus: true, moveToBrokerageAbove: 50000, settlingInYears: 0 },
      },
      withdrawals: {
        // 'fixedOrder' = the order below; 'proportional' = in proportion to balances; 'bracketFill' = traditional TSP and
        // IRA first up to the top of fillToTopOfBracket, then the order below.
        strategy: 'fixedOrder',
        fillToTopOfBracket: 0.12,
        oneTimeOutflowsFromRothFirst: false,
        order: ['brokerage', 'traditionalTsp', 'rothTsp', 'traditionalIra', 'rothIra'], // the money market always goes first
        bridgeBucket: { enabled: false, yearsCovered: 5, buildYearsBeforeRetirement: 5, return: 0.04 },
      },
      fersPension: {
        serviceYears: 28,
        sickLeaveHours: 1000,
        high3Mode: 'auto',
        manualHigh3: 160000, // nominal dollars at retirement
        survivorElection: 'full',
        averageSalaryYears: 3, // 3 = High-3 (current law); 5 = High-5 (proposed)
        colaMode: 'diet', // 'diet' = current law; 'reduced' = diet COLA minus colaReducedBy; 'none' = no COLA
        colaReducedBy: 0.01,
        postponeToAge: 0, // 0 = start as early as the retirement type allows
        specialCategory: false,
        useOpmEstimate: false,
        opmEstimateMonthly: 3000, // gross, in dollars of the first year it is paid
        fehbYearsBeforeRetirement: 28,
      },
      fersSupplement: {
        mode: 'auto',
        // Today's $: Social Security at 62 from the FERS years' earnings only (28 years of about $95,000 ≈ 70% of a
        // $2,700 PIA). 0 = 70% of your PIA, the age-62 benefit for anyone born in 1960 or later.
        ssAt62FromFersMonthly: 1900,
        manualMonthly: 1500, // dollars of your retirement year
      },
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
        // localPerUsd and annualDrift also convert the Mexico ISR tariff (foreignTax.method 'mexicoIsr').
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
        stateRate: 0.04,
        heirsRate: 0.22, // heirs' marginal rate on inherited traditional TSP and IRA money (after-tax inheritance)
        // By your age (see MOVES). In a year the first conversion covering your age applies, and every transfer covering it.
        conversionsAndTransfers: [],
      },
      foreignTax: {
        enabled: false,
        country: 'Mexico',
        residentFromYear: 2045, // first year of foreign tax residency
        method: 'mexicoIsr', // 'mexicoIsr' = Mexico's progressive annual ISR tariff; 'flatRate' = one effective rate
        isrIndexing: 0.035, // yearly indexing of the ISR tariff and the UMA from 2026
        flatRate: 0.30,
        flatExemptAmount: 0, // today's $ of included income exempt each year (flat rate)
        // Double-tax relief: 'usCreditsForeignTax' = Mexico taxes in full and the US credits it (treaty resourcing, §904
        // limit, 10-year carryforward); 'foreignCountryCreditsUsTax' = Mexico credits the US tax on the same income;
        // 'none' = both tax in full.
        relief: 'foreignCountryCreditsUsTax',
        treatyArt20: false, // TSP, FERS annuity and supplement are US-only government-service pensions (treaty art. 20)
        retirementIncomeExemption: false, // ISR: Mexico's exemption for retirement income (LISR art. 93 fr. IV)
        umaDailyMxn: 117.31, // 2026; indexed with isrIndexing
        umaMultiple: 15,
        appliesTo: {
          traditionalWithdrawals: true,
          rothWithdrawals: true,
          rothAmountTaxed: 'fixedShare', // 'earningsShare' = the earnings part of each withdrawal (basis tracked); 'fixedShare'
          rothTaxedShare: 1.0, // fixedShare: share of each Roth withdrawal taxed
          rothConversions: true,
          socialSecurity: false,
          fersAnnuity: false,
          fersSupplement: false,
          brokerageGains: true,
          interest: true, // money market and checking interest
          earnedIncome: true,
        },
      },
      monteCarlo: {
        enabled: true,
        runs: 1000,
        seed: 20260101,
        // Standard deviation of yearly returns by account. Each year one market shock moves every account.
        volatility: {
          beforeRetirement: { tsp: 0.15, brokerage: 0.15, traditionalIra: 0.15, rothIra: 0.15 },
          afterRetirement: { tsp: 0.10, brokerage: 0.12, traditionalIra: 0.10, rothIra: 0.15 },
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
  // A conversion or transfer row. howMuch: 'fillBracket' (conversions only) | 'fixedAmount' (today's $ a year) | 'wholeBalance'.
  const MOVE_DEFAULT = { fromAccount: 'traditionalTsp', toAccount: 'rothTsp', fromAge: 62, throughAge: 62, howMuch: 'fillBracket',
    fillToTopOfBracket: 0.22, fixedAmount: 50000 };
  // Accounts as the inputs name them (withdrawal order, conversions and transfers) and their keys inside the engine.
  const ACCOUNT_KEY = { brokerage: 'taxable', traditionalTsp: 'trad', rothTsp: 'roth', traditionalIra: 'tradIra', rothIra: 'rothIra' };
  const ACCOUNT_NAMES = Object.keys(ACCOUNT_KEY);
  const ACCOUNT_LABELS = { brokerage: 'Brokerage investments', traditionalTsp: 'Traditional TSP', rothTsp: 'Roth TSP',
    traditionalIra: 'Traditional IRA', rothIra: 'Roth IRA' };
  // Conversions (traditional → Roth: taxed) and transfers (same tax type: not taxed) between accounts.
  const MOVES = [
    { fromAccount: 'traditionalTsp', toAccount: 'rothTsp', label: 'Traditional TSP → Roth TSP (in-plan conversion)' },
    { fromAccount: 'traditionalTsp', toAccount: 'rothIra', label: 'Traditional TSP → Roth IRA (conversion)' },
    { fromAccount: 'traditionalIra', toAccount: 'rothIra', label: 'Traditional IRA → Roth IRA (conversion)' },
    { fromAccount: 'rothTsp', toAccount: 'rothIra', label: 'Roth TSP → Roth IRA (transfer)' },
    { fromAccount: 'traditionalTsp', toAccount: 'traditionalIra', label: 'Traditional TSP → traditional IRA (transfer)' },
  ];
  const findMove = (w) => MOVES.find((m) => m.fromAccount === w.fromAccount && m.toAccount === w.toAccount) || null;
  const isConversion = (w) => /^traditional/.test(w.fromAccount) && /^roth/.test(w.toAccount);
  // Key of a move in each year's `moves`, e.g. traditionalTspToRothIra. Each move keeps one key string: building a new
  // string per run made V8 deoptimize the keyed accesses in simulate() over and over (Monte Carlo ran ~40% slower).
  const moveKey = (w) => `${w.fromAccount}To${w.toAccount[0].toUpperCase()}${w.toAccount.slice(1)}`;
  for (const m of MOVES) m.key = moveKey(m);
  // Withdrawal order: each invested account once (a comma-separated string is accepted); missing ones are appended.
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
    'employment.currentStep': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    'employment.yearsUntilNextStep': [1, 2, 3],
    'household.spouse.sex': ['male', 'female'],
    'household.monteCarloLifespans': ['fixed', 'stochastic'],
    'withdrawals.strategy': ['fixedOrder', 'proportional', 'bracketFill'],
    'withdrawals.fillToTopOfBracket': BRACKET_RATES,
    'withdrawals.order[]': ACCOUNT_NAMES,
    'fersPension.high3Mode': ['auto', 'manual'],
    'fersPension.survivorElection': ['none', 'partial', 'full'],
    'fersPension.averageSalaryYears': [3, 5],
    'fersPension.colaMode': ['diet', 'reduced', 'none'],
    'fersSupplement.mode': ['auto', 'manual', 'off'],
    'spending.oneTimeEvents[].person': ['household', 'you', 'spouse'],
    'spending.oneTimeEvents[].when': ['year', 'age', 'yearsBeforeDeath'],
    'spending.oneTimeEvents[].repeat': ['once', 'everyNYears', 'eachYearForNYears'],
    'spending.oneTimeEvents[].direction': ['outflow', 'inflow'],
    'spending.oneTimeEvents[].taxed': ['no', 'ordinaryIncome', 'longTermGain'],
    'taxes.mode': ['advanced', 'simple'],
    'taxes.conversionsAndTransfers[].fromAccount': ACCOUNT_NAMES,
    'taxes.conversionsAndTransfers[].toAccount': ACCOUNT_NAMES,
    'taxes.conversionsAndTransfers[].howMuch': ['fillBracket', 'fixedAmount', 'wholeBalance'],
    'taxes.conversionsAndTransfers[].fillToTopOfBracket': BRACKET_RATES,
    'foreignTax.method': ['mexicoIsr', 'flatRate'],
    'foreignTax.relief': ['foreignCountryCreditsUsTax', 'usCreditsForeignTax', 'none'],
    'foreignTax.appliesTo.rothAmountTaxed': ['earningsShare', 'fixedShare'],
    'monteCarlo.adaptiveRules.earlySocialSecurity.threshold': ['shareOfPlan', 'dollarAmount'],
  };
  const LIST_ITEM = { 'spending.oneTimeEvents': EVENT_DEFAULT, 'taxes.conversionsAndTransfers': MOVE_DEFAULT };
  const allowed = (enumPath, v) => ENUMS[enumPath].some((a) => (typeof a === 'number' ? Math.abs(a - v) < 1e-9 : a === v));
  // Settings that are decimals (0.07 = 7%), and the value from which one is taken to be a whole-number percent typed by
  // mistake: 100% or more for rates and returns, above 150% for shares (spending phases and guardrails go a bit above 100%).
  const decimalLimit = (path) => (/(^|\.)(\w*Share|\w*ShareOfPlan|shareOfPlan)$/.test(path) ? 1.5
    : /^monteCarlo\.volatility\./.test(path) || /(^|\.)(rate|yield|interestRate|annualRaise|beforeRetirement|afterRetirement|return|inflation|colaReducedBy|bracketGrowthBelowInflation|stateRate|heirsRate|simpleRateJoint|simpleRateSingle|flatRate|isrIndexing|annualDrift|volatility|persistence|spendingCut|fillToTopOfBracket)$/.test(path) ? 1 : null);

  // How to read and edit a plan file, for people and AI assistants (in exported files and the review packet).
  const PLAN_GUIDE = [
    'Each top-level section of "inputs" is one input panel of the calculator, in the same order, and nested objects are the groups inside it. ' +
      'A missing setting takes its default and an unknown one is ignored; the app lists both when the file is imported.',
    'Rates, returns and shares are decimals: 0.07 means 7%.',
    "Dollar amounts are in today's dollars (the plan's current year) and per year, unless the name ends in Monthly (per month). " +
      'In nominal dollars instead: fersPension.manualHigh3 (at retirement), fersPension.opmEstimateMonthly (the first year it is paid), ' +
      'fersSupplement.manualMonthly (the retirement year), and one-time events with inTodaysDollars false.',
    'Ages are whole years, and a change tied to an age happens at the start of the calendar year that age is reached. "you" is the FERS employee who owns the TSP.',
    'Accounts: traditionalTsp, rothTsp, traditionalIra, rothIra and brokerage (a taxable account of stock and bond funds) are invested; checking and the money market ' +
      'are cash (checkingAndMoneyMarket). withdrawals.order ranks the five invested accounts; the money market is always drawn first and checking last.',
    'taxes.conversionsAndTransfers: conversions are taxed as income in the year (' +
      MOVES.filter(isConversion).map((m) => `${m.fromAccount} → ${m.toAccount}`).join(', ') + '); transfers are not taxed (' +
      MOVES.filter((m) => !isConversion(m)).map((m) => `${m.fromAccount} → ${m.toAccount}`).join(', ') + '). ' +
      "howMuch: fillBracket (taxable income up to the top of fillToTopOfBracket; conversions only), fixedAmount (today's $ a year) or wholeBalance. " +
      'Each year the first conversion row covering your age applies, and every transfer row covering it.',
    'spending.oneTimeEvents: when is "year" (a calendar year), "age" (the person\'s age; yours for household events) or "yearsBeforeDeath"; ' +
      'repeat is "once", "everyNYears" (from at through `through`, 0 = end of plan) or "eachYearForNYears" (forNYears years in a row); ' +
      'events for "you" or "spouse" stop after that person dies; taxed applies to inflows; deferrable events can slide under spending guardrails.',
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
          walk(LIST_ITEM[path], v, p, enumPath + '[]', true);
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

  // Mexico annual ISR (MXN) on taxable income `income` (MXN), with the tariff scaled by `scale` (indexing since 2026).
  function mexicoIsr(income, scale) {
    const t = CONSTANTS.mexico.isrAnnual;
    if (!(income > 0)) return 0;
    let i = 0;
    while (i + 1 < t.length && income >= t[i + 1][0] * scale) i++;
    return t[i][1] * scale + t[i][2] * (income - t[i][0] * scale);
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
   * Federal + state income tax for one year.
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
    const state = (p.stateRate || 0) * (ordTaxable + gainsTaxable);
    return {
      taxableSS, agi, magi: agi, deduction, seniorDeduction: senior, ordTaxable, gainsTaxable, taxableIncome: ordTaxable + gainsTaxable,
      ordinaryTax, ltcgTax, niit, federal, state, total: federal + state, marginal, bracket,
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

  // Accounts: money market (`cash`), brokerage (`taxable`), traditional and Roth TSP (`trad`, `roth`), traditional and
  // Roth IRA (`tradIra`, `rothIra`), and checking. The money market is always drawn first and checking last; the order
  // of the five invested accounts is configurable.
  const INVESTED = ['taxable', 'trad', 'roth', 'tradIra', 'rothIra'];
  const ACCOUNTS = ['cash', ...INVESTED, 'checking'];
  const TRADITIONAL = ['trad', 'tradIra'];
  const ROTH_ACCOUNTS = ['roth', 'rothIra'];
  // Conversion tax is paid from the money market, brokerage, traditional, Roth, then checking.
  const TAX_ORDER = ['cash', 'taxable', 'trad', 'tradIra', 'roth', 'rothIra', 'checking'];
  const noFlows = () => ({ cash: 0, taxable: 0, trad: 0, roth: 0, tradIra: 0, rothIra: 0, checking: 0, unmet: 0 });
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
    const H = inp.household, E = inp.employment, T = inp.tsp, IR = inp.iras, BR = inp.brokerage;
    const CK = inp.checkingAndMoneyMarket.checking, MM = inp.checkingAndMoneyMarket.moneyMarket, WD = inp.withdrawals;
    const P = inp.fersPension, SU = inp.fersSupplement, SS = inp.socialSecurity, SP = inp.spending, TX = inp.taxes;
    const FT = inp.foreignTax, MC = inp.monteCarlo;

    const Y0 = Math.round(H.currentYear);
    const infl = inp.inflation.rate;
    const idxBase = Math.pow(1 + infl, Y0 - C.baseYear); // statutory $ from baseYear to current year
    // Federal tax amounts (chained CPI): grow at inflation minus the gap, from baseYear.
    const taxGap = TX.mode === 'advanced' ? TX.bracketGrowthBelowInflation : 0;
    let taxIdx = Math.pow(1 + infl - taxGap, Y0 - C.baseYear);
    const order = ['cash', ...normalizeOrder(WD.order).map((a) => ACCOUNT_KEY[a])];

    // People -------------------------------------------------------------------------------------
    const hasSp = !!H.married;
    const mkPerson = (by, lifespan, pia, claimY, claimM) => {
      const claimAge = clamp(claimY + clamp(claimM, 0, 11) / 12, 62, C.ss.maxClaimAge);
      const fra = fraMonthsForBirthYear(by);
      return {
        by, deathYear: Math.max(Y0, by + lifespan), pia, claimAge, fra,
        factor: ssClaimFactor(claimAge, fra), claimTime: by + claimAge,
      };
    };
    const you = mkPerson(H.you.birthYear, H.you.lifespan, SS.you.piaMonthly, SS.you.claimAge, SS.you.claimExtraMonths);
    const sp = hasSp ? mkPerson(H.spouse.birthYear, H.spouse.lifespan, SS.spouse.piaMonthly, SS.spouse.claimAge, SS.spouse.claimExtraMonths) : null;
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

    // Employment ---------------------------------------------------------------------------------
    const retireYear = you.by + E.retirementAge; // first calendar year without salary
    // Today's salary is at the current step; other years move with the raises and with the step held that year.
    const s0 = gsStep(E.currentStep);
    const stepStart = E.addStepIncreases ? gsStepStartYears(s0, E.yearsUntilNextStep, Y0) : null;
    const stepIn = (y) => { let s = 1; if (!stepStart) return s0; for (let k = 2; k <= 10; k++) if (stepStart[k] <= y) s = k; return s; };
    const uncappedIn = (y) => E.salary * Math.pow(1 + E.annualRaise, y - Y0) * gsStepPay(stepIn(y)) / gsStepPay(s0);
    // The GS pay cap (Executive Schedule level IV) grows with the raise, as level IV follows the GS across-the-board raise.
    const capIn = (y) => (E.gsPayCap > 0 ? E.gsPayCap * Math.pow(1 + E.annualRaise, y - Y0) : Infinity);
    const salaryIn = (y) => Math.min(uncappedIn(y), capIn(y));
    let payCapFromYear = null; // first working year whose pay is held at the cap
    for (let y = Y0; y < retireYear && payCapFromYear === null; y++) if (uncappedIn(y) > capIn(y) + 0.005) payCapFromYear = y;

    // FERS annuity -------------------------------------------------------------------------------
    const service = Math.max(0, P.serviceYears);
    const compService = Math.floor((service + Math.max(0, P.sickLeaveHours) / C.fers.sickLeaveHoursPerYear) * 12 + 1e-9) / 12;
    const mra = mraForBirthYear(you.by);
    const rt = fersRetirementType(E.retirementAge, service, mra, P.specialCategory);
    // Average of the highest N consecutive projected salaries before retirement (N = 3 under current law, 5 if High-5).
    const highN = P.averageSalaryYears === 5 ? 5 : 3;
    let high3Auto = 0;
    {
      const last = retireYear - 1;
      const first = Math.min(Y0, last - (highN - 1));
      for (let y = first; y + highN - 1 <= last; y++) {
        let tot = 0;
        for (let k = 0; k < highN; k++) tot += salaryIn(y + k);
        high3Auto = Math.max(high3Auto, tot / highN);
      }
    }
    const high3 = P.high3Mode === 'manual' ? P.manualHigh3 : high3Auto;
    const pensionStartAge = fersStartAge(rt, E.retirementAge, service, mra, Math.round(P.postponeToAge || 0));
    const pensionStartYear = pensionStartAge === null ? null : you.by + pensionStartAge;
    const ageReduction = pensionStartAge === null ? 0 : fersAgeReduction(rt, pensionStartAge, service);
    const specialFormula = P.specialCategory && rt.rule.startsWith('Special');
    const multiplier = specialFormula ? null : fersMultiplier(E.retirementAge, service);
    const basicAnnuity = rt.type === 'none' ? 0 : fersBasicAnnuity({
      high3, compService, ageAtSeparation: E.retirementAge, service, special: specialFormula,
    });
    const firstPayYear = pensionStartYear === null ? null : Math.max(pensionStartYear, Y0);
    const spAliveAtPension = sp && firstPayYear !== null && firstPayYear <= sp.deathYear;
    const election = sp && spAliveAtPension ? (C.fers.survivor[P.survivorElection] ? P.survivorElection : 'none') : 'none';
    const [survRed, survPct] = C.fers.survivor[election];
    // Annuity after any age reduction, before the survivor reduction (the survivor base). Nominal $ at commencement.
    const initialAnnuity = rt.type === 'none' ? 0 : (P.useOpmEstimate ? P.opmEstimateMonthly * 12 : basicAnnuity * (1 - ageReduction));

    // FERS supplement ----------------------------------------------------------------------------
    const suppEligible = SU.mode !== 'off' && rt.supplementEligible && E.retirementAge < 62 && pensionStartAge === E.retirementAge;
    // 0 = 70% of your PIA: claiming at 62 with an FRA of 67 (births 1960+, so everyone who can still get the supplement).
    const ss62Today = SU.ssAt62FromFersMonthly > 0 ? SU.ssAt62FromFersMonthly : 0.70 * SS.you.piaMonthly;
    let suppMonthly = null; // fixed when first paid (no COLA)

    // Conversions, transfers & bridge -------------------------------------------------------------
    // Rows covering your age: the first taxable conversion applies, and every transfer applies in list order.
    // Rows use the engine's account keys (from, to) and keep their key in each year's `moves`.
    const moveRows = TX.conversionsAndTransfers.filter(findMove)
      .map((w) => ({ ...w, from: ACCOUNT_KEY[w.fromAccount], to: ACCOUNT_KEY[w.toAccount], key: findMove(w).key, conversion: isConversion(w) }));
    const covers = (w, age) => age >= w.fromAge && age <= w.throughAge;
    const conversionFor = (age) => moveRows.find((w) => w.conversion && covers(w, age)) || null;
    const transfersFor = (age) => moveRows.filter((w) => !w.conversion && w.howMuch !== 'fillBracket' && covers(w, age));
    const idxAtRetireDet = Math.pow(1 + infl, retireYear - Y0);
    const suppAnnualDet = suppEligible ? (SU.mode === 'manual' ? SU.manualMonthly * 12 : fersSupplementMonthly(ss62Today * idxAtRetireDet, service) * 12) : 0;

    // Bridge bucket: pre-funds the deterministic plan's net portfolio draws for the first `yearsCovered` years of retirement.
    const bucketPlan = opts.noBucket ? null : (opts.bucketPlan !== undefined ? opts.bucketPlan : computeBucketPlan(inp));
    let bucket = null; // start-of-year bucket balance (nominal); null until funded

    const events = expandEvents(SP.oneTimeEvents, { you, spouse: sp });

    // State --------------------------------------------------------------------------------------
    const bal = { cash: Math.max(0, MM.balance), taxable: Math.max(0, BR.balance), trad: Math.max(0, T.balances.traditional), roth: Math.max(0, T.balances.roth),
      tradIra: Math.max(0, IR.traditional.balance), rothIra: Math.max(0, IR.roth.balance), checking: Math.max(0, CK.balance) };
    const total = (o) => ACCOUNTS.reduce((t, k) => t + o[k], 0);
    // Roth basis (contributions + conversions), for Mexico taxing only the earnings share of Roth withdrawals.
    let rothBasis = bal.roth * clamp(T.balances.rothBasisShare, 0, 1);
    let rothIraBasis = bal.rothIra * clamp(IR.roth.basisShare, 0, 1);
    // Roth IRA basis under the US ordering rules (contributions and conversions come out before earnings), for the
    // before-59½ check. The 5-year rules are assumed met.
    let rothIraUsBasis = rothIraBasis;
    // Expected return and volatility by account, before and after retirement. The TSP's traditional and Roth balances
    // share one allocation, so one return.
    const specPre = { trad: [T.returns.beforeRetirement, MC.volatility.beforeRetirement.tsp], roth: [T.returns.beforeRetirement, MC.volatility.beforeRetirement.tsp], taxable: [BR.returns.beforeRetirement, MC.volatility.beforeRetirement.brokerage],
      tradIra: [IR.traditional.returns.beforeRetirement, MC.volatility.beforeRetirement.traditionalIra], rothIra: [IR.roth.returns.beforeRetirement, MC.volatility.beforeRetirement.rothIra] };
    const specPost = { trad: [T.returns.afterRetirement, MC.volatility.afterRetirement.tsp], roth: [T.returns.afterRetirement, MC.volatility.afterRetirement.tsp], taxable: [BR.returns.afterRetirement, MC.volatility.afterRetirement.brokerage],
      tradIra: [IR.traditional.returns.afterRetirement, MC.volatility.afterRetirement.traditionalIra], rothIra: [IR.roth.returns.afterRetirement, MC.volatility.afterRetirement.rothIra] };
    // Taxable-account cost basis (average cost): deposits add to it, withdrawals take it pro rata, growth does not.
    let taxBasis = bal.taxable * (1 - clamp(BR.unrealizedGainShare, 0, 1));
    // US foreign-tax-credit carryforward vintages [{ year, amount }] (relief 'usCreditsForeignTax').
    let cfPool = [];

    // Foreign income tax on the income types the user flags. With `credit`, the US federal tax attributable to the
    // same income (pro rata by AGI) offsets it, so only the excess is paid. Roth has no US tax to offset.
    // Foreign (Mexican) income tax on the income types the user flags, and the double-tax relief between the countries.
    //  - method 'flatRate': rate × (income − exempt); 'mexicoIsr': Mexico's annual tariff in MXN (indexed), converted at the FX
    //    rate of the year, with the optional retirement-income exemption (UMA multiple) on pension-type income.
    //  - art20: TSP, FERS annuity and supplement are US-only government-service pensions (not Mexico-taxable).
    //  - Roth: 'earnings' taxes only the earnings share (1 − basis ÷ balance at the start of the year).
    //  - relief 'foreignCountryCreditsUsTax': Mexico credits the US federal tax on the same income (pro rata by AGI);
    //    'usCreditsForeignTax': Mexico taxes in full and the US credits it, limited to the US tax on that income (pro rata by AGI)
    //    using this year's Mexican tax first and then carried-forward credits (`cfAvail`); 'none': no relief.
    const mexYears = (Y) => Math.pow(1 + FT.isrIndexing, Y - C.mexico.isrYear);
    const fxOf = (Y) => SP.foreignCurrency.localPerUsd * Math.pow(1 + SP.foreignCurrency.annualDrift, Y - Y0);
    const foreignTaxCalc = (p, us, idxY, Y, cfAvail) => {
      const pension = !FT.treatyArt20; // art. 20 covers the TSP (a US government plan), never IRAs
      const rothPart = (w, share) => (FT.appliesTo.rothAmountTaxed === 'earningsShare' ? (w || 0) * (1 - (share || 0)) : (w || 0) * FT.appliesTo.rothTaxedShare);
      const byType = {
        trad: FT.appliesTo.traditionalWithdrawals && pension ? p.trad || 0 : 0,
        ira: FT.appliesTo.traditionalWithdrawals ? p.ira || 0 : 0,
        roth: FT.appliesTo.rothWithdrawals && pension ? rothPart(p.roth, p.rothBasisShare) : 0,
        rothIra: FT.appliesTo.rothWithdrawals ? rothPart(p.rothIra, p.rothIraBasisShare) : 0,
        conv: FT.appliesTo.rothConversions ? p.conv || 0 : 0,
        ss: FT.appliesTo.socialSecurity ? p.ss || 0 : 0,
        fers: FT.appliesTo.fersAnnuity && pension ? p.fers || 0 : 0,
        supp: FT.appliesTo.fersSupplement && pension ? p.supp || 0 : 0,
        gains: FT.appliesTo.brokerageGains ? p.gains || 0 : 0,
        interest: FT.appliesTo.interest ? p.interest || 0 : 0,
        earned: FT.appliesTo.earnedIncome ? p.earned || 0 : 0,
      };
      const income = Object.values(byType).reduce((a, b) => a + b, 0);
      let gross, exemptUsd = 0;
      if (FT.method === 'mexicoIsr') {
        const fx = fxOf(Y), scale = mexYears(Y);
        if (FT.retirementIncomeExemption) {
          const pensionIncome = byType.trad + byType.ira + byType.roth + byType.rothIra + byType.fers + byType.supp;
          exemptUsd = Math.min(pensionIncome, (FT.umaDailyMxn * scale * FT.umaMultiple * 365) / fx);
        }
        gross = mexicoIsr((income - exemptUsd) * fx, scale) / fx;
      } else {
        gross = Math.max(0, income - Math.max(0, FT.flatExemptAmount) * idxY) * FT.flatRate;
      }
      // US federal tax attributable to the Mexico-taxed income (its share of AGI; only the taxable part of SS counts).
      const usPart = byType.trad + byType.ira + byType.conv + (FT.appliesTo.socialSecurity ? us.taxableSS : 0) + byType.fers + byType.supp + byType.gains +
        byType.interest + (FT.appliesTo.earnedIncome ? p.earnedUS || 0 : 0);
      const usAttrib = gross > 0 && us.agi > 0 ? us.federal * Math.min(1, usPart / us.agi) : 0;
      let mxCredit = 0, usFtc = 0, limitation = 0;
      if (FT.relief === 'foreignCountryCreditsUsTax') mxCredit = Math.min(gross, usAttrib);
      else if (FT.relief === 'usCreditsForeignTax') { limitation = usAttrib; usFtc = Math.min(limitation, gross + (cfAvail || 0)); }
      return { income, gross, exemptUsd, mxCredit, usFtc, limitation, mxPaid: gross - mxCredit, byType };
    };
    let idx = 1, hcIdx = 1, prevInfl = infl;
    let inflDev = 0; // AR(1) inflation deviation from the mean
    // Adaptive rules (Monte Carlo only): compare this run's real portfolio with the deterministic plan's.
    const RU = opts.rules ? inp.monteCarlo.adaptiveRules : null;
    let guardActive = false, guardYears = 0, deferrals = 0;
    let annBase = null; // pension (after age reduction, before survivor reduction) incl. COLAs
    const magiByYear = {};
    const years = [];
    let depletionYear = null;

    for (let Y = Y0; Y <= endYear; Y++) {
      const ageY = Y - you.by;
      const ageS = sp ? Y - sp.by : null;
      const youAlive = Y <= you.deathYear;
      const spAlive = !!sp && Y <= sp.deathYear;
      if (!youAlive && !spAlive) break;
      const status = youAlive && spAlive ? 'mfj' : 'single';
      const working = youAlive && Y < retireYear;
      const scale = idxBase * idx; // CPI-indexed statutory amounts (402(g), earnings test, IRMAA)
      const taxScale = taxIdx; // federal brackets and deductions

      // Random draws: return first, then inflation, every year (keeps streams reproducible). Every account's return
      // comes from one market shock z per year, with the account's own mean and SD.
      const spec = Y < retireYear ? specPre : specPost;
      const z = rng && Object.values(spec).some(([, sd]) => sd > 0) ? normal(rng) : 0;
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
      const salary = working ? salaryIn(Y) : 0;
      const spouseEarned = spAlive && E.spouse.hasEarnings && ageS < E.spouse.stopsAtAge ? E.spouse.earnings * idx : 0;
      const postEarned = !working && youAlive && Y >= retireYear && ageY < E.afterRetiring.untilAge ? E.afterRetiring.earnings * idx : 0;

      let empTrad = 0, empRoth = 0, agency = 0, catchUp = 0, catchUpRoth = false, capped = false;
      if (working && salary > 0) {
        const lim = floorTo(C.tsp.elective402g * scale, 500);
        let emp = salary * T.contributions.rate;
        if (emp > lim) { emp = lim; capped = true; }
        const eff = emp / salary;
        let match = 0, used = 0;
        for (const [width, rate] of C.tsp.matchTiers) { match += Math.min(Math.max(eff - used, 0), width) * rate; used += width; }
        agency = salary * (C.tsp.agencyAutomatic + match);
        if (T.contributions.catchUp && ageY >= 50) {
          const base = ageY >= 60 && ageY <= 63 ? C.tsp.catchUp60to63 : C.tsp.catchUp50;
          catchUp = floorTo(base * scale, 500);
          catchUpRoth = salaryIn(Y - 1) > C.tsp.rothCatchUpWageThreshold * scale;
        }
        empTrad = emp * (1 - T.contributions.rothShare) + (catchUpRoth ? 0 : catchUp);
        empRoth = emp * T.contributions.rothShare + (catchUpRoth ? catchUp : 0);
      }
      // Roth IRA contributions while you work, paid from salary like TSP contributions (capped at the IRA limit; the
      // income limit for Roth IRA contributions is not checked).
      const iraLimit = floorTo(C.ira.limit * scale, 500) + (ageY >= 50 ? floorTo(C.ira.catchUp50 * scale, 100) : 0);
      const contribRothIra = working && IR.roth.contributionsWhileWorking > 0 ? Math.min(IR.roth.contributionsWhileWorking * idx, iraLimit) : 0;

      // FERS annuity / survivor annuity
      let pension = 0, survivorAnnuity = 0, colaApplied = 0;
      if (firstPayYear !== null && Y >= firstPayYear && (youAlive || (spAlive && survPct > 0))) {
        if (annBase === null) {
          annBase = initialAnnuity;
        } else {
          const retireeAliveLastYear = Y - 1 <= you.deathYear;
          const colaEligible = !retireeAliveLastYear || P.specialCategory || ageY - 1 >= C.fers.colaStartAge;
          if (colaEligible) {
            const diet = dietCola(prevInfl);
            colaApplied = P.colaMode === 'none' ? 0 : P.colaMode === 'reduced' ? Math.max(0, diet - P.colaReducedBy) : diet;
            annBase *= 1 + colaApplied;
          }
        }
        if (youAlive) pension = annBase * (1 - (spAlive ? survRed : 0));
        else survivorAnnuity = annBase * survPct;
      }

      // FERS supplement (no COLA; earnings test; ends at 62)
      let supplement = 0, suppReduction = 0;
      if (suppEligible && youAlive && Y >= retireYear && ageY < 62) {
        if (suppMonthly === null) {
          const idxRet = retireYear >= Y0 ? idx : Math.pow(1 + infl, retireYear - Y0);
          suppMonthly = SU.mode === 'manual' ? SU.manualMonthly : fersSupplementMonthly(ss62Today * idxRet, service);
        }
        const annual = suppMonthly * 12;
        const testApplies = !P.specialCategory || ageY >= mra;
        if (testApplies && postEarned > 0) {
          suppReduction = Math.min(annual, Math.max(0, (postEarned - C.ss.earningsTestLimit * scale) / 2));
        }
        supplement = annual - suppReduction;
      }

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
      // Share of the Roth balance that is basis, at the start of the year (withdrawals are pro rata).
      const rothBasisShare = bal.roth > 0 ? clamp(rothBasis / bal.roth, 0, 1) : 1;
      // Share of each taxable-account withdrawal that is long-term gain this year (1 − basis ÷ balance at the start of
      // the year). After a loss the basis can exceed the balance: then nothing is gain and the excess basis stays to
      // shelter later gains (losses are not deducted).
      const gainShare = bal.taxable > 0 ? clamp(1 - taxBasis / bal.taxable, 0, 1) : 0;
      // Foreign tax credits older than the carryforward period expire; the rest are available this year.
      let ftcExpired = 0;
      cfPool = cfPool.filter((v) => { if (v.year < Y - C.ftcCarryforwardYears) { ftcExpired += v.amount; return false; } return true; });
      const cfAvail = cfPool.reduce((t, v) => t + v.amount, 0);

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

      // 2) Required minimum distribution (TSP passes to the surviving spouse) ---------------------
      const owner = youAlive ? you : sp;
      const ownerAge = Y - owner.by;
      const rmdAge = rmdStartAge(owner.by);
      // TSP RMDs wait while you still work (still-working exception); IRA RMDs do not. Both use the same table.
      const rmdTsp = !working && ownerAge >= rmdAge && bal.trad > 0 ? Math.min(bal.trad, bal.trad / rmdDivisor(ownerAge)) : 0;
      const rmdIra = ownerAge >= rmdAge && bal.tradIra > 0 ? Math.min(bal.tradIra, bal.tradIra / rmdDivisor(ownerAge)) : 0;
      const rmd = rmdTsp + rmdIra;

      // Transfers between accounts of the same tax type (not taxed), at the start of the year after the RMDs. `av` is
      // what each account has left for the conversion and withdrawals.
      const av = { ...bal, trad: bal.trad - rmdTsp, tradIra: bal.tradIra - rmdIra };
      const moved = {};
      for (const m of MOVES) moved[m.key] = 0;
      const xIn = noFlows(), xOut = noFlows();
      let rothToIraBasis = 0;
      if (youAlive) {
        for (const w of transfersFor(ageY)) {
          const amt = Math.max(0, w.howMuch === 'wholeBalance' ? av[w.from] : Math.min(av[w.from], w.fixedAmount * idx));
          if (!(amt > 0)) continue;
          av[w.from] -= amt; av[w.to] += amt; xOut[w.from] += amt; xIn[w.to] += amt; moved[w.key] += amt;
          if (w.from === 'roth') rothToIraBasis += amt * rothBasisShare;
        }
      }
      const rothIraBasisShare = av.rothIra > 0 ? clamp((rothIraBasis + rothToIraBasis) / av.rothIra, 0, 1) : 1;

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
      const extraSave = working ? E.extraSavings * idx : 0;
      // While working, salary covers living costs; optionally benefits that start early are spent the same way.
      const coverBenefits = working && E.spendBenefitsThatStartBeforeRetiring;
      const benefits = pension + survivorAnnuity + supplement + ssTotal;
      const coveredIncome = coverBenefits ? benefits : 0;
      const cashIn = (working ? 0 : spouseEarned + postEarned) + benefits - coveredIncome + oneIn + rmd + extraSave + interest;

      // 3–6) Roth conversion, taxes, spending, withdrawals — solved as a fixed point -------------
      const nOver65 = (youAlive && ageY >= 65 ? 1 : 0) + (spAlive && ageS >= 65 ? 1 : 0);
      const taxCtx = {
        status, year: Y, nOver65, scale: taxScale, ss: ssTotal, interest, mode: TX.mode, simpleMfj: TX.simpleRateJoint,
        simpleSingle: TX.simpleRateSingle, stateRate: TX.stateRate, seniorDeduction: TX.seniorDeduction,
      };
      const taxOf = (ordinary, ltcg) => computeTaxes({ ...taxCtx, ordinary, ltcg }); // US only
      const wages = salary - empTrad + (working ? spouseEarned : 0);
      const ordinaryFixed = wages + (working ? 0 : spouseEarned) + postEarned + pension + survivorAnnuity + supplement + rmd + oneOrd + interest;
      const ftActive = FT.enabled && Y >= FT.residentFromYear;
      const earnedAll = salary + spouseEarned + postEarned;
      const earnedUS = salary - empTrad + spouseEarned + postEarned;
      const noForeign = { usTotal: 0, foreign: 0, foreignGross: 0, foreignCredit: 0, foreignIncome: 0, foreignByType: null, usFtc: 0, ftcLimit: 0, foreignExempt: 0 };
      // US + foreign tax for a candidate set of withdrawals `w` (by account, beyond the RMDs) and conversion. Traditional
      // IRA withdrawals before 59½ add the 10% early-withdrawal penalty (not an income tax: outside the foreign relief).
      const earlyIra = ownerAge < 60;
      const taxFull = (w, conv, noOneTime) => {
        const ltcg = gainShare * w.taxable + (noOneTime ? 0 : oneLtcg);
        const us = taxOf(ordinaryFixed - (noOneTime ? oneOrd : 0) + w.trad + w.tradIra + conv, ltcg);
        const pen = earlyIra ? C.ira.earlyPenaltyRate * w.tradIra : 0;
        if (!ftActive) {
          return Object.assign(us, noForeign, { usTotal: us.total + pen, usFederalBefore: us.federal, earlyPenalty: pen, federal: us.federal + pen, total: us.total + pen });
        }
        const ft = foreignTaxCalc({ trad: rmdTsp + w.trad, ira: rmdIra + w.tradIra, roth: w.roth, rothBasisShare, rothIra: w.rothIra, rothIraBasisShare,
          conv, ss: ssTotal, fers: pension + survivorAnnuity, supp: supplement, gains: ltcg, interest, earned: earnedAll, earnedUS }, us, idx, Y, cfAvail);
        return Object.assign(us, { usFederalBefore: us.federal, earlyPenalty: pen, federal: us.federal - ft.usFtc + pen, usTotal: us.total - ft.usFtc + pen,
          usFtc: ft.usFtc, ftcLimit: ft.limitation, foreign: ft.mxPaid, foreignGross: ft.gross, foreignCredit: ft.mxCredit, foreignExempt: ft.exemptUsd,
          foreignIncome: ft.income, foreignByType: ft.byType, total: us.total - ft.usFtc + ft.mxPaid + pen });
      };
      // Tax on the income that pays for living costs while working (wages, plus early benefits if they are spent too).
      let wageTax = 0;
      if (working) {
        const annuity = coverBenefits ? pension + survivorAnnuity + supplement : 0;
        const ss = coverBenefits ? ssTotal : 0;
        const us = computeTaxes({ ...taxCtx, ss, ordinary: wages + annuity, ltcg: 0, interest: 0 });
        if (ftActive) {
          const ft = foreignTaxCalc({ earned: salary + spouseEarned, earnedUS: wages, ss,
            fers: coverBenefits ? pension + survivorAnnuity : 0, supp: coverBenefits ? supplement : 0 }, us, idx, Y, cfAvail);
          wageTax = us.total - ft.usFtc + ft.mxPaid;
        } else wageTax = us.total;
      }
      const convWin = youAlive ? conversionFor(ageY) : null;
      const convActive = !!convWin;
      const convFrom = convActive ? convWin.from : 'trad', convTo = convActive ? convWin.to : 'roth';
      const convTop = convActive && convWin.howMuch === 'fillBracket' ? bracketTop(convWin.fillToTopOfBracket, status, taxScale) : 0;

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
          const base = ordinaryFixed + cAl.trad + cAl.tradIra, ltcg = gainShare * (out.taxable + cAl.taxable) + oneLtcg;
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
      // Foreign tax credit bookkeeping: this year's Mexican tax is used first, then the oldest carryforwards; any
      // unused Mexican tax becomes a new carryforward vintage.
      let ftcFromCarry = 0;
      if (ftActive && FT.relief === 'usCreditsForeignTax') {
        const fromCurrent = Math.min(tx.foreignGross, tx.usFtc);
        let need = tx.usFtc - fromCurrent;
        for (const v of cfPool) { const take = Math.min(v.amount, need); v.amount -= take; need -= take; ftcFromCarry += take; }
        const excess = tx.foreignGross - fromCurrent;
        if (excess > 0.005) cfPool.push({ year: Y, amount: excess });
        cfPool = cfPool.filter((v) => v.amount > 0.005);
      }
      // Roth basis: withdrawals and transfers take basis pro rata; contributions and conversions add to it.
      const rothBasisOut = W.roth * rothBasisShare;
      rothBasis = Math.max(0, rothBasis - rothBasisOut - rothToIraBasis) + empRoth + (convTo === 'roth' ? conv : 0);
      const rothIraBasisOut = W.rothIra * rothIraBasisShare;
      const rothIraIn = rothToIraBasis + contribRothIra + (convTo === 'rothIra' ? conv : 0);
      rothIraBasis = Math.max(0, rothIraBasis - rothIraBasisOut) + rothIraIn;
      // US ordering rules: Roth IRA withdrawals come from contributions and conversions first; earnings withdrawn before
      // 59½ would be taxed and penalized (flagged in a warning, not added).
      const rothIraEarlyEarnings = ownerAge < 60 ? Math.max(0, W.rothIra - (rothIraUsBasis + rothIraIn)) : 0;
      rothIraUsBasis = Math.max(0, rothIraUsBasis + rothIraIn - W.rothIra);
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
      for (const k of ACCOUNTS) flows[k] = { contrib: 0, deposit: 0, convIn: 0, convOut: 0, xferIn: xIn[k], xferOut: xOut[k], withdraw: W[k] };
      flows.cash.deposit = toCash; flows.cash.xferIn += chkOut; flows.cash.xferOut += sweep + chkIn;
      flows.taxable.deposit = toTaxable; flows.taxable.xferIn += sweep;
      flows.trad.contrib = empTrad + agency; flows.trad.withdraw += rmdTsp;
      flows.roth.contrib = empRoth;
      flows.tradIra.withdraw += rmdIra;
      flows.rothIra.contrib = contribRothIra;
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
      const growth = INVESTED.reduce((t, k) => t + growthBy[k], 0);
      const rEff = investedPre > 0 ? growth / investedPre : f * g + (1 - f) * r;
      const endTotal = total(bal);
      const grossW = wSum + rmd;
      const netW = Math.max(0, grossW - deposit);

      magiByYear[Y] = { magi: tx.magi, status };

      // Keep this row under 128 properties: V8 builds larger object literals in slow dictionary mode, which makes
      // Monte Carlo roughly 1.7× slower. Group related new fields into a nested object (like `bracket`, `flows`).
      years.push({
        year: Y, ageYou: youAlive ? ageY : null, ageSpouse: spAlive ? ageS : null, youAlive, spAlive, idxEnd: idx * (1 + yrInfl),
        phase: working ? 'Working' : survivorMode ? 'Survivor' : 'Retired', status, idx, inflation: yrInfl,
        returnRate: rEff, marketReturn: r, returnTsp: rByAcct.trad, returnTaxable: rByAcct.taxable,
        bucketStart, bucketDraw, bucketHeld, bucket: bucketEnd,
        salary, step: working && stepStart ? stepIn(Y) : null, spouseEarned, postEarned, earned: salary + spouseEarned + postEarned,
        contribEmpTrad: empTrad, contribEmpRoth: empRoth, contribAgency: agency, catchUp, catchUpRoth, capped402g: capped,
        pension, survivorAnnuity, colaApplied, supplement, suppReduction,
        ssYou, ssSpouse, ssYouSurvivor: ssY.survivor, ssSpouseSurvivor: ssS.survivor,
        ssYouSpousal: ssY.spousal, ssSpouseSpousal: ssS.spousal, ssPayable: ssPay,
        oneTimeIn: oneIn, oneTimeOut: oneOut, events: eventLabels,
        rmd, wTrad: W.trad, wRoth: W.roth, wTaxable: W.taxable, wCash: W.cash, cashInterest, tradTotal: rmdTsp + W.trad, conversion: conv,
        spendBase: baseSpend, phaseMult, fehb, partB, irmaaTier, irmaaCost, spending: otherOut,
        taxableSS: tx.taxableSS, agi: tx.agi, deduction: tx.deduction, ordTaxable: tx.ordTaxable, gainsTaxable: tx.gainsTaxable,
        taxableIncome: tx.taxableIncome, bracket: tx.bracket,
        federalTax: tx.federal, usFederalBefore: tx.usFederalBefore, usFtc: tx.usFtc, ftcLimit: tx.ftcLimit, ftcFromCarry, ftcExpired,
        ftcCarryforward: cfPool.reduce((t, v) => t + v.amount, 0), foreignExempt: tx.foreignExempt,
        // End-of-year cost basis, and the earnings / gain part of this year's withdrawals.
        basis: { roth: rothBasis, rothEarnings: W.roth - rothBasisOut, rothIra: rothIraBasis, rothIraEarnings: W.rothIra - rothIraBasisOut,
          taxable: taxBasis, taxableGain: taxGain },
        // Traditional and Roth IRA: balances, RMD, withdrawals beyond it, growth, return, early-withdrawal penalty,
        // contributions, and Roth IRA earnings withdrawn before 59½ (US ordering rules).
        ira: {
          trad: { start: startBal.tradIra, bal: bal.tradIra, rmd: rmdIra, withdraw: W.tradIra, growth: growthBy.tradIra, ret: rByAcct.tradIra, penalty: tx.earlyPenalty },
          roth: { start: startBal.rothIra, bal: bal.rothIra, withdraw: W.rothIra, growth: growthBy.rothIra, ret: rByAcct.rothIra, contrib: contribRothIra,
            earlyEarnings: rothIraEarlyEarnings },
        },
        // Conversions and transfers this year by move (MOVES keys, e.g. tradToRothIra); `conversion` is the taxable total.
        moves: moved,
        ordinaryIncome: ordinaryFixed + W.trad + conv, ltcgIncome: taxGain + oneLtcg, nOver65, taxScale,
        stateTax: tx.state, usTax: tx.usTotal, foreignTax: tx.foreign, foreignTaxGross: tx.foreignGross,
        foreignCredit: tx.foreignCredit, foreignIncome: tx.foreignIncome, foreignByType: tx.foreignByType,
        totalTax: tx.total, wageTax, portfolioTax, conversionTax: convTax, marginal: tx.marginal,
        deposit, depositCash: toCash, depositTaxable: toTaxable, sweep, shortfall, cashIn, extraSavings: extraSave, coveredIncome,
        startCash: startBal.cash, startTaxable: startBal.taxable, startTrad: startBal.trad, startRoth: startBal.roth, startTotal,
        growthTaxable: growthBy.taxable, growthTrad: growthBy.trad, growthRoth: growthBy.roth,
        growth,
        balCash: bal.cash, balTaxable: bal.taxable, balTrad: bal.trad, balRoth: bal.roth, total: endTotal,
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
      stepIncreases: stepStart ? stepStart.map((year, step) => ({ step, year })).filter((x) => x.year > Y0 && x.year < retireYear) : [],
      payCapFromYear, // first working year held at the GS pay cap (null if never)
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
      lifetimeStateTax: sum((r) => r.stateTax),
      lifetimeForeignTax: sum((r) => r.foreignTax),
      lifetimeIrmaa: sum((r) => r.irmaaCost),
      lifetimeUsFtc: sum((r) => r.usFtc),
      ftcExpiredTotal: sum((r) => r.ftcExpired),
      ftcCarryforwardEnd: last ? last.ftcCarryforward : 0,
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
      lifetimeForeignTaxGross: sum((r) => r.foreignTaxGross),
      maxCash: years.reduce((m, r) => Math.max(m, r.balCash), 0),
      bridgeStartYear: retireYear, bridgeEndYear: bridgeEnd, bridgeTspUsed: bridgeTsp, bridgePortfolioUsed: bridgePortfolio,
      totalShortfall: sum((r) => r.shortfall),
      totalConversions: sum((r) => r.conversion),
      firstDeathYear, lastDeathYear, youDeathYear: you.deathYear, spouseDeathYear: sp ? sp.deathYear : null,
      people: {
        you: { birthYear: you.by, fraMonths: you.fra, claimAge: you.claimAge, claimYear: Math.floor(you.claimTime), factor: you.factor, pia: you.pia, rmdStartAge: rmdStartAge(you.by) },
        spouse: sp ? { birthYear: sp.by, fraMonths: sp.fra, claimAge: sp.claimAge, claimYear: Math.floor(sp.claimTime), factor: sp.factor, pia: sp.pia, rmdStartAge: rmdStartAge(sp.by) } : null,
      },
      fers: {
        mra, mraYear: you.by + Math.ceil(mra - 1e-9), retirementType: rt.type, rule: rt.rule, supplementEligible: suppEligible,
        service, compService, high3, high3Auto, highN, colaMode: P.colaMode, colaReduction: P.colaReducedBy, multiplier, specialFormula,
        basicAnnuity, ageReduction, pensionStartAge, pensionStartYear, election,
        survivorReduction: survRed, survivorPct: survPct, initialAnnuity,
        initialMonthlyToRetiree: initialAnnuity * (1 - survRed) / 12,
        supplementMonthly: suppMonthly !== null ? suppMonthly : (suppEligible ? suppAnnualDet / 12 : 0),
        supplementEndYear: suppEligible ? you.by + 62 : null,
        ss62Today, supplementYears: fersSupplementYears(service),
      },
      bucket: bucketPlan ? {
        fundYear: Math.max(bucketPlan.fundYear, Y0), retireYear: bucketPlan.retireYear, endYear: bucketPlan.endYear, rate: bucketPlan.g,
        sizeAtFund: bucketPV(bucketPlan, Math.max(bucketPlan.fundYear, Y0)),
        plannedDraws: Object.values(bucketPlan.draws).reduce((a, b) => a + b, 0),
        drawn: years.reduce((t, r) => t + r.bucketDraw, 0),
      } : null,
    };

    const out = { inputs: inp, years, summary };
    if (!opts.lite) {
      out.warnings = buildWarnings(inp, out, { you, sp, rt, retireYear, mra, service, pensionStartAge, election, suppEligible });
      out.milestones = buildMilestones(inp, out, { you, sp, retireYear, mra, suppEligible, pensionStartYear });
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
    const { you, sp, rt, retireYear, service, pensionStartAge, election } = ctx;
    const S = res.summary, years = res.years, F = S.fers;
    const E = inp.employment, P = inp.fersPension, SP = inp.spending;

    if (rt.type === 'none') {
      add('danger', 'notVested', `With ${service} years of service you are not vested (5 years required): no FERS annuity, no supplement, no FEHB in retirement.`);
    } else if (rt.type === 'deferred') {
      add('danger', 'deferred', `Separating at ${E.retirementAge} with ${service} years is a deferred retirement (before your MRA of ${fmtAgeYM(ctx.mra)}). The annuity starts at age ${pensionStartAge}` +
        `${F.ageReduction > 0 ? ` reduced ${pctTxt(F.ageReduction)}` : ''}; there is no FERS supplement, and you cannot carry FEHB into retirement.`);
    } else if (rt.type === 'mra10') {
      if (F.ageReduction > 0) {
        add('warn', 'mra10', `MRA+10 retirement at ${E.retirementAge}: the annuity is permanently reduced ${pctTxt(F.ageReduction)} (5% for each year under 62 when it starts at ${pensionStartAge}) and there is no FERS supplement.` +
          ` Postponing the start to ${service >= 20 ? 60 : 62} removes the reduction (FEHB is suspended until the annuity starts).`);
      } else {
        add('warn', 'mra10', `MRA+10 retirement at ${E.retirementAge} with the annuity postponed to ${pensionStartAge}: no age reduction, but no FERS supplement, and FEHB is suspended until the annuity begins in ${F.pensionStartYear}.`);
      }
    }
    if (S.payCapFromYear !== null) {
      const capYear = years.find((r) => r.year === S.payCapFromYear);
      add('info', 'payCap', `${S.payCapFromYear === S.startYear ? 'Your salary is above this year’s' : `From ${S.payCapFromYear} your pay reaches the`} GS pay cap ` +
        `(Executive Schedule level IV, ${usd(E.gsPayCap)} in ${S.startYear}, growing with your raise), so it is held there${capYear && S.payCapFromYear > S.startYear ? ` (${usd(capYear.salary)} in ${capYear.year})` : ''}. ` +
        'Step increases add nothing above the cap, and the High-3 uses the capped pay.');
    }
    if (inp.fersSupplement.mode === 'off' && rt.supplementEligible) {
      add('info', 'suppOff', 'FERS supplement turned off ("eliminated by Congress" scenario).');
    }
    const suppRed = years.filter((r) => r.suppReduction > 0);
    if (suppRed.length) {
      const tot = suppRed.reduce((s, r) => s + r.suppReduction, 0);
      add('warn', 'suppEarnings', `Supplement earnings test: post-retirement earnings exceed the annual limit (${usd(CONSTANTS.ss.earningsTestLimit)} in 2026, indexed), cutting the supplement by ${usd(tot)} over ${suppRed.length} year(s) ($1 for every $2 over the limit).`);
    }
    if (rt.type !== 'none' && rt.type !== 'deferred' && P.fehbYearsBeforeRetirement < CONSTANTS.fers.fehbYearsRequired) {
      add('danger', 'fehb5', `Only ${P.fehbYearsBeforeRetirement} year(s) of FEHB enrollment before retirement: you need 5 continuous years immediately before retiring to keep FEHB.`);
    }
    // Part B special enrollment period
    const people = [['You', you]];
    if (sp) people.push(['Your spouse', sp]);
    for (const [who, p] of people) {
      const y65 = p.by + 65;
      if (y65 < retireYear && y65 <= p.deathYear && y65 >= S.startYear - 1 && y65 <= you.deathYear) {
        add('warn', 'partBSep', `${who} turn${who === 'You' ? '' : 's'} 65 in ${y65} while covered by active-employee FEHB. Delaying Part B is fine then, but the Part B Special Enrollment Period ends 8 months after your employment ends (around ${retireYear}); enrolling later means a permanent 10%-per-year premium penalty.`);
      }
    }
    if (sp && election === 'none' && P.survivorElection === 'none' && rt.type !== 'none') {
      add('danger', 'noSurvivor', 'Survivor election is "none": if you die first your spouse gets no FERS survivor annuity and loses FEHB coverage (FEHB continuation requires a survivor annuity).');
    }
    // Rule of 55 / early-withdrawal penalty
    const sepAgeOk = E.retirementAge >= (P.specialCategory ? 50 : 55);
    const early = years.filter((r) => r.ageYou !== null && r.ageYou < 59.5 && r.ageYou >= 0 && (r.tradTotal + r.wRoth) > 1 && r.phase !== 'Working');
    if (early.length && !sepAgeOk) {
      add('warn', 'earlyPenalty', `TSP withdrawals before 59½ (first in ${early[0].year}) after separating before age ${P.specialCategory ? 50 : 55} usually incur a 10% early-withdrawal penalty, which this model does not add.`);
    }
    // Traditional IRA withdrawals before 59½: the 10% penalty is added (the TSP's separation-at-55 exception does not apply
    // to IRAs). Roth IRA earnings before 59½ are flagged only. Moves out of the TSP while still working need 59½.
    const pen = years.filter((r) => r.ira.trad.penalty > 0.5);
    if (pen.length) {
      add('warn', 'iraPenalty', `Traditional IRA withdrawals before 59½ (${pen[0].year}${pen.length > 1 ? `–${pen[pen.length - 1].year}` : ''}) include ${usd(pen.reduce((t, r) => t + r.ira.trad.penalty, 0))} of 10% early-withdrawal penalty. ` +
        (sepAgeOk ? 'Money left in the TSP can be withdrawn without it, because you separate at 55 or later; IRAs have no such exception.' : 'Consider spending other accounts first until 59½.'));
    }
    const rothEarly = years.filter((r) => r.ira.roth.earlyEarnings > 0.5);
    if (rothEarly.length) {
      add('warn', 'rothIraEarly', `Roth IRA withdrawals before 59½ (first in ${rothEarly[0].year}) exceed your contributions and conversions by ${usd(rothEarly.reduce((t, r) => t + r.ira.roth.earlyEarnings, 0))}. ` +
        'Those earnings are taxable and get the 10% penalty, which the model does not add.');
    }
    const outOfTsp = years.filter((r) => r.phase === 'Working' && r.ageYou < 60 && r.moves.traditionalTspToRothIra + r.moves.rothTspToRothIra + r.moves.traditionalTspToTraditionalIra > 0.5);
    if (outOfTsp.length) {
      add('warn', 'tspRollWorking', `Money moves from the TSP to an IRA in ${outOfTsp[0].year}, while you still work and are under 59½. The TSP allows that only after you separate (or from 59½); an in-plan conversion to Roth TSP is allowed any time.`);
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
        stateRate: TXi.stateRate, seniorDeduction: TXi.seniorDeduction }).marginal;
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
          `${usd(irmaaHit.irmaaCost)} extra Part B premium that year and ${usd(cost)} over ${yrs} year(s) (nominal).`);
      }
    }
    const irmaaAny = years.find((r) => r.irmaaTier > 0 && r.partB > 0);
    if (irmaaAny && !W.some((w) => w.code === 'rmdIrmaa')) {
      const yrs = years.filter((r) => r.irmaaCost > 0.5).length;
      add('warn', 'irmaa', `Income crosses a Medicare IRMAA tier: Part B surcharges start in ${irmaaAny.year} (tier ${irmaaAny.irmaaTier}, ${usd(irmaaAny.irmaaCost)} extra that year) ` +
        `and total ${usd(S.lifetimeIrmaa)} over ${yrs} year(s) (nominal).`);
    }
    if (S.depletionYear !== null) {
      add('danger', 'depleted', `Portfolio is depleted in ${S.depletionYear} (your age ${S.depletionAge}). Unfunded spending through the plan end totals ${usd(S.totalShortfall)} (nominal).`);
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
      if (E.spendBenefitsThatStartBeforeRetiring) {
        add('info', 'incomeWhileWorking', `${lead} It is assumed to be spent on living costs along with your salary, so it is not saved ` +
          `(${usd(ww.reduce((t, r) => t + r.coveredIncome, 0))} over ${ww.length} year(s); turn off “Spend benefits that start before you retire” to save it instead).`);
      } else {
        const saved = ww.reduce((t, r) => t + r.deposit, 0);
        add('info', 'incomeWhileWorking', `${lead} Salary is assumed to cover living costs before retirement, so this income is saved rather than spent: ${usd(saved)} over ${ww.length} year(s), ` +
          `${inp.checkingAndMoneyMarket.moneyMarket.keepSurplus ? 'kept in the money market up to the limit and invested in brokerage investments above it' : 'invested in brokerage investments'}.`);
      }
    }

    // Foreign income tax
    const FT = inp.foreignTax;
    if (FT.enabled) {
      const ftRows = years.filter((r) => r.foreignTax > 0.5);
      const country = FT.country || 'Foreign';
      const how = FT.method === 'mexicoIsr' ? `Mexico's progressive ISR tariff (2026, indexed ${pctTxt(FT.isrIndexing)}/yr)` : `a flat ${pctTxt(FT.flatRate)}`;
      const relief = { usCreditsForeignTax: 'the US credits it against US tax on the same income', foreignCountryCreditsUsTax: `${country} credits the US tax on the same income`, none: 'no double-tax relief' }[FT.relief];
      if (ftRows.length) {
        add('info', 'foreignTax', `${country} income tax: ${usd(S.lifetimeForeignTax)} paid over ${ftRows.length} year(s) from ${FT.residentFromYear}, using ${how}; ${relief}` +
          (FT.relief === 'usCreditsForeignTax' ? ` (${usd(S.lifetimeUsFtc)} of US tax credited).` : FT.relief === 'foreignCountryCreditsUsTax' ? ` (${usd(S.lifetimeForeignTaxGross)} before that credit).` : '.'));
      } else {
        add('info', 'foreignTaxNone', `${country} tax is on from ${FT.residentFromYear}, but none is owed with the selected income types${FT.relief === 'foreignCountryCreditsUsTax' ? ' after the credit for US tax' : ''}.`);
      }
      if (FT.relief === 'usCreditsForeignTax' && S.ftcExpiredTotal > 0.5) {
        add('warn', 'ftcExpired', `${usd(S.ftcExpiredTotal)} of ${country} tax credits expire unused after the 10-year carryforward: ${country}'s tax on that income exceeds the US tax on it, ` +
          `so the excess is a real extra cost.${S.ftcCarryforwardEnd > 0.5 ? ` ${usd(S.ftcCarryforwardEnd)} is still being carried forward at the end of the plan.` : ''}`);
      }
      const rothIncome = years.reduce((t, r) => t + (r.foreignByType ? r.foreignByType.roth : 0), 0);
      if (FT.appliesTo.rothWithdrawals && !FT.treatyArt20 && rothIncome > 0.5) {
        add('warn', 'foreignRoth', `${usd(rothIncome)} of Roth withdrawals ${FT.appliesTo.rothAmountTaxed === 'earningsShare' ? '(the earnings share, after your contributions and conversions)' : ''} is treated as ${country} taxable income. ` +
          'There is no US tax on qualified Roth money to credit, so under these settings that money is not tax-free while you live abroad.');
      }
      const convForeign = years.filter((r) => r.foreignByType && r.foreignByType.conv > 0.5);
      if (FT.appliesTo.rothConversions && convForeign.length) {
        add('warn', 'foreignConversion', `Roth conversions in ${convForeign[0].year}–${convForeign[convForeign.length - 1].year} are counted as ${country} income as well as US income` +
          `${FT.relief === 'none' ? ' with no relief, so they are taxed twice' : '; double-tax relief applies, so the higher of the two taxes is roughly what you pay'}.`);
      }
      if (FT.treatyArt20) {
        add('info', 'art20', 'Treaty art. 20 toggle is on: TSP (traditional and Roth), the FERS annuity and the supplement are treated as US government-service pensions taxable only by the US. This is the optimistic bookend.');
      }
      if (/mex/i.test(country) && (FT.appliesTo.socialSecurity || ((FT.appliesTo.fersAnnuity || FT.appliesTo.fersSupplement) && !FT.treatyArt20))) {
        add('info', 'treaty', 'Under the US–Mexico treaty, Social Security paid by the US is taxable only by the US (art. 19), and US government pensions paid to a US citizen ' +
          'are taxable only by the US (art. 20). Flagging them as Mexico-taxable is a conservative stress test. Confirm with a cross-border tax professional.');
      }
    }
    const badCheck = years.filter((r) => Math.abs(r.cashCheck) > 5);
    if (badCheck.length) {
      add('danger', 'cashCheck', `Cash-flow check fails in ${badCheck.length} year(s) (first ${badCheck[0].year}: off by ${usd(badCheck[0].cashCheck)}). This is a model bug; please report it with this scenario.`);
    }
    if (you.deathYear < retireYear) {
      add('info', 'deathBeforeRetire', 'Your assumed lifespan ends before retirement; death-in-service benefits are not modeled.');
    }
    if (years.some((r) => r.capped402g)) {
      add('info', 'cap402g', `Your employee contribution is capped at the 402(g) limit (${usd(CONSTANTS.tsp.elective402g)} in 2026, indexed) in some years.`);
    }
    if (years.some((r) => r.catchUpRoth)) {
      add('info', 'rothCatchUp', 'Catch-up contributions must go to Roth TSP because prior-year wages exceed the SECURE 2.0 threshold ($150,000 in 2026, indexed).');
    }
    return W;
  }

  function fmtAgeYM(years) {
    const m = Math.round(years * 12);
    const y = Math.floor(m / 12), mm = m % 12;
    return mm ? `${y}y ${mm}m` : `${y}`;
  }

  function buildMilestones(inp, res, ctx) {
    const { you, sp, retireYear, mra, suppEligible, pensionStartYear } = ctx;
    const S = res.summary;
    const M = [];
    const add = (year, key, label, detail, who) => { if (year >= S.startYear && year <= S.endYear) M.push({ year, key, label, detail, who: who || 'you' }); };
    add(retireYear, 'retire', 'Retire', `You retire at ${inp.employment.retirementAge} (${S.fers.rule}).`);
    if (pensionStartYear !== null && pensionStartYear !== retireYear) add(pensionStartYear, 'pension', 'Annuity starts', `FERS annuity begins at ${S.fers.pensionStartAge}.`);
    add(you.by + Math.ceil(mra - 1e-9), 'mra', 'MRA', `Your FERS minimum retirement age is ${fmtAgeYM(mra)}.`);
    if (suppEligible) add(you.by + 62, 'suppEnd', 'Supplement ends', 'The FERS supplement stops at 62.');
    add(Math.floor(you.claimTime), 'ssYou', 'Your SS', `You claim Social Security at ${fmtAgeYM(you.claimAge)} (${pctTxt(you.factor)} of PIA).`);
    if (sp) add(Math.floor(sp.claimTime), 'ssSpouse', 'Spouse SS', `Spouse claims Social Security at ${fmtAgeYM(sp.claimAge)} (${pctTxt(sp.factor)} of PIA).`, 'spouse');
    if (you.by + 65 <= you.deathYear) add(you.by + 65, 'medYou', 'Medicare (you)', 'You turn 65: Medicare eligibility.');
    if (sp && sp.by + 65 <= sp.deathYear) add(sp.by + 65, 'medSpouse', 'Medicare (spouse)', 'Spouse turns 65: Medicare eligibility.', 'spouse');
    add(S.rmdStartYear, 'rmd', 'RMDs begin', `Required minimum distributions start at age ${S.rmdStartAge}.`);
    for (const w of inp.taxes.conversionsAndTransfers) {
      const a = you.by + w.fromAge, b = you.by + w.throughAge, mv = findMove(w);
      if (mv && b >= S.startYear && a <= S.endYear) {
        const conv = isConversion(w);
        const how = w.howMuch === 'fillBracket' && conv ? `fill the ${pctTxt(w.fillToTopOfBracket)} bracket` : w.howMuch === 'wholeBalance' ? 'the whole balance' : `${usd(w.fixedAmount)}/yr (today's $)`;
        M.push({ year: Math.max(a, S.startYear), endYear: Math.min(b, S.endYear), key: 'roth', label: conv ? 'Roth conversions' : 'Transfer',
          detail: `${mv.label} at ages ${w.fromAge}–${w.throughAge}: ${how}.`, who: 'you', range: true });
      }
    }
    if (inp.foreignTax.enabled) add(inp.foreignTax.residentFromYear, 'foreign', 'Foreign tax residency', `${inp.foreignTax.country || 'Foreign'} tax applies from ${inp.foreignTax.residentFromYear}.`);
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
          lifetimeFederalTax: S.lifetimeFederalTax, lifetimeForeignTax: S.lifetimeForeignTax, depletionYear: S.depletionYear,
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

  // Earliest retirement age whose Monte Carlo success meets `target`. Each candidate age adjusts service at
  // separation (service − (planned age − candidate age)), so FERS eligibility, the annuity and the supplement follow.
  function solveEarliestRetirement(raw, opts) {
    const inp = normalizeInputs(raw), o = toolOpts(inp, opts);
    const planned = inp.employment.retirementAge, cur = inp.household.currentYear - inp.household.you.birthYear;
    const from = Math.max(cur, planned - 10), to = Math.max(planned, Math.min(75, (opts && opts.maxAge) || planned + 8));
    const rows = [];
    for (let a = from; a <= to; a++) {
      const c = cloneInputs(inp);
      c.employment.retirementAge = a;
      c.fersPension.serviceYears = Math.max(0, inp.fersPension.serviceYears - (planned - a));
      const r = evaluatePlan(c, o), S = simulate(c, { lite: true }).summary;
      rows.push({ age: a, year: inp.household.you.birthYear + a, service: c.fersPension.serviceYears, rule: S.fers.rule, retirementType: S.fers.retirementType,
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
    const retire = inp.employment.retirementAge, youClaim = inp.socialSecurity.you.claimAge, rmdAge = rmdStartAge(H.you.birthYear);
    const ends = [retire, retire + 2, youClaim - 1, rmdAge - 1];
    if (inp.foreignTax.enabled && inp.foreignTax.residentFromYear - 1 - H.you.birthYear >= retire) ends.push(inp.foreignTax.residentFromYear - 1 - H.you.birthYear);
    if (opts.roth !== false) {
      // Candidates replace the plan's conversions and keep its transfers; conversions go where the plan's first one goes.
      const keep = (inp.taxes.conversionsAndTransfers || []).filter((w) => !isConversion(w));
      const first = (inp.taxes.conversionsAndTransfers || []).find(isConversion);
      const from = first ? first.fromAccount : 'traditionalTsp', to = first ? first.toAccount : 'rothTsp';
      rothCands.push({ windows: keep, label: 'No conversions' });
      for (const br of [0.12, 0.22, 0.24, 0.32]) {
        for (const e of [...new Set(ends.filter((x) => x >= retire))].sort((x, y) => x - y)) {
          rothCands.push({ windows: [...keep, { ...MOVE_DEFAULT, fromAccount: from, toAccount: to, fromAge: retire, throughAge: e, howMuch: 'fillBracket', fillToTopOfBracket: br }], label: `Fill ${Math.round(br * 100)}% at ages ${retire}–${e}` });
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
    const T = inp.tsp, MC = inp.monteCarlo, FT = inp.foreignTax;
    const pt = (x) => `${Math.round(x * 1000) / 10}%`.replace('-', '−');
    const mod = (f) => (c) => { f(c); return c; };
    // Every account's return before or after retirement, and every volatility, move together.
    const shiftPost = (d) => mod((c) => { c.tsp.returns.afterRetirement += d; c.brokerage.returns.afterRetirement += d; c.iras.traditional.returns.afterRetirement += d; c.iras.roth.returns.afterRetirement += d; });
    const shiftPre = (d) => mod((c) => { c.tsp.returns.beforeRetirement += d; c.brokerage.returns.beforeRetirement += d; c.iras.traditional.returns.beforeRetirement += d; c.iras.roth.returns.beforeRetirement += d; });
    const shiftVol = (d) => mod((c) => {
      for (const when of Object.values(c.monteCarlo.volatility)) for (const k of Object.keys(when)) when[k] = Math.max(0, when[k] + d);
    });
    const retireShift = (d) => mod((c) => { c.employment.retirementAge += d; c.fersPension.serviceYears = Math.max(0, c.fersPension.serviceYears + d); });
    const vars = [
      { key: 'returnPost', label: 'Return after retirement', lo: shiftPost(-0.01), hi: shiftPost(0.01), loText: '−1 pt', hiText: '+1 pt' },
      { key: 'returnPre', label: 'Return before retirement', lo: shiftPre(-0.01), hi: shiftPre(0.01), loText: '−1 pt', hiText: '+1 pt' },
      { key: 'vol', label: 'Return volatility', lo: shiftVol(-0.03), hi: shiftVol(0.03), loText: '−3 pts', hiText: '+3 pts' },
      { key: 'inflation', label: 'Inflation (healthcare moves with it)', lo: mod((c) => { c.inflation.rate -= 0.01; c.spending.healthcare.inflation -= 0.01; }), hi: mod((c) => { c.inflation.rate += 0.01; c.spending.healthcare.inflation += 0.01; }), loText: pt(inp.inflation.rate - 0.01), hiText: pt(inp.inflation.rate + 0.01) },
      { key: 'health', label: 'Healthcare inflation', lo: mod((c) => { c.spending.healthcare.inflation -= 0.01; }), hi: mod((c) => { c.spending.healthcare.inflation += 0.01; }), loText: '−1 pt', hiText: '+1 pt' },
      { key: 'spending', label: 'Base spending', lo: mod((c) => { c.spending.baseMonthly *= 0.9; c.spending.foreignCurrency.baseMonthly *= 0.9; }), hi: mod((c) => { c.spending.baseMonthly *= 1.1; c.spending.foreignCurrency.baseMonthly *= 1.1; }), loText: '−10%', hiText: '+10%' },
      { key: 'retire', label: 'Retirement age (service adjusted)', lo: retireShift(-1), hi: retireShift(1), loText: '1 year earlier', hiText: '1 year later' },
      { key: 'ss', label: 'Social Security paid', lo: mod((c) => { c.socialSecurity.trustFundShortfall.benefitsPaidShare = Math.min(c.socialSecurity.trustFundShortfall.benefitsPaidShare, 0.78); c.socialSecurity.trustFundShortfall.fromYear = Math.min(c.socialSecurity.trustFundShortfall.fromYear, 2033); }), hi: mod((c) => { c.socialSecurity.trustFundShortfall.benefitsPaidShare = 1; }), loText: '78% from 2033', hiText: '100%' },
      { key: 'cola', label: 'FERS COLA', lo: mod((c) => { c.fersPension.colaMode = 'none'; }), hi: mod((c) => { c.fersPension.colaMode = 'diet'; }), loText: 'none', hiText: 'current law' },
    ];
    if (o.mode === 'fixed') vars.push({ key: 'life', label: 'Lifespans', lo: mod((c) => { c.household.you.lifespan -= 5; c.household.spouse.lifespan -= 5; }), hi: mod((c) => { c.household.you.lifespan += 5; c.household.spouse.lifespan += 5; c.household.planToAge += 5; }), loText: '−5 years', hiText: '+5 years' });
    if (inp.fersSupplement.mode !== 'off') vars.push({ key: 'supp', label: 'FERS supplement', lo: mod((c) => { c.fersSupplement.mode = 'off'; }), hi: (c) => c, loText: 'eliminated', hiText: 'as planned' });
    if (FT.enabled) vars.push({ key: 'mexico', label: `${FT.country || 'Foreign'} tax`, lo: mod((c) => { c.foreignTax.relief = 'none'; }), hi: mod((c) => { c.foreignTax.enabled = false; }), loText: 'no double-tax relief', hiText: 'none at all' });
    if ((FT.enabled && FT.method === 'mexicoIsr') || inp.spending.foreignCurrency.enabled) vars.push({ key: 'fx', label: 'Peso drift per year', lo: mod((c) => { c.spending.foreignCurrency.annualDrift -= 0.01; }), hi: mod((c) => { c.spending.foreignCurrency.annualDrift += 0.01; }), loText: pt(inp.spending.foreignCurrency.annualDrift - 0.01), hiText: pt(inp.spending.foreignCurrency.annualDrift + 0.01) });
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
