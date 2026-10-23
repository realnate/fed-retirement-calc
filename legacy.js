/*
 * legacy.js — loads plans saved in input schemas 1–8 (before October 2026's restructure) by normalizing them in their
 * own schema and mapping every setting onto schema 9. Share links made before the current defaults revision are not
 * decoded (they store only differences from defaults that are no longer kept); plan files and saved scenarios hold
 * every setting, so they load.
 *
 * Kept apart from engine.js so the engine only knows the current schema. Pure and DOM-free; works as a browser global
 * (window.RetireLegacy) and as a CommonJS module under Node. Delete it (and its <script> tag) to drop old files.
 *
 *   RetireLegacy.isLegacy(raw)              true for inputs in schema 1–8
 *   RetireLegacy.upgrade(raw)               schema 1–8 inputs → schema 9 inputs (anything else is returned as is)
 *   RetireLegacy.schema8Defaults()          the schema-8 template (tests)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RetireLegacy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function legacyFactory() {
  'use strict';

  // ---------------------------------------------------------------------------------------------
  // Schema 8 (frozen October 2026): template, migrations and normalization
  // ---------------------------------------------------------------------------------------------
  const INVESTED = ['taxable', 'trad', 'roth', 'tradIra', 'rothIra'];
  function parseOrder(s) {
    const parts = String(s || '').split(',').map((x) => x.trim()).filter((x, i, a) => INVESTED.includes(x) && a.indexOf(x) === i);
    for (const a of INVESTED) if (!parts.includes(a)) parts.push(a);
    return parts;
  }

  // The schema-8 template: every setting of that schema. A file only takes values from it for settings it lacks (see
  // FILL_MISSING for settings added after a file was saved); the values match today's example household.
  function v8Defaults() {
    const ev = (at, label, amount, dir, extra) => ({ ...EVENT_DEFAULT, at, label, amount, dir, ...extra });
    return {
      version: 8,
      household: {
        currentYear: 2026,
        youBirthYear: 1982,
        youLifespan: 95,
        hasSpouse: true,
        spouseBirthYear: 1980,
        spouseLifespan: 95,
        planToAge: 95,
        longevityStress: false,
        mortality: 'stochastic', // 'fixed' = lifespans above; 'stochastic' = Monte Carlo samples death ages from the SSA table
        youSex: 'male',
        spouseSex: 'female',
      },
      employment: {
        salary: 101443,
        raisePct: 0.02,
        stepBumpOn: true,
        stepBumpPct: 0.01,
        retireAge: 62,
        spouseWorks: true,
        spouseSalary: 60000,
        spouseRetireAge: 62,
        extraSavings: 6000,
        // Social Security / annuity income that starts before you retire is spent with your salary (not saved).
        spendBenefitsWhileWorking: true,
        postRetEarned: 0,
        postRetEarnedUntilAge: 62,
      },
      tsp: {
        trad: 120000,
        roth: 30000,
        taxable: 20000,
        rothBasisPct: 0.7, // share of today's Roth balance that is contributions (basis); earnings share for Mexico tax
        contribPct: 0.10,
        rothShare: 0.3,
        catchUp: false,
        // TSP return before and after retirement: one allocation covers the traditional and Roth balances.
        returnPre: 0.07,
        returnPost: 0.06,
        // Brokerage (`taxable`) returns before and after retirement.
        returnPreTaxable: 0.07,
        returnPostTaxable: 0.06,
        inflation: 0.025,
        withdrawalOrder: 'taxable,trad,roth,tradIra,rothIra',
        // 'order' = the order above; 'proportional' = in proportion to balances; 'fill' = traditional TSP and IRA first up
        // to the top of `fillBracket`, then the order above.
        withdrawalStrategy: 'order',
        fillBracket: 0.12,
        lumpsFromRoth: false, // pay one-time outflows from the Roth accounts first
        gainsPct: 0.3, // share of today's taxable balance that is unrealized long-term gain (the rest is cost basis)
        bridgeOn: false,
        bridgeYears: 5,
        bridgeStartYearsBefore: 5,
        bridgeReturn: 0.04,
      },
      // Your traditional and Roth IRAs (each invested separately), and Roth IRA contributions while you work.
      ira: {
        trad: 0,
        roth: 0,
        rothBasisPct: 1, // share of today's Roth IRA balance that is contributions and conversions (basis)
        returnPreTrad: 0.07,
        returnPostTrad: 0.06,
        returnPreRoth: 0.07,
        returnPostRoth: 0.07,
        contribRoth: 0, // today's $ a year into the Roth IRA while you work (capped at the IRA limit)
      },
      cash: {
        // `cash` is the money market account (money market funds, savings); checking is tracked separately.
        start: 25000, // today's money market balance
        holdSurplus: true, // keep surpluses in the money market (up to `cap`) instead of investing them
        cap: 50000, // today's $; money market above this is invested in the brokerage (taxable) account
        holdYears: 0, // settling-in years: no cap in the first N years of retirement (large purchases); 0 = off
        rate: 0.03, // money market yield (taxable as ordinary income)
        checkingStart: 0, // today's checking balance
        checkingTarget: 0, // today's $; checking is kept at this level: topped up first, refilled from the money market
        checkingRate: 0, // interest on checking
      },
      pension: {
        serviceYears: 28,
        sickHours: 1000,
        high3Mode: 'auto',
        high3Manual: 160000,
        overrideOn: false,
        overrideMonthly: 3000,
        survivorElection: 'full',
        highN: 3, // 3 = High-3 (current law); 5 = High-5 (proposed)
        colaMode: 'diet', // 'diet' = current-law diet COLA; 'reduced' = diet COLA minus colaReduction; 'none' = no COLA
        colaReduction: 0.01,
        specialCategory: false,
        startAge: 0,
        fehbYears: 28,
      },
      supplement: {
        mode: 'auto',
        ss62Monthly: 1900, // today's $; 0 = 70% of your PIA
        manualMonthly: 1500,
      },
      ss: {
        youPia: 2900,
        youClaimAge: 67,
        youClaimMonths: 0,
        spousePia: 2200,
        spouseClaimAge: 67,
        spouseClaimMonths: 0,
        // Share of scheduled benefits actually paid from cutFromYear (trust-fund shortfall scenario); 1 = full benefits.
        payablePct: 1,
        cutFromYear: 2033,
      },
      spending: {
        monthly: 5000,
        phasesOn: false,
        goGoUntil: 75,
        slowGoUntil: 85,
        goGoPct: 1.0,
        slowGoPct: 0.9,
        noGoPct: 0.85,
        survivorPct: 0.7,
        fehbMonthly: 650,
        fehbSelfOnlyPct: 0.45,
        healthInflation: 0.045,
        partBYou: true,
        partBSpouse: true,
        partBMonthly: 202.90,
        events: [
          ev(62, 'Replace car', 35000, 'out', { when: 'age', repeat: 'every', every: 8, until: 85, deferrable: true }),
          ev(65, 'Major home repair (roof, HVAC)', 25000, 'out', { when: 'age', repeat: 'every', every: 10, until: 85 }),
          ev(1, 'Long-term care (you)', 60000, 'out', { person: 'you', when: 'beforeDeath', repeat: 'span', count: 2 }),
          ev(1, 'Long-term care (spouse)', 60000, 'out', { person: 'spouse', when: 'beforeDeath', repeat: 'span', count: 2 }),
        ],
        currencyOn: false,
        currencyCode: 'MXN',
        fxRate: 18.5,
        fxDrift: 0,
        monthlyForeign: 92500,
      },
      taxes: {
        mode: 'advanced',
        mfjRate: 0.12,
        singleRate: 0.15,
        stateRate: 0.04,
        seniorDeduction: true,
        // Federal brackets, standard deduction, 65+ amounts and LTCG breakpoints are indexed with chained CPI (IRC §1(f)(3)),
        // which runs below the CPI used for `inflation`: they grow at inflation minus this gap each year. 0 = with inflation.
        taxIndexGap: 0.0025,
        heirRate: 0.22, // heirs' marginal rate on inherited traditional TSP (after-tax inheritance)
      },
      foreignTax: {
        on: false,
        country: 'Mexico',
        fromYear: 2045, // first year of foreign tax residency
        method: 'isr', // 'isr' = Mexico's progressive annual ISR tariff; 'flat' = one effective rate
        rate: 0.30, // flat method: effective foreign rate on the included income
        exempt: 0, // flat method: today's $ of included income exempt each year
        isrIndex: 0.035, // ISR method: yearly indexing of the ISR tariff and the UMA from 2026
        // Double-tax relief: 'usFtc' = Mexico taxes in full, the US credits Mexican tax (treaty resourcing, §904 limit,
        // 10-year carryforward); 'mxCredit' = Mexico credits the US tax on the same income; 'none' = both tax in full.
        relief: 'mxCredit',
        art20: false, // treat TSP, FERS annuity and supplement as US government-service pensions (US-only, treaty art. 20)
        pensionExemptOn: false, // ISR method: Mexican exemption for retirement income (LISR art. 93 fr. IV)
        umaDaily: 117.31, // 2026 MXN; indexed with isrIndex
        umaMultiple: 15,
        trad: true,
        roth: true,
        rothMode: 'share', // 'earnings' = only the earnings share of Roth withdrawals (pro rata vs basis); 'share' = rothShare
        rothShare: 1.0, // 'share' mode: share of Roth withdrawals the foreign country treats as income
        conversion: true,
        ss: false,
        fers: false,
        supplement: false,
        gains: true,
        interest: true,
        earned: true,
      },
      // Conversions and transfers by your age (see MOVES). In a year, the first taxable conversion covering your age
      // applies; every transfer covering it applies.
      roth: { windows: [] },
      mc: {
        on: true,
        runs: 1000,
        seed: 20260101,
        // Volatility (SD of annual returns) before and after retirement: TSP, brokerage, traditional IRA, Roth IRA.
        // Each year one market shock moves every account.
        sdPre: 0.15,
        sdPost: 0.10,
        sdPreTaxable: 0.15,
        sdPostTaxable: 0.12,
        sdPreTradIra: 0.15,
        sdPostTradIra: 0.10,
        sdPreRothIra: 0.15,
        sdPostRothIra: 0.15,
        inflationSd: 0.015,
        inflationAR: 0.6, // AR(1) persistence of inflation; inflationSd stays the long-run SD
      },
      // Adaptive rules applied in Monte Carlo runs only (the deterministic projection is the plan as written).
      rules: {
        // Claim Social Security early if the portfolio is low in a trigger year.
        contingentSS: { on: false, fromAge: 67, toAge: 69, mode: 'pct', pct: 0.8, abs: 1000000 },
        // Cut base living spending while the portfolio is below `lower` × plan, until it recovers above `upper` × plan;
        // deferrable one-time events slide up to `deferYears` years while the cut is active.
        guardrails: { on: false, lower: 0.8, upper: 0.95, cut: 0.10, deferYears: 3 },
      },
    };
  }

  // repeat: 'once' | 'every' (every `every` years from `at` through `until`; until 0 = end of plan) | 'span' (each year
  // for `count` consecutive years from `at`). `until` uses the same unit as `when` (calendar year or your age).
  // person: 'none' (household) | 'you' | 'spouse' — a person's event is skipped in years after that person has died.
  // when: 'year' | 'age' (age of the tied person; your age if none) | 'beforeDeath' (`at` years before the person's death year).
  const EVENT_DEFAULT = { when: 'year', at: 2030, label: 'Event', amount: 0, dir: 'out', tax: 'none', real: true, deferrable: false,
    repeat: 'once', every: 5, until: 0, count: 2, person: 'none' };
  const WINDOW_DEFAULT = { fromAge: 57, toAge: 57, from: 'trad', to: 'roth', mode: 'fill', bracketRate: 0.22, fixedAmount: 50000 };

  // The single Roth-conversion block of inputs schemas 1–2: values for any of its fields a file lacks.
  const ROTH_V2 = { mode: 'fill', fixedAmount: 50000, fromAge: 57, toAge: 57, bracketRate: 0.22 };

  // Schema migrations applied before normalizing. v2 → v3: the single Roth block becomes a one-element window list
  // (or an empty list if conversions were off). v1 → v2 and v2 → v3 otherwise only added fields (see FILL_MISSING).
  function migrate(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    const r = raw.roth;
    if (r && typeof r === 'object' && !Array.isArray(r.windows) && ['mode', 'fromAge', 'toAge', 'bracketRate', 'fixedAmount'].some((k) => k in r)) {
      const o = { ...ROTH_V2, ...r };
      const windows = o.mode === 'fill' || o.mode === 'fixed'
        ? [{ fromAge: o.fromAge, toAge: o.toAge, mode: o.mode, bracketRate: o.bracketRate, fixedAmount: o.fixedAmount }] : [];
      raw = { ...raw, roth: { windows } };
    }
    // v3 → v4: the boolean foreignTax.credit becomes relief ('mxCredit' if it was on, 'none' if off).
    const f = raw.foreignTax;
    if (f && typeof f === 'object' && 'credit' in f && !('relief' in f)) {
      const g = { ...f, relief: f.credit === false || f.credit === 'false' ? 'none' : 'mxCredit' };
      delete g.credit;
      raw = { ...raw, foreignTax: g };
    }
    // v7 → v8: the TSP has one return (the traditional TSP's when returns differed by account; the separate Roth TSP
    // return is dropped), the brokerage gets returns and volatility of its own, and IRAs are added. Old conversion
    // windows (no source/destination) are traditional TSP → Roth TSP (WINDOW_DEFAULT). Not an exact reproduction.
    if ((Number(raw.version) || 1) < 8) {
      const t = raw.tsp && typeof raw.tsp === 'object' ? raw.tsp : {}, m = raw.mc && typeof raw.mc === 'object' ? raw.mc : {};
      const per = t.perAccountOn === true || t.perAccountOn === 'true';
      const tsp = { ...t }, mc = { ...m };
      if (t.withdrawalOrder !== undefined) tsp.withdrawalOrder = parseOrder(t.withdrawalOrder).join(','); // adds the IRAs last
      if (t.returnPre !== undefined) tsp.returnPreTaxable = t.returnPre;
      if (per && t.returnPostTrad !== undefined) tsp.returnPost = t.returnPostTrad;
      if (!per && t.returnPost !== undefined) tsp.returnPostTaxable = t.returnPost;
      if (m.sdPre !== undefined) Object.assign(mc, { sdPreTaxable: m.sdPre, sdPreTradIra: m.sdPre, sdPreRothIra: m.sdPre });
      if (per && m.sdPostTrad !== undefined) mc.sdPost = m.sdPostTrad;
      if (!per && m.sdPost !== undefined) Object.assign(mc, { sdPostTaxable: m.sdPost, sdPostTradIra: m.sdPost, sdPostRothIra: m.sdPost });
      raw = { ...raw, tsp, mc };
    }
    return raw;
  }

  // Values for fields missing from a saved file (fields added after the file was saved). Each reproduces the behavior
  // of the version that did not have the field. New plans use v8Defaults() instead.
  const FILL_MISSING = {
    tsp: { rothBasisPct: 1, withdrawalStrategy: 'order', lumpsFromRoth: false },
    pension: { highN: 3, colaMode: 'diet' },
    ss: { payablePct: 1 },
    household: { mortality: 'fixed' },
    mc: { inflationAR: 0 },
    rules: { contingentSS: { on: false }, guardrails: { on: false } },
    employment: { spendBenefitsWhileWorking: false },
    cash: { start: 0, holdSurplus: false, cap: 100000, rate: 0 },
    foreignTax: { on: false, method: 'flat', relief: 'mxCredit', rothMode: 'share', art20: false, pensionExemptOn: false },
  };

  // Deep-merge user inputs over defaults, coercing types and dropping unknown keys. Never mutates.
  function normalizeV8(raw) {
    const defs = v8Defaults();
    function merge(def, val, fill, key) {
      if (Array.isArray(def)) {
        if (!Array.isArray(val)) return def;
        const tmpl = key === 'windows' ? WINDOW_DEFAULT : EVENT_DEFAULT;
        return val.map((v) => merge(tmpl, v && typeof v === 'object' ? v : {}));
      }
      if (def && typeof def === 'object') {
        const out = {};
        const src = val && typeof val === 'object' ? val : {};
        for (const k of Object.keys(def)) out[k] = merge(def[k], src[k], fill && typeof fill === 'object' ? fill[k] : undefined, k);
        return out;
      }
      if (val === undefined || val === null || val === '') return fill !== undefined && typeof fill !== 'object' ? fill : def;
      if (typeof def === 'number') {
        const n = Number(val);
        return Number.isFinite(n) ? n : def;
      }
      if (typeof def === 'boolean') return val === true || val === 'true' || val === 1;
      return String(val);
    }
    // Schema migrations: v1 → v2 added fields (mortality mode and sex, inflation persistence, adaptive rules, event
    // `deferrable`); v2 → v3 added event repeats, per-account returns and the heirs' rate, and turned the Roth block
    // into windows (migrate); v3 → v4 added the ISR method, relief modes, art. 20, the pension exemption and Roth
    // basis, and turned foreignTax.credit into relief (migrate); v4 → v5 added event person/before-death timing, the SS
    // payable share, High-5, COLA modes and withdrawal strategies; v5 → v6 added taxes.taxIndexGap; v6 → v7 added checking
    // (cash.checkingStart/Target/Rate) and cash.holdYears, whose defaults (0) reproduce v6; v7 → v8 restructured returns,
    // added IRAs and conversion/transfer windows (migrate; results change). FILL_MISSING keeps older behavior for added
    // fields, except taxIndexGap: it corrects an assumption, so older files get the default.
    const out = merge(defs, migrate(raw || {}), FILL_MISSING);
    out.version = 8;
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Schema 8 → 9: every setting moves to the panel and group it appears under in the app, with a descriptive name
  // ---------------------------------------------------------------------------------------------
  // [schema-8 path, schema-9 path]
  const MAP = [
    ['household.currentYear', 'household.currentYear'], ['household.youBirthYear', 'household.you.birthYear'],
    ['household.youLifespan', 'household.you.lifespan'], ['household.youSex', 'household.you.sex'],
    ['household.hasSpouse', 'household.married'], ['household.spouseBirthYear', 'household.spouse.birthYear'],
    ['household.spouseLifespan', 'household.spouse.lifespan'], ['household.spouseSex', 'household.spouse.sex'],
    ['household.planToAge', 'household.planToAge'], ['household.longevityStress', 'household.longevityStress'],
    ['household.mortality', 'household.monteCarloLifespans'], ['tsp.inflation', 'inflation.rate'],
    ['employment.salary', 'employment.salary'], ['employment.raisePct', 'employment.annualRaise'],
    ['employment.stepBumpOn', 'employment.addStepIncreases'], // the flat stepBumpPct is dropped: steps follow the GS schedule
    ['employment.retireAge', 'employment.retirementAge'], ['employment.extraSavings', 'employment.extraSavings'],
    ['employment.spendBenefitsWhileWorking', 'employment.spendBenefitsThatStartBeforeRetiring'],
    ['employment.postRetEarned', 'employment.afterRetiring.earnings'],
    ['employment.postRetEarnedUntilAge', 'employment.afterRetiring.untilAge'],
    ['employment.spouseWorks', 'employment.spouse.hasEarnings'], ['employment.spouseSalary', 'employment.spouse.earnings'],
    ['employment.spouseRetireAge', 'employment.spouse.stopsAtAge'], ['tsp.trad', 'tsp.balances.traditional'],
    ['tsp.roth', 'tsp.balances.roth'], ['tsp.rothBasisPct', 'tsp.balances.rothBasisShare'],
    ['tsp.contribPct', 'tsp.contributions.rate'], ['tsp.rothShare', 'tsp.contributions.rothShare'],
    ['tsp.catchUp', 'tsp.contributions.catchUp'], ['tsp.returnPre', 'tsp.returns.beforeRetirement'],
    ['tsp.returnPost', 'tsp.returns.afterRetirement'], ['ira.trad', 'iras.traditional.balance'],
    ['ira.returnPreTrad', 'iras.traditional.returns.beforeRetirement'],
    ['ira.returnPostTrad', 'iras.traditional.returns.afterRetirement'], ['ira.roth', 'iras.roth.balance'],
    ['ira.rothBasisPct', 'iras.roth.basisShare'], ['ira.returnPreRoth', 'iras.roth.returns.beforeRetirement'],
    ['ira.returnPostRoth', 'iras.roth.returns.afterRetirement'],
    ['ira.contribRoth', 'iras.roth.contributionsWhileWorking'], ['tsp.taxable', 'brokerage.balance'],
    ['tsp.gainsPct', 'brokerage.unrealizedGainShare'], ['tsp.returnPreTaxable', 'brokerage.returns.beforeRetirement'],
    ['tsp.returnPostTaxable', 'brokerage.returns.afterRetirement'],
    ['cash.checkingStart', 'checkingAndMoneyMarket.checking.balance'],
    ['cash.checkingTarget', 'checkingAndMoneyMarket.checking.keepInChecking'],
    ['cash.checkingRate', 'checkingAndMoneyMarket.checking.interestRate'],
    ['cash.start', 'checkingAndMoneyMarket.moneyMarket.balance'],
    ['cash.rate', 'checkingAndMoneyMarket.moneyMarket.yield'],
    ['cash.holdSurplus', 'checkingAndMoneyMarket.moneyMarket.keepSurplus'],
    ['cash.cap', 'checkingAndMoneyMarket.moneyMarket.moveToBrokerageAbove'],
    ['cash.holdYears', 'checkingAndMoneyMarket.moneyMarket.settlingInYears'],
    ['tsp.withdrawalStrategy', 'withdrawals.strategy'], ['tsp.fillBracket', 'withdrawals.fillToTopOfBracket'],
    ['tsp.lumpsFromRoth', 'withdrawals.oneTimeOutflowsFromRothFirst'], ['tsp.withdrawalOrder', 'withdrawals.order'],
    ['tsp.bridgeOn', 'withdrawals.bridgeBucket.enabled'], ['tsp.bridgeYears', 'withdrawals.bridgeBucket.yearsCovered'],
    ['tsp.bridgeStartYearsBefore', 'withdrawals.bridgeBucket.buildYearsBeforeRetirement'],
    ['tsp.bridgeReturn', 'withdrawals.bridgeBucket.return'], ['pension.serviceYears', 'fersPension.serviceYears'],
    ['pension.sickHours', 'fersPension.sickLeaveHours'], ['pension.high3Mode', 'fersPension.high3Mode'],
    ['pension.high3Manual', 'fersPension.manualHigh3'], ['pension.survivorElection', 'fersPension.survivorElection'],
    ['pension.highN', 'fersPension.averageSalaryYears'], ['pension.colaMode', 'fersPension.colaMode'],
    ['pension.colaReduction', 'fersPension.colaReducedBy'], ['pension.startAge', 'fersPension.postponeToAge'],
    ['pension.specialCategory', 'fersPension.specialCategory'], ['pension.overrideOn', 'fersPension.useOpmEstimate'],
    ['pension.overrideMonthly', 'fersPension.opmEstimateMonthly'],
    ['pension.fehbYears', 'fersPension.fehbYearsBeforeRetirement'], ['supplement.mode', 'fersSupplement.mode'],
    ['supplement.ss62Monthly', 'fersSupplement.ssAt62FromFersMonthly'],
    ['supplement.manualMonthly', 'fersSupplement.manualMonthly'], ['ss.youPia', 'socialSecurity.you.piaMonthly'],
    ['ss.youClaimAge', 'socialSecurity.you.claimAge'], ['ss.youClaimMonths', 'socialSecurity.you.claimExtraMonths'],
    ['ss.spousePia', 'socialSecurity.spouse.piaMonthly'], ['ss.spouseClaimAge', 'socialSecurity.spouse.claimAge'],
    ['ss.spouseClaimMonths', 'socialSecurity.spouse.claimExtraMonths'],
    ['ss.payablePct', 'socialSecurity.trustFundShortfall.benefitsPaidShare'],
    ['ss.cutFromYear', 'socialSecurity.trustFundShortfall.fromYear'], ['spending.monthly', 'spending.baseMonthly'],
    ['spending.survivorPct', 'spending.survivorShare'], ['spending.phasesOn', 'spending.phases.enabled'],
    ['spending.goGoUntil', 'spending.phases.goGoUntilAge'], ['spending.goGoPct', 'spending.phases.goGoShare'],
    ['spending.slowGoUntil', 'spending.phases.slowGoUntilAge'], ['spending.slowGoPct', 'spending.phases.slowGoShare'],
    ['spending.noGoPct', 'spending.phases.noGoShare'], ['spending.fehbMonthly', 'spending.healthcare.fehbMonthly'],
    ['spending.fehbSelfOnlyPct', 'spending.healthcare.fehbSelfOnlyShare'],
    ['spending.healthInflation', 'spending.healthcare.inflation'],
    ['spending.partBYou', 'spending.healthcare.medicarePartBYou'],
    ['spending.partBSpouse', 'spending.healthcare.medicarePartBSpouse'],
    ['spending.partBMonthly', 'spending.healthcare.partBMonthly'], ['spending.events', 'spending.oneTimeEvents'],
    ['spending.currencyOn', 'spending.foreignCurrency.enabled'],
    ['spending.currencyCode', 'spending.foreignCurrency.code'],
    ['spending.monthlyForeign', 'spending.foreignCurrency.baseMonthly'],
    ['spending.fxRate', 'spending.foreignCurrency.localPerUsd'],
    ['spending.fxDrift', 'spending.foreignCurrency.annualDrift'], ['taxes.mode', 'taxes.mode'],
    ['taxes.mfjRate', 'taxes.simpleRateJoint'], ['taxes.singleRate', 'taxes.simpleRateSingle'],
    ['taxes.seniorDeduction', 'taxes.seniorDeduction'], ['taxes.taxIndexGap', 'taxes.bracketGrowthBelowInflation'],
    ['taxes.stateRate', 'taxes.stateRate'], ['taxes.heirRate', 'taxes.heirsRate'],
    ['roth.windows', 'taxes.conversionsAndTransfers'], ['foreignTax.on', 'foreignTax.enabled'],
    ['foreignTax.country', 'foreignTax.country'], ['foreignTax.fromYear', 'foreignTax.residentFromYear'],
    ['foreignTax.method', 'foreignTax.method'], ['foreignTax.isrIndex', 'foreignTax.isrIndexing'],
    ['foreignTax.rate', 'foreignTax.flatRate'], ['foreignTax.exempt', 'foreignTax.flatExemptAmount'],
    ['foreignTax.relief', 'foreignTax.relief'], ['foreignTax.art20', 'foreignTax.treatyArt20'],
    ['foreignTax.pensionExemptOn', 'foreignTax.retirementIncomeExemption'],
    ['foreignTax.umaDaily', 'foreignTax.umaDailyMxn'], ['foreignTax.umaMultiple', 'foreignTax.umaMultiple'],
    ['foreignTax.trad', 'foreignTax.appliesTo.traditionalWithdrawals'],
    ['foreignTax.roth', 'foreignTax.appliesTo.rothWithdrawals'],
    ['foreignTax.rothMode', 'foreignTax.appliesTo.rothAmountTaxed'],
    ['foreignTax.rothShare', 'foreignTax.appliesTo.rothTaxedShare'],
    ['foreignTax.conversion', 'foreignTax.appliesTo.rothConversions'],
    ['foreignTax.ss', 'foreignTax.appliesTo.socialSecurity'], ['foreignTax.fers', 'foreignTax.appliesTo.fersAnnuity'],
    ['foreignTax.supplement', 'foreignTax.appliesTo.fersSupplement'],
    ['foreignTax.gains', 'foreignTax.appliesTo.brokerageGains'], ['foreignTax.interest', 'foreignTax.appliesTo.interest'],
    ['foreignTax.earned', 'foreignTax.appliesTo.earnedIncome'], ['mc.on', 'monteCarlo.enabled'],
    ['mc.runs', 'monteCarlo.runs'], ['mc.seed', 'monteCarlo.seed'],
    ['mc.sdPre', 'monteCarlo.volatility.beforeRetirement.tsp'],
    ['mc.sdPreTaxable', 'monteCarlo.volatility.beforeRetirement.brokerage'],
    ['mc.sdPreTradIra', 'monteCarlo.volatility.beforeRetirement.traditionalIra'],
    ['mc.sdPreRothIra', 'monteCarlo.volatility.beforeRetirement.rothIra'],
    ['mc.sdPost', 'monteCarlo.volatility.afterRetirement.tsp'],
    ['mc.sdPostTaxable', 'monteCarlo.volatility.afterRetirement.brokerage'],
    ['mc.sdPostTradIra', 'monteCarlo.volatility.afterRetirement.traditionalIra'],
    ['mc.sdPostRothIra', 'monteCarlo.volatility.afterRetirement.rothIra'],
    ['mc.inflationSd', 'monteCarlo.inflation.volatility'], ['mc.inflationAR', 'monteCarlo.inflation.persistence'],
    ['rules.contingentSS.on', 'monteCarlo.adaptiveRules.earlySocialSecurity.enabled'],
    ['rules.contingentSS.fromAge', 'monteCarlo.adaptiveRules.earlySocialSecurity.fromAge'],
    ['rules.contingentSS.toAge', 'monteCarlo.adaptiveRules.earlySocialSecurity.throughAge'],
    ['rules.contingentSS.mode', 'monteCarlo.adaptiveRules.earlySocialSecurity.threshold'],
    ['rules.contingentSS.pct', 'monteCarlo.adaptiveRules.earlySocialSecurity.shareOfPlan'],
    ['rules.contingentSS.abs', 'monteCarlo.adaptiveRules.earlySocialSecurity.dollarAmount'],
    ['rules.guardrails.on', 'monteCarlo.adaptiveRules.spendingGuardrails.enabled'],
    ['rules.guardrails.lower', 'monteCarlo.adaptiveRules.spendingGuardrails.cutBelowShareOfPlan'],
    ['rules.guardrails.upper', 'monteCarlo.adaptiveRules.spendingGuardrails.restoreAboveShareOfPlan'],
    ['rules.guardrails.cut', 'monteCarlo.adaptiveRules.spendingGuardrails.spendingCut'],
    ['rules.guardrails.deferYears', 'monteCarlo.adaptiveRules.spendingGuardrails.deferEventsUpToYears'],
  ];
  // Enumerated values renamed in schema 9 (by schema-9 path).
  const VALUES = {
    'withdrawals.strategy': {'order':  'fixedOrder', 'proportional':  'proportional', 'fill':  'bracketFill'},
    'foreignTax.method': {'isr':  'mexicoIsr', 'flat':  'flatRate'},
    'foreignTax.relief': {'usFtc':  'usCreditsForeignTax', 'mxCredit':  'foreignCountryCreditsUsTax', 'none':  'none'},
    'foreignTax.appliesTo.rothAmountTaxed': {'earnings':  'earningsShare', 'share':  'fixedShare'},
    'monteCarlo.adaptiveRules.earlySocialSecurity.threshold': {'pct':  'shareOfPlan', 'abs':  'dollarAmount'},
  };
  const ACCOUNT = {'taxable':  'brokerage',  'trad':  'traditionalTsp',  'roth':  'rothTsp',  'tradIra':  'traditionalIra',  'rothIra':  'rothIra'};
  const get = (o, p) => p.split('.').reduce((v, k) => (v === null || v === undefined ? undefined : v[k]), o);
  const set = (o, p, v) => {
    const ks = p.split('.');
    let t = o;
    for (const k of ks.slice(0, -1)) t = t[k] = t[k] || {};
    t[ks[ks.length - 1]] = v;
  };
  const eventToV9 = (e) => ({
    label: e.label, person: e.person === 'none' ? 'household' : e.person, amount: e.amount, direction: e.dir === 'in' ? 'inflow' : 'outflow',
    inTodaysDollars: e.real, when: e.when === 'beforeDeath' ? 'yearsBeforeDeath' : e.when, at: e.at,
    repeat: { every: 'everyNYears', span: 'eachYearForNYears' }[e.repeat] || 'once', everyNYears: e.every, through: e.until, forNYears: e.count,
    taxed: { ordinary: 'ordinaryIncome', ltcg: 'longTermGain' }[e.tax] || 'no', deferrable: e.deferrable,
  });
  const windowToV9 = (w) => ({
    fromAccount: ACCOUNT[w.from], toAccount: ACCOUNT[w.to], fromAge: w.fromAge, throughAge: w.toAge,
    howMuch: { fill: 'fillBracket', fixed: 'fixedAmount', all: 'wholeBalance' }[w.mode] || 'fillBracket',
    fillToTopOfBracket: w.bracketRate, fixedAmount: w.fixedAmount,
  });
  // A normalized schema-8 object → schema 9.
  function toV9(o) {
    const out = { version: 9 };
    for (const [from, to] of MAP) {
      let v = get(o, from);
      if (v === undefined) continue;
      if (VALUES[to] && VALUES[to][v] !== undefined) v = VALUES[to][v];
      set(out, to, v);
    }
    out.withdrawals.order = parseOrder(o.tsp.withdrawalOrder).map((k) => ACCOUNT[k]);
    out.spending.oneTimeEvents = (o.spending.events || []).map(eventToV9);
    out.taxes.conversionsAndTransfers = (o.roth.windows || []).map(windowToV9);
    return out;
  }

  // Top-level sections that exist only before schema 9, and only from schema 9 on.
  const OLD_KEYS = ['pension', 'supplement', 'ss', 'cash', 'ira', 'roth', 'mc', 'rules'];
  const NEW_KEYS = ['inflation', 'iras', 'brokerage', 'checkingAndMoneyMarket', 'withdrawals', 'fersPension', 'fersSupplement', 'socialSecurity', 'monteCarlo'];
  function isLegacy(raw) {
    if (!raw || typeof raw !== 'object') return false;
    const v = Number(raw.version);
    if (Number.isFinite(v) && v > 0) return v < 9;
    return OLD_KEYS.some((k) => k in raw) && !NEW_KEYS.some((k) => k in raw);
  }
  const upgrade = (raw) => (isLegacy(raw) ? toV9(normalizeV8(raw)) : raw);

  return { isLegacy, upgrade, schema8Defaults: v8Defaults, MAP };
});
