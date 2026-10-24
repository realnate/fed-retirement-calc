/*
 * engine.test.js — tests for engine.js.
 * Node:    node engine.test.js        (exit code 1 on failure)
 * Browser: open tests.html            (loads engine.js, then this file)
 */
(function (root) {
  'use strict';
  const isNode = typeof module === 'object' && module.exports && typeof require === 'function';
  const E = isNode ? require('./engine.js') : root.RetireEngine;
  const R = isNode ? require('./report.js') : root.RetireReport;
  const results = [];

  function test(name, fn) {
    try { fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, error: e && e.message ? e.message : String(e) }); }
  }
  function near(actual, expected, tol, label) {
    if (!(Math.abs(actual - expected) <= (tol === undefined ? 1e-9 : tol))) {
      throw new Error(`${label ? label + ': ' : ''}expected ${expected}, got ${actual}`);
    }
  }
  function ok(cond, label) { if (!cond) throw new Error(label || 'assertion failed'); }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  // Test households. They are made up, and frozen here so the tests' numbers stay meaningful when the app's defaults
  // change. Their salaries grow 2.01% a year with GS step increases off.
  const BASE_PLAN = {"version":1,"household":{"currentYear":2026,"you":{"birthYear":1983,"lifespan":90,"sex":"male"},"married":true,"spouse":{"birthYear":1973,"lifespan":86,"sex":"female"},"planToAge":95,"longevityStress":false,"monteCarloLifespans":"fixed"},"inflation":{"rate":0.03},"employment":{"you":{"federal":true,"salary":125000,"annualRaise":0.0201,"addStepIncreases":false,"currentStep":5,"yearsUntilNextStep":1,"gsPayCap":197200,"retirementAge":57,"afterRetiring":{"earnings":0,"untilAge":62}},"spouse":{"federal":false,"salary":0,"annualRaise":0.03,"addStepIncreases":false,"currentStep":5,"yearsUntilNextStep":1,"gsPayCap":197200,"retirementAge":62,"afterRetiring":{"earnings":0,"untilAge":62}},"spendBenefitsThatStartBeforeRetiring":true},"workplacePlans":{"you":{"balances":{"traditional":280000,"roth":0,"rothBasisShare":1},"contributions":{"rate":0.05,"rothShare":0,"catchUp":false},"employerContributions":{"automatic":0,"match":0.5,"matchUpTo":0.06},"returns":{"beforeRetirement":0.07,"afterRetirement":0.05}},"spouse":{"balances":{"traditional":0,"roth":0,"rothBasisShare":1},"contributions":{"rate":0,"rothShare":0,"catchUp":false},"employerContributions":{"automatic":0,"match":0.5,"matchUpTo":0.06},"returns":{"beforeRetirement":0.07,"afterRetirement":0.06}}},"iras":{"you":{"traditional":{"balance":0,"returns":{"beforeRetirement":0.07,"afterRetirement":0.05}},"roth":{"balance":0,"basisShare":1,"returns":{"beforeRetirement":0.07,"afterRetirement":0.07},"contributionsWhileWorking":0}},"spouse":{"traditional":{"balance":0,"returns":{"beforeRetirement":0.07,"afterRetirement":0.06}},"roth":{"balance":0,"basisShare":1,"returns":{"beforeRetirement":0.07,"afterRetirement":0.07},"contributionsWhileWorking":0}}},"brokerage":{"balance":0,"unrealizedGainShare":0.5,"savingsWhileWorking":0,"returns":{"beforeRetirement":0.07,"afterRetirement":0.05}},"checkingAndMoneyMarket":{"checking":{"balance":0,"keepInChecking":0,"interestRate":0},"moneyMarket":{"balance":0,"yield":0,"keepSurplus":true,"moveToBrokerageAbove":100000,"settlingInYears":0}},"withdrawals":{"strategy":"fixedOrder","fillToTopOfBracket":0.12,"oneTimeOutflowsFromRothFirst":false,"order":["brokerage","traditionalWorkplace","rothWorkplace","traditionalIra","rothIra"],"bridgeBucket":{"enabled":false,"yearsCovered":3,"buildYearsBeforeRetirement":5,"return":0.04}},"fersPension":{"you":{"serviceYears":30,"sickLeaveHours":0,"high3Mode":"auto","manualHigh3":200000,"survivorElection":"partial","postponeToAge":0,"specialCategory":false,"useOpmEstimate":false,"opmEstimateMonthly":5000,"fehbYearsBeforeRetirement":30},"spouse":{"serviceYears":20,"sickLeaveHours":0,"high3Mode":"auto","manualHigh3":100000,"survivorElection":"full","postponeToAge":0,"specialCategory":false,"useOpmEstimate":false,"opmEstimateMonthly":3000,"fehbYearsBeforeRetirement":20},"averageSalaryYears":3,"colaMode":"diet","colaReducedBy":0.01},"fersSupplement":{"you":{"mode":"auto","ssAt62FromFersMonthly":2000,"manualMonthly":2100},"spouse":{"mode":"auto","ssAt62FromFersMonthly":0,"manualMonthly":1000}},"otherPension":{"you":{"monthly":0,"startAge":65,"cola":0,"survivorShare":0.5},"spouse":{"monthly":0,"startAge":65,"cola":0,"survivorShare":0.5}},"socialSecurity":{"you":{"piaMonthly":3100,"claimAge":70,"claimExtraMonths":0},"spouse":{"piaMonthly":1900,"claimAge":67,"claimExtraMonths":0},"trustFundShortfall":{"benefitsPaidShare":1,"fromYear":2033}},"spending":{"baseMonthly":3800,"survivorShare":0.7,"phases":{"enabled":false,"goGoUntilAge":75,"goGoShare":1,"slowGoUntilAge":85,"slowGoShare":0.9,"noGoShare":0.85},"healthcare":{"fehbMonthly":0,"fehbSelfOnlyShare":0.45,"inflation":0.05,"medicarePartBYou":false,"medicarePartBSpouse":false,"partBMonthly":202.9},"oneTimeEvents":[{"label":"Sell house (net of selling costs)","person":"household","when":"year","at":2040,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":400000,"direction":"inflow","taxed":"no","inTodaysDollars":true,"deferrable":false},{"label":"Buy smaller house","person":"household","when":"year","at":2040,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":330000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":false},{"label":"Buy car","person":"household","when":"year","at":2040,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":25000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":false}],"foreignCurrency":{"enabled":false,"code":"MXN","baseMonthly":64750,"localPerUsd":18.5,"annualDrift":0}},"taxes":{"mode":"advanced","simpleRateJoint":0.12,"simpleRateSingle":0.15,"seniorDeduction":true,"bracketGrowthBelowInflation":0.0025,"heirsRate":0.24,"conversionsAndTransfers":[]},"otherTaxes":[],"monteCarlo":{"enabled":false,"runs":1000,"seed":20260101,"volatility":{"beforeRetirement":{"workplacePlans":0.15,"brokerage":0.15,"traditionalIra":0.15,"rothIra":0.15},"afterRetirement":{"workplacePlans":0.1,"brokerage":0.1,"traditionalIra":0.1,"rothIra":0.1}},"inflation":{"volatility":0,"persistence":0},"adaptiveRules":{"earlySocialSecurity":{"enabled":false,"fromAge":67,"throughAge":69,"threshold":"shareOfPlan","shareOfPlan":0.8,"dollarAmount":1000000},"spendingGuardrails":{"enabled":false,"cutBelowShareOfPlan":0.8,"restoreAboveShareOfPlan":0.95,"spendingCut":0.1,"deferEventsUpToYears":3}}}};
  const BASE = () => E.normalizeInputs(clone(BASE_PLAN));
  // A Roth conversion row: fill the 22% bracket, traditional TSP → Roth TSP, ages 57–69.
  const WIN = (o) => ({ fromAccount: 'traditionalWorkplace', toAccount: 'rothWorkplace', fromAge: 57, throughAge: 69, howMuch: 'fillBracket', fillToTopOfBracket: 0.22, fixedAmount: 50000, ...o });
  const withInputs = (mut) => { const i = BASE(); mut(i); return i; };
  // A state, local or foreign tax entry with every income type off, then the given settings (appliesTo merged in).
  const NO_INCOME = Object.fromEntries(Object.keys(E.defaultInputs().otherTaxes[0].appliesTo).map((k) => [k, false]));
  const TAX = (o) => ({ ...clone(E.defaultInputs().otherTaxes[0]), name: 'Tax', deduction: 0, ...o, appliesTo: { ...NO_INCOME, ...(o && o.appliesTo) } });
  // Plan 1: flat-rate foreign tax, 15 one-time events, Monte Carlo on. Carries regression anchors.
  const PLAN1_PLAN = {"version":1,"household":{"currentYear":2026,"you":{"birthYear":1983,"lifespan":95,"sex":"male"},"married":true,"spouse":{"birthYear":1973,"lifespan":95,"sex":"female"},"planToAge":95,"longevityStress":false,"monteCarloLifespans":"fixed"},"inflation":{"rate":0.03},"employment":{"you":{"federal":true,"salary":125000,"annualRaise":0.0201,"addStepIncreases":false,"currentStep":5,"yearsUntilNextStep":1,"gsPayCap":197200,"retirementAge":57,"afterRetiring":{"earnings":0,"untilAge":62}},"spouse":{"federal":false,"salary":0,"annualRaise":0.03,"addStepIncreases":false,"currentStep":5,"yearsUntilNextStep":1,"gsPayCap":197200,"retirementAge":62,"afterRetiring":{"earnings":0,"untilAge":62}},"spendBenefitsThatStartBeforeRetiring":true},"workplacePlans":{"you":{"balances":{"traditional":280000,"roth":2000,"rothBasisShare":1},"contributions":{"rate":0.05,"rothShare":0,"catchUp":false},"employerContributions":{"automatic":0,"match":0.5,"matchUpTo":0.06},"returns":{"beforeRetirement":0.07,"afterRetirement":0.06}},"spouse":{"balances":{"traditional":0,"roth":0,"rothBasisShare":1},"contributions":{"rate":0,"rothShare":0,"catchUp":false},"employerContributions":{"automatic":0,"match":0.5,"matchUpTo":0.06},"returns":{"beforeRetirement":0.07,"afterRetirement":0.06}}},"iras":{"you":{"traditional":{"balance":0,"returns":{"beforeRetirement":0.07,"afterRetirement":0.06}},"roth":{"balance":0,"basisShare":1,"returns":{"beforeRetirement":0.07,"afterRetirement":0.07},"contributionsWhileWorking":0}},"spouse":{"traditional":{"balance":0,"returns":{"beforeRetirement":0.07,"afterRetirement":0.06}},"roth":{"balance":0,"basisShare":1,"returns":{"beforeRetirement":0.07,"afterRetirement":0.07},"contributionsWhileWorking":0}}},"brokerage":{"balance":0,"unrealizedGainShare":0.5,"savingsWhileWorking":0,"returns":{"beforeRetirement":0.07,"afterRetirement":0.06}},"checkingAndMoneyMarket":{"checking":{"balance":0,"keepInChecking":0,"interestRate":0},"moneyMarket":{"balance":0,"yield":0,"keepSurplus":true,"moveToBrokerageAbove":50000,"settlingInYears":0}},"withdrawals":{"strategy":"fixedOrder","fillToTopOfBracket":0.12,"oneTimeOutflowsFromRothFirst":false,"order":["brokerage","traditionalWorkplace","rothWorkplace","traditionalIra","rothIra"],"bridgeBucket":{"enabled":false,"yearsCovered":13,"buildYearsBeforeRetirement":5,"return":0.04}},"fersPension":{"you":{"serviceYears":30,"sickLeaveHours":0,"high3Mode":"auto","manualHigh3":200000,"survivorElection":"partial","postponeToAge":0,"specialCategory":false,"useOpmEstimate":false,"opmEstimateMonthly":5000,"fehbYearsBeforeRetirement":30},"spouse":{"serviceYears":20,"sickLeaveHours":0,"high3Mode":"auto","manualHigh3":100000,"survivorElection":"full","postponeToAge":0,"specialCategory":false,"useOpmEstimate":false,"opmEstimateMonthly":3000,"fehbYearsBeforeRetirement":20},"averageSalaryYears":3,"colaMode":"diet","colaReducedBy":0.01},"fersSupplement":{"you":{"mode":"auto","ssAt62FromFersMonthly":2000,"manualMonthly":2100},"spouse":{"mode":"auto","ssAt62FromFersMonthly":0,"manualMonthly":1000}},"otherPension":{"you":{"monthly":0,"startAge":65,"cola":0,"survivorShare":0.5},"spouse":{"monthly":0,"startAge":65,"cola":0,"survivorShare":0.5}},"socialSecurity":{"you":{"piaMonthly":3100,"claimAge":70,"claimExtraMonths":0},"spouse":{"piaMonthly":1900,"claimAge":67,"claimExtraMonths":0},"trustFundShortfall":{"benefitsPaidShare":1,"fromYear":2033}},"spending":{"baseMonthly":4800,"survivorShare":0.7,"phases":{"enabled":false,"goGoUntilAge":75,"goGoShare":1,"slowGoUntilAge":85,"slowGoShare":0.9,"noGoShare":0.85},"healthcare":{"fehbMonthly":720,"fehbSelfOnlyShare":0.45,"inflation":0.06,"medicarePartBYou":false,"medicarePartBSpouse":false,"partBMonthly":202.9},"oneTimeEvents":[{"label":"Sell house (net of selling costs)","person":"household","when":"year","at":2040,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":380000,"direction":"inflow","taxed":"no","inTodaysDollars":true,"deferrable":false},{"label":"Buy smaller house","person":"household","when":"year","at":2040,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":330000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":false},{"label":"Buy car","person":"household","when":"year","at":2040,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":30000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":false},{"label":"Replace car","person":"household","when":"year","at":2054,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":30000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":false},{"label":"Replace car","person":"household","when":"year","at":2060,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":30000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":false},{"label":"Replace car","person":"household","when":"year","at":2070,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":30000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":false},{"label":"Major home repair (roof, AC, etc.)","person":"household","when":"year","at":2054,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":20000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":false},{"label":"Major home repair (roof, AC, etc.)","person":"household","when":"year","at":2062,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":20000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":false},{"label":"Major home repair (roof, AC, etc.)","person":"household","when":"year","at":2072,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":20000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":false},{"label":"Long-term care reserve (spouse ~90)","person":"household","when":"year","at":2063,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":50000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":false},{"label":"Long-term care reserve (you ~90)","person":"household","when":"year","at":2073,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":50000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":false},{"label":"Long-term care reserve (you ~90)","person":"household","when":"year","at":2074,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":50000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":false},{"label":"Long-term care reserve (you ~90)","person":"household","when":"year","at":2075,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":50000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":false},{"label":"Long-term care reserve (spouse ~90)","person":"household","when":"year","at":2064,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":50000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":false},{"label":"Long-term care reserve (spouse ~90)","person":"household","when":"year","at":2065,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":50000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":false}],"foreignCurrency":{"enabled":false,"code":"MXN","baseMonthly":64750,"localPerUsd":18.5,"annualDrift":0}},"taxes":{"mode":"advanced","simpleRateJoint":0.12,"simpleRateSingle":0.15,"seniorDeduction":true,"bracketGrowthBelowInflation":0.0025,"heirsRate":0.22,"conversionsAndTransfers":[{"owner":"you","fromAccount":"traditionalWorkplace","toAccount":"rothWorkplace","fromAge":57,"throughAge":57,"howMuch":"fillBracket","fillToTopOfBracket":0.22,"fixedAmount":50000}]},"otherTaxes":[{"name":"Mexico","fromYear":2041,"throughYear":0,"filing":"household","rates":"flat","flatRate":0.3,"brackets":[],"deduction":0,"thresholdGrowthBelowInflation":0,"retirementExclusion":0,"exclusionFromAge":0,"appliesTo":{"wages":true,"fersAnnuity":false,"otherPensions":false,"fersSupplement":false,"socialSecurity":false,"traditionalTsp":true,"traditional401k":true,"traditionalIra":true,"rothTsp":true,"roth401k":true,"rothIra":true,"rothConversions":false,"brokerageGains":true,"interest":true,"oneTimeIncome":true},"rothAmountTaxed":"whole","creditsFederalTax":true}],"monteCarlo":{"enabled":true,"runs":1000,"seed":424242,"volatility":{"beforeRetirement":{"workplacePlans":0.15,"brokerage":0.15,"traditionalIra":0.15,"rothIra":0.15},"afterRetirement":{"workplacePlans":0.15,"brokerage":0.15,"traditionalIra":0.15,"rothIra":0.15}},"inflation":{"volatility":0.015,"persistence":0},"adaptiveRules":{"earlySocialSecurity":{"enabled":false,"fromAge":67,"throughAge":69,"threshold":"shareOfPlan","shareOfPlan":0.8,"dollarAmount":1000000},"spendingGuardrails":{"enabled":false,"cutBelowShareOfPlan":0.8,"restoreAboveShareOfPlan":0.95,"spendingCut":0.1,"deferEventsUpToYears":3}}}};
  const PLAN1 = () => clone(PLAN1_PLAN);
  // Plan 2: Mexico ISR, a money market, returns by account. Carries its own anchors.
  const PLAN2_PLAN = {"version":1,"household":{"currentYear":2026,"you":{"birthYear":1983,"lifespan":95,"sex":"male"},"married":true,"spouse":{"birthYear":1973,"lifespan":95,"sex":"female"},"planToAge":95,"longevityStress":false,"monteCarloLifespans":"stochastic"},"inflation":{"rate":0.03},"employment":{"you":{"federal":true,"salary":125000,"annualRaise":0.0201,"addStepIncreases":false,"currentStep":5,"yearsUntilNextStep":1,"gsPayCap":197200,"retirementAge":57,"afterRetiring":{"earnings":0,"untilAge":62}},"spouse":{"federal":false,"salary":0,"annualRaise":0.03,"addStepIncreases":false,"currentStep":5,"yearsUntilNextStep":1,"gsPayCap":197200,"retirementAge":62,"afterRetiring":{"earnings":0,"untilAge":62}},"spendBenefitsThatStartBeforeRetiring":true},"workplacePlans":{"you":{"balances":{"traditional":280000,"roth":2000,"rothBasisShare":1},"contributions":{"rate":0.05,"rothShare":1,"catchUp":false},"employerContributions":{"automatic":0,"match":0.5,"matchUpTo":0.06},"returns":{"beforeRetirement":0.07,"afterRetirement":0.05}},"spouse":{"balances":{"traditional":0,"roth":0,"rothBasisShare":1},"contributions":{"rate":0,"rothShare":0,"catchUp":false},"employerContributions":{"automatic":0,"match":0.5,"matchUpTo":0.06},"returns":{"beforeRetirement":0.07,"afterRetirement":0.06}}},"iras":{"you":{"traditional":{"balance":0,"returns":{"beforeRetirement":0.07,"afterRetirement":0.06}},"roth":{"balance":0,"basisShare":1,"returns":{"beforeRetirement":0.07,"afterRetirement":0.07},"contributionsWhileWorking":0}},"spouse":{"traditional":{"balance":0,"returns":{"beforeRetirement":0.07,"afterRetirement":0.06}},"roth":{"balance":0,"basisShare":1,"returns":{"beforeRetirement":0.07,"afterRetirement":0.07},"contributionsWhileWorking":0}}},"brokerage":{"balance":0,"unrealizedGainShare":0.5,"savingsWhileWorking":0,"returns":{"beforeRetirement":0.07,"afterRetirement":0.06}},"checkingAndMoneyMarket":{"checking":{"balance":0,"keepInChecking":0,"interestRate":0},"moneyMarket":{"balance":0,"yield":0.035,"keepSurplus":true,"moveToBrokerageAbove":100000,"settlingInYears":0}},"withdrawals":{"strategy":"fixedOrder","fillToTopOfBracket":0.12,"oneTimeOutflowsFromRothFirst":false,"order":["brokerage","traditionalWorkplace","rothWorkplace","traditionalIra","rothIra"],"bridgeBucket":{"enabled":false,"yearsCovered":13,"buildYearsBeforeRetirement":5,"return":0.04}},"fersPension":{"you":{"serviceYears":30,"sickLeaveHours":0,"high3Mode":"auto","manualHigh3":200000,"survivorElection":"partial","postponeToAge":0,"specialCategory":false,"useOpmEstimate":false,"opmEstimateMonthly":5000,"fehbYearsBeforeRetirement":30},"spouse":{"serviceYears":20,"sickLeaveHours":0,"high3Mode":"auto","manualHigh3":100000,"survivorElection":"full","postponeToAge":0,"specialCategory":false,"useOpmEstimate":false,"opmEstimateMonthly":3000,"fehbYearsBeforeRetirement":20},"averageSalaryYears":3,"colaMode":"diet","colaReducedBy":0.01},"fersSupplement":{"you":{"mode":"auto","ssAt62FromFersMonthly":2000,"manualMonthly":2100},"spouse":{"mode":"auto","ssAt62FromFersMonthly":0,"manualMonthly":1000}},"otherPension":{"you":{"monthly":0,"startAge":65,"cola":0,"survivorShare":0.5},"spouse":{"monthly":0,"startAge":65,"cola":0,"survivorShare":0.5}},"socialSecurity":{"you":{"piaMonthly":3100,"claimAge":70,"claimExtraMonths":0},"spouse":{"piaMonthly":1900,"claimAge":67,"claimExtraMonths":0},"trustFundShortfall":{"benefitsPaidShare":1,"fromYear":2033}},"spending":{"baseMonthly":4800,"survivorShare":0.7,"phases":{"enabled":false,"goGoUntilAge":75,"goGoShare":1,"slowGoUntilAge":85,"slowGoShare":0.9,"noGoShare":0.85},"healthcare":{"fehbMonthly":720,"fehbSelfOnlyShare":0.45,"inflation":0.06,"medicarePartBYou":false,"medicarePartBSpouse":false,"partBMonthly":202.9},"oneTimeEvents":[{"label":"Sell house (net of selling costs)","person":"household","when":"year","at":2040,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":380000,"direction":"inflow","taxed":"no","inTodaysDollars":true,"deferrable":false},{"label":"Buy smaller house","person":"household","when":"year","at":2040,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":330000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":false},{"label":"Buy car","person":"household","when":"year","at":2040,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":30000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":false},{"label":"Replace car","person":"household","when":"year","at":2054,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":30000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":true},{"label":"Replace car","person":"household","when":"year","at":2060,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":30000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":true},{"label":"Replace car","person":"household","when":"year","at":2070,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":30000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":true},{"label":"Major home repair (roof, AC, etc.)","person":"household","when":"year","at":2056,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":20000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":false},{"label":"Major home repair (roof, AC, etc.)","person":"household","when":"year","at":2062,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":20000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":false},{"label":"Major home repair (roof, AC, etc.)","person":"household","when":"year","at":2072,"repeat":"once","everyNYears":5,"through":0,"forNYears":2,"amount":20000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":false},{"label":"Long-term care reserve (spouse ~90)","person":"household","when":"year","at":2063,"repeat":"eachYearForNYears","everyNYears":5,"through":0,"forNYears":3,"amount":50000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":false},{"label":"Long-term care reserve (you ~90)","person":"household","when":"year","at":2073,"repeat":"eachYearForNYears","everyNYears":5,"through":0,"forNYears":3,"amount":50000,"direction":"outflow","taxed":"no","inTodaysDollars":true,"deferrable":false}],"foreignCurrency":{"enabled":false,"code":"MXN","baseMonthly":64750,"localPerUsd":18.5,"annualDrift":0.005}},"taxes":{"mode":"advanced","simpleRateJoint":0.12,"simpleRateSingle":0.15,"seniorDeduction":true,"bracketGrowthBelowInflation":0.0025,"heirsRate":0.24,"conversionsAndTransfers":[{"owner":"you","fromAccount":"traditionalWorkplace","toAccount":"rothWorkplace","fromAge":57,"throughAge":57,"howMuch":"fillBracket","fillToTopOfBracket":0.24,"fixedAmount":50000}]},"otherTaxes":[{"name":"Mexico","fromYear":2041,"throughYear":0,"filing":"household","rates":"brackets","flatRate":0.3,"brackets":[{"from":0,"rate":0.0192},{"from":547.8443243243244,"rate":0.064},{"from":4649.844324324324,"rate":0.1088},{"from":8171.686486486487,"rate":0.16},{"from":9499.225405405406,"rate":0.1792},{"from":11373.172972972974,"rate":0.2136},{"from":22938.05297297297,"rate":0.2352},{"from":36153.52162162162,"rate":0.3},{"from":69023.02648648649,"rate":0.32},{"from":92030.70162162161,"rate":0.34},{"from":276092.1043243243,"rate":0.35}],"deduction":0,"thresholdGrowthBelowInflation":0.00014925373134322406,"retirementExclusion":0,"exclusionFromAge":0,"appliesTo":{"wages":true,"fersAnnuity":false,"otherPensions":false,"fersSupplement":false,"socialSecurity":false,"traditionalTsp":true,"traditional401k":true,"traditionalIra":true,"rothTsp":true,"roth401k":true,"rothIra":true,"rothConversions":true,"brokerageGains":true,"interest":true,"oneTimeIncome":true},"rothAmountTaxed":"whole","creditsFederalTax":true}],"monteCarlo":{"enabled":true,"runs":1000,"seed":424242,"volatility":{"beforeRetirement":{"workplacePlans":0.15,"brokerage":0.15,"traditionalIra":0.15,"rothIra":0.15},"afterRetirement":{"workplacePlans":0.07,"brokerage":0.15,"traditionalIra":0.1,"rothIra":0.15}},"inflation":{"volatility":0.015,"persistence":0.6},"adaptiveRules":{"earlySocialSecurity":{"enabled":false,"fromAge":67,"throughAge":69,"threshold":"shareOfPlan","shareOfPlan":0.8,"dollarAmount":1000000},"spendingGuardrails":{"enabled":false,"cutBelowShareOfPlan":0.8,"restoreAboveShareOfPlan":0.95,"spendingCut":0.1,"deferEventsUpToYears":3}}}};
  const PLAN2 = () => clone(PLAN2_PLAN);
  const planWith = (mut) => { const i = E.normalizeInputs(PLAN1()); mut(i); return i; };
  // Plan 2 with its Roth money in a Roth IRA. Its separate 7% post-retirement Roth return stood for Roth money held
  // in a Roth IRA after retiring: the Roth TSP moves there at 57 and the conversion goes there too.
  const PLAN2_IRA = () => {
    const p = E.normalizeInputs(PLAN2());
    p.taxes.conversionsAndTransfers = [WIN({ fromAge: 57, throughAge: 57, fromAccount: 'rothWorkplace', toAccount: 'rothIra', howMuch: 'wholeBalance', fillToTopOfBracket: 0.24 }),
      { ...p.taxes.conversionsAndTransfers[0], toAccount: 'rothIra' }];
    return E.normalizeInputs(p);
  };
  // Plan 2 in a Roth IRA with each long-term-care reserve tied to the person it is for.
  const PLAN2_TIED = () => {
    const p = PLAN2_IRA();
    p.spending.oneTimeEvents.find((e) => e.label.includes('spouse ~90')).person = 'spouse';
    p.spending.oneTimeEvents.find((e) => e.label.includes('you ~90')).person = 'you';
    return p;
  };
  const FRA67 = 67 * 12;

  // --- Social Security ---------------------------------------------------------------------------
  test('SS claim factors with FRA 67: 62→0.70, 64→0.80, 67→1.00, 70→1.24', () => {
    near(E.ssClaimFactor(62, FRA67), 0.70, 1e-9, '62');
    near(E.ssClaimFactor(64, FRA67), 0.80, 1e-9, '64');
    near(E.ssClaimFactor(67, FRA67), 1.00, 1e-9, '67');
    near(E.ssClaimFactor(70, FRA67), 1.24, 1e-9, '70');
    near(E.ssClaimFactor(72, FRA67), 1.24, 1e-9, 'no credits past 70');
  });
  test('FRA by birth year (SSA table)', () => {
    near(E.fraMonthsForBirthYear(1960), 804);
    near(E.fraMonthsForBirthYear(1973), 804);
    near(E.fraMonthsForBirthYear(1957), 66 * 12 + 6);
    near(E.fraMonthsForBirthYear(1950), 66 * 12);
  });
  test('Spousal excess is 0 when own PIA ≥ 50% of the other PIA', () => {
    near(E.spousalExcess(1900, 3100), 0);
    near(E.spousalExcess(1550, 3100), 0);
    near(E.spousalExcess(1000, 3000), 500, 1e-9, 'positive case');
    near(E.ssSpousalFactor(62, FRA67), 0.65, 1e-9, 'spousal factor at 62');
    near(E.ssSpousalFactor(67, FRA67), 1.0, 1e-9, 'spousal factor at FRA');
  });
  test('Provisional income: MFJ, $20k other + $30k SS → $1,500 taxable (IRS Pub 915; spec expected $0)', () => {
    // Provisional income = 20,000 + 50% × 30,000 = 35,000, which is $3,000 over the $32,000 MFJ base,
    // so 50% × 3,000 = $1,500 is taxable. The spec's expected $0 is incorrect; $0 needs PI ≤ $32,000.
    near(E.taxableSocialSecurity(20000, 30000, 'mfj'), 1500, 1e-9);
    near(E.taxableSocialSecurity(15000, 30000, 'mfj'), 0, 1e-9, '$15k other → PI $30k → $0');
    near(E.taxableSocialSecurity(17000, 30000, 'mfj'), 0, 1e-9, 'PI exactly $32k → $0');
    near(E.taxableSocialSecurity(200000, 40000, 'mfj'), 34000, 1e-9, '85% cap');
    near(E.taxableSocialSecurity(30000, 20000, 'single'), 0.85 * (40000 - 34000) + 4500, 1e-9, 'single, second tier');
  });

  // --- FERS ----------------------------------------------------------------------------------------
  test('Diet COLA: CPI 1.5%→1.5%, 2.5%→2.0%, 4.0%→3.0%', () => {
    near(E.dietCola(0.015), 0.015);
    near(E.dietCola(0.025), 0.02);
    near(E.dietCola(0.04), 0.03);
    near(E.dietCola(0.02), 0.02, 1e-12, 'boundary 2%');
    near(E.dietCola(0.03), 0.02, 1e-12, 'boundary 3%');
    near(E.dietCola(-0.01), 0, 1e-12, 'deflation');
  });
  test('Pension: age 57, 30 years, High-3 $200k → $60,000/yr', () => {
    near(E.fersBasicAnnuity({ high3: 200000, compService: 30, ageAtSeparation: 57, service: 30 }), 60000, 1e-6);
  });
  test('Pension: age 62 with 20 years → 1.1% multiplier (61 or 19 years → 1.0%)', () => {
    near(E.fersMultiplier(62, 20), 0.011);
    near(E.fersMultiplier(61, 25), 0.01);
    near(E.fersMultiplier(62, 19), 0.01);
    near(E.fersBasicAnnuity({ high3: 200000, compService: 20, ageAtSeparation: 62, service: 20 }), 44000, 1e-6);
  });
  test('MRA table by birth year', () => {
    near(E.mraForBirthYear(1983), 57);
    near(E.mraForBirthYear(1965), 56 + 2 / 12, 1e-12);
    near(E.mraForBirthYear(1958), 56);
    near(E.mraForBirthYear(1947), 55);
  });
  test('MRA+10: age 57 with 15 years → 25% reduction if started immediately', () => {
    const mra = E.mraForBirthYear(1983);
    const rt = E.fersRetirementType(57, 15, mra, false);
    ok(rt.type === 'mra10', 'type is mra10, got ' + rt.type);
    const start = E.fersStartAge(rt, 57, 15, mra, 0);
    near(start, 57);
    near(E.fersAgeReduction(rt, start, 15), 0.25, 1e-12);
    near(E.fersAgeReduction(rt, 60, 15), 0.10, 1e-12, 'postponed to 60 with 15 yrs');
    near(E.fersAgeReduction(rt, 60, 20), 0, 1e-12, 'postponed to 60 with 20 yrs');
  });
  test('Retirement types: MRA+30, 60+20, 62+5, deferred', () => {
    const mra = 57;
    ok(E.fersRetirementType(57, 30, mra).rule === 'MRA+30');
    ok(E.fersRetirementType(60, 20, mra).rule === '60+20');
    ok(E.fersRetirementType(62, 5, mra).rule === '62+5');
    const d = E.fersRetirementType(50, 20, mra);
    ok(d.type === 'deferred' && !d.supplementEligible, 'deferred');
    near(E.fersStartAge(d, 50, 20, mra, 0), 60, 0, 'deferred 20 yrs starts unreduced at 60');
  });
  test('Supplement: SS-at-62 $3,200/mo with 30 years → $2,400/mo', () => {
    near(E.fersSupplementMonthly(3200, 30), 2400, 1e-9);
    near(E.fersSupplementMonthly(3200, 30.25), 2400, 1e-9, '30¼ years rounds to 30');
    near(E.fersSupplementMonthly(3200, 30.5), 2480, 1e-9, '30½ years rounds up to 31 (5 USC 8421(b)(3))');
    near(E.fersSupplementMonthly(3200, 30.9), 2480, 1e-9, '30.9 years rounds to 31');
    near(E.fersSupplementMonthly(3200, 45), 3200, 1e-9, 'at most 40 years');
    // OPM CSRS/FERS Handbook ch. 51 worked example: PIA $3,018.30 × 0.70 → $2,112; 33 years → $1,742/mo (OPM drops cents).
    near(Math.floor(E.fersSupplementMonthly(2112, 33)), 1742, 0, 'OPM handbook example');
  });
  test('Supplement is paid until 62 and is zero from 62 on', () => {
    const res = E.simulate(BASE());
    const at = (age) => res.years.find((r) => r.ageYou === age);
    ok(at(57).supplement > 0, 'paid at 57');
    ok(at(61).supplement > 0, 'paid at 61');
    near(at(62).supplement, 0, 0, 'zero at 62');
    near(at(70).supplement, 0, 0, 'zero at 70');
    near(at(57).supplement, at(61).supplement, 1e-9, 'no COLA');
    near(res.summary.fers.supplementMonthly, 2000 * Math.pow(1.03, 14) * 30 / 40, 1e-9, 'SS-at-62 in 2040 dollars × 30 ÷ 40');
  });
  test('Supplement is zero for MRA+10 retirements', () => {
    const res = E.simulate(withInputs((i) => { i.fersPension.you.serviceYears = 15; }));
    ok(res.summary.fers.retirementType === 'mra10', 'mra10');
    ok(res.years.every((r) => r.supplement === 0), 'all zero');
    near(res.summary.fers.ageReduction, 0.25, 1e-12, '25% reduction');
  });
  test('Supplement earnings test: $1 per $2 over the limit', () => {
    const res = E.simulate(withInputs((i) => { i.employment.you.afterRetiring.earnings = 40000; }));
    const r = res.years.find((y) => y.ageYou === 58);
    const scale = r.idx; // currentYear = base year
    near(r.suppReduction, (40000 * r.idx - 24480 * scale) / 2, 1e-6);
  });
  test('Survivor (full election): retiree gets 90%; restored to 100% after the spouse dies', () => {
    const res = E.simulate(withInputs((i) => { i.fersPension.you.survivorElection = 'full'; }));
    const F = res.summary.fers;
    const first = res.years.find((r) => r.year === F.pensionStartYear);
    near(first.pension, F.initialAnnuity * 0.90, 1e-6, 'reduced by 10%');
    const d = res.summary.spouseDeathYear;
    const before = res.years.find((r) => r.year === d), after = res.years.find((r) => r.year === d + 1);
    near(after.pension, (before.pension / 0.90) * (1 + after.colaApplied), 1e-6, 'unreduced after spouse death');
  });
  test('Survivor annuity: spouse receives 50% of the unreduced annuity (with COLAs) after retiree dies', () => {
    const res = E.simulate(withInputs((i) => {
      i.fersPension.you.survivorElection = 'full';
      i.household.you.lifespan = 70; i.household.spouse.lifespan = 95; i.household.planToAge = 100;
    }));
    const d = res.summary.youDeathYear;
    const before = res.years.find((r) => r.year === d), after = res.years.find((r) => r.year === d + 1);
    near(after.pension, 0, 0, 'retiree annuity stops');
    near(after.survivorAnnuity, (before.pension / 0.90) * (1 + after.colaApplied) * 0.5, 1e-6, '50% of unreduced');
    ok(after.colaApplied > 0, 'survivor annuity gets COLA');
  });
  test('Regular retiree COLA starts the year after turning 62', () => {
    const res = E.simulate(BASE());
    const at = (age) => res.years.find((r) => r.ageYou === age);
    near(at(62).colaApplied, 0, 0, 'none at 62');
    near(at(63).colaApplied, 0.02, 1e-12, 'diet COLA at 63 (CPI 3% → 2%)');
  });

  // --- Pay ----------------------------------------------------------------------------------------
  test('GS step increases: 1-, 2- and 3-year waits from the current step, each step 1/30 of step 1', () => {
    const st = E.gsStepStartYears(5, 1, 2026);
    ok(st.slice(6).join() === '2027,2029,2032,2035,2038', `step 5, next within a year: steps 6–10 in ${st.slice(6).join(', ')}`);
    ok(st[5] === 2025 && st[4] === 2023 && st[1] === 2020, 'earlier steps back-projected: 5 in 2025, 4 in 2023, 1 in 2020');
    const one = E.gsStepStartYears(1, 1, 2026);
    ok(one[10] - one[1] === 18, '18 years from step 1 to step 10');
    ok(E.gsStepStartYears(2, 3, 2026)[3] === 2027 && E.gsStepStartYears(5, 3, 2026)[6] === 2028 && E.gsStepStartYears(8, 3, 2026)[9] === 2029, 'the next step is at most its waiting period away');
    near(E.gsStepPay(10) / E.gsStepPay(1), 1.3, 1e-12, 'step 10 pays 30% more than step 1');
    // The published table rounds each step to the dollar.
    near(89508 * E.gsStepPay(5), 101443, 2, '2026 GS-12 Rest of U.S.: step 1 $89,508 → step 5 $101,443');
    near(89508 * E.gsStepPay(10), 116362, 2, '→ step 10 $116,362');
    // Salary: the raise every year, times the step held that year relative to today's step.
    const run = (o) => E.simulate(withInputs((i) => { Object.assign(i.employment.you, { salary: 100000, annualRaise: 0.02, addStepIncreases: true, currentStep: 5, yearsUntilNextStep: 1, ...o }); }));
    const res = run({});
    const stepIn = (Y) => (Y >= 2038 ? 10 : Y >= 2035 ? 9 : Y >= 2032 ? 8 : Y >= 2029 ? 7 : Y >= 2027 ? 6 : 5);
    const pay = (Y) => 100000 * Math.pow(1.02, Y - 2026) * (1 + (stepIn(Y) - 1) / 30) / (1 + 4 / 30);
    for (const r of res.years.filter((y) => y.phase === 'Working')) {
      ok(r.step === stepIn(r.year), `${r.year}: step ${r.step}`);
      near(r.salary, pay(r.year), 1e-6, `${r.year}: salary`);
    }
    ok(res.years.filter((y) => y.phase !== 'Working').every((y) => y.step === null), 'no step once retired');
    ok(res.summary.stepIncreases.map((x) => `${x.step}:${x.year}`).join() === '6:2027,7:2029,8:2032,9:2035,10:2038', 'the summary lists the increases before retirement');
    near(res.summary.fers.high3, (pay(2037) + pay(2038) + pay(2039)) / 3, 1e-6, 'High-3 from the stepped salaries');
    const flat = (r) => r.years.filter((y) => y.phase === 'Working').every((y) => Math.abs(y.salary - 100000 * Math.pow(1.02, y.year - 2026)) < 1e-6);
    const top = run({ currentStep: 10 });
    ok(flat(top) && top.summary.stepIncreases.length === 0, 'step 10: raises only');
    const off = run({ addStepIncreases: false, currentStep: 2 });
    ok(flat(off) && off.years.every((y) => y.step === null) && off.summary.stepIncreases.length === 0, 'steps off: raises only');
    // Retiring next year: the High-3 reaches back two years, to step 5 (step 6 was reached this year).
    const soon = run({ currentStep: 6, yearsUntilNextStep: 2 }), early = E.simulate(withInputs((i) => { Object.assign(i.employment.you, { salary: 100000, annualRaise: 0.02, addStepIncreases: true, currentStep: 6, yearsUntilNextStep: 2, retirementAge: 44 }); }));
    ok(soon.years[0].step === 6 && soon.years.find((y) => y.year === 2028).step === 7, 'step 6, step 7 in 2028');
    const back = (k) => 100000 / Math.pow(1.02, k) * (1 + 4 / 30) / (1 + 5 / 30);
    near(early.summary.fers.high3, (back(2) + back(1) + 100000) / 3, 1e-6, 'back-projected High-3: 2024 and 2025 at step 5');
    // Values outside the schedule fall back to the default and are reported.
    const d0 = E.defaultInputs(), bad = { employment: { ...d0.employment, you: { ...d0.employment.you, currentStep: 11, yearsUntilNextStep: 4 } } };
    const n = E.normalizeInputs(bad);
    ok(n.employment.you.currentStep === E.defaultInputs().employment.you.currentStep && n.employment.you.yearsUntilNextStep === E.defaultInputs().employment.you.yearsUntilNextStep, 'defaults used');
    ok(E.validateInputs({ ...E.defaultInputs(), ...bad }).filter((x) => /not allowed/.test(x.problem)).length === 2, 'both reported');
  });

  test('GS pay cap: pay is held at Executive Schedule level IV, which grows with the raise; the High-3 uses capped pay', () => {
    const run = (o) => E.simulate(withInputs((i) => { Object.assign(i.employment.you, { salary: 190000, annualRaise: 0.02, addStepIncreases: true, currentStep: 7, yearsUntilNextStep: 1, gsPayCap: 197200, ...o }); }));
    const res = run({});
    const cap = (Y) => 197200 * Math.pow(1.02, Y - 2026);
    const uncapped = (Y) => 190000 * Math.pow(1.02, Y - 2026) * (1 + ((Y >= 2033 ? 10 : Y >= 2030 ? 9 : Y >= 2027 ? 8 : 7) - 1) / 30) / (1 + 6 / 30);
    for (const r of res.years.filter((y) => y.phase === 'Working')) near(r.salary, Math.min(uncapped(r.year), cap(r.year)), 1e-6, `${r.year}: salary`);
    ok(res.summary.payCapFromYear === 2030 && res.years.find((y) => y.year === 2029).salary < cap(2029), 'step 9 (2030) is the first year above the cap');
    near(res.summary.fers.high3, (cap(2037) + cap(2038) + cap(2039)) / 3, 1e-6, 'High-3 at the cap');
    ok(res.warnings.some((w) => w.code === 'payCap' && w.text.startsWith('From 2030')), 'a note says when');
    const over = run({ salary: 205000 });
    ok(over.summary.payCapFromYear === 2026 && Math.abs(over.years[0].salary - 197200) < 1e-6, 'a salary above this year\'s cap is held at it');
    ok(over.warnings.some((w) => w.code === 'payCap' && w.text.startsWith('Your salary is above')), 'and the note says so');
    const none = run({ gsPayCap: 0 });
    ok(none.summary.payCapFromYear === null && none.years.filter((y) => y.phase === 'Working').every((y) => Math.abs(y.salary - uncapped(y.year)) < 1e-6), '0: no cap');
    ok(run({ salary: 170000 }).summary.payCapFromYear === null, '$170,000 at step 7 stays under it (step 10 is $184,167 today)');
    ok(E.defaultInputs().employment.you.gsPayCap === 197200 && E.CONSTANTS.gs.payCap === 197200, '2026 level IV');
  });

  // --- RMD -----------------------------------------------------------------------------------------
  test('RMD start age 75 for birth year 1960+, 73 for 1951–1959; divisor at 75 = 24.6', () => {
    near(E.rmdStartAge(1960), 75);
    near(E.rmdStartAge(1983), 75);
    near(E.rmdStartAge(1959), 73);
    near(E.rmdStartAge(1951), 73);
    near(E.rmdDivisor(75), 24.6);
    near(E.rmdDivisor(73), 26.5);
    near(E.rmdDivisor(100), 6.4);
    const res = E.simulate(BASE());
    const first = res.years.find((r) => r.rmd > 0);
    near(first.ageYou, 75, 0, 'first RMD at 75');
    near(first.rmd, first.startTrad / 24.6, 1e-6, 'RMD = balance / 24.6');
  });

  // --- Taxes ---------------------------------------------------------------------------------------
  test('2026 MFJ tax on $100k ordinary income (no SS) = $7,640', () => {
    const t = E.computeTaxes({ ordinary: 100000, ltcg: 0, ss: 0, status: 'mfj', year: 2026, scale: 1, nOver65: 0 });
    near(t.ordTaxable, 67800, 1e-6);
    near(t.federal, 2480 + 0.12 * (67800 - 24800), 1e-6);
    near(t.marginal, 0.12);
  });
  test('Long-term gains are stacked on ordinary income at 0/15/20%', () => {
    const t = E.computeTaxes({ ordinary: 100000, ltcg: 50000, ss: 0, status: 'mfj', year: 2026, scale: 1, nOver65: 0 });
    // Ordinary taxable 67,800; gains 67,800 → 117,800; 0% up to 98,900, 15% above.
    near(t.ltcgTax, 0.15 * (117800 - 98900), 1e-6);
  });
  test('NIIT: 3.8% of interest and gains, up to the MAGI over $250,000 (MFJ); wages and TSP income are not investment income', () => {
    const t = (o) => E.computeTaxes({ status: 'mfj', year: 2026, scale: 1, nOver65: 0, mode: 'advanced', ss: 0, ltcg: 0, ...o });
    near(t({ ordinary: 300000, interest: 20000 }).niit, 0.038 * 20000, 1e-9, 'interest below the excess: all of it');
    near(t({ ordinary: 260000, interest: 20000 }).niit, 0.038 * 10000, 1e-9, 'the excess over $250,000 when smaller');
    near(t({ ordinary: 300000 }).niit, 0, 0, 'no investment income: none');
    near(t({ ordinary: 240000, interest: 20000, ltcg: 30000 }).niit, 0.038 * 20000, 1e-9, 'interest and gains together, capped at the excess');
    // A year row: money market interest pushes MAGI over the threshold while working.
    const r = E.simulate(withInputs((i) => { Object.assign(i.checkingAndMoneyMarket.moneyMarket, { balance: 3000000, yield: 0.05, moveToBrokerageAbove: 1e9 }); })).years[0];
    const ctx = { ordinary: r.salary - r.contribEmpTrad + r.cashInterest, ltcg: 0, ss: 0, status: 'mfj', year: 2026, scale: 1, nOver65: 0, mode: 'advanced', seniorDeduction: true };
    near(r.federalTax - E.computeTaxes(ctx).federal, 0.038 * Math.min(r.cashInterest, r.agi - 250000), 0.01, 'the row\'s federal tax includes NIIT on the interest');
  });
  test('Filing status switches to single the year after the first death', () => {
    const res = E.simulate(BASE());
    const d = res.summary.firstDeathYear;
    ok(res.years.find((r) => r.year === d).status === 'mfj', 'MFJ in death year');
    ok(res.years.find((r) => r.year === d + 1).status === 'single', 'single next year');
  });
  test('Roth "fill the 22% bracket" lands exactly at the bracket top', () => {
    const inp = withInputs((i) => { i.taxes.conversionsAndTransfers = [WIN({})]; });
    const res = E.simulate(inp);
    const r = res.years.find((y) => y.ageYou === 60);
    ok(r.conversion > 0, 'converts');
    const top = E.bracketTop(0.22, 'mfj', r.taxScale);
    near(r.ordTaxable, top, 1, 'ordinary taxable income = top of 22%');
    ok(res.years.find((y) => y.ageYou === 70).conversion === 0, 'stops after toAge');
  });
  test('Conversion tax is paid from the taxable account first', () => {
    // Spending is drawn trad-first, but the conversion's extra tax must come out of the taxable account.
    const inp = withInputs((i) => {
      i.taxes.conversionsAndTransfers = [WIN({ howMuch: 'fixedAmount', fixedAmount: 40000 })]; i.brokerage.balance = 200000;
      i.withdrawals.order = ['traditionalWorkplace', 'brokerage', 'rothWorkplace']; i.spending.oneTimeEvents = []; i.spending.baseMonthly = 9000;
    });
    const r = E.simulate(inp).years.find((y) => y.year === 2041);
    ok(r.conversion > 0 && r.conversionTax > 0, 'conversion with tax');
    ok(r.wTrad > 0, 'spending drawn from trad');
    near(r.wTaxable, r.conversionTax, 1, 'taxable withdrawal = conversion tax');
  });

  // --- Withdrawals, depletion -----------------------------------------------------------------------
  test('Withdrawal order is respected (trad first when configured)', () => {
    const inp = withInputs((i) => { i.spending.baseMonthly = 12000; i.brokerage.balance = 300000; i.withdrawals.order = ['traditionalWorkplace', 'brokerage', 'rothWorkplace']; i.spending.oneTimeEvents = []; });
    const r = E.simulate(inp).years.find((y) => y.year === 2041);
    ok(r.wTrad > 0 && r.wTaxable === 0, `trad ${r.wTrad}, taxable ${r.wTaxable}`);
  });
  test('Depletion is flagged and simulation continues with an unfunded shortfall', () => {
    const inp = withInputs((i) => { i.spending.baseMonthly = 20000; i.workplacePlans.you.balances.traditional = 100000; i.spending.oneTimeEvents = []; });
    const res = E.simulate(inp);
    ok(res.summary.depletionYear !== null, 'depleted');
    const later = res.years.filter((r) => r.year > res.summary.depletionYear);
    ok(later.length > 0 && later.every((r) => r.shortfall > 0), 'shortfall continues');
    ok(res.warnings.some((w) => w.code === 'depleted'), 'warning');
  });

  // --- Mass conservation ----------------------------------------------------------------------------
  // Every account: money market, brokerage, checking, and each spouse's workplace plan and IRAs (spouse's end in S).
  const ACCTS = ['cash', 'taxable', 'trad', 'roth', 'tradIra', 'rothIra', 'tradS', 'rothS', 'tradIraS', 'rothIraS', 'checking'];
  function checkConservation(res, label) {
    for (const r of res.years) {
      ok(Object.keys(r.flows).sort().join() === ACCTS.slice().sort().join(), `${label} ${r.year} every account has flows`);
      for (const k of ACCTS) {
        const f = r.flows[k];
        const lhs = f.start + f.contrib + f.deposit + f.convIn - f.convOut + f.xferIn - f.xferOut - f.withdraw + f.growth;
        near(lhs, f.end, 1, `${label} ${r.year} ${k}`);
        ok(f.end > -1e-6, `${label} ${r.year} ${k} never negative`);
      }
      // The household totals are the sums of the accounts.
      const F = r.flows;
      near(r.balTrad, F.trad.end + F.tradS.end, 1e-6, `${label} ${r.year} traditional plans`); near(r.balRoth, F.roth.end + F.rothS.end, 1e-6, `${label} ${r.year} Roth plans`);
      near(r.ira.trad.bal, F.tradIra.end + F.tradIraS.end, 1e-6, `${label} ${r.year} traditional IRAs`); near(r.ira.roth.bal, F.rothIra.end + F.rothIraS.end, 1e-6, `${label} ${r.year} Roth IRAs`);
      near(r.balCash, F.cash.end, 1e-9); near(r.balTaxable, F.taxable.end, 1e-9); near(r.checking.bal, F.checking.end, 1e-9);
      near(r.total, ACCTS.reduce((t, k) => t + F[k].end, 0), 1e-6, `${label} ${r.year} total`);
      const net = (field) => ACCTS.reduce((t, k) => t + r.flows[k][field], 0);
      near(net('xferIn') - net('xferOut'), 0, 1e-6, `${label} ${r.year} transfers between accounts net to zero`);
      near(net('convIn') - net('convOut'), 0, 1e-6, `${label} ${r.year} conversions net to zero`);
      near(net('convIn'), r.conversion, 1e-6, `${label} ${r.year} conversion amount`);
      // Cash flow: sources = uses
      const sources = r.cashIn + r.wCash + r.wTaxable + r.wTrad + r.wRoth + r.ira.trad.withdraw + r.ira.roth.withdraw + r.checking.withdraw;
      const uses = r.spending + r.portfolioTax + r.deposit - r.shortfall;
      near(sources, uses, 1, `${label} ${r.year} cash`);
    }
  }
  test('Mass conservation: start + contributions + growth − withdrawals = end (every year, every account)', () => {
    checkConservation(E.simulate(BASE()), 'defaults');
    checkConservation(E.simulate(withInputs((i) => { i.taxes.conversionsAndTransfers = [WIN({})]; i.brokerage.balance = 50000; i.workplacePlans.you.balances.roth = 20000; })), 'fill');
    checkConservation(E.simulate(withInputs((i) => { i.spending.baseMonthly = 20000; i.workplacePlans.you.balances.traditional = 100000; })), 'depletion');
    checkConservation(E.simulate(withInputs((i) => { i.withdrawals.bridgeBucket.enabled = true; i.spending.baseMonthly = 9000; i.workplacePlans.you.contributions.catchUp = true; i.workplacePlans.you.contributions.rothShare = 0.5; })), 'bridge');
    checkConservation(E.simulate(withInputs((i) => { i.household.married = false; i.spending.healthcare.medicarePartBYou = true; i.taxes.mode = 'simple'; })), 'single');
    checkConservation(E.simulate(BASE(), { rng: E.mulberry32(7) }), 'stochastic');
    checkConservation(E.simulate(withInputs((i) => { i.checkingAndMoneyMarket.moneyMarket.balance = 80000; i.checkingAndMoneyMarket.moneyMarket.yield = 0.02; i.checkingAndMoneyMarket.moneyMarket.moveToBrokerageAbove = 50000; i.spending.baseMonthly = 8000; })), 'cash');
    checkConservation(E.simulate(withInputs((i) => {
      i.otherTaxes = [TAX({ fromYear: 2030, flatRate: 0.2, creditsFederalTax: true, appliesTo: { wages: true, traditionalTsp: true, rothTsp: true, rothConversions: true, brokerageGains: true, interest: true } }),
        TAX({ name: 'State', filing: 'separate', rates: 'brackets', brackets: [{ from: 0, rate: 0.02 }, { from: 20000, rate: 0.05 }], deduction: 5000, retirementExclusion: 20000,
          exclusionFromAge: 62, appliesTo: { wages: true, fersAnnuity: true, traditionalTsp: true, socialSecurity: true, interest: true } })];
      i.taxes.conversionsAndTransfers = [WIN({})]; i.workplacePlans.you.balances.roth = 200000; i.spending.baseMonthly = 9000; })), 'other taxes');
    const chk = (i) => { Object.assign(i.checkingAndMoneyMarket.checking, { balance: 25000, keepInChecking: 10000, interestRate: 0.001 });
      Object.assign(i.checkingAndMoneyMarket.moneyMarket, { balance: 40000, settlingInYears: 3, moveToBrokerageAbove: 30000 }); };
    checkConservation(E.simulate(withInputs(chk)), 'checking');
    checkConservation(E.simulate(withInputs((i) => { chk(i); i.spending.baseMonthly = 20000; i.workplacePlans.you.balances.traditional = 100000; })), 'checking depletion');
    for (const seed of [3, 4]) {
      checkConservation(E.simulate(E.defaultInputs(), { rng: E.mulberry32(seed) }), `defaults seed ${seed}`);
      checkConservation(E.simulate(PLAN2_TIED(), { rng: E.mulberry32(seed) }), `plan 2 seed ${seed}`);
    }
    const ira = (i) => { i.iras.you.traditional.balance = 150000; Object.assign(i.iras.you.roth, { balance: 60000, basisShare: 0.5, contributionsWhileWorking: 7000 }); i.withdrawals.order = ['traditionalIra', 'brokerage', 'rothIra', 'traditionalWorkplace', 'rothWorkplace'];
      i.taxes.conversionsAndTransfers = [WIN({ fromAge: 57, throughAge: 57, fromAccount: 'rothWorkplace', toAccount: 'rothIra', howMuch: 'wholeBalance' }), WIN({ fromAge: 57, throughAge: 59, fromAccount: 'traditionalWorkplace', toAccount: 'traditionalIra', howMuch: 'fixedAmount', fixedAmount: 40000 }),
        WIN({ fromAge: 58, throughAge: 60, fromAccount: 'traditionalIra', toAccount: 'rothIra', howMuch: 'fillBracket', fillToTopOfBracket: 0.22 }), WIN({ fromAge: 61, throughAge: 62, fromAccount: 'traditionalWorkplace', toAccount: 'rothWorkplace', howMuch: 'fixedAmount', fixedAmount: 30000 })]; };
    checkConservation(E.simulate(withInputs(ira)), 'IRAs');
    for (const seed of [5, 6]) checkConservation(E.simulate(withInputs(ira), { rng: E.mulberry32(seed) }), `IRAs seed ${seed}`);
    checkConservation(E.simulate(withInputs((i) => { ira(i); i.spending.baseMonthly = 15000; i.withdrawals.strategy = 'bracketFill'; i.withdrawals.oneTimeOutflowsFromRothFirst = true; })), 'IRAs fill');
    checkConservation(E.simulate(withInputs((i) => { ira(i); i.withdrawals.strategy = 'proportional'; i.spending.baseMonthly = 12000; })), 'IRAs proportional');
  });

  // --- Cash (checking) ------------------------------------------------------------------------------
  test('With surplus held in cash turned off, every surplus is reinvested', () => {
    const res = E.simulate(withInputs((i) => { i.checkingAndMoneyMarket.moneyMarket.keepSurplus = false; i.taxes.bracketGrowthBelowInflation = 0; }));
    near(res.summary.endingBalance, 9972202, 1, 'ending balance');
    ok(res.years.every((r) => r.balCash === 0), 'no cash');
  });
  test('Surplus is held in cash up to the cap (today’s $); the rest is invested', () => {
    const res = E.simulate(BASE());
    ok(res.years.every((r) => r.balCash <= 100000 * r.idx + 0.01), 'cash never above cap');
    const r = res.years.find((y) => y.year === 2042);
    near(r.balCash, 100000 * r.idx, 0.01, 'cash at cap by 2042');
    ok(r.depositTaxable > 0, 'excess invested');
    const capped = E.simulate(withInputs((i) => { i.checkingAndMoneyMarket.moneyMarket.moveToBrokerageAbove = 1e9; }));
    ok(capped.years.every((y) => y.depositTaxable === 0), 'huge cap: nothing reinvested');
  });
  test('Cash above the cap is swept into the taxable account', () => {
    const res = E.simulate(withInputs((i) => { i.checkingAndMoneyMarket.moneyMarket.balance = 300000; i.checkingAndMoneyMarket.moneyMarket.moveToBrokerageAbove = 100000; }));
    const r = res.years[0];
    near(r.sweep, 200000, 0.01, 'sweep');
    near(r.balCash, 100000, 0.01, 'cash at cap');
  });
  test('Cash is drawn before the configured withdrawal order', () => {
    const res = E.simulate(withInputs((i) => { i.checkingAndMoneyMarket.moneyMarket.balance = 50000; i.checkingAndMoneyMarket.moneyMarket.keepSurplus = false; i.brokerage.balance = 100000; i.spending.baseMonthly = 12000; i.spending.oneTimeEvents = []; i.household.currentYear = 2040; }));
    const r = res.years[0];
    near(r.wCash, 50000, 0.01, 'cash used up first');
    ok(r.wTaxable > 0, 'then taxable');
  });
  test('Cash interest is paid out as taxable income', () => {
    const res = E.simulate(withInputs((i) => { i.checkingAndMoneyMarket.moneyMarket.balance = 50000; i.checkingAndMoneyMarket.moneyMarket.yield = 0.02; }));
    const r = res.years[0];
    near(r.cashInterest, 1000, 1e-9);
    const t = E.computeTaxes({ ordinary: r.salary - r.contribEmpTrad + 1000, ltcg: 0, ss: 0, status: 'mfj', year: 2026, scale: 1 });
    near(r.agi, t.agi, 0.01, 'interest in AGI');
  });

  test('Benefits received while still working are spent with salary by default (not saved)', () => {
    const res = E.simulate(withInputs((i) => { i.employment.you.retirementAge = 62; i.spending.oneTimeEvents = []; }));
    const r = res.years.find((y) => y.year === 2041);
    ok(r.phase === 'Working' && r.ssSpouse > 0, 'spouse SS while working');
    near(r.coveredIncome, r.ssSpouse, 1e-9, 'covered by living costs');
    near(r.deposit, 0, 0.01, 'nothing saved');
    near(r.portfolioTax, 0, 0.01, 'its tax is paid with it');
    ok(res.years.filter((y) => y.phase === 'Working').every((y) => y.balCash < 0.01), 'checking stays at 0 while working');
    ok(res.warnings.some((w) => w.code === 'incomeWhileWorking' && w.text.includes('spent on living costs')), 'note explains it');
  });
  test('Benefits received while still working are saved when that option is off', () => {
    const res = E.simulate(withInputs((i) => { i.employment.you.retirementAge = 62; i.employment.spendBenefitsThatStartBeforeRetiring = false; }));
    const r = res.years.find((y) => y.year === 2041);
    ok(r.phase === 'Working' && r.ssSpouse > 0, 'spouse SS while working');
    near(r.deposit, r.ssSpouse - r.portfolioTax, 0.01, 'SS minus its tax is saved');
    ok(res.warnings.some((w) => w.code === 'incomeWhileWorking' && w.text.includes('2040')), 'note explains it');
    ok(!E.simulate(BASE()).warnings.some((w) => w.code === 'incomeWhileWorking'), 'no note for defaults');
  });

  test('Lifetime totals: taxes add up and spending covers retired years', () => {
    const res = E.simulate(withInputs((i) => { i.otherTaxes = [TAX({ name: 'State', flatRate: 0.04, appliesTo: { wages: true, fersAnnuity: true, traditionalTsp: true, interest: true } }),
      TAX({ name: 'Abroad', fromYear: 2045, flatRate: 0.3, creditsFederalTax: true, appliesTo: { fersAnnuity: true } })]; }));
    const S = res.summary;
    near(S.lifetimeTax, S.lifetimeFederalTax + S.lifetimeOtherTax, 0.01, 'total = federal + other');
    near(S.lifetimeOtherTax, S.lifetimeOtherByEntry[0] + S.lifetimeOtherByEntry[1], 0.01, 'other = the sum of the entries');
    ok(S.lifetimeOtherByEntry.every((x) => x > 0) && S.lifetimeOtherCredit > 0, 'both present, with a credit');
    const retired = res.years.filter((r) => r.phase !== 'Working');
    near(S.lifetimeSpending, retired.reduce((t, r) => t + r.spendBase + r.fehb + r.partB, 0), 0.01, 'recurring spending');
    near(S.lifetimeOneTimeOut, res.years.reduce((t, r) => t + r.oneTimeOut, 0), 0.01, 'one-time outflows');
  });

  // --- State, local and foreign taxes ------------------------------------------------------------------
  // The base household: you retire at 57 (2040) with 30 years; your spouse (born 1973, dies 2059) has Social Security only;
  // 3% inflation.
  const otIn = (taxes, mut) => withInputs((i) => { i.otherTaxes = taxes; i.spending.oneTimeEvents = []; if (mut) mut(i); });
  const yr = (res, y) => res.years.find((r) => r.year === y);
  const gro = (y, gap) => Math.pow(1.03 - (gap || 0), y - 2026);
  test('A flat tax: the checked income less the deduction, from its first year through its last', () => {
    const res = E.simulate(otIn([TAX({ flatRate: 0.05, deduction: 10000, fromYear: 2041, throughYear: 2050, appliesTo: { fersAnnuity: true, interest: true } })]));
    const r = yr(res, 2045), d = r.otherByEntry[0];
    near(d.income, r.pension + r.cashInterest + r.checking.interest, 1e-6, 'annuity + interest');
    near(r.otherTax, 0.05 * (d.income - 10000 * gro(2045)), 1e-6, "5% after the deduction (today's $, inflated)");
    near(r.totalTax, r.federalTax + r.otherTax, 1e-6, 'total = federal + other');
    ok(yr(res, 2040).otherTax === 0 && yr(res, 2051).otherTax === 0 && yr(res, 2041).otherTax > 0 && yr(res, 2050).otherTax > 0, '2041–2050 only');
    ok(d.byType.socialSecurity === undefined && yr(res, 2040).otherByEntry === null, 'unchecked types and inactive years are not counted');
  });
  test('Brackets apply to taxable income; thresholds and the deduction grow with inflation less the gap', () => {
    const br = [{ from: 0, rate: 0.02 }, { from: 10000, rate: 0.05 }, { from: 40000, rate: 0.08 }];
    const t = (gap, b) => E.simulate(otIn([TAX({ rates: 'brackets', brackets: b || br, deduction: 5000, thresholdGrowthBelowInflation: gap, appliesTo: { fersAnnuity: true } })]));
    for (const gap of [0, 0.01]) {
      const r = yr(t(gap), 2045), g = gro(2045, gap), x = Math.max(0, r.pension - 5000 * g);
      near(r.otherTax, 0.02 * Math.min(x, 10000 * g) + 0.05 * Math.max(0, Math.min(x, 40000 * g) - 10000 * g) + 0.08 * Math.max(0, x - 40000 * g), 1e-6, `gap ${gap}`);
    }
    near(yr(t(0, br.slice().reverse()), 2045).otherTax, yr(t(0), 2045).otherTax, 1e-9, 'brackets in any order');
  });
  test('Separate returns: each spouse\'s own income on their own brackets and joint income split; one return after a death', () => {
    const br = [{ from: 0, rate: 0.02 }, { from: 20000, rate: 0.06 }];
    const run = (filing) => E.simulate(otIn([TAX({ filing, rates: 'brackets', brackets: br, appliesTo: { fersAnnuity: true, interest: true, socialSecurity: true } })]));
    const tax = (x, y) => { const g = gro(y); return 0.02 * Math.min(x, 20000 * g) + 0.06 * Math.max(0, x - 20000 * g); };
    // Social Security counts at its federally taxable amount, shared pro rata.
    const parts = (r) => { const f = r.ssYou + r.ssSpouse > 0 ? r.taxableSS / (r.ssYou + r.ssSpouse) : 0;
      return [r.per.you.pension + r.ssYou * f, (r.per.spouse ? r.per.spouse.pension : 0) + r.ssSpouse * f, r.cashInterest + r.checking.interest]; };
    const S = yr(run('separate'), 2045), H = yr(run('household'), 2045), [y, s, j] = parts(S), [hy, hs, hj] = parts(H);
    ok(s > 0 && y > 0, 'both have income');
    near(S.otherTax, tax(y + j / 2, 2045) + tax(s + j / 2, 2045), 1e-6, 'two returns');
    near(H.otherTax, tax(hy + hs + hj, 2045), 1e-6, 'one household return');
    ok(S.otherTax < H.otherTax, 'splitting income lowers a progressive tax');
    const d = yr(run('separate'), 2062), [dy, ds, dj] = parts(d);
    near(d.otherTax, tax(dy + ds + dj, 2062), 1e-6, 'after your spouse dies (2059), one return');
  });
  test('Retirement-income exclusion: up to the amount for each person from the age, on retirement income only', () => {
    const res = E.simulate(otIn([TAX({ flatRate: 0.05, retirementExclusion: 20000, exclusionFromAge: 65, appliesTo: { fersAnnuity: true, interest: true } })]));
    const r64 = yr(res, 2047), r65 = yr(res, 2048); // you turn 65 in 2048
    near(r64.otherByEntry[0].excluded, 0, 0, 'none before 65');
    near(r64.otherTax, 0.05 * r64.otherByEntry[0].income, 1e-6, 'all of it taxed');
    near(r65.otherByEntry[0].excluded, Math.min(r65.pension, 20000 * gro(2048)), 1e-6, "the annuity, up to the amount (today's $, inflated)");
    near(r65.otherTax, 0.05 * (r65.otherByEntry[0].income - r65.otherByEntry[0].excluded), 1e-6, 'interest is not retirement income');
  });
  test('Credit for federal tax: reduced by the federal tax on the same income, credited once; Roth carries none', () => {
    const one = (credit) => yr(E.simulate(otIn([TAX({ flatRate: 0.3, creditsFederalTax: credit, appliesTo: { fersAnnuity: true } })])), 2047);
    const a = one(false), b = one(true);
    near(a.otherTax, 0.3 * a.pension, 1e-6, 'without: 30% of the annuity');
    near(b.otherCredit, b.federalTax * b.pension / b.agi, 1e-6, "credit = federal tax × the annuity's share of AGI");
    near(b.otherTax, 0.3 * b.pension - b.otherCredit, 1e-6, 'with: less the credit');
    const two = yr(E.simulate(otIn([TAX({ flatRate: 0.3, creditsFederalTax: true, appliesTo: { fersAnnuity: true } }), TAX({ flatRate: 0.3, creditsFederalTax: true, appliesTo: { fersAnnuity: true } })])), 2047);
    near(two.otherCredit, two.federalTax * two.pension / two.agi, 1e-6, 'two such taxes on the same income credit its federal tax once');
    const roth = yr(E.simulate(otIn([TAX({ flatRate: 0.2, creditsFederalTax: true, rothAmountTaxed: 'whole', appliesTo: { rothTsp: true } })], (i) => {
      i.workplacePlans.you.balances.roth = 500000; i.withdrawals.order = ['rothWorkplace', 'brokerage', 'traditionalWorkplace', 'traditionalIra', 'rothIra']; i.spending.baseMonthly = 9000;
      i.checkingAndMoneyMarket.moneyMarket.balance = 0; })), 2041);
    ok(roth.wRoth > 0, 'Roth drawn');
    near(roth.otherCredit, 0, 1e-9, 'no federal tax on Roth money to credit');
    near(roth.otherTax, 0.2 * roth.wRoth, 0.01, '20% of the Roth withdrawal');
  });
  test('Roth withdrawals: only the earnings share, pro rata, so converted money is never taxed twice; or the whole withdrawal', () => {
    const inp = (amt) => otIn([TAX({ flatRate: 0.2, rothAmountTaxed: amt, appliesTo: { rothTsp: true, rothConversions: true } })], (i) => {
      i.workplacePlans.you.balances.roth = 100000; i.workplacePlans.you.balances.rothBasisShare = 0.6; i.spending.baseMonthly = 9000;
      i.withdrawals.order = ['rothWorkplace', 'brokerage', 'traditionalWorkplace', 'traditionalIra', 'rothIra'];
      i.taxes.conversionsAndTransfers = [WIN({ fromAge: 57, throughAge: 57, howMuch: 'fixedAmount', fixedAmount: 50000 })];
    });
    const res = E.simulate(inp('earnings')), r = yr(res, 2041), prev = yr(res, 2040);
    ok(r.wRoth > 0, 'Roth drawn');
    near(r.basis.rothEarnings, r.wRoth * (1 - prev.basis.roth / r.startRoth), 0.01, 'earnings share = 1 − basis ÷ balance at the start of the year');
    near(r.otherByEntry[0].byType.rothTsp, r.basis.rothEarnings, 0.01, 'only the earnings share is taxed');
    ok(prev.conversion > 0 && prev.basis.roth >= prev.conversion, 'the conversion (taxed when made) becomes basis');
    let basisTaken = 0;
    for (const y of res.years) basisTaken += y.wRoth - y.basis.rothEarnings;
    ok(basisTaken <= 100000 * 0.6 + res.years.reduce((t, y) => t + y.conversion + y.contribEmpRoth, 0) + 0.01, 'basis withdrawn never exceeds contributions + conversions');
    const whole = yr(E.simulate(inp('whole')), 2041);
    near(whole.otherByEntry[0].byType.rothTsp, whole.wRoth, 1e-6, 'or the whole withdrawal');
  });
  test('The TSP and a 401(k), FERS and other pensions are separate types (e.g. a treaty covering federal pensions only)', () => {
    const res = E.simulate(otIn([TAX({ flatRate: 0.2, appliesTo: { traditional401k: true, otherPensions: true } })], (i) => {
      i.workplacePlans.spouse.balances.traditional = 40000; Object.assign(i.otherPension.spouse, { monthly: 1000, startAge: 65 }); i.spending.baseMonthly = 12000;
      i.withdrawals.order = ['traditionalWorkplace', 'brokerage', 'rothWorkplace', 'traditionalIra', 'rothIra'];
    }));
    const r = yr(res, 2040), d = r.otherByEntry[0]; // the older spouse's 401(k) goes first and runs out this year
    ok(r.flows.trad.withdraw > 0 && r.flows.tradS.withdraw > 0, "your TSP and your spouse's 401(k) are both drawn");
    near(d.byType.traditional401k, r.flows.tradS.withdraw, 1e-6, "your spouse's 401(k) counts");
    near(d.byType.otherPensions, r.per.spouse.pension, 1e-6, 'and their pension');
    near(d.income, r.flows.tradS.withdraw + r.per.spouse.pension, 1e-6, 'your TSP and FERS annuity do not');
  });
  test('A tax on wages while you work is paid from the salaries, not the portfolio', () => {
    const r = yr(E.simulate(otIn([TAX({ flatRate: 0.05, appliesTo: { wages: true } })])), 2030), z = yr(E.simulate(otIn([])), 2030);
    near(r.otherTax, 0.05 * (r.salary - r.contribEmpTrad), 1e-6, '5% of taxable pay');
    near(r.wageTax - z.wageTax, r.otherTax, 1e-6, 'in the tax paid by the salaries');
    near(r.portfolioTax, z.portfolioTax, 1e-6, 'not from the portfolio');
  });

  // --- Monte Carlo ---------------------------------------------------------------------------------
  test('Monte Carlo is reproducible with a fixed seed', () => {
    const inp = withInputs((i) => { i.spending.baseMonthly = 9000; });
    const a = E.monteCarlo(inp, { runs: 200, seed: 42 });
    const b = E.monteCarlo(inp, { runs: 200, seed: 42 });
    near(a.successRate, b.successRate, 0);
    near(a.p50.nominal[20], b.p50.nominal[20], 0);
    ok(a.p10.nominal[20] <= a.p50.nominal[20] && a.p50.nominal[20] <= a.p90.nominal[20], 'ordered percentiles');
  });
  test('SS claim comparison break-even 62 vs 70 near age 80½', () => {
    const cmp = E.ssClaimComparison(BASE());
    const be = cmp[0].breakEvens.find((b) => b.early === 62 && b.late === 70);
    ok(be && be.age > 79 && be.age < 82, 'break-even ' + (be && be.age));
  });
  test('normalizeInputs fills missing fields and ignores junk', () => {
    const n = E.normalizeInputs({ household: { you: { birthYear: '1980' } }, bogus: 1, withdrawals: { strategy: 'fill', order: 'rothIra, brokerage, nope' },
      otherTaxes: [{ filing: 'joint', brackets: [{ from: '1000', rate: 0.02 }] }], taxes: { conversionsAndTransfers: [{ fromAccount: 'traditionalWorkplace', toAccount: 'rothIra', howMuch: 'all', fillToTopOfBracket: 22 }] } });
    near(n.household.you.birthYear, 1980);
    ok(n.bogus === undefined && n.workplacePlans.you.balances.traditional === E.defaultInputs().workplacePlans.you.balances.traditional, 'merged');
    ok(n.withdrawals.strategy === 'fixedOrder' && n.otherTaxes[0].filing === 'household', 'values that are not allowed fall back to the default');
    ok(n.otherTaxes[0].brackets[0].from === 1000 && n.otherTaxes[0].flatRate === 0.05 && n.otherTaxes[0].appliesTo.wages === true, 'list items in list items default field by field');
    ok(JSON.stringify(n.withdrawals.order) === JSON.stringify(['rothIra', 'brokerage', 'traditionalWorkplace', 'rothWorkplace', 'traditionalIra']), 'order: a string is accepted, unknown names dropped, missing ones appended');
    const w = n.taxes.conversionsAndTransfers[0];
    ok(w.howMuch === 'fillBracket' && w.fillToTopOfBracket === 0.22 && w.throughAge === 62, 'row fields default individually');
    const d = clone(BASE());
    ok(JSON.stringify(E.normalizeInputs(d)) === JSON.stringify(d), 'idempotent');
  });

  // --- The spouse: their own job, workplace plan, IRAs and pension ------------------------------------
  // The base household: you born 1983 (retiring at 57 with 30 years, partial survivor election) and a spouse born 1973;
  // 3% inflation.
  test('A spouse under FERS gets their own annuity, supplement and survivor protection, in both directions', () => {
    const plan = (o) => withInputs((i) => {
      Object.assign(i.employment.spouse, { federal: true, salary: 90000, annualRaise: 0.02, retirementAge: 57 });
      Object.assign(i.fersPension.spouse, { serviceYears: 30, sickLeaveHours: 0, survivorElection: 'full', high3Mode: 'auto' });
      Object.assign(i.fersSupplement.spouse, { mode: 'auto', ssAt62FromFersMonthly: 0 });
      if (o) o(i);
    });
    const res = E.simulate(plan()), F = res.summary.people.spouse.fers, at = (y) => res.years.find((r) => r.year === y);
    ok(F && F.rule === 'MRA+30' && F.supplementEligible && res.summary.people.spouse.federal, 'MRA+30 at 57 (MRA 57 for 1973)');
    const sal = (y) => 90000 * Math.pow(1.02, y - 2026);
    near(F.high3, (sal(2027) + sal(2028) + sal(2029)) / 3, 1e-6, 'High-3 from the spouse\'s own pay');
    near(at(2030).per.spouse.pension, 0.01 * 30 * F.high3 * 0.9, 1e-6, 'basic annuity less 10% for the full survivor election while you live');
    near(at(2030).per.spouse.supplement, 0.7 * 1900 * Math.pow(1.03, 4) * 30 / 40 * 12, 1e-6, 'supplement: 70% of the spouse\'s PIA × 30/40');
    near(at(2035).per.spouse.supplement, 0, 0, 'ends at 62');
    near(at(2030).pension, at(2030).per.you.pension + at(2030).per.spouse.pension, 1e-9, 'household annuity = both');
    ok(at(2029).per.spouse.contribEmployer > 0 && near(at(2029).per.spouse.contribEmployer, at(2029).per.spouse.salary * 0.01, 1e-6) === undefined, 'TSP: 1% automatic with no contribution');
    // The spouse dies at 70 (2043): the survivor annuity (50% of the unreduced annuity) goes to you, and your own
    // partial election's 5% reduction stops.
    const widow = E.simulate(plan((i) => { i.household.spouse.lifespan = 70; }));
    const w = (y) => widow.years.find((r) => r.year === y);
    ok(w(2043).per.spouse.pension > 0 && w(2044).per.spouse.pension === 0, 'the spouse\'s annuity stops after their death');
    near(w(2044).per.spouse.survivorAnnuity, 0.5 * w(2043).per.spouse.pension / 0.9 * (1 + w(2044).per.spouse.colaApplied), 0.01, '50% survivor annuity, with the COLA');
    near(w(2044).survivorAnnuity, w(2044).per.spouse.survivorAnnuity, 1e-9, 'paid to you');
    near(w(2044).per.you.pension / w(2043).per.you.pension, (1 + w(2044).per.you.colaApplied) / 0.95, 1e-9, 'your 5% partial-election reduction stops');
    checkConservation(widow, 'two FERS annuities');
  });
  test('A spouse\'s 401(k): the employer formula, RMDs at the spouse\'s age, and the survivor owns it after a death', () => {
    const plan = (o) => withInputs((i) => {
      Object.assign(i.employment.spouse, { federal: false, salary: 80000, annualRaise: 0.02, retirementAge: 60 });
      Object.assign(i.workplacePlans.spouse, { balances: { traditional: 200000, roth: 10000, rothBasisShare: 1 }, contributions: { rate: 0.10, rothShare: 0.25, catchUp: false },
        employerContributions: { automatic: 0.02, match: 0.5, matchUpTo: 0.06 } });
      if (o) o(i);
    });
    const res = E.simulate(plan()), at = (y) => res.years.find((r) => r.year === y);
    const r27 = at(2027), s = r27.per.spouse;
    near(s.salary, 80000 * 1.02, 1e-6, 'pay grows with the raise (no GS steps)');
    near(s.contribTrad, s.salary * 0.075, 1e-6, '10% contribution, 75% traditional');
    near(s.contribRoth, s.salary * 0.025, 1e-6, '25% Roth');
    near(s.contribEmployer, s.salary * (0.02 + 0.5 * 0.06), 1e-6, '2% automatic + 50% of the contribution up to 6% of pay');
    near(r27.flows.tradS.contrib, s.contribTrad + s.contribEmployer, 1e-9, 'into the spouse\'s traditional 401(k)');
    near(r27.flows.trad.contrib, r27.per.you.contribTrad + r27.per.you.contribEmployer, 1e-9, 'yours stay in your TSP');
    ok(at(2033).per.spouse.salary === 0 && at(2032).per.spouse.salary > 0, 'the spouse retires at 60 (2033)');
    const first = res.years.find((r) => r.per.spouse.rmd > 0);
    ok(first && first.year === 2048, 'RMDs at the spouse\'s 75 (born 1973), before yours (2058)');
    near(first.per.spouse.rmd, first.flows.tradS.start / 24.6, 0.01, 'RMD = prior year-end balance ÷ divisor');
    // The spouse dies in 2049 (lifespan 76): you own the 401(k) and your age drives its RMDs (66 in 2050: none yet).
    const d = E.simulate(plan((i) => { i.household.spouse.lifespan = 76; }));
    const r50 = d.years.find((r) => r.year === 2050);
    ok(r50.flows.tradS.start > 0 && r50.per.spouse.rmd === 0 && r50.rmd === 0, 'no RMD from the inherited 401(k) until your own RMD age');
    const r58 = d.years.find((r) => r.year === 2058);
    near(r58.per.spouse.rmd, r58.flows.tradS.start / 24.6, 0.01, 'at your 75 it pays an RMD by your age');
    checkConservation(d, 'spouse 401(k)');
  });
  test('Another pension: today\'s dollars when it starts, then its own COLA; the survivor keeps their share', () => {
    const res = E.simulate(withInputs((i) => {
      i.employment.spouse.federal = false;
      Object.assign(i.otherPension.spouse, { monthly: 2000, startAge: 65, cola: 0.02, survivorShare: 0.5 });
      i.household.spouse.lifespan = 75;
    }));
    const at = (y) => res.years.find((r) => r.year === y);
    ok(at(2037).per.spouse.pension === 0, 'nothing before 65 (2038)');
    near(at(2038).per.spouse.pension, 2000 * 12 * Math.pow(1.03, 12), 1e-6, 'today\'s $ inflated to the start');
    near(at(2039).per.spouse.pension, at(2038).per.spouse.pension * 1.02, 1e-6, 'then its 2% COLA');
    near(at(2049).per.spouse.survivorAnnuity, 0.5 * at(2038).per.spouse.pension * Math.pow(1.02, 11), 1e-6, 'after the death (2048), half to you, COLA continuing');
    ok(res.milestones.some((m) => m.key === 'pensionSpouse' && m.year === 2038), 'milestone');
    ok(res.summary.people.spouse.otherPension.startYear === 2038 && !res.summary.people.spouse.federal, 'summary');
  });
  test('A manual High-3 is used as entered; an OPM estimate and a manual supplement are today\'s dollars, inflated to the year they apply', () => {
    // You retire at 57 (2040) with 30 years (MRA+30, 1% multiplier, partial election while your spouse lives); 3% inflation.
    const g = (y) => Math.pow(1.03, y - 2026), at = (res, y) => res.years.find((r) => r.year === y);
    const manual = (o) => E.simulate(withInputs((i) => { i.fersPension.you.high3Mode = 'manual'; i.fersPension.you.manualHigh3 = 100000; }), o);
    const hi = manual();
    near(hi.summary.fers.high3, 100000, 1e-6, 'High-3 as entered');
    near(at(hi, 2040).per.you.pension, 0.01 * 30 * 100000 * 0.95, 1e-6, 'the annuity from it');
    const hiPath = at(manual({ inflationPath: Array.from({ length: 80 }, (_, k) => (k < 5 ? 0.06 : 0.02)) }), 2040);
    near(hiPath.per.you.pension, 0.01 * 30 * 100000 * 0.95, 1e-6, 'not rescaled by a run’s inflation');
    const opm = (o) => E.simulate(withInputs((i) => { i.fersPension.you.useOpmEstimate = true; i.fersPension.you.opmEstimateMonthly = 3000; }), o);
    near(at(opm(), 2040).per.you.pension, 3000 * 12 * g(2040) * 0.95, 1e-6, 'OPM estimate inflated to its first year');
    const su = E.simulate(withInputs((i) => { i.fersSupplement.you.mode = 'manual'; i.fersSupplement.you.manualMonthly = 2000; }));
    near(at(su, 2040).per.you.supplement, 2000 * 12 * g(2040), 1e-6, 'manual supplement inflated to the retirement year');
    near(su.summary.fers.supplementMonthly, 2000 * g(2040), 1e-6, 'and in the summary');
    // Like Social Security, each run (here a fixed inflation path) uses its own inflation.
    const r40 = at(opm({ inflationPath: Array.from({ length: 80 }, (_, k) => (k < 5 ? 0.06 : 0.02)) }), 2040);
    near(r40.per.you.pension, 3000 * 12 * r40.idx * 0.95, 1e-6, 'the run’s own inflation');
  });
  test('Within an account type, the spouse who can withdraw without a penalty goes first, then the older spouse', () => {
    const res = E.simulate(withInputs((i) => {
      i.iras.you.traditional.balance = 300000; i.iras.spouse.traditional.balance = 300000; i.spending.baseMonthly = 12000;
      i.withdrawals.order = ['traditionalIra', 'brokerage', 'traditionalWorkplace', 'rothWorkplace', 'rothIra'];
    }));
    const r = res.years.find((x) => x.year === 2040); // you 57, spouse 67
    ok(r.flows.tradIraS.withdraw > 0 && r.flows.tradIra.withdraw === 0, 'the spouse\'s IRA (67) before yours (57)');
    ok(r.ira.trad.penalty === 0, 'so no early-withdrawal penalty');
    checkConservation(res, 'two IRAs');
  });
  test('A conversion row owned by the spouse uses the spouse\'s ages and accounts', () => {
    const res = E.simulate(withInputs((i) => {
      i.workplacePlans.spouse.balances.traditional = 300000;
      i.taxes.conversionsAndTransfers = [WIN({ owner: 'spouse', fromAge: 60, throughAge: 62, howMuch: 'fixedAmount', fixedAmount: 20000 })];
    }));
    const at = (y) => res.years.find((r) => r.year === y);
    near(at(2033).flows.tradS.convOut, 20000 * Math.pow(1.03, 7), 1e-6, 'at the spouse\'s 60 (2033), from the spouse\'s 401(k)');
    near(at(2033).flows.rothS.convIn, at(2033).flows.tradS.convOut, 1e-9, 'into the spouse\'s Roth 401(k)');
    ok(at(2033).flows.trad.convOut === 0 && at(2036).conversion === 0 && at(2032).conversion === 0, 'not yours, and only at 60–62');
    checkConservation(res, 'spouse conversion');
  });
  test('Single: the spouse\'s settings are ignored', () => {
    const single = (o) => E.simulate(withInputs((i) => { i.household.married = false; if (o) o(i); }));
    const a = single(), b = single((i) => {
      i.workplacePlans.spouse.balances.traditional = 500000; i.iras.spouse.roth.balance = 100000; i.employment.spouse.salary = 90000;
      i.otherPension.spouse.monthly = 3000; i.employment.spouse.federal = true;
    });
    ok(b.years.every((r) => r.flows.tradS.start === 0 && r.flows.rothIraS.start === 0 && r.per.spouse === null), 'no spouse accounts');
    near(b.summary.endingBalance, a.summary.endingBalance, 1e-6, 'same result');
  });
  test('A spouse still working after you retire: take-home pay reaches the household and is taxed', () => {
    const plan = (salary) => E.simulate(withInputs((i) => {
      Object.assign(i.employment.spouse, { federal: false, salary, annualRaise: 0.02, retirementAge: 70 });
      Object.assign(i.workplacePlans.spouse.contributions, { rate: 0.08, rothShare: 0.5 });
    }));
    const r = plan(50000).years.find((x) => x.year === 2040), z = plan(0).years.find((x) => x.year === 2040), s = r.per.spouse;
    ok(r.phase === 'Retired' && s.salary > 0, 'you retired in 2040; your spouse still works');
    near(r.cashIn - z.cashIn, s.salary - s.contribTrad - s.contribRoth, 1e-6, 'pay less plan contributions is cash in');
    near(r.ordinaryIncome - r.wTrad - (z.ordinaryIncome - z.wTrad), s.salary - s.contribTrad, 1e-6, 'pay less traditional contributions is taxable');
    checkConservation(plan(50000), 'working spouse');
  });

  // --- Defaults and regression anchors ----------------------------------------------------------------
  test('Regression anchors hold for plan 1 (worked by hand)', () => {
    const res = E.simulate(PLAN1());
    // 2026 wages $125,000 less the 5% traditional contribution, minus the $32,200 deduction: 10% to $24,800, then 12%.
    near(res.years[0].federalTax, 2480 + 0.12 * (125000 * 0.95 - 32200 - 24800), 0.01, '2026 federal tax, rothShare 0 ($9,890)');
    near(E.simulate(planWith((i) => { i.workplacePlans.you.contributions.rothShare = 1; })).years[0].federalTax, 2480 + 0.12 * (125000 - 32200 - 24800), 0.01, 'rothShare 1 ($10,640)');
    const F = res.summary.fers, sal = (y) => 125000 * Math.pow(1.0201, y - 2026), h3 = (sal(2037) + sal(2038) + sal(2039)) / 3;
    near(F.high3, h3, 0.01, 'High-3 ($158,738)'); near(F.basicAnnuity, 0.01 * 30 * h3, 0.01, 'basic annuity ($47,621)');
    near(res.years.find((y) => y.year === 2040).pension, 0.95 * 0.01 * 30 * h3, 0.01, 'after 5% partial survivor reduction ($45,240)');
    near(F.supplementMonthly, 2000 * Math.pow(1.03, 14) * 30 / 40, 0.01, 'supplement ($2,269/mo)');
    near(E.ssClaimFactor(70, 804), 1.24); near(E.ssClaimFactor(67, 804), 1.0); near(E.ssClaimFactor(62, 804), 0.7);
    const rmd = res.years.find((y) => y.rmd > 0);
    ok(rmd.ageYou === 75, 'RMD at 75'); near(rmd.rmd, rmd.startTrad / 24.6, 1e-6, 'RMD = prior balance / 24.6');
    near(E.simulate(planWith((i) => { i.taxes.bracketGrowthBelowInflation = 0; })).summary.endingBalance, 2434284, 1, 'ending balance (brackets indexed at full inflation)');
  });
  test('Defaults are the example household', () => {
    const d = E.defaultInputs();
    ok(d.household.you.birthYear === 1982 && d.employment.you.salary === 101443 && d.employment.you.retirementAge === 62 && d.fersPension.you.serviceYears === 28,
      'a GS-12 (step 5, Rest of U.S.) ten years in, retiring at 62 with 28 years');
    const S = E.simulate(d).summary;
    ok(S.fers.rule === '62+5' && S.fers.multiplier === 0.011 && S.depletionYear === null, 'immediate annuity at the 1.1% multiplier; the projection never runs short');
    const after = (r) => r.afterRetirement;
    ok([d.iras.you.roth, d.iras.you.traditional, d.workplacePlans.you, d.brokerage].every((a) => after(a.returns) === after(d.workplacePlans.you.returns)),
      'every account earns the same after retirement by default');
  });
  test('Share links rebuild from the current defaults', () => {
    const c = E.inputsFromDiff({ spending: { baseMonthly: 4000 } });
    ok(c.spending.baseMonthly === 4000 && JSON.stringify({ ...c, spending: { ...c.spending, baseMonthly: E.defaultInputs().spending.baseMonthly } }) === JSON.stringify(E.defaultInputs()),
      'differences from today\'s defaults');
    ok(JSON.stringify(E.inputsFromDiff({})) === JSON.stringify(E.defaultInputs()), 'an empty diff is the defaults');
  });

  // --- Cash-flow check ------------------------------------------------------------------------------------
  test('Cash-flow check is ~0 in every year (deterministic and Monte Carlo)', () => {
    const cases = [PLAN1(), BASE(), planWith((i) => { i.withdrawals.bridgeBucket.enabled = true; }), planWith((i) => { i.spending.baseMonthly = 15000; }),
      withInputs((i) => { i.employment.you.retirementAge = 62; i.employment.spendBenefitsThatStartBeforeRetiring = false; i.checkingAndMoneyMarket.moneyMarket.balance = 30000; i.checkingAndMoneyMarket.moneyMarket.yield = 0.02; })];
    for (const inp of cases) {
      const res = E.simulate(inp);
      for (const r of res.years) near(r.cashCheck, 0, 1, `${r.year} check`);
      ok(!res.warnings.some((w) => w.code === 'cashCheck'), 'no check warning');
    }
    const rng = E.mulberry32(99);
    for (let k = 0; k < 20; k++) for (const r of E.simulate(PLAN1(), { rng, bucketPlan: null }).years) near(r.cashCheck, 0, 1, 'MC check');
  });

  // --- Bridge bucket ----------------------------------------------------------------------------------------
  test('Bridge bucket is funded at the present value of planned draws and spent first', () => {
    const inp = planWith((i) => { i.withdrawals.bridgeBucket.enabled = true; i.withdrawals.bridgeBucket.yearsCovered = 13; i.withdrawals.bridgeBucket.buildYearsBeforeRetirement = 5; i.withdrawals.bridgeBucket.return = 0.04; });
    const plan = E.computeBucketPlan(inp);
    const res = E.simulate(inp);
    ok(plan.fundYear === 2035 && plan.endYear === 2052, 'window 2035–2052');
    const fund = res.years.find((y) => y.year === 2035);
    let pv = 0; for (const [y, d] of Object.entries(plan.draws)) pv += d / Math.pow(1.04, +y - 2035);
    near(fund.bucketStart, pv, 0.01, 'funded at PV');
    near(res.summary.bucket.sizeAtFund, pv, 0.01, 'summary size');
    for (let y = 2040; y <= 2052; y++) {
      const r = res.years.find((x) => x.year === y);
      near(r.bucketDraw, Math.min(r.bucketStart, r.netWithdrawal), 0.01, `${y} drawn first`);
    }
    near(res.years.find((y) => y.year === 2052).bucket, 0, 0.01, 'merges back after the window');
    ok(res.years.filter((y) => y.year > 2052).every((y) => y.bucket === 0), 'no bucket after the window');
  });
  test('Bridge bucket has zero volatility in Monte Carlo', () => {
    const inp = planWith((i) => { i.withdrawals.bridgeBucket.enabled = true; i.spending.baseMonthly = 9000; });
    const plan = E.computeBucketPlan(inp);
    const res = E.simulate(inp, { rng: E.mulberry32(5), bucketPlan: plan });
    const rows = res.years.filter((y) => y.year >= plan.fundYear && y.year < plan.endYear);
    ok(rows.some((y) => Math.abs(y.marketReturn - 0.06) > 0.01), 'market returns are random');
    for (const r of rows) {
      if (r.bucketHeld > 1) near(r.bucket, r.bucketHeld * 1.04, 0.01, `${r.year} bucket grows at exactly 4%`);
      ok(r.bucketHeld <= Math.max(0, r.bucketStart - r.bucketDraw) + 0.01, 'held = start − drawn (capped at portfolio)');
    }
    checkConservation(res, 'bucket MC');
  });

  // --- Senior deduction ------------------------------------------------------------------------------------
  test('Senior deduction applies only in 2025–2028 and is never indexed', () => {
    const base = { ordinary: 100000, ltcg: 0, ss: 0, status: 'mfj', nOver65: 2, scale: 1 };
    const d = (year, extra) => E.computeTaxes({ ...base, year, ...extra }).seniorDeduction;
    near(d(2025), 12000); near(d(2028), 12000);
    near(d(2024), 0, 0, 'not before 2025'); near(d(2029), 0, 0, 'expires after 2028'); near(d(2040), 0);
    near(d(2028, { scale: 1.5 }), 12000, 1e-9, 'not indexed with inflation');
    near(d(2026, { ordinary: 200000 }), 2 * (6000 - 0.06 * 50000), 1e-9, 'phase-out 6% over $150k, per person');
    near(d(2026, { seniorDeduction: false }), 0, 0, 'toggle off');
  });

  // --- Core withdrawal rate --------------------------------------------------------------------------------
  test('Core withdrawal rate excludes one-time events and conversion tax', () => {
    const res = E.simulate(PLAN1());
    const y = (k) => res.years.find((x) => x.year === k);
    const ltc = y(2063);
    ok(ltc.oneTimeOut > 100000 && ltc.coreWithdrawalRate < ltc.withdrawalRate / 3, 'LTC year: core far below all-in');
    const conv = y(2040);
    ok(conv.conversionTax > 0 && conv.coreWithdrawal < conv.netWithdrawal, 'conversion year excludes conversion tax');
    const plain = y(2052);
    ok(plain.oneTimeOut === 0 && plain.conversion === 0 && plain.shortfall === 0, 'plain year');
    near(plain.coreWithdrawalRate, plain.withdrawalRate, 1e-6, 'equal when there is nothing to exclude');
    ok(res.summary.peakCoreWithdrawalRate < res.summary.peakWithdrawalRate, 'peak core below peak all-in');
  });
  test('Conversion tax includes the tax on the withdrawals that pay it: without the conversion the year pays the rest', () => {
    // The first conversion year (2041, age 58), so both runs start it with the same balances. No surplus or cash: the
    // TSP pays the conversion tax.
    const plan = (i) => { i.spending.oneTimeEvents = []; i.spending.baseMonthly = 9000; };
    const conv = E.simulate(withInputs((i) => { plan(i); i.taxes.conversionsAndTransfers = [WIN({ fromAge: 58, throughAge: 58 })]; })).years.find((y) => y.year === 2041);
    const none = E.simulate(withInputs(plan)).years.find((y) => y.year === 2041);
    ok(conv.conversion > 0 && conv.wTrad > none.wTrad + 1000, 'a TSP withdrawal pays the conversion tax');
    near(conv.totalTax - conv.conversionTax, none.totalTax, 1, 'tax without the conversion');
    near(conv.coreWithdrawal, none.coreWithdrawal, 1, 'core draw as without the conversion');
  });
  test('Bridge years: the net draw is withdrawals minus amounts saved over the bridge, with its conversion tax', () => {
    const res = E.simulate(withInputs((i) => { i.taxes.conversionsAndTransfers = [WIN({ fromAge: 58, throughAge: 60 })]; }));
    const S = res.summary, rows = res.years.filter((r) => r.year >= S.bridgeStartYear && r.year < S.bridgeEndYear);
    const sum = (f) => rows.reduce((t, r) => t + f(r), 0);
    const out = sum((r) => Object.values(r.flows).reduce((t, f) => t + f.withdraw, 0)), saved = sum((r) => r.deposit);
    near(S.bridgePortfolioUsed, out - saved, 0.01, 'withdrawals − saved');
    near(S.bridgeSaved, saved, 0.01, 'saved');
    near(S.bridgeConversionTax, sum((r) => r.conversionTax), 0.01, 'conversion tax');
    ok(rows.some((r) => r.netDraw < -1) && S.bridgePortfolioUsed < sum((r) => r.netWithdrawal) - 1, 'a year that saves offsets the draws');
  });
  test('IRMAA caused by a Roth conversion is the surcharge above the tier MAGI would give without it', () => {
    const inp = withInputs((i) => { i.spending.healthcare.medicarePartBSpouse = true; i.taxes.conversionsAndTransfers = [WIN({ fromAge: 58, throughAge: 58, howMuch: 'fixedAmount', fixedAmount: 300000 })]; });
    const res = E.simulate(inp), r = res.years.find((y) => y.year === 2043);
    ok(r.irmaaTier > 0 && r.irmaaFromConversion > 0, '2041 conversion raises the 2043 tier');
    ok(res.years.every((y) => y.irmaaFromConversion <= y.irmaaCost + 1e-6), 'never more than the surcharge');
    near(res.summary.lifetimeIrmaaFromConversions, res.years.reduce((t, y) => t + y.irmaaFromConversion, 0), 1e-6, 'summary');
    const none = E.simulate(withInputs((i) => { i.spending.healthcare.medicarePartBSpouse = true; })).summary;
    near(none.lifetimeIrmaaFromConversions, 0, 0, 'none without conversions');
  });
  test('A conversion into an account assumed to earn more than its source is flagged', () => {
    const into = (roth) => E.simulate(withInputs((i) => { i.taxes.conversionsAndTransfers = [WIN({ toAccount: 'rothIra' })]; i.iras.you.roth.returns.afterRetirement = roth; })).warnings;
    const w = into(0.07).find((x) => x.code === 'moveReturnGap');
    ok(w && w.level === 'info' && w.text.includes('7% after retirement instead of 5%'), 'Roth IRA 7% vs TSP 5%');
    ok(!into(0.05).some((x) => x.code === 'moveReturnGap'), 'same return: no warning');
  });
  test('A High-3 reports the years it averages and that pay in today\'s dollars', () => {
    const F = E.simulate(BASE()).summary.people.you.fers;
    ok(JSON.stringify(F.high3Years) === '[2037,2039]', 'the three years before retiring in 2040');
    const pay = (y) => 125000 * Math.pow(1.0201, y - 2026);
    near(F.high3, (pay(2037) + pay(2038) + pay(2039)) / 3, 0.01, 'nominal average');
    near(F.high3Today, [2037, 2038, 2039].reduce((t, y) => t + pay(y) / Math.pow(1.03, y - 2026), 0) / 3, 0.01, "today's dollars");
    const M = E.simulate(withInputs((i) => { i.fersPension.you.high3Mode = 'manual'; })).summary.people.you.fers;
    ok(JSON.stringify(M.high3Years) === '[2037,2039]', 'manual: the three years before retiring');
    near(M.high3Today, [2037, 2038, 2039].reduce((t, y) => t + 200000 / Math.pow(1.03, y - 2026), 0) / 3, 0.01, "manual: today's dollars");
  });

  // --- Mortality, inflation, adaptive rules, Monte Carlo metrics --------------------------------------------
  test('Life table: SSA 2023 period table, ages 0–119, sampler matches life expectancy', () => {
    const M = E.CONSTANTS.mortality;
    ok(M.male.length === 120 && M.female.length === 120 && M.male.every((q) => q > 0 && q <= 1), 'table shape');
    const rng = E.mulberry32(2024);
    const meanLife = (sex, age, n) => { let t = 0; for (let k = 0; k < n; k++) { const a = E.sampleDeathAge(rng, sex, age); ok(a >= age, 'never before current age'); t += a - age + 0.5; } return t / n; };
    near(meanLife('male', 45, 20000), M.eMale45, 0.35, 'male at 45');
    near(meanLife('female', 55, 20000), M.eFemale55, 0.35, 'female at 55');
  });
  test('Sampled death years drive survivor phase, filing, survivor annuity and SS, spending and RMDs', () => {
    const res = E.simulate(BASE(), { deathYears: { you: 2052, spouse: 2082 }, toLastDeath: true });
    ok(res.summary.endYear === 2082, 'runs to the last death');
    const a = res.years.find((y) => y.year === 2052), b = res.years.find((y) => y.year === 2053);
    ok(a.status === 'mfj' && b.status === 'single' && b.phase === 'Survivor', 'filing and phase');
    ok(a.pension > 0 && b.pension === 0 && b.survivorAnnuity > 0, 'survivor annuity starts');
    near(b.ssSpouse, 3100 * b.idx * E.ssClaimFactor(69, 804) * 12, 0.01, 'spouse takes your benefit with credits to 69');
    near(b.spendBase, 3800 * 12 * b.idx * 0.7, 0.01, 'survivor spending');
    near(b.rmd, b.startTrad / E.rmdDivisor(80), 0.01, 'RMD on the surviving spouse at 80');
  });
  test('Simulated inflation drives COLA, SS, tax indexing, spending and healthcare', () => {
    const path = Array.from({ length: 60 }, () => 0.03);
    path[2045 - 2026] = 0.05; path[2046 - 2026] = 0.01;
    const res = E.simulate(PLAN1(), { inflationPath: path });
    const r = res.years.find((y) => y.year === 2046);
    let idx = 1, hc = 1, tIdx = 1;
    for (let y = 2026; y < 2046; y++) { idx *= 1 + path[y - 2026]; hc *= 1 + 0.06 + (path[y - 2026] - 0.03); tIdx *= 1 + path[y - 2026] - 0.0025; }
    near(r.idx, idx, 1e-12, 'inflation index');
    near(r.colaApplied, E.dietCola(0.05), 1e-12, 'diet COLA uses last year’s CPI (5% → 4%)');
    near(res.years.find((y) => y.year === 2047).colaApplied, E.dietCola(0.01), 1e-12, '1% → 1%');
    near(r.ssSpouse, 1900 * idx * 12, 0.01, 'SS COLA = inflation');
    near(r.spendBase, 4800 * 12 * idx, 0.01, 'spending');
    near(r.fehb, 720 * 12 * hc, 0.01, 'healthcare = CPI + 3%');
    near(r.taxScale, tIdx, 1e-12, 'tax index = inflation − chained-CPI gap');
    near(r.deduction, (32200 + 1650) * tIdx, 0.01, 'deduction indexed');
  });
  test('Inflation AR(1): long-run SD stays inflationSd and lag-1 correlation ≈ φ', () => {
    const inp = planWith((i) => { i.monteCarlo.inflation.volatility = 0.015; i.monteCarlo.inflation.persistence = 0.6; });
    const rng = E.mulberry32(77);
    const devs = [];
    for (let k = 0; k < 300; k++) devs.push(E.simulate(inp, { rng, lite: true, bucketPlan: null }).years.map((y) => y.inflation - 0.03));
    const flat = devs.flat();
    const sd = Math.sqrt(flat.reduce((t, x) => t + x * x, 0) / flat.length);
    let num = 0, den = 0;
    for (const d of devs) for (let t = 1; t < d.length; t++) { num += d[t] * d[t - 1]; den += d[t - 1] * d[t - 1]; }
    near(sd, 0.015, 0.0008, 'long-run SD'); near(num / den, 0.6, 0.04, 'persistence');
  });
  test('Contingent SS claiming triggers in the age window at that age’s factor', () => {
    const inp = planWith((i) => { i.monteCarlo.adaptiveRules.earlySocialSecurity = { enabled: true, fromAge: 67, throughAge: 69, threshold: 'dollarAmount', shareOfPlan: 0.8, dollarAmount: 1e12 }; });
    const res = E.simulate(inp, { rng: E.mulberry32(3), rules: { detReal: {} } });
    const r = res.years.find((y) => y.year === 2050);
    ok(res.summary.ssTriggered.you && res.summary.people.you.claimAge === 67, 'you claim at 67 instead of 70');
    near(r.ssYou, 3100 * r.idx * 1.0 * 12, 0.01, 'benefit at the age-67 factor');
    ok(!res.summary.ssTriggered.spouse, 'spouse already claimed at 67');
    ok(E.simulate(inp).summary.people.you.claimAge === 70, 'deterministic plan unaffected');
  });
  test('Guardrails cut base spending with hysteresis and defer deferrable events', () => {
    const inp = planWith((i) => { i.monteCarlo.adaptiveRules.spendingGuardrails = { enabled: true, cutBelowShareOfPlan: 0.8, restoreAboveShareOfPlan: 0.95, spendingCut: 0.1, deferEventsUpToYears: 2 }; i.spending.oneTimeEvents[3].deferrable = true; });
    const base = E.simulate(inp);
    const detReal = {};
    for (const y of base.years) detReal[y.year] = y.year <= 2054 ? 1e12 : 1.0001; // way below plan until 2054, then far above
    const res = E.simulate(inp, { rules: { detReal } });
    const y = (k) => res.years.find((x) => x.year === k);
    ok(y(2040).guardCut && y(2054).guardCut && !y(2055).guardCut, 'cut while below, released after recovery');
    near(y(2042).spendBase, base.years.find((x) => x.year === 2042).spendBase * 0.9, 0.01, '10% cut');
    near(y(2042).fehb, base.years.find((x) => x.year === 2042).fehb, 1e-9, 'FEHB not cut');
    near(y(2054).oneTimeOut, 20000 * y(2054).idx, 0.01, 'deferrable car (2054) moved; non-deferrable repair stays');
    near(y(2055).oneTimeOut, 30000 * y(2055).idx, 0.01, 'car happens once the cut is released');
    checkConservation(res, 'guardrails');
    // Cut stays on through 2058: the car slides at most 2 years, then happens anyway.
    for (const yr of Object.keys(detReal)) detReal[yr] = +yr <= 2058 ? 1e12 : 1.0001;
    const res2 = E.simulate(inp, { rules: { detReal } });
    const z = (k) => res2.years.find((x) => x.year === k);
    near(z(2055).oneTimeOut, 0, 0.01, 'still deferred in 2055');
    near(z(2056).oneTimeOut, 30000 * z(2056).idx, 0.01, 'deferral limit reached in 2056');
    ok(res2.summary.deferrals === 2 && res2.summary.guardYears > 0, 'summary counts');
  });
  test('Monte Carlo suite: shortfall frequency, duration, size, cause, real dollars, reproducible', () => {
    const inp = planWith((i) => { i.spending.baseMonthly = 6000; });
    const a = E.monteCarloSuite(inp, { runs: 300, seed: 11 });
    const b = E.monteCarloSuite(inp, { runs: 300, seed: 11 });
    for (const k of ['fixed', 'stochastic']) {
      const m = a[k];
      near(m.successRate, b[k].successRate, 0, `${k} reproducible`);
      near(m.shortfall.durationHistogram.reduce((t, h) => t + h.runs, 0), 300, 0, 'histogram covers all runs');
      near(m.shortfall.anyRate, 1 - m.shortfall.durationHistogram[0].runs / 300, 1e-12, 'frequency');
      ok(m.shortfall.anyRate > 0 && m.shortfall.totalRealAll.p95 >= m.shortfall.totalRealAll.p50, 'size percentiles');
      ok(m.shortfall.cause.baseShare > 0 && m.shortfall.cause.baseShare <= 1, 'cause split');
      ok(m.endingBalanceReal.p90 < m.endingBalance.p90 && m.p50.real.length === m.years.length && m.p90.real[m.years.length - 1] <= m.p90.nominal[m.years.length - 1], 'real-dollar outputs');
    }
    ok(a.stochastic.mortality.youDeathAge.p50 > 70 && a.fixed.mortality === null, 'mortality stats only in stochastic mode');
    for (let k = 0; k < 5; k++) {
      checkConservation(E.simulate(inp, { rng: E.mulberry32(k), deathYears: { you: 2040 + 7 * k, spouse: 2090 - 5 * k }, toLastDeath: true,
        rules: { detReal: {} } }), 'stochastic deaths');
    }
  });

  // --- Events, conversions, inheritance, returns by account, comparison, IRMAA ------------------------------
  test('Recurring and multi-year events expand to the right years', () => {
    const ys = (e) => E.expandEvents([{ ...e, label: 'x', amount: 1, direction: 'outflow' }], 1983).map((o) => o.year);
    ok(JSON.stringify(ys({ when: 'year', at: 2054, repeat: 'everyNYears', everyNYears: 6, through: 2072 })) === '[2054,2060,2066,2072]', 'every 6 through 2072');
    ok(JSON.stringify(ys({ when: 'year', at: 2063, repeat: 'eachYearForNYears', forNYears: 3 })) === '[2063,2064,2065]', '3 consecutive years');
    ok(JSON.stringify(ys({ when: 'age', at: 80, repeat: 'everyNYears', everyNYears: 5, through: 90 })) === '[2063,2068,2073]', 'age-based');
    ok(ys({ when: 'year', at: 2042, repeat: 'everyNYears', everyNYears: 10, through: 0 }).slice(0, 3).join() === '2042,2052,2062', 'through 0 = to the end');
    ok(JSON.stringify(ys({ when: 'year', at: 2040 })) === '[2040]', 'single events unchanged');
  });
  test('A multi-year event equals the same single-year events', () => {
    const singles = PLAN1();
    const multi = planWith((i) => {
      i.spending.oneTimeEvents = i.spending.oneTimeEvents.filter((e) => !(e.label.includes('spouse ~90')));
      i.spending.oneTimeEvents.push({ when: 'year', at: 2063, label: 'Long-term care reserve (spouse ~90)', amount: 50000, direction: 'outflow', taxed: 'no', inTodaysDollars: true, repeat: 'eachYearForNYears', forNYears: 3 });
    });
    near(E.simulate(multi).summary.endingBalance, E.simulate(singles).summary.endingBalance, 0.01, 'same result');
    const inp = planWith((i) => { i.spending.oneTimeEvents = [{ when: 'year', at: 2042, label: 'Trip', amount: 10000, direction: 'outflow', taxed: 'no', inTodaysDollars: true, repeat: 'everyNYears', everyNYears: 2, through: 2048, deferrable: true }];
      i.monteCarlo.adaptiveRules.spendingGuardrails = { enabled: true, cutBelowShareOfPlan: 0.8, restoreAboveShareOfPlan: 0.95, spendingCut: 0.1, deferEventsUpToYears: 1 }; });
    const detReal = {}; for (let y = 2026; y <= 2082; y++) detReal[y] = y === 2044 ? 1e12 : 1.0001;
    const res = E.simulate(inp, { rules: { detReal } });
    const out = (y) => res.years.find((x) => x.year === y).oneTimeOut;
    ok(out(2042) > 0 && out(2044) === 0 && out(2045) > 0 && out(2046) > 0 && out(2048) > 0, 'only the 2044 occurrence is deferred, by one year');
  });
  test('Conversion rows: two rows fill their own brackets; the first row wins', () => {
    const inp = withInputs((i) => { i.workplacePlans.you.balances.traditional = 1500000; i.taxes.conversionsAndTransfers = [WIN({ fromAge: 57, throughAge: 57, fillToTopOfBracket: 0.24 }), WIN({ fromAge: 60, throughAge: 62, fillToTopOfBracket: 0.12 }), WIN({ fromAge: 62, throughAge: 62, fillToTopOfBracket: 0.35 })]; });
    const res = E.simulate(inp);
    const y = (k) => res.years.find((x) => x.year === k);
    near(y(2040).ordTaxable, E.bracketTop(0.24, 'mfj', y(2040).taxScale), 1, '2040 fills 24%');
    for (const k of [2043, 2044, 2045]) near(y(k).ordTaxable, E.bracketTop(0.12, 'mfj', y(k).taxScale), 1, `${k} fills 12% (first window wins at 62)`);
    ok(y(2041).conversion === 0 && y(2042).conversion === 0 && y(2046).conversion === 0, 'no conversions outside the windows');
  });
  test('After-tax inheritance = Roth + cash + taxable + traditional × (1 − heirs rate)', () => {
    const res = E.simulate(PLAN1());
    const last = res.years[res.years.length - 1], I = res.summary.inheritance;
    near(res.summary.afterTaxInheritance, last.balRoth + last.ira.roth.bal + last.balCash + last.checking.bal + last.balTaxable + (last.balTrad + last.ira.trad.bal) * 0.76, 0.01, 'formula');
    near(I.roth + I.cash + I.checking + I.taxable + I.tradAfterTax, res.summary.afterTaxInheritance, 0.01, 'composition adds up');
    const withIra = E.simulate(withInputs((i) => { i.iras.you.traditional.balance = 100000; i.iras.you.roth.balance = 50000; })).summary;
    const L = E.simulate(withInputs((i) => { i.iras.you.traditional.balance = 100000; i.iras.you.roth.balance = 50000; })).years.at(-1);
    near(withIra.inheritance.trad, L.balTrad + L.ira.trad.bal, 0.01, 'traditional IRA taxed like the TSP');
    near(withIra.inheritance.roth, L.balRoth + L.ira.roth.bal, 0.01, 'Roth IRA passes tax-free');
    near(res.summary.afterTaxInheritanceReal, res.summary.afterTaxInheritance / last.idxEnd, 0.01, "today's $");
    const mc = E.monteCarlo(PLAN1(), { runs: 100 });
    ok(mc.afterTax.p50 <= mc.endingBalance.p50 + 0.01 && mc.afterTaxReal.p90 > 0, 'Monte Carlo percentiles');
  });
  test('Account returns: one TSP return (traditional and Roth together); IRAs and brokerage have their own; one shock per year', () => {
    const diff = planWith((i) => { i.workplacePlans.you.returns = { beforeRetirement: 0.08, afterRetirement: 0.04 }; i.brokerage.returns = { beforeRetirement: 0.065, afterRetirement: 0.055 };
      i.iras.you.traditional = { balance: 50000, returns: { beforeRetirement: 0.06, afterRetirement: 0.03 } }; Object.assign(i.iras.you.roth, { balance: 50000, returns: { beforeRetirement: 0.09, afterRetirement: 0.075 } });
      Object.assign(i.monteCarlo.volatility.afterRetirement, { tsp: 0.05, rothIra: 0.2, traditionalIra: 0.04, brokerage: 0.12 }); });
    const y = (res, Y) => res.years.find((x) => x.year === Y);
    const det = E.simulate(diff);
    for (const [Y, tsp, brk, ti, ri] of [[2032, 0.08, 0.065, 0.06, 0.09], [2047, 0.04, 0.055, 0.03, 0.075]]) {
      const r = y(det, Y);
      near(r.returnTsp, tsp, 1e-12, `${Y} TSP`); near(r.returnTaxable, brk, 1e-12, `${Y} brokerage`);
      near(r.ira.trad.ret, ti, 1e-12, `${Y} traditional IRA`); near(r.ira.roth.ret, ri, 1e-12, `${Y} Roth IRA`);
      near(r.growthRoth, r.startRoth * tsp, 1e-6, `${Y} Roth TSP earns the TSP return`);
    }
    const mc = E.simulate(diff, { rng: E.mulberry32(4) });
    const rows = mc.years.filter((x) => x.year >= 2041);
    const pre = (r, k) => { const f = r.flows[k]; return r['start' + k[0].toUpperCase() + k.slice(1)] + f.contrib + f.deposit + f.convIn - f.convOut + f.xferIn - f.xferOut - f.withdraw; };
    ok(rows.every((r) => Math.abs(r.growthTrad - pre(r, 'trad') * r.returnTsp) < 1e-6 && Math.abs(r.growthRoth - pre(r, 'roth') * r.returnTsp) < 1e-6),
      'traditional and Roth TSP both earn the TSP return every year');
    const rank = (f) => rows.map((r, i) => [f(r), i]).sort((a, b) => a[0] - b[0]).map((p) => p[1]).join();
    ok(rank((r) => r.returnTsp) === rank((r) => r.ira.roth.ret) && rank((r) => r.returnTsp) === rank((r) => r.returnTaxable), 'one market shock orders the years identically');
    checkConservation(mc, 'account returns');
  });
  test('Scenario comparison matches standalone runs at the same seed', () => {
    const a = PLAN1(), b = planWith((i) => { i.spending.baseMonthly = 6000; });
    const cmp = E.compareScenarios([{ name: 'A', inputs: a }, { name: 'B', inputs: b }], { runs: 120, seed: 9, mode: 'fixed' });
    const sa = E.monteCarloSuite(a, { runs: 120, seed: 9 });
    near(cmp[0].fixed.successRate, sa.fixed.successRate, 0); near(cmp[0].stochastic.successRate, sa.stochastic.successRate, 0);
    ok(cmp[1].det.endingBalance < cmp[0].det.endingBalance && cmp[1].sel.successRate <= cmp[0].sel.successRate, 'higher spending is worse');
  });
  test('IRMAA cost is the extra Part B premium in dollars and appears in warnings', () => {
    const res = E.simulate(withInputs((i) => { i.spending.healthcare.medicarePartBYou = true; i.workplacePlans.you.balances.traditional = 800000; })); // RMDs reach the IRMAA tiers
    const r = res.years.find((x) => x.irmaaTier > 0 && x.partB > 0);
    ok(r, 'some IRMAA year');
    const ratio = E.CONSTANTS.medicare.irmaaPartBMonthly[r.irmaaTier] / E.CONSTANTS.medicare.irmaaPartBMonthly[0];
    near(r.irmaaCost, r.partB * (1 - 1 / ratio), 0.01, 'extra premium');
    near(res.summary.lifetimeIrmaa, res.years.reduce((t, x) => t + x.irmaaCost, 0), 0.01, 'lifetime total');
    ok(res.warnings.some((w) => /IRMAA/.test(w.text) && /\$[\d,]+ extra/.test(w.text)), 'warning states dollars');
  });


  // --- Plan 2: regression anchors and an independent re-derivation of every year ---------------------------------
  test('Plan 2 regression anchors (Roth money in a Roth IRA at 7%)', () => {
    const p = PLAN2_IRA(); p.taxes.bracketGrowthBelowInflation = 0;
    const S = E.simulate(p).summary;
    // The next test re-derives every year of the same plan independently (at the default chained-CPI gap).
    near(S.endingBalance, 5646252, 1, 'ending balance'); near(S.lifetimeFederalTax, 637939, 1, 'federal tax'); near(S.lifetimeOtherTax, 357248, 1, 'Mexico tax');
    near(S.totalConversions, 466267, 1, '2040 conversion'); near(S.peakCoreWithdrawalRate, 0.0567, 0.0005, 'core peak'); ok(S.peakCoreWithdrawalYear === 2052, 'core peak year');
    near(S.afterTaxInheritance, 5646252, 1, 'after-tax inheritance'); near(S.lifetimeOneTimeOut, 2071053, 1, 'one-time outflows');
  });
  test('Independent re-derivation of every year of plan 2 (separate tax, Mexico tariff, benefit and balance math)', () => {
    const rows = E.simulate(PLAN2_IRA()).years;
    const BR = { mfj: [[0, .10], [24800, .12], [100800, .22], [211400, .24], [403550, .32], [512450, .35], [768700, .37]], single: [[0, .10], [12400, .12], [50400, .22], [105700, .24], [201775, .32], [256225, .35], [640600, .37]] };
    const ULT = { 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1, 80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9 };
    // Mexico's 2026 annual ISR tariff (lower limit in MXN, rate), entered in dollars at 18.5 MXN/USD; in dollars the limits
    // grow 3.5% a year (the tariff's indexing) less the peso's 0.5% a year drift.
    const ISR = [[0, .0192], [10135.12, .064], [86022.12, .1088], [151176.20, .16], [175735.67, .1792], [210403.70, .2136],
      [424353.98, .2352], [668840.15, .30], [1276925.99, .32], [1702567.98, .34], [5107703.93, .35]];
    const band = (x, st, s) => { let t = 0; const b = BR[st]; for (let i = 0; i < b.length; i++) { const lo = b[i][0] * s, hi = i + 1 < b.length ? b[i + 1][0] * s : 1e18; if (x > lo) t += (Math.min(x, hi) - lo) * b[i][1]; } return t; };
    const ssTax = (o, ss, st) => { const [b, a] = st === 'mfj' ? [32000, 44000] : [25000, 34000]; const pi = o + ss / 2; return pi <= b ? 0 : pi <= a ? Math.min(ss / 2, (pi - b) / 2) : Math.min(0.85 * ss, 0.85 * (pi - a) + Math.min(ss / 2, (a - b) / 2)); };
    const fed = (ord, ss, st, s, n65, g, int) => {
      g = g || 0;
      const tss = ssTax(ord + g, ss, st), agi = ord + g + tss, ded = ((st === 'mfj' ? 32200 : 16100) + (st === 'mfj' ? 1650 : 2050) * n65) * s;
      const ordT = Math.max(0, ord + tss - ded), gT = Math.max(0, g - Math.max(0, ded - ord - tss));
      const z = (st === 'mfj' ? 98900 : 49450) * s, f = (st === 'mfj' ? 613700 : 545500) * s; // LTCG 0/15/20% stacked on ordinary
      const gTax = 0.15 * Math.max(0, Math.min(ordT + gT, f) - Math.max(ordT, z)) + 0.20 * Math.max(0, ordT + gT - Math.max(ordT, f));
      const niit = 0.038 * Math.min(g + (int || 0), Math.max(0, agi - (st === 'mfj' ? 250000 : 200000))); // gains and interest (IRC §1411); not indexed
      return { tax: band(ordT, st, s) + gTax + niit, agi };
    };
    const isr = (usd, t) => { const k = Math.pow(1.035 / 1.005, t) / 18.5; let tax = 0;
      for (let i = 0; i < ISR.length; i++) { const lo = ISR[i][0] * k, hi = i + 1 < ISR.length ? ISR[i + 1][0] * k : 1e18; if (usd > lo) tax += (Math.min(usd, hi) - lo) * ISR[i][1]; } return tax; };
    let ann = null, basis = 0; // taxable-account cost basis (the account starts empty)
    for (const r of rows) {
      const Y = r.year, t = Y - 2026, idx = Math.pow(1.03, t), tIdx = Math.pow(1.03 - 0.0025, t), age = Y - 1983, sp = Y <= 2068, st = sp ? 'mfj' : 'single';
      const n65 = (age >= 65 ? 1 : 0) + (sp && Y - 1973 >= 65 ? 1 : 0);
      const gain = r.startTaxable > 0 ? r.wTaxable * Math.max(0, 1 - basis / r.startTaxable) : 0; // average cost
      basis += r.depositTaxable + r.sweep - (r.wTaxable - gain);
      near(r.basis.taxable, basis, 0.01, `${Y} taxable basis`);
      near(r.idx, idx, 1e-9, `${Y} idx`);
      if (Y < 2040) {
        const sal = 125000 * Math.pow(1.0201, t);
        near(r.contribAgency, 0.05 * sal, 0.01, `${Y} agency`); near(r.federalTax, fed(sal, 0, 'mfj', tIdx, n65).tax, 0.01, `${Y} wage tax`);
      } else {
        if (ann === null) ann = 0.01 * 30 * [2037, 2038, 2039].reduce((a, y) => a + 125000 * Math.pow(1.0201, y - 2026), 0) / 3; else if (age - 1 >= 62) ann *= 1.02;
        near(r.pension, ann * (sp ? 0.95 : 1), 0.01, `${Y} annuity`);
        near(r.supplement, Y <= 2044 ? 2000 * Math.pow(1.03, 14) * 0.75 * 12 : 0, 0.01, `${Y} supplement`);
        near(r.ssSpouse, sp ? 1900 * idx * 12 : 0, 0.01, `${Y} spouse SS`);
        near(r.ssYou, Y >= 2053 ? 3100 * 1.24 * idx * 12 : 0, 0.01, `${Y} your SS`);
        near(r.spendBase + r.fehb, 57600 * idx * (sp ? 1 : 0.7) + 8640 * Math.pow(1.06, t) * (sp ? 1 : 0.45), 0.01, `${Y} spending`);
        near(r.rmd, age >= 75 ? r.startTrad / ULT[age] : 0, 0.01, `${Y} RMD`);
        const us = fed(r.pension + r.supplement + r.rmd + r.wTrad + r.conversion + r.cashInterest, r.ssYou + r.ssSpouse, st, tIdx, n65, gain, r.cashInterest);
        near(r.federalTax, us.tax, 0.02, `${Y} federal`);
        if (Y >= 2041) {
          const usInc = r.rmd + r.wTrad + r.conversion + gain + r.cashInterest, inc = usInc + r.wRoth + r.ira.roth.withdraw;
          const gross = isr(inc, t), credit = Math.min(gross, us.agi > 0 ? us.tax * Math.min(1, usInc / us.agi) : 0);
          near(r.otherTax, gross - credit, 0.02, `${Y} Mexico tax`);
        }
        near(r.depositCash, Math.min(r.deposit, Math.max(0, 100000 * idx - (r.startCash - r.wCash))), 0.01, `${Y} surplus to cash`);
      }
      // TSP (traditional and Roth together), Roth IRA, brokerage. At 57 (2040) the Roth TSP moves to the Roth IRA and the
      // conversion goes there too.
      const g = Y < 2040 ? [0.07, 0.07, 0.07] : [0.05, 0.07, 0.06];
      const toIra = Y === 2040 ? r.startRoth + r.contribEmpRoth : 0;
      near(r.moves.rothWorkplaceToRothIra, toIra, 0.01, `${Y} Roth TSP → Roth IRA`); near(r.moves.traditionalWorkplaceToRothIra, r.conversion, 1e-9, `${Y} conversion into the Roth IRA`);
      near(r.balTrad, (r.startTrad + r.contribAgency - r.rmd - r.wTrad - r.conversion) * (1 + g[0]), 0.02, `${Y} trad`);
      near(r.balRoth, (r.startRoth + r.contribEmpRoth - toIra - r.wRoth) * (1 + g[0]), 0.02, `${Y} Roth TSP`);
      near(r.ira.roth.bal, (r.ira.roth.start + toIra + r.conversion - r.ira.roth.withdraw) * (1 + g[1]), 0.02, `${Y} Roth IRA`);
      near(r.balTaxable, (r.startTaxable + r.depositTaxable + r.sweep - r.wTaxable) * (1 + g[2]), 0.02, `${Y} taxable`);
    }
  });
  test('RMD bracket warning fires only when the unneeded RMD itself changes the bracket', () => {
    // Plan 2 without conversions, the spouse dying in 2061: in 2062 taxable income moves from the 12% to the 22% bracket on
    // the filing status alone, and 2066 is the first year an RMD itself pushes it up a bracket.
    const p = PLAN2(); p.taxes.bracketGrowthBelowInflation = 0; p.taxes.conversionsAndTransfers = []; p.workplacePlans.you.balances.traditional = 450000; p.household.spouse.lifespan = 88;
    const res = E.simulate(p), p2 = res.warnings.find((w) => w.code === 'rmdBracket');
    const j = res.years.find((y) => y.year === 2062), before = res.years.find((y) => y.year === 2061);
    ok(j.status === 'single' && before.status === 'mfj' && j.rmd > 0 && j.deposit > 1 && j.marginal > before.marginal, '2062: an RMD year whose bracket rises with the filing status');
    ok(p2 && p2.text.startsWith('The 2066 RMD') && !p2.text.includes('2062'), '2062 is the filing-status jump (not RMDs); 2066 is a genuine RMD bracket push');
    const big = E.simulate(withInputs((i) => { i.workplacePlans.you.balances.traditional = 1200000; }));
    const w = big.warnings.find((x) => x.code === 'rmdBracket');
    ok(w && /pushes taxable income from the \d+% into the \d+% bracket/.test(w.text), 'large traditional balance: warning with the brackets');
  });

  // --- Planning release: person events, SS shortfall, High-5, COLA modes, withdrawal strategies ---------------
  test('Events tied to a person are skipped after that person dies; ages and before-death timing follow the person', () => {
    const base = PLAN2_TIED();
    ok(Math.abs(E.simulate({ ...base, taxes: { ...base.taxes, bracketGrowthBelowInflation: 0 } }).summary.endingBalance - 5646252) < 1, 'tying the reserves to each person changes nothing while both are alive at the care years');
    const early = E.simulate(base, { deathYears: { you: 2078, spouse: 2052 }, toLastDeath: true });
    const y = (r, k) => r.years.find((x) => x.year === k);
    near(y(early, 2063).oneTimeOut, 0, 0, 'spouse died 2052: her 2063 care reserve is skipped');
    near(y(early, 2073).oneTimeOut, 50000 * y(early, 2073).idx, 0.01, 'your 2073 reserve still happens');
    const ys = (ev) => E.expandEvents([{ amount: 1, direction: 'outflow', label: 'x', ...ev }], { you: { by: 1983, deathYear: 2072 }, spouse: { by: 1973, deathYear: 2062 } }).map((o) => o.year);
    ok(JSON.stringify(ys({ when: 'age', at: 80, person: 'spouse' })) === '[2053]', 'age of the tied person (spouse 80 in 2053)');
    ok(JSON.stringify(ys({ when: 'yearsBeforeDeath', at: 2, person: 'spouse', repeat: 'eachYearForNYears', forNYears: 3 })) === '[2060,2061,2062]', 'the 3 years ending at her death');
    ok(JSON.stringify(ys({ when: 'yearsBeforeDeath', at: 0, person: 'you' })) === '[2072]', 'your death year');
    const none = E.simulate(planWith((i) => { i.household.married = false; i.spending.oneTimeEvents = [{ when: 'year', at: 2047, label: 'x', amount: 9999, direction: 'outflow', person: 'spouse' }]; }));
    ok(none.years.every((r) => r.oneTimeOut === 0), 'spouse events need a spouse');
    // Stochastic mortality: before-death care follows each run's sampled death.
    const inp = planWith((i) => { i.spending.oneTimeEvents = [{ when: 'yearsBeforeDeath', at: 0, label: 'End of life', amount: 40000, direction: 'outflow', person: 'spouse', inTodaysDollars: true }]; });
    const r = E.simulate(inp, { deathYears: { you: 2078, spouse: 2051 }, toLastDeath: true });
    ok(y(r, 2051).oneTimeOut > 0 && r.years.filter((x) => x.oneTimeOut > 0).length === 1, 'cost lands in the sampled death year');
  });
  test('Deferred tied event is dropped if its person dies before it happens', () => {
    const inp = planWith((i) => { i.spending.oneTimeEvents = [{ when: 'year', at: 2050, label: 'Trip', amount: 20000, direction: 'outflow', person: 'spouse', deferrable: true, inTodaysDollars: true }];
      i.monteCarlo.adaptiveRules.spendingGuardrails = { enabled: true, cutBelowShareOfPlan: 0.8, restoreAboveShareOfPlan: 0.95, spendingCut: 0.1, deferEventsUpToYears: 5 }; });
    const detReal = {}; for (let k = 2026; k <= 2100; k++) detReal[k] = 1e12;
    const r = E.simulate(inp, { rules: { detReal }, deathYears: { you: 2078, spouse: 2052 }, toLastDeath: true });
    ok(r.years.every((x) => x.oneTimeOut === 0), 'deferred to 2051, 2052, then 2053 after her death → never paid');
  });
  test('Social Security payable share applies to own, spousal and survivor benefits from the cut year', () => {
    const base = E.simulate(PLAN2()), cut = E.simulate(planWith((i) => { i.socialSecurity.trustFundShortfall.benefitsPaidShare = 0.78; i.socialSecurity.trustFundShortfall.fromYear = 2033; }));
    const at = (r, k) => r.years.find((x) => x.year === k);
    near(at(cut, 2040).ssSpouse, at(base, 2040).ssSpouse * 0.78, 0.01, 'spouse benefit × 78%');
    near(at(cut, 2069).ssYou, at(base, 2069).ssYou * 0.78, 0.01, 'survivor-phase benefit × 78%');
    const before = E.simulate(planWith((i) => { i.socialSecurity.trustFundShortfall.benefitsPaidShare = 0.5; i.socialSecurity.trustFundShortfall.fromYear = 2047; }));
    near(at(before, 2046).ssSpouse, at(base, 2046).ssSpouse, 0.01, 'unchanged before the cut year');
    ok(E.simulate(planWith((i) => { i.socialSecurity.trustFundShortfall.benefitsPaidShare = 0; })).years.every((x) => x.ssYou === 0 && x.ssSpouse === 0 || x.year < 2033), '0% pays nothing');
    ok(cut.summary.endingBalance < base.summary.endingBalance, 'less income, smaller estate');
  });
  test('High-5 averages five salaries; COLA modes reduce or remove retiree and survivor COLAs', () => {
    const h5 = E.simulate(planWith((i) => { i.fersPension.averageSalaryYears = 5; })).summary.fers;
    const sal = (y) => 125000 * Math.pow(1.0201, y - 2026);
    near(h5.high3, [2035, 2036, 2037, 2038, 2039].reduce((t, y) => t + sal(y), 0) / 5, 0.01, 'High-5 average');
    near(h5.basicAnnuity, 0.01 * 30 * h5.high3, 0.01, 'annuity uses High-5');
    const red = E.simulate(planWith((i) => { i.fersPension.colaMode = 'reduced'; i.fersPension.colaReducedBy = 0.005; })).years.find((y) => y.year === 2052);
    near(red.colaApplied, 0.015, 1e-12, 'diet 2% − 0.5 pt');
    const none = E.simulate(planWith((i) => { i.fersPension.colaMode = 'none'; i.fersPension.you.survivorElection = 'full'; i.household.you.lifespan = 70; i.household.planToAge = 100; }));
    ok(none.years.every((y) => y.colaApplied === 0), 'no COLA for retiree or survivor');
    const s1 = none.years.find((y) => y.year === 2054), s2 = none.years.find((y) => y.year === 2062);
    near(s2.survivorAnnuity, s1.survivorAnnuity, 1e-6, 'survivor annuity flat without COLA');
  });
  test('Withdrawal strategies: proportional, traditional-to-bracket-top, and one-time outflows from Roth', () => {
    const plan = (mut) => planWith((i) => { i.brokerage.balance = 300000; i.workplacePlans.you.balances.roth = 300000; i.spending.baseMonthly = 9000; i.taxes.conversionsAndTransfers = []; mut(i); });
    const prop = E.simulate(plan((i) => { i.withdrawals.strategy = 'proportional'; })).years.find((y) => y.year === 2047);
    const tot = prop.startTaxable + (prop.startTrad - prop.rmd) + prop.startRoth;
    const drawn = prop.wTaxable + prop.wTrad + prop.wRoth;
    near(prop.wRoth / drawn, prop.startRoth / tot, 0.001, 'Roth share of the draw = Roth share of balances');
    const fill = E.simulate(plan((i) => { i.withdrawals.strategy = 'bracketFill'; i.withdrawals.fillToTopOfBracket = 0.12; })).years.find((y) => y.year === 2047);
    near(fill.ordTaxable, E.bracketTop(0.12, 'mfj', fill.taxScale), 1, 'traditional fills exactly to the top of 12%');
    ok(fill.wTaxable > 0, 'then the order continues with the taxable account');
    const lumps = E.simulate(plan((i) => { i.withdrawals.oneTimeOutflowsFromRothFirst = true; i.checkingAndMoneyMarket.moneyMarket.balance = 50000; })).years.find((y) => y.year === 2054);
    near(lumps.wRoth, lumps.oneTimeOut, 0.01, 'the 2054 car comes out of Roth');
    for (const strat of ['proportional', 'fill']) checkConservation(E.simulate(plan((i) => { i.withdrawals.strategy = strat; i.withdrawals.oneTimeOutflowsFromRothFirst = true; }), { rng: E.mulberry32(3) }), strat);
  });

  // --- Planning tools ---------------------------------------------------------------------------------------
  test('Max-spending solver brackets the target success', () => {
    const r = E.solveMaxSpending(PLAN2(), { runs: 100, seed: 7, target: 0.9 });
    ok(r.success >= 0.9, `success at the answer ${r.success}`);
    const above = r.trace.filter((t) => t.monthly > r.monthly + 1e-6);
    ok(above.length && above.every((t) => t.success < 0.9), 'every tried amount above the answer misses the target');
    ok(r.trace.every((t, i) => i === 0 || t.success <= r.trace[i - 1].success + 1e-12), 'success never rises with spending (same seed)');
    const c = E.normalizeInputs(PLAN2()); c.spending.baseMonthly = r.monthly;
    const check = E.evaluatePlan(c, { runs: 100, seed: 7, mode: 'stochastic' });
    near(check.success, r.success, 1e-12, 'reproducible');
  });
  test('Earliest-retirement solver adjusts service and finds the first age meeting the target', () => {
    const r = E.solveEarliestRetirement(PLAN2(), { runs: 100, seed: 7, target: 0.9 });
    const first = r.rows.find((x) => x.success >= 0.9);
    ok(r.earliest === first.age, 'earliest = first qualifying age');
    const r56 = r.rows.find((x) => x.age === 56);
    ok(r56.service === 29 && r56.retirementType === 'deferred', 'retiring at 56 has 29 years and is deferred (MRA 57)');
  });
  test('Optimizer ranks claim ages and conversion windows; the best patch reproduces its score', () => {
    const r = E.optimizePlan(PLAN2(), { runs: 60, seed: 5, goal: 'success' });
    ok(r.ssCount === 81 && r.rothCount > 5, 'searched 9 × 9 claim ages and several conversion windows');
    for (let k = 1; k < r.ss.length; k++) {
      const a = r.ss[k - 1].metrics, b = r.ss[k].metrics;
      ok(a.success > b.success || (a.success === b.success && a.inheritanceReal >= b.inheritanceReal), 'strict ranking: success, then inheritance');
    }
    const applied = E.evaluatePlan(E.normalizeInputs(Object.assign(PLAN2(), {})), { runs: 60, seed: 5, mode: 'stochastic' });
    ok(applied.success === r.base.success, 'base score reproducible');
    const det = E.simulate(PLAN2()).summary;
    ok(r.base.inheritance > r.base.inheritanceReal && Math.abs(r.base.lifetimeTax - det.lifetimeTax) < 1e-6 && Math.abs(r.base.detAfterTax - det.afterTaxInheritance) < 1e-6 &&
      r.base.detEndYear === det.endYear, 'scores carry future (nominal) dollars and the projection at average returns');
    const md = R.buildPlanReport(E.simulate(PLAN2()), { tools: { optimize: r } }).markdown;
    ok(md.includes("| Median inheritance (today's $ / future $) | Lifetime tax (today's $ / future $) |") && md.includes('the projection at average returns leaves'), 'report shows both dollar bases');
    const t = E.optimizePlan(PLAN2(), { runs: 40, seed: 5, goal: 'tax', ss: false });
    for (let k = 1; k < t.roth.length; k++) ok(t.roth[k - 1].metrics.lifetimeTaxReal <= t.roth[k].metrics.lifetimeTaxReal + 1, 'tax goal ranks by lifetime tax');
  });
  test('Median inheritance in today\'s and future dollars comes from the same Monte Carlo run', () => {
    // With steady 3% inflation each run's deflator is 1.03^(years to the end of its last year). With stochastic lifespans the
    // runs end in different years, so medians of the nominal and real amounts taken separately need not share one.
    const p = E.normalizeInputs(PLAN2()); p.monteCarlo.inflation.volatility = 0;
    const m = E.evaluatePlan(p, { runs: 101, seed: 4, mode: 'stochastic' });
    const years = Math.log(m.inheritance / m.inheritanceReal) / Math.log(1.03);
    ok(m.inheritanceRuns === 1 && Math.abs(years - Math.round(years)) < 1e-6, `one run: future ÷ today's $ = 1.03^${years}`);
    const mc = E.monteCarlo(p, { runs: 100, seed: 4, mortality: 'stochastic' });
    ok(mc.afterTaxMiddleRun.runs === 2 && Math.abs(mc.afterTaxMiddleRun.real - mc.afterTaxReal.p50) < 1e-6, 'even runs: the middle two averaged, as the today\'s-$ median');
  });
  test('Sensitivity: one assumption at a time, sorted by swing in success', () => {
    const r = E.sensitivityAnalysis(PLAN2(), { runs: 80, seed: 9 });
    ok(r.entries.length >= 10, 'variables');
    for (let k = 1; k < r.entries.length; k++) ok(r.entries[k - 1].swingSuccess >= r.entries[k].swingSuccess, 'sorted');
    const sp = r.entries.find((e) => e.key === 'spending');
    ok(sp.lo.success >= r.base.success && sp.hi.success <= r.base.success, 'less spending helps, more hurts');
    const ss = r.entries.find((e) => e.key === 'ss');
    ok(ss.lo.inheritanceReal < ss.hi.inheritanceReal, 'a Social Security cut lowers the inheritance');
  });

  // --- Plan report (report.js) -------------------------------------------------------------------------
  test('Plan report has every section and no undefined/NaN text across scenarios', () => {
    const scenarios = [
      PLAN1(),
      planWith((i) => { i.withdrawals.bridgeBucket.enabled = true; }),
      BASE(),
      withInputs((i) => { i.household.married = false; }),
      withInputs((i) => { i.spending.baseMonthly = 20000; i.workplacePlans.you.balances.traditional = 100000; }),
      withInputs((i) => { i.otherTaxes = [TAX({ name: 'Mexico', fromYear: 2040, flatRate: 0.2, creditsFederalTax: true, filing: 'separate', retirementExclusion: 30000,
        appliesTo: { traditionalTsp: true, rothTsp: true, rothConversions: true, brokerageGains: true, interest: true } })]; i.taxes.conversionsAndTransfers = [WIN({})]; i.spending.foreignCurrency.enabled = true; i.checkingAndMoneyMarket.moneyMarket.balance = 20000; i.checkingAndMoneyMarket.moneyMarket.yield = 0.01; }),
      withInputs((i) => { i.fersPension.you.serviceYears = 3; i.fersSupplement.you.mode = 'off'; }),
      withInputs((i) => { i.household.you.lifespan = 70; i.household.spouse.lifespan = 95; i.fersPension.you.survivorElection = 'full'; i.spending.phases.enabled = true; }),
      withInputs((i) => { i.household.you.birthYear = 1964; i.household.spouse.birthYear = 1964; i.employment.you.retirementAge = 60; }),
    ];
    const headers = ['Instructions for the reviewer', 'Plan narrative', 'Key results', 'Inputs', 'Rules applied and computed values', 'Milestones',
      'Warnings and notes from the model', 'Monte Carlo', 'Year-by-year projection (future dollars: the amounts paid each year)', 'Model limitations', 'Questions for the reviewer', 'Plan settings (JSON)'];
    scenarios.forEach((inp, k) => {
      const res = E.simulate(inp);
      const mc = k === 5 || k === 0 ? E.monteCarloSuite(inp, { runs: 60 }) : null;
      const rep = R.buildPlanReport(res, { scenarioName: 'Test', mc, generatedAt: '2026-10-04' });
      ok(rep.story.length >= 6, `scenario ${k}: story paragraphs`);
      for (const hd of headers) ok(rep.markdown.includes('## ' + hd), `scenario ${k}: missing section ${hd}`);
      const bad = /undefined|NaN|\[object|Infinity/.exec(rep.markdown + rep.story.join(' '));
      ok(!bad, `scenario ${k}: found "${bad && bad[0]}" near "${bad && (rep.markdown + rep.story.join(' ')).slice(Math.max(0, bad.index - 60), bad.index + 20)}"`);
      const yearSection = rep.markdown.split('## Year-by-year projection')[1].split('\n## ')[0];
      const tableRows = yearSection.split('\n').filter((l) => /^\| \d{4} \|/.test(l));
      ok(tableRows.length === res.years.length, `scenario ${k}: one table row per year`);
      const head = yearSection.split('\n').find((l) => l.startsWith('| Year'));
      ok(head.includes('| 1x in |') && head.includes('| 1x out |') && head.includes('| Check |') && !head.includes('One-time ±'), `scenario ${k}: split one-time and check columns`);
      if (inp.withdrawals.bridgeBucket.enabled) ok(head.includes('| Bucket |'), 'bucket column when bucket is on');
      if (mc) {
        const sec = rep.markdown.split('\n## Monte Carlo\n')[1].split('\n## ')[0];
        for (const t of ['| Metric | Fixed lifespans | Stochastic mortality |', 'Runs with any unfunded year', 'Years unfunded in failing runs', 'Total unfunded, all runs',
          'Worst single-year shortfall', 'Unfunded dollars by cause', "Ending balance, today's $", "p50 today's $"]) ok(sec.includes(t), `scenario ${k}: MC export has "${t}"`);
        ok(rep.markdown.includes('Lifespans in Monte Carlo:') && rep.markdown.includes('persistence AR(1)') && rep.markdown.includes('Spending guardrails:'), 'new inputs exported');
      }
    });
  });
  test('Plan report includes events, conversions, IRAs, inheritance, IRMAA and a comparison', () => {
    const inp = planWith((i) => { i.taxes.conversionsAndTransfers.push(WIN({ fromAge: 71, throughAge: 74, fillToTopOfBracket: 0.12 })); i.iras.you.roth.balance = 20000;
      i.spending.oneTimeEvents.push({ when: 'year', at: 2040, label: 'Travel', amount: 8000, direction: 'outflow', taxed: 'no', inTodaysDollars: true, repeat: 'everyNYears', everyNYears: 2, through: 2050 }); });
    const res = E.simulate(inp);
    const cmp = E.compareScenarios([{ name: 'Plan', inputs: PLAN1() }, { name: 'Variant', inputs: inp }], { runs: 40, seed: 3 });
    const md = R.buildPlanReport(res, { comparison: cmp }).markdown;
    for (const t of ['Conversions and transfers', 'traditional TSP → Roth TSP at ages 57–57: fill to the top of the 22% bracket (conversion); traditional TSP → Roth TSP at ages 71–74: fill to the top of the 12% bracket (conversion)', "Heirs' marginal tax rate",
      'After-tax inheritance', 'Roth IRA', '(one fund allocation for traditional and Roth)', 'Travel −$8,000 (today\'s $) every 2 years from 2040 through 2050', 'Medicare IRMAA surcharges',
      '## Scenario comparison', '| Metric | Plan | Variant |']) ok(md.includes(t), `report has "${t}"`);
    ok(!/undefined|NaN/.test(md), 'no undefined/NaN');
  });
  test('Plan report includes person-tied events, SS shortfall, FERS scenarios, withdrawal strategy and planning tools', () => {
    const inp = planWith((i) => { i.socialSecurity.trustFundShortfall.benefitsPaidShare = 0.78; i.fersPension.averageSalaryYears = 5; i.fersPension.colaMode = 'reduced'; i.withdrawals.strategy = 'bracketFill'; i.withdrawals.oneTimeOutflowsFromRothFirst = true;
      i.spending.oneTimeEvents = [{ when: 'yearsBeforeDeath', at: 2, label: 'Care', amount: 50000, direction: 'outflow', person: 'spouse', repeat: 'eachYearForNYears', forNYears: 3, inTodaysDollars: true }]; });
    const res = E.simulate(inp);
    const tools = { spending: E.solveMaxSpending(inp, { runs: 50, seed: 1 }), sensitivity: E.sensitivityAnalysis(inp, { runs: 50, seed: 1 }) };
    const md = R.buildPlanReport(res, { tools }).markdown;
    for (const t of ["2 year(s) before your spouse's death [only while your spouse is alive]", '78% of scheduled from 2033', 'High-5 proposal scenario',
      'diet COLA minus', 'traditional TSP and IRA first up to the top of the 12% bracket', 'One-time outflows are paid from the Roth accounts first',
      '## Planning tools', 'Highest base spending with at least 90% success', '| Assumption | Setting | Success |']) ok(md.includes(t), `report has "${t}"`);
    ok(!/undefined|NaN/.test(md), 'no undefined/NaN');
  });
  test('Plan report: conversion tax and IRMAA, the bridge net of savings, interest column, High-3 years, deflators, survivor wording', () => {
    const inp = withInputs((i) => {
      i.taxes.conversionsAndTransfers = [WIN({ fromAge: 58, throughAge: 58, howMuch: 'fixedAmount', fixedAmount: 300000 })];
      i.spending.healthcare.medicarePartBYou = true; i.spending.healthcare.medicarePartBSpouse = true; i.spending.healthcare.fehbMonthly = 700;
      i.checkingAndMoneyMarket.moneyMarket.yield = 0.03;
    });
    const res = E.simulate(inp), S = res.summary, rep = R.buildPlanReport(res, { generatedAt: '2026-10-04' });
    const text = rep.story.join(' ') + rep.markdown;
    const F = S.people.you.fers, ann = F.initialAnnuity * F.survivorPct / 12;
    for (const t of [`costing $${Math.round(S.totalConversionTax).toLocaleString('en-US')} in tax`, 'of Medicare IRMAA surcharges in 2043',
      `less $${Math.round(S.bridgeSaved).toLocaleString('en-US')} saved`, `High-3 is $${Math.round(F.high3).toLocaleString('en-US')}, the average of 2037–2039 pay`,
      "After the first death, living spending drops to 70%, FEHB to 45% (self only) and the deceased's Part B stops.",
      `the index at the end of ${S.endYear} is ${res.years[res.years.length - 1].idxEnd.toFixed(3)}`,
      `a survivor annuity of $${Math.round(ann / res.years.find((r) => r.year === F.pensionStartYear).idx).toLocaleString('en-US')}/mo in today's dollars`]) ok(text.includes(t), `report has "${t}"`);
    ok(!/\/yr\}/.test(text), 'no stray brace');
    const table = rep.markdown.split('## Year-by-year projection')[1].split('\n## ')[0].split('\n');
    const cols = table.find((l) => l.startsWith('| Year')).split(' | ');
    const k = cols.indexOf('Interest'), r = res.years.find((y) => y.cashInterest > 100);
    ok(k > 0 && r, 'interest column');
    ok(table.find((l) => l.startsWith(`| ${r.year} |`)).split(' | ')[k] === Math.round(r.cashInterest + r.checking.interest).toLocaleString('en-US'), 'interest value');
  });
  test('Plan report lists each state, local or foreign tax with its rules', () => {
    const res = E.simulate(withInputs((i) => {
      i.otherTaxes = [TAX({ name: 'Virginia', throughYear: 2044, flatRate: 0.05, deduction: 8000, appliesTo: { wages: true, fersAnnuity: true, traditionalTsp: true, interest: true } }),
        TAX({ name: 'Mexico', fromYear: 2045, rates: 'brackets', brackets: [{ from: 0, rate: 0.02 }, { from: 20000, rate: 0.1 }], filing: 'separate', creditsFederalTax: true,
          retirementExclusion: 30000, exclusionFromAge: 60, appliesTo: { traditionalTsp: true, rothTsp: true, interest: true } })];
    }));
    const rep = R.buildPlanReport(res, {});
    for (const t of ['### State, local & foreign tax (`otherTaxes`)', '**Virginia:** 2026–2044; flat 5%', '**Mexico:** 2045 on; brackets', 'each spouse files separately',
      'credits federal tax on the same income', 'retirement income excluded up to $30,000 a person from age 60', '| Other tax |']) ok(rep.markdown.includes(t), `report has "${t}"`);
    ok(rep.story.some((p) => p.includes('Virginia') && p.includes('Mexico')), 'the narrative names both');
    ok(rep.story.some((p) => p.includes('kept in the money market (money market funds, savings) up to $100,000')), 'cash narrative');
    ok(!/undefined|NaN/.test(rep.markdown), 'no undefined/NaN');
  });

  // --- Federal brackets: chained-CPI indexing, bracket and headroom columns, fill solver ---------------------
  test('Federal tax amounts index at inflation minus the chained-CPI gap; other amounts at full inflation', () => {
    const rows = E.simulate(PLAN2()).years;
    ok(E.normalizeInputs(PLAN2()).taxes.bracketGrowthBelowInflation === 0.0025, 'default gap 0.25%');
    for (const r of rows) near(r.taxScale, Math.pow(1.03 - 0.0025, r.year - 2026), 1e-12, `${r.year} tax index`);
    const r38 = rows.find((r) => r.year === 2040);
    near(r38.deduction, (32200 + 1650) * r38.taxScale, 0.01, 'deduction uses the tax index');
    const g0 = E.simulate({ ...PLAN2(), taxes: { ...PLAN2().taxes, bracketGrowthBelowInflation: 0 } }).years;
    ok(g0.every((r) => Math.abs(r.taxScale - r.idx) < 1e-12), 'gap 0: brackets grow with inflation');
    const B = E.federalBrackets(r38.taxScale);
    near(B.mfj.brackets[3].to, 403550 * r38.taxScale, 1e-6, '24% top'); ok(B.mfj.brackets[6].to === null, '37% has no top');
    near(B.single.brackets[1].from, 12400 * r38.taxScale, 1e-6, 'single 12% start');
    near(B.mfj.standardDeduction, 32200 * r38.taxScale, 1e-6, 'standard deduction'); near(B.single.additional65, 2050 * r38.taxScale, 1e-6, '65+ single');
    near(B.mfj.ltcg[1].from, 98900 * r38.taxScale, 1e-6, 'LTCG 15% starts');
  });
  test('Each year reports its bracket, the bracket range and the headroom to the top', () => {
    const rows = E.simulate(PLAN2()).years;
    for (const r of rows) {
      const b = r.bracket;
      ok(b && r.ordTaxable > b.from && (b.to === null || r.ordTaxable <= b.to + 1e-6), `${r.year} income inside its bracket`);
      const br = E.federalBrackets(r.taxScale)[r.status].brackets.find((x) => Math.abs(x.from - b.from) < 1e-6);
      ok(br && br.rate === r.marginal && br.to === b.to, `${r.year} bracket matches the year's table and the marginal rate`);
      near(b.headroom, b.to - r.ordTaxable, 1e-6, `${r.year} headroom`);
      near(r.taxableIncome, r.ordTaxable + r.gainsTaxable, 1e-6, `${r.year} taxable income`);
    }
    near(rows.find((r) => r.year === 2040).bracket.headroom, 0, 0.5, '2040 conversion fills the 24% bracket (no headroom left)');
    const tx = (o) => E.computeTaxes({ status: 'mfj', year: 2030, scale: 1, nOver65: 0, mode: 'advanced', ltcg: 0, ss: 0, ...o });
    const low = tx({ ordinary: 20000 });
    ok(low.ordTaxable === 0 && low.marginal === 0 && low.bracket.from === null && low.bracket.to === null, 'below the deduction: no bracket');
    near(low.bracket.headroom, 32200 - 20000, 1e-9, 'headroom = unused deduction');
    const top = tx({ ordinary: 2000000 });
    ok(top.marginal === 0.37 && top.bracket.to === null && top.bracket.headroom === null, 'top bracket has no ceiling');
    near(tx({ ordinary: 100000 + 32200 }).bracket.headroom, 800, 1e-9, '$100,000 taxable: $800 left in 12%');
    ok(tx({ ordinary: 50000, mode: 'simple', simpleMfj: 0.12 }).bracket === null, 'simple mode: no bracket');
  });
  test('Fill conversions land at the bracket top even with double taxation (no relief) and taxes paid from traditional', () => {
    // These settings oscillate if the conversion is sized from the previous pass's tax withdrawal, stopping off target
    // and leaving spurious unfunded amounts that Monte Carlo would count as failures.
    const inp = PLAN2_TIED();
    inp.taxes.conversionsAndTransfers = [{ fromAge: 57, throughAge: 66, howMuch: 'fillBracket', fillToTopOfBracket: 0.24, fixedAmount: 0 }];
    Object.assign(inp.otherTaxes[0], { fromYear: 2030, creditsFederalTax: false }); inp.otherTaxes[0].appliesTo.rothConversions = true;
    inp.withdrawals.order = ['traditionalWorkplace', 'brokerage', 'rothWorkplace']; inp.checkingAndMoneyMarket.moneyMarket.balance = 20000;
    let years = 0;
    for (const rng of [null, ...[1, 2, 3, 4, 5, 6, 7, 8].map((s) => E.mulberry32(s))]) {
      const res = E.simulate(inp, rng ? { rng, lite: true } : {});
      for (const r of res.years.filter((x) => x.conversion > 0)) {
        years++;
        const top = E.bracketTop(0.24, r.status, r.taxScale), tradLeft = r.startTrad - r.rmd - r.wTrad - r.conversion;
        ok(r.ordTaxable <= top + 0.01, `${r.year}: not over the top (${r.ordTaxable} vs ${top})`);
        ok(r.ordTaxable >= top - 1 || tradLeft < 1, `${r.year}: at the top unless traditional TSP ran out`);
        ok(r.shortfall === 0, `${r.year}: no unfunded amount`);
      }
      ok(res.years.every((r) => Math.abs(r.cashCheck) < 0.05), 'cash flows balance');
    }
    ok(years > 20, 'conversion years checked');
  });
  test('Taxable account tracks cost basis: money deposited is basis, only its growth is gain', () => {
    // A home sale parked in the taxable account and spent the next year is basis coming back, not gain, in both countries.
    const ev = { when: 'year', taxed: 'no', inTodaysDollars: true, deferrable: false, repeat: 'once', everyNYears: 5, through: 0, forNYears: 2, person: 'household' };
    const inp = PLAN2_TIED();
    inp.spending.oneTimeEvents = [{ ...ev, at: 2041, label: 'Sell home', amount: 400000, direction: 'inflow' }, { ...ev, at: 2042, label: 'Buy home', amount: 400000, direction: 'outflow' }];
    const res = E.simulate(inp);
    let basis = 0;
    for (const r of res.years) {
      const gain = r.startTaxable > 0 ? r.wTaxable * Math.max(0, 1 - basis / r.startTaxable) : 0;
      basis += r.depositTaxable + r.sweep - (r.wTaxable - gain);
      near(r.basis.taxableGain, gain, 0.01, `${r.year} gain = withdrawal × (1 − basis ÷ start balance)`);
      near(r.basis.taxable, basis, 0.01, `${r.year} basis rolls forward`);
      near(r.ltcgIncome, gain, 0.01, `${r.year} long-term gains = realized gain (no taxable events)`);
      if (r.otherByEntry && r.otherByEntry[0]) near(r.otherByEntry[0].byType.brokerageGains, gain, 0.01, `${r.year} Mexico taxes the same gain`);
    }
    const r39 = res.years.find((y) => y.year === 2041), r40 = res.years.find((y) => y.year === 2042);
    ok(r39.depositTaxable + r39.sweep > 250000 && r40.wTaxable > 250000, 'the sale is invested in 2041 and withdrawn in 2042');
    ok(r40.basis.taxableGain > 0 && r40.basis.taxableGain <= r39.growthTaxable + 0.01, 'gain is at most the one year of growth');
    ok(r40.basis.taxableGain < 0.1 * r40.wTaxable, `gain is a small share of the withdrawal (${r40.basis.taxableGain} of ${r40.wTaxable})`);
  });
  test('Taxable basis: the gain share sets the starting basis; gains + unrealized gain = growth, also after losses', () => {
    const run = (mut, rng) => { const inp = E.defaultInputs(); inp.brokerage.balance = 200000; inp.brokerage.unrealizedGainShare = 0.3; mut(inp); return E.simulate(inp, rng ? { rng } : {}); };
    const check = (res, startGain, what) => {
      let realized = 0, growth = 0;
      for (const r of res.years) {
        realized += r.basis.taxableGain; growth += r.growthTaxable;
        ok(r.basis.taxable >= 0 && r.basis.taxableGain >= 0 && r.basis.taxableGain <= r.wTaxable + 1e-9, `${what} ${r.year}: basis and gain in range`);
      }
      const last = res.years[res.years.length - 1];
      near(realized + (last.balTaxable - last.basis.taxable), startGain + growth, 0.05, `${what}: realized + unrealized = starting gain + growth`);
    };
    const det = run(() => {});
    near(det.years[0].basis.taxable, 140000, 1e-9, '30% of $200,000 is gain: $140,000 basis');
    check(det, 60000, 'deterministic');
    for (const seed of [1, 2, 3, 4, 5, 6]) check(run(() => {}, E.mulberry32(seed)), 60000, `seed ${seed}`);
    // Losing account: the balance stays below basis, so withdrawals realize no gain and the excess basis is kept.
    const loss = run((i) => { i.brokerage.unrealizedGainShare = 0; i.brokerage.returns.beforeRetirement = -0.02; i.brokerage.returns.afterRetirement = -0.02; });
    ok(loss.years.some((r) => r.wTaxable > 1000), 'the losing account is drawn');
    ok(loss.years.every((r) => r.basis.taxableGain === 0 && (r.balTaxable === 0 || r.basis.taxable > r.balTaxable)), 'no gain while underwater');
    check(loss, 0, 'losses');
  });
  test('Checking: surplus tops it up first, it is refilled from the money market and drawn only when everything else is empty', () => {
    const run = (mut) => E.simulate(withInputs((i) => { Object.assign(i.checkingAndMoneyMarket.moneyMarket, { balance: 30000, yield: 0.0371 });
      Object.assign(i.checkingAndMoneyMarket.checking, { balance: 4000, keepInChecking: 10000, interestRate: 0.001 }); mut(i); }));
    const res = run(() => {});
    const r0 = res.years[0];
    near(r0.checking.interest, 4000 * 0.001, 1e-9, 'interest on the start-of-year checking balance');
    near(r0.cashInterest, 30000 * 0.0371, 1e-9, 'money market interest separately');
    ok(r0.checking.deposit > 0 && r0.checking.fromMoneyMarket > 0, 'surplus tops it up first, the money market refills the rest');
    near(r0.checking.deposit + r0.checking.fromMoneyMarket, 6000, 0.01, 'up to the target');
    near(r0.checking.bal, 10000, 0.01, 'at the target');
    for (const r of res.years) {
      ok(r.checking.bal <= 10000 * r.idx + 0.01, `${r.year}: never above the target`);
      if (r.balCash > 0.01 || r.checking.deposit > 0) near(r.checking.bal, 10000 * r.idx, 0.01, `${r.year}: kept at the target while the money market has money`);
      ok(r.checking.withdraw === 0, `${r.year}: not spent while other accounts have money`);
    }
    const over = run((i) => { i.checkingAndMoneyMarket.checking.balance = 25000; }).years[0];
    near(over.checking.toMoneyMarket, 15000, 0.01, 'checking above the target moves to the money market');
    const dep = run((i) => { i.spending.baseMonthly = 20000; i.workplacePlans.you.balances.traditional = 100000; i.spending.oneTimeEvents = []; });
    const used = dep.years.filter((r) => r.checking.withdraw > 0.005);
    ok(used.length > 0, 'depletion: checking is eventually spent');
    for (const r of used) ok(r.balCash < 0.01 && r.balTaxable < 0.01 && r.balTrad < 0.01 && r.balRoth < 0.01, `${r.year}: checking spent only after every other account`);
    const tax = E.computeTaxes({ ordinary: r0.salary - r0.contribEmpTrad + r0.cashInterest + r0.checking.interest, ltcg: 0, ss: 0, status: 'mfj', year: 2026, scale: 1 });
    near(r0.agi, tax.agi, 0.01, 'both interest amounts in AGI');
    ok(E.simulate(withInputs(() => {})).summary.endingBalance === E.simulate(withInputs((i) => { i.checkingAndMoneyMarket.checking.interestRate = 0.05; })).summary.endingBalance, 'no checking: rate irrelevant');
  });
  test('Settling-in years: the money market has no limit in the first years of retirement, then the excess moves to brokerage', () => {
    const ev = { when: 'year', taxed: 'no', inTodaysDollars: true, deferrable: false, repeat: 'once', everyNYears: 5, through: 0, forNYears: 2, person: 'household' };
    const mk = (n) => { const i = PLAN2_TIED(); Object.assign(i.checkingAndMoneyMarket.moneyMarket, { moveToBrokerageAbove: 20000, settlingInYears: n }); i.brokerage.savingsWhileWorking = 5000;
      i.spending.oneTimeEvents = [{ ...ev, at: 2041, label: 'Sell home', amount: 400000, direction: 'inflow' }, { ...ev, at: 2042, label: 'Buy home', amount: 300000, direction: 'outflow' }]; return i; };
    const base = E.simulate(mk(0)), hold = E.simulate(mk(3));
    const y = (res, Y) => res.years.find((r) => r.year === Y);
    ok(y(base, 2041).depositTaxable > 300000 && y(base, 2042).wTaxable > 0, 'no settling-in: the sale is invested, then sold for the purchase');
    for (const Y of [2040, 2041, 2042]) ok(y(hold, Y).depositTaxable === 0 && y(hold, Y).sweep === 0, `${Y}: nothing moved to brokerage while settling in`);
    const sale = y(hold, 2041);
    ok(Math.abs(sale.depositCash - sale.deposit) < 0.01 && sale.deposit > 0.9 * 400000 * sale.idx, 'the sale (less that year\'s spending) waits in the money market');
    ok(y(hold, 2042).wTaxable === 0 && y(hold, 2042).basis.taxableGain === 0, 'the purchase is paid from the money market: no gain realized');
    const r41 = y(hold, 2043);
    near(r41.sweep, r41.startCash - r41.wCash - 20000 * r41.idx, 0.01, '2043: everything above the limit moves to brokerage');
    near(r41.balCash, 20000 * r41.idx, 0.01, 'then the limit applies');
    ok(hold.years.filter((r) => r.phase === 'Working').some((r) => r.depositTaxable > 0), 'before retirement the limit applies as usual');
    ok(base.years.filter((r) => r.phase === 'Working').every((r, k) => Math.abs(r.depositTaxable - hold.years[k].depositTaxable) < 1e-9), 'pre-retirement flows unchanged');
  });
  // --- IRAs, conversions and transfers ----------------------------------------------------------------------
  test('Conversions are taxed and transfers are not; each move takes from its source and adds to its destination', () => {
    const run = (mut) => E.simulate(withInputs((i) => { i.iras.you.traditional.balance = 200000; i.workplacePlans.you.balances.roth = 100000; i.spending.oneTimeEvents = []; mut(i); }));
    const at57 = (res) => res.years.find((r) => r.year === 2040);
    const r0 = at57(run(() => {}));
    for (const [fromAccount, toAccount, taxed] of [['traditionalWorkplace', 'rothWorkplace', true], ['traditionalWorkplace', 'rothIra', true], ['traditionalIra', 'rothIra', true], ['rothWorkplace', 'rothIra', false], ['traditionalWorkplace', 'traditionalIra', false]]) {
      const key = E.moveKey({ fromAccount, toAccount });
      const res = run((i) => { i.taxes.conversionsAndTransfers = [WIN({ fromAge: 57, throughAge: 57, fromAccount, toAccount, howMuch: 'fixedAmount', fixedAmount: 30000 })]; });
      const r = at57(res), amt = 30000 * r.idx;
      near(r.moves[key], amt, 0.01, `${key}: amount moved`);
      ok(Object.entries(r.moves).every(([k, v]) => k === key || v === 0), `${key}: only this move`);
      near(r.conversion, taxed ? amt : 0, 0.01, `${key}: conversion = ${taxed}`);
      if (taxed) ok(r.agi >= r0.agi + amt - 0.01, `${key}: the conversion is income`);
      else near(r.agi, r0.agi, 0.01, `${key}: a transfer changes no income`);
      checkConservation(res, key);
    }
    const all = at57(run((i) => { i.taxes.conversionsAndTransfers = [WIN({ fromAge: 57, throughAge: 57, fromAccount: 'rothWorkplace', toAccount: 'rothIra', howMuch: 'wholeBalance' })]; }));
    ok(all.balRoth === 0 && all.moves.rothWorkplaceToRothIra > 100000, 'whole balance moves');
    const fill = run((i) => { i.taxes.conversionsAndTransfers = [WIN({ fromAge: 57, throughAge: 58, fromAccount: 'traditionalIra', toAccount: 'rothIra', howMuch: 'fillBracket', fillToTopOfBracket: 0.22 })]; });
    for (const r of fill.years.filter((x) => x.moves.traditionalIraToRothIra > 0)) {
      ok(r.ordTaxable <= E.bracketTop(0.22, r.status, r.taxScale) + 0.01 && (r.ordTaxable >= E.bracketTop(0.22, r.status, r.taxScale) - 1 || r.ira.trad.bal < 1), `${r.year}: IRA conversion fills the 22% bracket`);
    }
    const two = at57(run((i) => { i.taxes.conversionsAndTransfers = [WIN({ fromAge: 57, throughAge: 57, fromAccount: 'traditionalWorkplace', toAccount: 'rothIra', howMuch: 'fixedAmount', fixedAmount: 10000 }),
      WIN({ fromAge: 57, throughAge: 57, fromAccount: 'traditionalIra', toAccount: 'rothIra', howMuch: 'fixedAmount', fixedAmount: 20000 }), WIN({ fromAge: 57, throughAge: 57, fromAccount: 'rothWorkplace', toAccount: 'rothIra', howMuch: 'fixedAmount', fixedAmount: 5000 })]; }));
    ok(two.moves.traditionalWorkplaceToRothIra > 0 && two.moves.traditionalIraToRothIra === 0 && two.moves.rothWorkplaceToRothIra > 0, 'first conversion in a year applies; transfers always apply');
  });
  test('Traditional IRA: 10% penalty before 59½, RMDs; Roth IRA contributions while working are capped and are basis', () => {
    const res = E.simulate(withInputs((i) => { i.iras.you.traditional.balance = 100000; i.withdrawals.order = ['traditionalIra', 'brokerage', 'traditionalWorkplace', 'rothWorkplace', 'rothIra']; i.iras.you.roth.contributionsWhileWorking = 10000; i.spending.oneTimeEvents = []; i.spending.baseMonthly = 12000; }));
    const r57 = res.years.find((r) => r.year === 2040);
    ok(r57.ira.trad.withdraw > 0, 'the IRA is drawn first');
    near(r57.ira.trad.penalty, 0.1 * r57.ira.trad.withdraw, 1e-6, '10% of the withdrawal');
    const noPen = E.computeTaxes({ ordinary: r57.ordinaryIncome, ltcg: r57.ltcgIncome, ss: r57.ssYou + r57.ssSpouse, status: r57.status, year: 2040,
      scale: r57.taxScale, nOver65: r57.nOver65, mode: 'advanced', seniorDeduction: true });
    near(r57.federalTax, noPen.federal + r57.ira.trad.penalty, 0.01, 'federal tax includes the penalty');
    ok(res.years.filter((r) => r.ageYou >= 60).every((r) => r.ira.trad.penalty === 0), 'none from the year you turn 60');
    ok(res.warnings.some((w) => w.code === 'iraPenalty'), 'warning');
    const s = (Y) => Math.pow(1.03, Y - 2026);
    for (const r of res.years.filter((x) => x.phase === 'Working')) {
      const lim = Math.floor(7500 * s(r.year) / 500) * 500 + (r.ageYou >= 50 ? Math.floor(1100 * s(r.year) / 100) * 100 : 0);
      near(r.ira.roth.contrib, Math.min(10000 * r.idx, lim), 1e-6, `${r.year}: capped at the IRA limit`);
    }
    near(res.years[0].basis.rothIra, 7500, 1e-6, 'contributions are basis');
    ok(res.years.filter((r) => r.phase !== 'Working').every((r) => r.ira.roth.contrib === 0), 'no contributions after retiring');
    const big = E.simulate(withInputs((i) => { i.iras.you.traditional.balance = 800000; }));
    const first = big.years.find((r) => r.ira.trad.rmd > 0);
    ok(first && first.ageYou === 75, 'IRA RMDs start at 75');
    near(first.ira.trad.rmd, first.ira.trad.start / 24.6, 0.01, 'IRA RMD = prior year-end balance ÷ divisor');
    near(first.rmd, first.ira.trad.rmd + (first.startTrad > 0 ? first.startTrad / 24.6 : 0), 0.01, 'total RMD = TSP + IRA');
  });
  test('Roth IRA: transfers carry the Roth TSP basis share; earnings withdrawn before 59½ are flagged', () => {
    const res = E.simulate(withInputs((i) => { i.workplacePlans.you.balances.roth = 100000; i.workplacePlans.you.balances.rothBasisShare = 0.6; i.spending.oneTimeEvents = [];
      i.taxes.conversionsAndTransfers = [WIN({ fromAge: 57, throughAge: 57, fromAccount: 'rothWorkplace', toAccount: 'rothIra', howMuch: 'wholeBalance' })]; }));
    const r = res.years.find((x) => x.year === 2040), prev = res.years.find((x) => x.year === 2039);
    near(r.basis.rothIra, prev.basis.roth, 0.01, 'the Roth TSP basis moves with it');
    near(r.basis.roth, 0, 0.01, 'nothing left in the Roth TSP');
    const early = E.simulate(withInputs((i) => { i.iras.you.roth.balance = 50000; i.iras.you.roth.basisShare = 0; i.withdrawals.order = ['rothIra', 'brokerage', 'traditionalWorkplace', 'rothWorkplace', 'traditionalIra']; i.spending.oneTimeEvents = []; i.spending.baseMonthly = 12000; }));
    const e = early.years.find((x) => x.year === 2040);
    near(e.ira.roth.earlyEarnings, e.ira.roth.withdraw, 1e-6, 'no contributions: every dollar before 59½ is earnings');
    ok(early.warnings.some((w) => w.code === 'rothIraEarly'), 'warning');
    ok(early.years.filter((x) => x.ageYou >= 60).every((x) => x.ira.roth.earlyEarnings === 0), 'nothing flagged from 60');
  });
  test('Withdrawal order and strategies include the IRAs', () => {
    const res = E.simulate(withInputs((i) => { i.iras.you.traditional.balance = 300000; i.iras.you.roth.balance = 300000; i.brokerage.balance = 0; i.spending.oneTimeEvents = []; i.spending.baseMonthly = 12000;
      i.withdrawals.order = ['rothIra', 'traditionalIra', 'brokerage', 'traditionalWorkplace', 'rothWorkplace']; }));
    const r = res.years.find((x) => x.year === 2042);
    ok(r.ira.roth.withdraw > 0 && r.ira.trad.withdraw === 0 && r.wTrad === 0, 'Roth IRA first');
    const fill = E.simulate(withInputs((i) => { i.iras.you.traditional.balance = 300000; i.withdrawals.strategy = 'bracketFill'; i.withdrawals.fillToTopOfBracket = 0.12; i.spending.oneTimeEvents = []; i.spending.baseMonthly = 12000;
      i.withdrawals.order = ['traditionalIra', 'brokerage', 'traditionalWorkplace', 'rothWorkplace', 'rothIra']; })).years.find((x) => x.year === 2040);
    ok(fill.ira.trad.withdraw > 0 && fill.wTrad === 0, 'bracket fill takes the traditional accounts in order: IRA first');
  });
  test('Plan report shows IRAs, conversions and transfers', () => {
    const md = R.buildPlanReport(E.simulate(PLAN2_TIED()), {}).markdown;
    for (const t of ['### IRAs', 'Roth TSP → Roth IRA at ages 57–57: the whole balance (transfer)', 'traditional TSP → Roth IRA at ages 57–57: fill to the top of the 24% bracket',
      'Transfers between accounts', '| RIRA W |', '| Transfers |', 'Roth IRA 5-year rules are assumed met', 'traditional-only or Roth-only withdrawals are allowed']) ok(md.includes(t), `report has "${t}"`);
    ok(!/undefined|NaN/.test(md), 'no undefined/NaN');
    const ti = R.buildPlanReport(E.simulate(withInputs((i) => { i.iras.you.traditional.balance = 100000; })), {}).markdown;
    ok(ti.includes('| TIRA W |') && ti.includes('| Trad IRA |') && !ti.includes('| RIRA W |'), 'traditional IRA columns only when used');
  });
  // --- Plan file: one section per input panel, validation, the guide for people and AI assistants -----------
  const leafPaths = (o) => { const out = []; (function walk(v, p) { for (const [k, x] of Object.entries(v)) { const q = p ? `${p}.${k}` : k; if (x && typeof x === 'object' && !Array.isArray(x)) walk(x, q); else out.push(q); } })(o, ''); return out; };
  test('Every setting has a control in the panel of its section, in the same order, and every control is a setting', () => {
    if (!isNode) return; // reads index.html from disk
    const html = require('fs').readFileSync(require('path').join(__dirname, 'index.html'), 'utf8');
    const start = html.indexOf('const PANELS = [');
    const block = html.slice(start, html.indexOf('\n  ];', start));
    // A panel about one person writes its paths with $ for the person picked with its switch: they stand for "you" and
    // then "spouse", and must come before the panel's household settings, as in the file.
    const panels = block.split(/\n    \{ id: '/).slice(1).map((p) => {
      const raw = [...p.matchAll(/\{ p: '([\w.$]+)'/g)].map((m) => m[1]);
      const per = raw.filter((x) => x.includes('$')), shared = raw.filter((x) => !x.includes('$'));
      ok(!per.length || raw.indexOf(per[per.length - 1]) < (shared.length ? raw.indexOf(shared[0]) : Infinity), `${p.slice(0, p.indexOf("'"))}: per-person controls come first`);
      return { id: p.slice(0, p.indexOf("'")), paths: [...per.map((x) => x.replace('$', 'you')), ...per.map((x) => x.replace('$', 'spouse')), ...shared] };
    });
    const leaves = leafPaths(E.defaultInputs());
    const sections = Object.keys(E.defaultInputs()).filter((k) => k !== 'version');
    ok(panels.map((p) => p.id).join() === sections.join(), `panels ${panels.map((p) => p.id).join()} = sections in the same order`);
    // Lists have editors of their own (one-time events, conversions and transfers, withdrawal order).
    const own = ['version', 'spending.oneTimeEvents', 'taxes.conversionsAndTransfers', 'withdrawals.order', 'otherTaxes'];
    const all = panels.flatMap((p) => p.paths);
    for (const p of panels) {
      for (const path of p.paths) ok(path.startsWith(p.id + '.') && leaves.includes(path), `${path} is a setting of the ${p.id} section`);
      ok(leaves.filter((l) => p.paths.includes(l)).join() === p.paths.join(), `${p.id}: controls follow the settings' order`);
    }
    for (const leaf of leaves) if (!own.includes(leaf)) ok(all.includes(leaf), `${leaf} has a control`);
  });
  test('validateInputs lists what an edited plan file gets wrong; the defaults are clean', () => {
    ok(E.validateInputs(E.defaultInputs()).length === 0, 'defaults are clean');
    const f = clone(E.defaultInputs());
    f.workplacePlans.you.returns.afterRetirment = 0.05;
    f.workplacePlans.you.returns.beforeRetirement = 7;
    delete f.brokerage;
    f.withdrawals.strategy = 'fill';
    f.withdrawals.order = ['rothIra', 'roth'];
    const badMove = f.taxes.conversionsAndTransfers.push({ fromAccount: 'rothIra', toAccount: 'traditionalWorkplace', fromAge: 60, throughAge: 60, howMuch: 'fixedAmount', fixedAmount: 1000 }) - 1;
    f.spending.oneTimeEvents[0].direction = 'in';
    f.household.married = 'maybe';
    f.employment.you.salary = '101,443';
    const issues = E.validateInputs(f);
    const at = (path) => issues.filter((x) => x.path === path).map((x) => x.problem).join(' | ');
    ok(/unknown/.test(at('workplacePlans.you.returns.afterRetirment')), 'unknown setting (typo)');
    ok(/whole-number percent/.test(at('workplacePlans.you.returns.beforeRetirement')), '7 instead of 0.07');
    ok(/missing/.test(at('brokerage')) && !issues.some((x) => x.path.startsWith('brokerage.')), 'a missing section is reported once');
    ok(/not allowed/.test(at('withdrawals.strategy')) && /not an account/.test(at('withdrawals.order')), 'values that are not allowed');
    ok(/not a conversion or transfer/.test(at(`taxes.conversionsAndTransfers[${badMove}]`)), 'unsupported move');
    ok(/not allowed/.test(at('spending.oneTimeEvents[0].direction')) && !issues.some((x) => /oneTimeEvents\[\d+\]\.\w+$/.test(x.path) && /missing/.test(x.problem)), 'list items: bad values, no missing-field noise');
    ok(/true or false/.test(at('household.married')) && /number/.test(at('employment.you.salary')), 'wrong types');
    // Every decimal default is checked for whole-number percents.
    const g = clone(E.defaultInputs()), decimals = leafPaths(g).filter((p) => { const v = p.split('.').reduce((o, k) => o[k], g); return typeof v === 'number' && v >= 0.01 && v < 1; }); // ×100 below 1 (e.g. 0.25 for 0.25%) cannot be told apart
    for (const p of decimals) { const ks = p.split('.'), o = ks.slice(0, -1).reduce((x, k) => x[k], g); o[ks[ks.length - 1]] *= 100; }
    const flagged = E.validateInputs(g).filter((x) => /whole-number percent/.test(x.problem)).map((x) => x.path);
    for (const p of decimals) ok(flagged.includes(p), `${p} is checked as a decimal`);
    ok(E.PLAN_GUIDE.join(' ').includes('withdrawals.strategy = fixedOrder | proportional | bracketFill') && E.PLAN_GUIDE.join(' ').includes('traditionalWorkplace → rothIra'), 'the guide lists allowed values and moves');
  });
  test('The review packet lists inputs by section and ends with the plan file, which imports back to the same plan', () => {
    const inp = E.defaultInputs();
    const file = JSON.stringify({ app: 'fers-retirement-planner', name: 'Test', howToRead: E.PLAN_GUIDE, inputs: inp }, null, 2);
    const md = R.buildPlanReport(E.simulate(inp), { planFile: file }).markdown;
    for (const k of Object.keys(inp).filter((x) => x !== 'version')) ok(md.includes(`(\`${k}\`)`), `Inputs heading for ${k}`);
    const j = JSON.parse(md.split('```json\n')[1].split('\n```')[0]);
    ok(JSON.stringify(E.normalizeInputs(j.inputs)) === JSON.stringify(inp) && E.validateInputs(j.inputs).length === 0, 'the appended file imports to the same plan');
    ok(md.includes('complete edited settings file'), 'the reviewer is asked for an importable file');
    const story = R.buildPlanReport(E.simulate(withInputs((i) => { i.iras.you.roth.balance = 80000; i.brokerage.balance = 120000; i.withdrawals.strategy = 'proportional'; })), {}).story.join(' ');
    ok(story.includes('your Roth IRA $80,000') && story.includes('brokerage investments $120,000') && story.includes('in proportion to their size') && story.includes('Roth IRA'), 'the narrative covers every account and the strategy');
  });
  test('Year rows stay under 128 properties (larger literals are slow dictionary-mode objects in V8)', () => {
    const n = Object.keys(E.simulate(PLAN2()).years[0]).length;
    ok(n < 128, `row has ${n} properties; group new fields into a nested object`);
  });

  // --- Report --------------------------------------------------------------------------------------
  const failed = results.filter((r) => !r.ok);
  if (isNode) {
    for (const r of results) console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}${r.ok ? '' : '\n        ' + r.error}`);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) process.exitCode = 1;
  } else {
    root.__engineTestResults = results;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
