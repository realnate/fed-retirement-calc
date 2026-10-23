/*
 * report.js — turns a simulate() result into (1) a plain-English narrative and (2) a complete Markdown
 * "review packet" meant to be pasted into an AI assistant or sent to an advisor for a second check.
 *
 * Pure and DOM-free (formatting only; all numbers come from the engine result). Works as a browser
 * global (window.RetireReport) and as a CommonJS module under Node.
 *
 *   buildPlanReport(result, { scenarioName, mc, mcStale, comparison, tools, toolsStale, generatedAt, planFile })
 *     -> { story: string[], markdown: string }
 *   planFile: the plan's settings file (the text Export JSON saves), appended so a reviewer can return an edited copy.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RetireReport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function reportFactory() {
  'use strict';

  const usd = (x) => {
    if (x === null || x === undefined || !Number.isFinite(x)) return '—';
    const r = Math.round(x);
    return (r < 0 ? '−$' : '$') + Math.abs(r).toLocaleString('en-US');
  };
  const num = (x) => (Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : '');
  const pct = (x, d) => { const k = Math.pow(10, d === undefined ? 1 : d); return Number.isFinite(x) ? (Math.round(x * 100 * k) / k).toString() + '%' : '—'; };
  const ym = (years) => { const m = Math.round(years * 12); const y = Math.floor(m / 12), mm = m % 12; return mm ? `${y} y ${mm} m` : `${y}`; };
  const yesNo = (b) => (b ? 'yes' : 'no');
  const list = (arr) => (arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]);
  // Accounts as the inputs name them (withdrawal order; conversions and transfers).
  const ACCOUNT = { brokerage: 'brokerage investments', traditionalTsp: 'traditional TSP', rothTsp: 'Roth TSP', traditionalIra: 'traditional IRA', rothIra: 'Roth IRA' };
  // "Replace car −$30,000 (today's $) every 6 years from 2052 through 2070" and similar.
  const eventText = (e) => {
    const whose = e.person === 'spouse' ? "your spouse's" : 'your';
    const at = (v) => (e.when === 'age' ? `${whose} age ${v}` : e.when === 'yearsBeforeDeath' ? (+v === 0 ? `${whose} death year` : `${v} year(s) before ${whose} death`) : `${v}`);
    const tie = e.person === 'you' ? ' [only while you are alive]' : e.person === 'spouse' ? ' [only while your spouse is alive]' : '';
    const amt = `${e.direction === 'inflow' ? '+' : '−'}${usd(e.amount)}${e.inTodaysDollars ? " (today's $)" : ' (nominal)'}`;
    const core = e.repeat === 'everyNYears' ? `${e.label} ${amt} every ${e.everyNYears} years from ${at(e.at)}${e.through > 0 ? ` through ${at(e.through)}` : ' to the end of the plan'}`
      : e.repeat === 'eachYearForNYears' ? `${e.label} ${amt} a year for ${e.forNYears} years from ${at(e.at)}` : `${e.label} ${amt} in ${at(e.at)}`;
    return core + tie;
  };
  // Income types a foreign country can tax: [foreignTax.appliesTo key, label].
  const mxTypes = (A) => [['traditionalWithdrawals', 'traditional TSP and IRA + RMDs'],
    ['rothWithdrawals', A.rothAmountTaxed === 'earningsShare' ? 'Roth TSP and IRA (earnings share)' : `Roth TSP and IRA (${Math.round(A.rothTaxedShare * 100)}%)`],
    ['rothConversions', 'Roth conversions'], ['socialSecurity', 'Social Security'], ['fersAnnuity', 'FERS annuity'], ['fersSupplement', 'FERS supplement'],
    ['brokerageGains', 'brokerage investment gains'], ['interest', 'money market and checking interest'], ['earnedIncome', 'earned income']];
  const RELIEF = { usCreditsForeignTax: 'the US credits the foreign tax (Mexico taxes in full)', foreignCountryCreditsUsTax: 'the foreign country credits the US tax', none: 'none' };
  // [2038, 2052, 2053, 2054] → "2038 and 2052–2054"
  const yearRanges = (ys) => {
    const out = [];
    for (const y of ys) { const r = out[out.length - 1]; if (r && y === r[1] + 1) r[1] = y; else out.push([y, y]); }
    return list(out.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)));
  };
  // Conversions (traditional → Roth, taxed) and transfers (same tax type, not taxed) between accounts.
  const isConv = (w) => /^traditional/.test(w.fromAccount) && /^roth/.test(w.toAccount);
  const moveKey = (w) => `${w.fromAccount}To${w.toAccount[0].toUpperCase()}${w.toAccount.slice(1)}`;
  const moveText = (w) => `${ACCOUNT[w.fromAccount]} → ${ACCOUNT[w.toAccount]} at ages ${w.fromAge}–${w.throughAge}: ` +
    (w.howMuch === 'fillBracket' && isConv(w) ? `fill to the top of the ${pct(w.fillToTopOfBracket, 0)} bracket` : w.howMuch === 'wholeBalance' ? 'the whole balance' : `${usd(w.fixedAmount)}/yr (today's $)`);
  // "7% before → 5% after retirement"
  const beforeAfter = (r) => `${pct(r.beforeRetirement)} before → ${pct(r.afterRetirement)} after retirement`;

  function buildPlanReport(res, opts) {
    opts = opts || {};
    // opts.mc is a Monte Carlo suite { fixed, stochastic, selected } (both lifespan modes, same seeds).
    const suite = opts.mc && opts.mc.fixed ? opts.mc : null;
    const mcSelKey = res.inputs.household.monteCarloLifespans === 'stochastic' ? 'stochastic' : 'fixed';
    const mcSel = suite ? suite[mcSelKey] : null;
    const inp = res.inputs, S = res.summary, F = S.fers, Y = res.years;
    const H = inp.household, E = inp.employment, T = inp.tsp, IR = inp.iras, BR = inp.brokerage;
    const CK = inp.checkingAndMoneyMarket.checking, MM = inp.checkingAndMoneyMarket.moneyMarket, WD = inp.withdrawals;
    const P = inp.fersPension, SU = inp.fersSupplement, SS = inp.socialSecurity, SP = inp.spending, TX = inp.taxes;
    const FT = inp.foreignTax, MC = inp.monteCarlo, RUL = MC.adaptiveRules, HC = SP.healthcare, FX = SP.foreignCurrency;
    const moves = TX.conversionsAndTransfers;
    const convW = moves.filter(isConv), xferW = moves.filter((w) => !isConv(w));
    const iraT = IR.traditional.balance > 0 || moves.some((w) => w.fromAccount === 'traditionalIra' || w.toAccount === 'traditionalIra');
    const iraR = IR.roth.balance > 0 || IR.roth.contributionsWhileWorking > 0 || moves.some((w) => w.toAccount === 'rothIra');
    const Y0 = H.currentYear, hasSp = H.married;
    const row = (y) => Y.find((r) => r.year === y);
    const today = (v, y) => { const r = row(y); return r ? v / r.idx : v; };
    const first = Y[0], last = Y[Y.length - 1];
    const working = Y.filter((r) => r.phase === 'Working');
    const retired = Y.filter((r) => r.phase !== 'Working');
    const sum = (rows, f) => rows.reduce((t, r) => t + f(r), 0);
    const youAgeNow = Y0 - H.you.birthYear, spAgeNow = Y0 - H.spouse.birthYear;
    const hasChk = CK.balance > 0 || CK.keepInChecking > 0;
    const orderText = WD.order.map((k) => ACCOUNT[k]);
    const nSettle = Math.round(MM.settlingInYears || 0);
    const settle = MM.keepSurplus && nSettle > 0 && S.retireYear <= S.endYear ? [S.retireYear, Math.min(S.endYear, S.retireYear + nSettle - 1)] : null;
    const settleTxt = settle ? `${settle[0]}${settle[1] > settle[0] ? `–${settle[1]}` : ''}` : '';
    const typeText = { immediate: 'immediate, unreduced', mra10: 'MRA+10 (reduced, no supplement)', deferred: 'deferred', none: 'no annuity (not vested)' }[F.retirementType];
    const electionText = { none: 'no survivor annuity', partial: 'partial survivor annuity (−5%, survivor gets 25%)', full: 'full survivor annuity (−10%, survivor gets 50%)' }[F.election];
    const strategyText = {
      fixedOrder: 'the accounts in a fixed order',
      proportional: 'the brokerage, TSP and IRA balances in proportion to their size',
      bracketFill: `traditional TSP and IRA money first, up to the top of the ${pct(WD.fillToTopOfBracket, 0)} bracket each year, then the other accounts in order`,
    }[WD.strategy];
    const P1 = S.people.you, P2 = S.people.spouse;
    const tradEnd = last.balTrad + last.ira.trad.bal;

    // ---------------------------------------------------------------------------------------------
    // Narrative
    // ---------------------------------------------------------------------------------------------
    const story = [];
    story.push(
      `This plan covers ${hasSp ? 'a married couple' : 'a single person'}: you (born ${H.you.birthYear}, age ${youAgeNow} in ${Y0})` +
      (hasSp ? ` and your spouse (born ${H.spouse.birthYear}, age ${spAgeNow})` : '') + `. ` +
      `It runs from ${Y0} to ${S.endYear} in nominal dollars with ${pct(inp.inflation.rate)} inflation; "today's dollars" means ${Y0} dollars. ` +
      `Assumed lifespans: you through age ${S.youDeathYear - H.you.birthYear} (${S.youDeathYear})` +
      (hasSp ? `, your spouse through age ${S.spouseDeathYear - H.spouse.birthYear} (${S.spouseDeathYear})` : '') + '.' +
      (H.longevityStress ? ' Longevity stress is on: the last survivor is extended to the plan-to age.' : ''));

    {
      // Savings today and the returns each account is expected to earn.
      const held = [
        [`the TSP ${usd(T.balances.traditional + T.balances.roth)} (traditional ${usd(T.balances.traditional)}, Roth ${usd(T.balances.roth)})`, true],
        [`a traditional IRA ${usd(IR.traditional.balance)}`, IR.traditional.balance > 0],
        [`a Roth IRA ${usd(IR.roth.balance)}`, IR.roth.balance > 0],
        [`brokerage investments ${usd(BR.balance)} (${pct(BR.unrealizedGainShare, 0)} of it unrealized gain)`, BR.balance > 0],
        [`the money market ${usd(MM.balance)}`, MM.balance > 0],
        [`checking ${usd(CK.balance)}`, CK.balance > 0],
      ].filter(([, on]) => on).map(([t]) => t);
      const total = T.balances.traditional + T.balances.roth + IR.traditional.balance + IR.roth.balance + BR.balance + MM.balance + CK.balance;
      const rets = [`TSP ${beforeAfter(T.returns)} (one fund allocation for both balances)`];
      if (iraT) rets.push(`traditional IRA ${beforeAfter(IR.traditional.returns)}`);
      if (iraR) rets.push(`Roth IRA ${beforeAfter(IR.roth.returns)}`);
      rets.push(`brokerage investments ${beforeAfter(BR.returns)}`);
      story.push(`Savings today total ${usd(total)}: ${list(held)}. Expected yearly returns: ${list(rets)}` +
        `; the money market yields ${pct(MM.yield, 2)}${hasChk ? ` and checking ${pct(CK.interestRate, 2)}` : ''}.` +
        (MC.enabled ? ' Monte Carlo varies these returns around their expected values (see Monte Carlo).' : ''));
    }

    if (working.length) {
      const lastW = working[working.length - 1];
      const iraContrib = sum(working, (r) => r.ira.roth.contrib);
      const spouseWork = hasSp && E.spouse.hasEarnings && E.spouse.earnings > 0;
      // ", plus GS step increases from step 5: step 6 in 2027, 7 in 2029 and 8 in 2032"
      const stepsText = () => {
        if (!E.addStepIncreases) return '';
        const st = S.stepIncreases;
        if (!st.length) return E.currentStep >= 10 ? ', already at GS step 10, the top step' : `; GS step ${E.currentStep}, with no step increase before you retire`;
        const parts = st.map((x, k) => `${k ? '' : 'step '}${x.step} in ${x.year}`);
        return `, plus GS step increases from step ${E.currentStep}: ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]}`;
      };
      story.push(
        `You keep working through ${lastW.year}. Salary rises from ${usd(first.salary)} to about ${usd(lastW.salary)} ` +
        `(${pct(E.annualRaise)} raises a year${stepsText()})` +
        `${S.payCapFromYear !== null ? `, held at the GS pay cap (Executive Schedule level IV) ${S.payCapFromYear > S.startYear ? `from ${S.payCapFromYear}` : `throughout${S.stepIncreases.length ? ', so the step increases add nothing' : ''}`}` : ''}. ` +
        `You contribute ${pct(T.contributions.rate)} of pay (${pct(T.contributions.rothShare, 0)} Roth${T.contributions.catchUp ? ', plus catch-ups from 50' : ''}) and the agency adds ` +
        `${pct(first.contribAgency / first.salary)}. At a ${pct(T.returns.beforeRetirement)} return the TSP grows from ${usd(T.balances.traditional + T.balances.roth)} to ` +
        `${usd(S.tspAtRetirement)} by the start of ${S.retireYear} (${usd(today(S.tspAtRetirement, S.retireYear))} in today's dollars).` +
        (iraContrib > 0.5 ? ` You also put ${usd(IR.roth.contributionsWhileWorking)}/yr (today's $, capped at the IRA limit) into the Roth IRA, ${usd(iraContrib)} in all.` : '') +
        (spouseWork ? ` Your spouse earns ${usd(E.spouse.earnings)}/yr (today's $) until age ${E.spouse.stopsAtAge}.` : '') +
        ` While working, salary is assumed to cover living costs and taxes${E.extraSavings > 0 ? `; ${usd(E.extraSavings)}/yr (today's $) is saved on top, into the brokerage account` : ''}.` +
        (() => {
          const ww = working.filter((r) => r.ssYou + r.ssSpouse + r.pension + r.supplement > 0.5);
          if (!ww.length) return '';
          return E.spendBenefitsThatStartBeforeRetiring
            ? ` Benefits that start before you retire (from ${ww[0].year}, ${usd(sum(ww, (r) => r.coveredIncome))} in total) are assumed to be spent with your salary, not saved.`
            : ` Benefits that start before you retire (from ${ww[0].year}) are saved, not spent: ${usd(sum(ww, (r) => r.deposit))} in total${MM.keepSurplus ? ', kept in the money market up to the limit' : ''}.`;
        })());
    }

    if (F.retirementType === 'none') {
      story.push(`You separate at ${E.retirementAge} with ${F.service} years of service, which is not enough for a FERS annuity (5 years are required).`);
    } else {
      let t = `You retire at the start of ${S.retireYear} at age ${E.retirementAge} with ${F.service} years of service` +
        (P.sickLeaveHours > 0 ? ` (plus ${P.sickLeaveHours} sick-leave hours, giving ${F.compService.toFixed(2)} years for the computation)` : '') +
        `: ${/^[aeiou]/i.test(typeText) ? 'an' : 'a'} ${typeText} retirement under the ${F.rule} rule (your MRA is ${ym(F.mra)}). `;
      if (P.useOpmEstimate) t += `The annuity is taken from your OPM estimate: ${usd(F.initialAnnuity / 12)}/mo gross. `;
      else t += `High-${F.highN} is ${usd(F.high3)}${P.high3Mode === 'auto' ? ' (projected)' : ''}${F.highN === 5 ? ' (High-5 proposal scenario)' : ''}, so the basic annuity is ${F.specialFormula ? '1.7% × 20 yrs + 1% × the rest' : pct(F.multiplier)} × High-${F.highN} × service = ${usd(F.basicAnnuity)}/yr. `;
      if (F.ageReduction > 0) t += `It is permanently reduced ${pct(F.ageReduction)} because it starts at ${F.pensionStartAge}, before 62. `;
      if (F.pensionStartYear !== S.retireYear && F.pensionStartYear !== null) t += `Payments start in ${F.pensionStartYear} (age ${F.pensionStartAge}). `;
      t += `With ${electionText}, you receive ${usd(F.initialMonthlyToRetiree)}/mo at the start`;
      if (F.survivorPct > 0) t += `, and your spouse would receive ${usd(F.initialAnnuity * F.survivorPct / 12)}/mo (plus later COLAs) if you die first`;
      t += `. ${P.colaMode === 'none' ? 'Scenario: no COLAs on the annuity or survivor annuity.' : `${P.colaMode === 'reduced' ? `Scenario: COLAs are the diet COLA minus ${pct(P.colaReducedBy, 2)} (never below 0); they` : 'Diet COLAs'} ${P.specialCategory ? 'apply right away (special category).' : `begin the year after you turn 62 (${H.you.birthYear + 63}).`}`}`;
      if (E.afterRetiring.earnings > 0) t += ` After retiring you earn ${usd(E.afterRetiring.earnings)}/yr (today's $) until age ${E.afterRetiring.untilAge}.`;
      story.push(t);
      if (F.supplementEligible) {
        story.push(`The FERS supplement of ${usd(F.supplementMonthly)}/mo (fixed; no COLA) is paid from ${S.retireYear} through ${F.supplementEndYear - 1}. ` +
          (SU.mode === 'manual' ? 'It is a manual amount.' : `It is estimated as Social Security at 62 from FERS earnings (${usd(F.ss62Today)}/mo in today's $) × ${F.supplementYears} years of service (rounded to the nearest year) ÷ 40.`) +
          (E.afterRetiring.earnings > 0 ? ' Your post-retirement earnings are subject to its earnings test.' : ''));
      } else if (SU.mode === 'off') {
        story.push('The FERS supplement is switched off (a "supplement eliminated" scenario).');
      }
    }

    {
      const yr = row(P1.claimYear) || row(P1.claimYear + 1);
      let t = `You claim Social Security at ${ym(P1.claimAge)} in ${P1.claimYear}: ${pct(P1.factor)} of your ${usd(P1.pia)}/mo PIA (today's $), ` +
        `about ${usd(yr ? yr.ssYou : 0)} in ${yr ? yr.year : P1.claimYear} (nominal; benefits rise with inflation).`;
      if (P2) {
        const yr2 = row(P2.claimYear + 1) || row(P2.claimYear);
        t += ` Your spouse claims at ${ym(P2.claimAge)} in ${P2.claimYear}: ${pct(P2.factor)} of a ${usd(P2.pia)}/mo PIA, about ${usd(yr2 ? yr2.ssSpouse : 0)} in ${yr2 ? yr2.year : P2.claimYear}.`;
        const sp = Y.reduce((m, r) => m + r.ssSpouseSpousal + r.ssYouSpousal, 0);
        t += sp > 0 ? ` Spousal benefits add ${usd(sp)} over the plan.` : ' Neither spouse qualifies for a spousal top-up (each PIA is at least half of the other).';
      }
      const sh = SS.trustFundShortfall;
      if (sh.benefitsPaidShare < 1) t += ` Shortfall scenario: only ${pct(sh.benefitsPaidShare, 0)} of scheduled benefits are paid from ${sh.fromYear} (own, spousal and survivor benefits); the amounts above are before that cut where it applies.`;
      story.push(t);
    }

    {
      const base = FX.enabled ? `${num(FX.baseMonthly)} ${FX.code}/mo (≈ ${usd(FX.baseMonthly / FX.localPerUsd)}/mo today at ${FX.localPerUsd} per USD, drifting ${pct(FX.annualDrift)}/yr)` : `${usd(SP.baseMonthly)}/mo in today's dollars`;
      const ph = SP.phases;
      let t = `Retirement spending is ${base}` + (ph.enabled ? `, scaled ${pct(ph.goGoShare, 0)} / ${pct(ph.slowGoShare, 0)} / ${pct(ph.noGoShare, 0)} for go-go (to ${ph.goGoUntilAge}), slow-go (to ${ph.slowGoUntilAge}) and no-go years` : '') +
        (HC.fehbMonthly > 0 ? `, plus FEHB of ${usd(HC.fehbMonthly)}/mo growing at ${pct(HC.inflation)}` : ' (all-in, including FEHB)') +
        (HC.medicarePartBYou || HC.medicarePartBSpouse ? `, plus Medicare Part B for ${list([HC.medicarePartBYou ? 'you' : null, HC.medicarePartBSpouse ? 'your spouse' : null].filter(Boolean))} from 65` : '') +
        (hasSp ? `, dropping to ${pct(SP.survivorShare, 0)} after the first death` : '') + '.';
      const evs = (SP.oneTimeEvents || []).filter((e) => e.amount > 0);
      if (evs.length) t += ' One-time events: ' + evs.map(eventText).join('; ') + '.';
      const bridgeRows = Y.filter((r) => r.year >= S.bridgeStartYear && r.year < S.bridgeEndYear);
      if (bridgeRows.length) {
        t += ` During the bridge years ${S.bridgeStartYear}–${S.bridgeEndYear - 1}, before ${hasSp ? 'both Social Security claims' : 'Social Security'} start, ` +
          (S.bridgePortfolioUsed > 0.5 ? `the portfolio supplies ${usd(S.bridgePortfolioUsed)} net (${usd(S.bridgeTspUsed)} of it from the TSP).` : 'guaranteed income covers spending and taxes, so the portfolio is not drawn.');
      }
      if (S.peakWithdrawalRate > 0) {
        t += ` The peak core withdrawal rate (recurring spending and taxes only) is ${pct(S.peakCoreWithdrawalRate)}${S.peakCoreWithdrawalYear ? ` (${S.peakCoreWithdrawalYear})` : ''}; ` +
          `including one-time events and Roth-conversion tax it peaks at ${pct(S.peakWithdrawalRate)} (${S.peakWithdrawalYear}).`;
      } else t += ' The portfolio is never needed for spending.';
      if (S.bucket) {
        t += ` A bridge bucket earning a fixed ${pct(S.bucket.rate)} is funded in ${S.bucket.fundYear} with ${usd(S.bucket.sizeAtFund)}, the present value of the ` +
          `${usd(S.bucket.plannedDraws)} of planned net draws for ${S.bucket.retireYear}–${S.bucket.endYear}; ${usd(S.bucket.drawn)} of spending comes out of it.`;
      }
      story.push(t);
    }

    story.push(
      (hasChk ? `Checking is kept at ${usd(CK.keepInChecking)} (today's $)${CK.interestRate > 0 ? ` earning ${pct(CK.interestRate, 2)}` : ''}: surplus tops it up first, the money market refills it, and it is spent only after every other account. ` : '') +
      (MM.keepSurplus
        ? `Surplus cash flow is kept in the money market (money market funds, savings) up to ${usd(MM.moveToBrokerageAbove)} (today's $)${MM.yield > 0 ? ` earning ${pct(MM.yield, 2)}` : ' earning nothing'}; anything above that is invested in brokerage investments (stock and bond funds)` +
          (settle ? `, except in the settling-in years ${settleTxt} at the start of retirement, when the money market has no limit.` : '.')
        : 'Surplus cash flow, including RMDs beyond what is spent, is invested in brokerage investments (stock and bond funds).') +
      ` RMDs come out first each year. When income falls short, the money market is used first, then ${strategyText}` +
      (WD.strategy !== 'proportional' ? ` (${list(orderText)})` : '') + (hasChk ? ', and checking last' : '') + '.' +
      (WD.oneTimeOutflowsFromRothFirst ? ' One-time outflows are paid from the Roth accounts first.' : '') +
      (S.maxCash > 0.5 ? ` The money market balance peaks at ${usd(S.maxCash)} (nominal${MM.keepSurplus ? '; the limit rises with inflation' : ''}).` : ''));

    {
      const rmdRow = row(S.rmdStartYear);
      const fed = S.lifetimeFederalTax, fedRet = S.retirementFederalTax;
      const margins = retired.map((r) => r.marginal);
      let t = rmdRow
        ? `Required minimum distributions start in ${S.rmdStartYear} at age ${S.rmdStartAge}; the first is ${usd(rmdRow.rmd)} (${usd(rmdRow.startTrad + rmdRow.ira.trad.start)} of traditional TSP${iraT ? ' and IRA' : ''} money ÷ the IRS divisor). `
        : `RMDs would start in ${S.rmdStartYear} (age ${S.rmdStartAge}), after the projection ends. `;
      t += `Federal income tax totals ${usd(fed)} (${usd(fedRet)} in retirement), with retirement marginal brackets from ${pct(Math.min(...margins), 0)} to ${pct(Math.max(...margins), 0)}` +
        ` (${TX.mode === 'advanced' ? `2026 brackets and deductions, indexed ${pct(inp.inflation.rate - TX.bracketGrowthBelowInflation, 2)}/yr` : `simple effective rates ${pct(TX.simpleRateJoint)} joint / ${pct(TX.simpleRateSingle)} single`}${TX.stateRate > 0 ? `; state ${pct(TX.stateRate)}` : '; no state tax'}).`;
      if (convW.length) {
        const conv = Y.filter((r) => r.conversion > 0);
        t += conv.length ? ` Roth conversions (${convW.map(moveText).join('; ')}) move ${usd(S.totalConversions)} in ${yearRanges(conv.map((r) => r.year))}, costing ${usd(sum(conv, (r) => r.conversionTax))} in tax.`
          : ' Roth conversions are set but none happen (no room under the target or no traditional balance).';
      }
      if (xferW.length) {
        const moved = (r) => xferW.reduce((a, w) => a + (r.moves[moveKey(w)] || 0), 0);
        const xr = Y.filter((r) => moved(r) > 0.5);
        if (xr.length) t += ` Transfers (${xferW.map(moveText).join('; ')}) move ${usd(sum(xr, moved))} in ${yearRanges(xr.map((r) => r.year))}, untaxed.`;
      }
      const pen = sum(Y, (r) => r.ira.trad.penalty);
      if (pen > 0.5) t += ` Traditional IRA withdrawals before 59½ add ${usd(pen)} of 10% early-withdrawal penalty.`;
      if (FT.enabled) {
        // With art. 20 the TSP is US-only, but IRAs are still taxed.
        const A = FT.appliesTo;
        const types = mxTypes(A).filter(([k]) => A[k] && !(FT.treatyArt20 && (['fersAnnuity', 'fersSupplement'].includes(k) || (k === 'traditionalWithdrawals' && !iraT) || (k === 'rothWithdrawals' && !iraR))))
          .map(([k, l]) => (FT.treatyArt20 && k === 'traditionalWithdrawals' ? 'traditional IRA + RMDs' : FT.treatyArt20 && k === 'rothWithdrawals' ? l.replace('Roth TSP and IRA', 'Roth IRA') : l));
        const country = FT.country || 'Foreign';
        t += ` ${country} tax residency from ${FT.residentFromYear} adds ${FT.method === 'mexicoIsr' ? `Mexico's progressive ISR (2026 tariff, indexed ${pct(FT.isrIndexing)}/yr, converted at ${FX.localPerUsd} MXN/USD drifting ${pct(FX.annualDrift)}/yr)` : `a flat ${pct(FT.flatRate)}`}` +
          ` on ${types.length ? list(types) : 'nothing'}${FT.treatyArt20 ? ' (TSP, FERS and the supplement are US-only under the art. 20 toggle; IRAs are not covered)' : ''}` +
          `${FT.method === 'mexicoIsr' && FT.retirementIncomeExemption ? `, with retirement income exempt up to ${FT.umaMultiple} × UMA` : ''}${FT.method === 'flatRate' && FT.flatExemptAmount > 0 ? ` above ${usd(FT.flatExemptAmount)}/yr (today's $)` : ''}: ` +
          `${usd(S.lifetimeForeignTax)} paid to ${country}. ` +
          ({ usCreditsForeignTax: `The US credits ${country}'s tax up to the US tax on the same income (${usd(S.lifetimeUsFtc)} credited); ${usd(S.ftcExpiredTotal)} of credits expire unused after 10 years.`,
            foreignCountryCreditsUsTax: `${country} credits the US tax on the same income.`, none: 'No double-tax relief is applied.' }[FT.relief]);
      }
      story.push(t);
    }

    if (hasSp && S.firstDeathYear !== null && S.firstDeathYear < S.endYear) {
      const spouseFirst = S.spouseDeathYear <= S.youDeathYear;
      const after = row(S.firstDeathYear + 1);
      let t = `The first assumed death is ${spouseFirst ? 'your spouse' : 'you'} in ${S.firstDeathYear}. From ${S.firstDeathYear + 1} the survivor files single`;
      if (after) {
        if (spouseFirst) t += `, your annuity's survivor reduction ends (${usd(after.pension)}/yr), and you receive ${usd(after.ssYou)}/yr of Social Security (the larger of your own or your spouse's benefit)`;
        else t += `, your spouse receives a survivor annuity of ${usd(after.survivorAnnuity)}/yr and ${usd(after.ssSpouse)}/yr of Social Security (the larger of their own or yours)`;
        t += `, and spending drops to ${pct(SP.survivorShare, 0)}. Marginal bracket: ${pct(row(S.firstDeathYear).marginal, 0)} the year of death, ${pct(after.marginal, 0)} the next year.`;
      } else t += '.';
      story.push(t);
    }

    {
      let t = S.depletionYear === null
        ? `The portfolio is never depleted. `
        : `The portfolio runs out in ${S.depletionYear} (your age ${S.depletionAge}); ${usd(S.totalShortfall)} of spending is unfunded through ${S.endYear}. `;
      const parts = [`traditional TSP ${usd(last.balTrad)}`, `Roth TSP ${usd(last.balRoth)}`].concat(
        iraT ? [`traditional IRA ${usd(last.ira.trad.bal)}`] : [], iraR ? [`Roth IRA ${usd(last.ira.roth.bal)}`] : [],
        [`brokerage ${usd(last.balTaxable)}`, `money market ${usd(last.balCash)}`], last.checking.bal > 0.5 ? [`checking ${usd(last.checking.bal)}`] : []);
      t += `At the end of ${S.endYear} it holds ${usd(S.endingBalance)} (${usd(S.endingBalanceReal)} in today's dollars): ${list(parts)}. ` +
        `After the heirs' ${pct(TX.heirsRate, 0)} tax on the traditional TSP${iraT ? ' and IRA' : ''}, about ${usd(S.afterTaxInheritance)} (${usd(S.afterTaxInheritanceReal)} today's $) is left to heirs (real estate not included).` +
        (S.lifetimeIrmaa > 0.5 ? ` Medicare IRMAA surcharges add ${usd(S.lifetimeIrmaa)} in Part B premiums.` : '');
      if (suite) {
        const Fx = suite.fixed, St = suite.stochastic;
        t += ` Monte Carlo (${num(Fx.runs)} runs, seed ${Fx.seed}): ${pct(Fx.successRate, 0)} of runs never deplete with fixed lifespans and ${pct(St.successRate, 0)} with ` +
          `lifespans drawn from the SSA life table; median ending balance ${usd(mcSel.endingBalanceReal.p50)} in today's dollars (${mcSelKey} lifespans)` +
          `${opts.mcStale ? ' (inputs changed since this run)' : ''}.`;
        if (mcSel.shortfall.anyRate > 0) {
          t += ` In the ${pct(mcSel.shortfall.anyRate, 0)} of runs with an unfunded year, the gap lasts a median of ${mcSel.shortfall.durationFailing.p50} years and totals ` +
            `${usd(mcSel.shortfall.totalRealFailing.p50)} (median, today's $); ${pct(mcSel.shortfall.cause.baseShare, 0)} of unfunded dollars are base spending, the rest one-time events.`;
        }
      }
      if (res.warnings && res.warnings.length) {
        const lv = (l) => res.warnings.filter((w) => w.level === l).length;
        t += ` The model raised ${res.warnings.length} note(s): ${lv('danger')} critical, ${lv('warn')} caution, ${lv('info')} informational (listed below).`;
      }
      story.push(t);
    }

    // ---------------------------------------------------------------------------------------------
    // Full Markdown review packet
    // ---------------------------------------------------------------------------------------------
    const md = [];
    const h2 = (t) => md.push('', `## ${t}`, '');
    const h3 = (t, key) => md.push('', `### ${t}${key ? ` (\`${key}\`)` : ''}`);
    const bullet = (k, v) => md.push(`- **${k}:** ${v}`);
    md.push(`# Retirement plan review packet${opts.scenarioName ? ` — ${opts.scenarioName}` : ''}`, '');
    md.push(`Generated ${opts.generatedAt || new Date().toISOString().slice(0, 10)} by a FERS household retirement calculator (an educational model, not advice).`);

    h2('Instructions for the reviewer');
    md.push('You are reviewing a retirement cash-flow projection for a US federal employee under FERS and their household. Act as a skeptical, ' +
      'fee-only planner who knows FERS, the TSP, IRAs, Social Security, US federal income tax' + (FT.enabled || FX.enabled ? ', and US citizens retiring abroad (cross-border tax)' : '') + '. Please:');
    md.push('1. Check that every input below is plausible and internally consistent, and flag anything that looks wrong or optimistic.');
    md.push('2. Verify the rules applied (see "Rules applied and computed values"): retirement eligibility, annuity formula, survivor election, supplement, Social Security factors, RMDs and taxes. Recompute a few numbers yourself.');
    md.push('3. Spot-check rows of the year-by-year table. Each year, cash sources (income + withdrawals) equal uses (spending + taxes + surplus saved − unfunded), and balances roll forward.');
    md.push('4. Identify risks the model ignores (see "Model limitations") and say how material they are for this household.');
    md.push('5. Recommend concrete changes (claiming ages, survivor election, Roth conversions and transfers, withdrawal order, spending, cash buffer) with their trade-offs, and answer the questions at the end.');
    md.push('6. If you recommend changes to the settings, also give the complete edited settings file from "Plan settings (JSON)" at the end, changing only the values you recommend, so it can be imported into the calculator with Import JSON. Its "howToRead" notes explain the units and allowed values.');
    md.push('', 'Conventions: annual steps; age in a year = year − birth year; events take effect at the start of the year the age is reached; ' +
      `amounts are nominal dollars unless marked "today's $" (${Y0} dollars); the table's inflation index converts nominal to today's dollars (divide by it). ` +
      'The Inputs headings follow the calculator\'s input panels, and the name in backticks is that panel\'s section in the settings JSON.');

    h2('Plan narrative');
    for (const p of story) md.push(p, '');

    h2('Key results');
    md.push('| Metric | Value |', '| --- | --- |');
    const retRow = row(S.retireYear);
    const kr = [
      ['TSP (traditional + Roth) at retirement', `${usd(S.tspAtRetirement)} at start of ${S.retireYear} (${usd(today(S.tspAtRetirement, S.retireYear))} today's $)`],
      (iraT || iraR) && retRow && ['IRAs at retirement', `traditional ${usd(retRow.ira.trad.start)}, Roth ${usd(retRow.ira.roth.start)} at start of ${S.retireYear}`],
      ['TSP when RMDs start', S.tspAtRmdStart !== null ? `${usd(S.tspAtRmdStart)} at start of ${S.rmdStartYear}` : '—'],
      ['FERS annuity to retiree at start', F.retirementType === 'none' ? 'none' : `${usd(F.initialMonthlyToRetiree)}/mo (${F.pensionStartYear})`],
      ['FERS supplement', F.supplementEligible ? `${usd(F.supplementMonthly)}/mo, ${S.retireYear}–${F.supplementEndYear - 1}` : 'none'],
      ['Ending balance (left to heirs)', `${usd(S.endingBalance)} nominal / ${usd(S.endingBalanceReal)} today's $ (end of ${S.endYear}); ${usd(tradEnd)} of it is traditional TSP${iraT ? ' and IRA' : ''} money, which is pre-tax to heirs; real estate is not included`],
      ['Lifetime spending (retired years)', `${usd(S.lifetimeSpending)} recurring (living + healthcare), plus ${usd(S.lifetimeOneTimeOut)} of one-time outflows${S.totalShortfall > 0.5 ? `; ${usd(S.totalShortfall)} unfunded` : ''}`],
      ['Lifetime income taxes', `${usd(S.lifetimeTax)} total = federal ${usd(S.lifetimeFederalTax)} + state ${usd(S.lifetimeStateTax)} + foreign ${usd(S.lifetimeForeignTax)} (includes tax on salary while working)`],
      ['Depletion', S.depletionYear === null ? 'never' : `${S.depletionYear} (age ${S.depletionAge}); unfunded ${usd(S.totalShortfall)}`],
      ['Peak withdrawal rate (core)', S.peakCoreWithdrawalRate > 0 ? `${pct(S.peakCoreWithdrawalRate)} in ${S.peakCoreWithdrawalYear} (recurring spending + taxes, excl. one-time events and conversion tax)` : '0% (portfolio not needed)'],
      ['Peak withdrawal rate (all-in)', S.peakWithdrawalRate > 0 ? `${pct(S.peakWithdrawalRate)} in ${S.peakWithdrawalYear} (every net draw, incl. one-time events and conversion tax)` : '0% (portfolio not needed)'],
      ['Bridge bucket', S.bucket ? `${usd(S.bucket.sizeAtFund)} funded in ${S.bucket.fundYear} at a fixed ${pct(S.bucket.rate)}; covers ${S.bucket.retireYear}–${S.bucket.endYear}; ${usd(S.bucket.drawn)} drawn` : 'off'],
      ['Cash-flow check', S.maxCashCheck <= 5 ? `passes every year (largest difference ${usd(S.maxCashCheck)})` : `FAILS: largest difference ${usd(S.maxCashCheck)}`],
      ['Federal income tax', `${usd(S.lifetimeFederalTax)} lifetime, ${usd(S.retirementFederalTax)} in retirement`],
      ['Foreign income tax', FT.enabled ? `${usd(S.lifetimeForeignTax)} paid (${FT.method === 'mexicoIsr' ? 'Mexico ISR' : 'flat ' + pct(FT.flatRate)}; relief: ${RELIEF[FT.relief]})` +
        (FT.relief === 'usCreditsForeignTax' ? `; US foreign tax credit ${usd(S.lifetimeUsFtc)}; ${usd(S.ftcExpiredTotal)} expired; ${usd(S.ftcCarryforwardEnd)} still carried forward at the end` : '') : 'not modeled (off)'],
      ['Roth conversions', convW.length ? `${usd(S.totalConversions)} (${convW.map(moveText).join('; ')})` : 'none'],
      xferW.length && ['Transfers between accounts', `${usd(sum(Y, (r) => xferW.reduce((a, w) => a + (r.moves[moveKey(w)] || 0), 0)))} (${xferW.map(moveText).join('; ')}); not taxed`],
      ['After-tax inheritance', `${usd(S.afterTaxInheritance)} nominal / ${usd(S.afterTaxInheritanceReal)} today's $ = Roth ${usd(S.inheritance.roth)} + brokerage ${usd(S.inheritance.taxable)} + money market ${usd(S.inheritance.cash)}${S.inheritance.checking > 0.5 ? ` + checking ${usd(S.inheritance.checking)}` : ''} + traditional ${usd(S.inheritance.trad)} × (1 − ${pct(TX.heirsRate, 0)})`],
      ['Medicare IRMAA surcharges', S.lifetimeIrmaa > 0.5 ? `${usd(S.lifetimeIrmaa)} of extra Part B premiums` : (HC.medicarePartBYou || HC.medicarePartBSpouse ? 'none' : 'n/a (Part B not enrolled)')],
      ['Bridge years (retirement → SS)', S.bridgeEndYear > S.bridgeStartYear ? `${S.bridgeStartYear}–${S.bridgeEndYear - 1}: net portfolio draw ${usd(S.bridgePortfolioUsed)}, TSP ${usd(S.bridgeTspUsed)}` : 'none'],
      ['Monte Carlo success', suite ? `${pct(suite.fixed.successRate, 0)} fixed lifespans / ${pct(suite.stochastic.successRate, 0)} stochastic mortality over ${num(suite.fixed.runs)} runs${opts.mcStale ? ' (stale)' : ''}` : 'not run'],
      ['Monte Carlo shortfall', suite ? `${pct(mcSel.shortfall.anyRate, 1)} of runs have an unfunded year (${mcSelKey} lifespans)` +
        (mcSel.shortfall.totalRealFailing ? `; in those runs the total unfunded is ${usd(mcSel.shortfall.totalRealFailing.p50)} median / ${usd(mcSel.shortfall.totalRealFailing.p90)} 90th percentile (today's $)` : '') : 'not run'],
    ];
    for (const [k, v] of kr.filter(Boolean)) md.push(`| ${k} | ${v} |`);

    // Every setting, panel by panel in the calculator's order (the settings JSON has the same sections).
    h2('Inputs');
    md.push(`Dollar amounts are today's (${Y0}) dollars and per year unless noted.`);
    h3('Household', 'household');
    bullet('Current year', Y0);
    bullet('You', `born ${H.you.birthYear} (age ${youAgeNow}), lifespan ${H.you.lifespan}, ${H.you.sex} (life table)`);
    bullet('Spouse', hasSp ? `born ${H.spouse.birthYear} (age ${spAgeNow}), lifespan ${H.spouse.lifespan}, ${H.spouse.sex} (life table)` : 'none (single)');
    bullet('Plan to age (yours)', `${H.planToAge}; longevity stress ${H.longevityStress ? 'on (the last survivor lives to the plan-to age)' : 'off'}`);
    bullet('Lifespans in Monte Carlo', H.monteCarloLifespans === 'stochastic' ? 'stochastic (SSA 2023 period life table) shown; both modes are always run' : 'fixed lifespans shown; both modes are always run');
    h3('Inflation', 'inflation');
    bullet('Inflation', `${pct(inp.inflation.rate)} a year (healthcare inflation is under Spending; inflation volatility under Monte Carlo)`);
    h3('Employment', 'employment');
    const nextStep = S.stepIncreases.length ? `next step in ${S.stepIncreases[0].year}` : E.currentStep >= 10 ? 'the top step' : 'no step increase before you retire';
    bullet('Salary', `${usd(E.salary)}; raises ${pct(E.annualRaise)} a year; ${E.addStepIncreases ? `GS step ${E.currentStep} with step increases (${nextStep})` : 'no step increases'}; retire at ${E.retirementAge}`);
    bullet('GS pay cap', E.gsPayCap > 0 ? `${usd(E.gsPayCap)} in ${S.startYear}, growing with the raise${S.payCapFromYear !== null ? `; pay is held at it from ${S.payCapFromYear}` : '; pay stays below it'}` : 'none');
    bullet('Extra savings while working', E.extraSavings > 0 ? `${usd(E.extraSavings)}/yr into the brokerage account` : 'none');
    bullet('Benefits that start before you retire', E.spendBenefitsThatStartBeforeRetiring ? 'spent with salary (not saved)' : 'saved (salary covers living costs)');
    bullet('Earnings after retiring', E.afterRetiring.earnings > 0 ? `${usd(E.afterRetiring.earnings)}/yr until age ${E.afterRetiring.untilAge}` : 'none');
    bullet('Spouse earnings', hasSp && E.spouse.hasEarnings ? `${usd(E.spouse.earnings)}/yr until spouse age ${E.spouse.stopsAtAge}` : 'none');
    h3('TSP', 'tsp');
    bullet('Balances', `traditional ${usd(T.balances.traditional)}, Roth ${usd(T.balances.roth)} (${pct(T.balances.rothBasisShare, 0)} of the Roth balance is contributions)`);
    bullet('Your contributions', `${pct(T.contributions.rate)} of salary, ${pct(T.contributions.rothShare, 0)} Roth; catch-up ${yesNo(T.contributions.catchUp)}; the agency adds 1% + match (to traditional)`);
    bullet('Returns', `${beforeAfter(T.returns)} (one fund allocation for traditional and Roth); volatility ${pct(MC.volatility.beforeRetirement.tsp)} → ${pct(MC.volatility.afterRetirement.tsp)}`);
    h3('IRAs', 'iras');
    bullet('Traditional IRA', `${usd(IR.traditional.balance)}; returns ${beforeAfter(IR.traditional.returns)}; volatility ${pct(MC.volatility.beforeRetirement.traditionalIra)} → ${pct(MC.volatility.afterRetirement.traditionalIra)}${iraT ? '' : ' (not used)'}`);
    bullet('Roth IRA', `${usd(IR.roth.balance)} (${pct(IR.roth.basisShare, 0)} contributions and conversions); returns ${beforeAfter(IR.roth.returns)}; volatility ${pct(MC.volatility.beforeRetirement.rothIra)} → ${pct(MC.volatility.afterRetirement.rothIra)}; ` +
      `contributions while working ${IR.roth.contributionsWhileWorking > 0 ? `${usd(IR.roth.contributionsWhileWorking)}/yr (capped at the IRA limit)` : 'none'}${iraR ? '' : ' (not used)'}`);
    h3('Brokerage investments', 'brokerage');
    bullet('Balance', `${usd(BR.balance)} (${pct(BR.unrealizedGainShare, 0)} of it unrealized gain)`);
    bullet('Returns', `${beforeAfter(BR.returns)}; volatility ${pct(MC.volatility.beforeRetirement.brokerage)} → ${pct(MC.volatility.afterRetirement.brokerage)}`);
    h3('Checking & money market', 'checkingAndMoneyMarket');
    bullet('Checking', hasChk ? `${usd(CK.balance)} today; keep ${usd(CK.keepInChecking)} in checking; interest ${pct(CK.interestRate, 2)}` : 'not in the plan ($0 balance, nothing kept)');
    bullet('Money market', `${usd(MM.balance)} today; yield ${pct(MM.yield, 2)}; ` +
      (MM.keepSurplus ? `surplus is kept here up to ${usd(MM.moveToBrokerageAbove)} and the excess moves to brokerage; settling-in years ${nSettle}${settle ? ` (${settleTxt}, no limit)` : ''}` : 'surplus is not kept here (all of it is invested in brokerage)'));
    h3('Withdrawals', 'withdrawals');
    bullet('Strategy', { fixedOrder: 'fixed order', proportional: 'proportional to the brokerage, TSP and IRA balances', bracketFill: `traditional TSP and IRA first up to the top of the ${pct(WD.fillToTopOfBracket, 0)} bracket, then the order` }[WD.strategy]);
    bullet('One-time outflows from Roth accounts first', yesNo(WD.oneTimeOutflowsFromRothFirst));
    bullet('Order', `money market first, then ${orderText.join(' → ')}${hasChk ? ', checking last' : ''}${WD.strategy === 'proportional' ? ' (not used by the proportional strategy)' : ''}`);
    bullet('Bridge bucket', WD.bridgeBucket.enabled ? `pre-funds the planned net draws of the first ${WD.bridgeBucket.yearsCovered} retirement years; built ${WD.bridgeBucket.buildYearsBeforeRetirement} years before retirement; fixed ${pct(WD.bridgeBucket.return)} return` : 'off');
    h3('FERS pension', 'fersPension');
    bullet('Service', `${P.serviceYears} years + ${P.sickLeaveHours} sick-leave hours; FEHB ${P.fehbYearsBeforeRetirement} years before retirement; special category ${yesNo(P.specialCategory)}`);
    bullet('High-3', `${P.high3Mode === 'auto' ? `auto (${usd(F.high3)} projected)` : `manual ${usd(P.manualHigh3)} (nominal, at retirement)`}; average of the highest ${P.averageSalaryYears} years${P.averageSalaryYears === 5 ? ' (High-5 proposal scenario)' : ' (current law)'}`);
    bullet('Survivor election', P.survivorElection + (hasSp ? '' : ' (no spouse, so treated as none)'));
    bullet('COLA', { diet: 'current-law diet COLA', reduced: `diet COLA minus ${pct(P.colaReducedBy, 2)} (scenario)`, none: 'none (scenario)' }[P.colaMode]);
    bullet('Postpone annuity to age', P.postponeToAge > 0 ? P.postponeToAge : 'no (automatic start)');
    bullet('OPM estimate', P.useOpmEstimate ? `${usd(P.opmEstimateMonthly)}/mo gross (nominal, first year paid) replaces the computed annuity` : 'not used (computed)');
    h3('FERS supplement', 'fersSupplement');
    bullet('Supplement', SU.mode === 'auto' ? `auto; SS at 62 from FERS earnings ${usd(F.ss62Today)}/mo${SU.ssAt62FromFersMonthly > 0 ? '' : ' (70% of your PIA)'}` : SU.mode === 'manual' ? `manual ${usd(SU.manualMonthly)}/mo (retirement-year dollars)` : 'off (eliminated scenario)');
    h3('Social Security', 'socialSecurity');
    bullet('You', `PIA ${usd(SS.you.piaMonthly)}/mo, claim at ${ym(P1.claimAge)}`);
    if (P2) bullet('Spouse', `PIA ${usd(SS.spouse.piaMonthly)}/mo, claim at ${ym(P2.claimAge)}`);
    bullet('Benefits paid', SS.trustFundShortfall.benefitsPaidShare < 1 ? `${pct(SS.trustFundShortfall.benefitsPaidShare, 0)} of scheduled from ${SS.trustFundShortfall.fromYear} (trust-fund shortfall scenario)` : '100% of scheduled (current law)');
    h3('Spending & life events', 'spending');
    bullet('Base spending', FX.enabled ? `${num(FX.baseMonthly)} ${FX.code}/mo (foreign currency; see below)` : `${usd(SP.baseMonthly)}/mo`);
    if (hasSp) bullet('Survivor spending', `${pct(SP.survivorShare, 0)} of base after the first death`);
    bullet('Phases', SP.phases.enabled ? `${pct(SP.phases.goGoShare, 0)} until ${SP.phases.goGoUntilAge}, ${pct(SP.phases.slowGoShare, 0)} until ${SP.phases.slowGoUntilAge}, then ${pct(SP.phases.noGoShare, 0)}` : 'off');
    bullet('Healthcare', `FEHB ${HC.fehbMonthly > 0 ? `${usd(HC.fehbMonthly)}/mo (self-only ${pct(HC.fehbSelfOnlyShare, 0)} after the first death)` : '$0 separately (included in base spending)'}; ` +
      `healthcare inflation ${pct(HC.inflation)}; Medicare Part B you ${yesNo(HC.medicarePartBYou)}${hasSp ? `, spouse ${yesNo(HC.medicarePartBSpouse)}` : ''} at $${HC.partBMonthly.toFixed(2)}/mo standard, IRMAA applied`);
    const evs = SP.oneTimeEvents || [];
    bullet('One-time events', evs.length ? '' : 'none');
    for (const e of evs) md.push(`  - ${eventText(e)}; taxed: ${e.direction === 'inflow' ? { no: 'no', ordinaryIncome: 'ordinary income', longTermGain: 'long-term gain' }[e.taxed] : 'n/a'}${e.deferrable ? '; deferrable' : ''}`);
    bullet('Foreign-currency spending', FX.enabled ? `on: ${num(FX.baseMonthly)} ${FX.code}/mo at ${FX.localPerUsd} per USD, drifting ${pct(FX.annualDrift)}/yr` :
      `off${FT.enabled && FT.method === 'mexicoIsr' ? ` (the rate ${FX.localPerUsd} per USD and drift ${pct(FX.annualDrift)}/yr still convert the Mexico ISR)` : ''}`);
    h3('Taxes, conversions & transfers', 'taxes');
    bullet('Federal tax', TX.mode === 'advanced' ? `advanced (brackets and deductions); senior deduction ${yesNo(TX.seniorDeduction)}; brackets grow ${pct(TX.bracketGrowthBelowInflation, 2)} slower than inflation (chained CPI)` : `simple: ${pct(TX.simpleRateJoint)} joint / ${pct(TX.simpleRateSingle)} single`);
    bullet('State income tax', TX.stateRate > 0 ? `${pct(TX.stateRate)} flat` : 'none');
    bullet("Heirs' marginal tax rate", `${pct(TX.heirsRate, 0)} (applied to inherited traditional TSP and IRA money)`);
    bullet('Conversions and transfers', moves.length ? moves.map((w) => `${moveText(w)} (${isConv(w) ? 'conversion' : 'transfer'})`).join('; ') +
      ' (in a year, the first conversion row covering your age applies; every transfer row applies)' : 'none');
    h3('Foreign residence tax', 'foreignTax');
    if (FT.enabled) {
      const A = FT.appliesTo;
      bullet('Residence', `${FT.country} from ${FT.residentFromYear}`);
      bullet('Method', FT.method === 'mexicoIsr' ? `Mexico ISR, tariff and UMA indexed ${pct(FT.isrIndexing)}/yr` : `flat ${pct(FT.flatRate)} on income above ${usd(FT.flatExemptAmount)}/yr`);
      bullet('Double-tax relief', RELIEF[FT.relief]);
      bullet('Treaty art. 20 (TSP, FERS and supplement US-only)', yesNo(FT.treatyArt20));
      if (FT.method === 'mexicoIsr') bullet('Retirement-income exemption', FT.retirementIncomeExemption ? `on: ${FT.umaMultiple} × UMA (${FT.umaDailyMxn} MXN/day in 2026)` : 'off');
      bullet('Applies to', mxTypes(A).map(([k, l]) => `${l} ${A[k] ? '✓' : '✗'}`).join(', ') +
        (A.rothWithdrawals ? `; Roth taxed on ${A.rothAmountTaxed === 'earningsShare' ? `the earnings share only (basis = ${pct(T.balances.rothBasisShare, 0)} of today's Roth TSP and ${pct(IR.roth.basisShare, 0)} of today's Roth IRA, plus contributions and conversions)` : `${pct(A.rothTaxedShare, 0)} of each withdrawal`}` : ''));
    } else bullet('Foreign tax', 'off');
    h3('Monte Carlo', 'monteCarlo');
    bullet('Runs', `${MC.enabled ? 'on' : 'off'}; ${num(MC.runs)} runs, seed ${MC.seed}`);
    const V = MC.volatility;
    bullet('Volatility (SD of yearly returns) before → after retirement', `TSP ${pct(V.beforeRetirement.tsp)} → ${pct(V.afterRetirement.tsp)}, brokerage ${pct(V.beforeRetirement.brokerage)} → ${pct(V.afterRetirement.brokerage)}, ` +
      `traditional IRA ${pct(V.beforeRetirement.traditionalIra)} → ${pct(V.afterRetirement.traditionalIra)}, Roth IRA ${pct(V.beforeRetirement.rothIra)} → ${pct(V.afterRetirement.rothIra)}`);
    bullet('Inflation', `volatility ${pct(MC.inflation.volatility)}; persistence AR(1) φ = ${MC.inflation.persistence} (the long-run SD stays the volatility)`);
    const ES = RUL.earlySocialSecurity, GR = RUL.spendingGuardrails;
    bullet('Claim Social Security early if the portfolio is low', ES.enabled ? `on: ages ${ES.fromAge}–${ES.throughAge}, claim early if the start-of-year portfolio is below ${ES.threshold === 'shareOfPlan' ? pct(ES.shareOfPlan, 0) + ' of the deterministic plan (real $)' : usd(ES.dollarAmount) + " today's $"} (Monte Carlo runs only)` : 'off');
    bullet('Spending guardrails', GR.enabled ? `on: cut base living spending ${pct(GR.spendingCut, 0)} when the portfolio is below ${pct(GR.cutBelowShareOfPlan, 0)} of plan until above ${pct(GR.restoreAboveShareOfPlan, 0)}; deferrable events slide up to ${GR.deferEventsUpToYears} years (Monte Carlo runs only)` : 'off');

    h2('Rules applied and computed values');
    if (E.addStepIncreases || E.gsPayCap > 0) {
      md.push('### Pay');
      if (E.addStepIncreases) {
        bullet('GS step increases', 'after 1 year at steps 1–3, 2 years at steps 4–6 and 3 years at steps 7–9 (5 CFR 531.405); each step adds 1/30 of the step-1 rate, on top of the yearly raise' +
          (S.stepIncreases.length ? `: ${S.stepIncreases.map((x) => `step ${x.step} in ${x.year}`).join(', ')}` : ''));
      }
      if (E.gsPayCap > 0) {
        bullet('GS pay cap', `pay with locality is held at or below Executive Schedule level IV (5 USC 5304(g)): ${usd(E.gsPayCap)} in ${S.startYear}, ` +
          `growing with the ${pct(E.annualRaise)} raise because level IV follows the GS across-the-board raise (5 USC 5318)` + (S.payCapFromYear !== null ? `; the cap applies from ${S.payCapFromYear}` : ''));
      }
      md.push('');
    }
    md.push('### FERS');
    bullet('Eligibility', `age ${E.retirementAge}, ${F.service} yrs, MRA ${ym(F.mra)} → ${F.rule} (${F.retirementType})`);
    if (F.retirementType !== 'none' && !P.useOpmEstimate) {
      bullet('Formula', F.specialFormula
        ? `(1.7% × min(service, 20) + 1% × rest) × ${usd(F.high3)} = ${usd(F.basicAnnuity)}/yr`
        : `${pct(F.multiplier)} × ${usd(F.high3)} × ${F.compService.toFixed(2)} yrs = ${usd(F.basicAnnuity)}/yr (1.1% only if 62+ with 20+ yrs at separation)`);
    }
    bullet('Age reduction', F.ageReduction > 0 ? `${pct(F.ageReduction)} (5%/yr under 62 at start)` : 'none');
    bullet('Survivor', `${electionText}; reduction applies while the spouse is alive and stops after the spouse dies; survivor annuity base = annuity after any age reduction, with COLAs`);
    bullet('COLA', 'diet COLA (CPI ≤2% → CPI; 2–3% → 2%; >3% → CPI−1%), from the year after age 62 for regular retirees; survivor annuities always');
    if (F.supplementEligible) bullet('Supplement', `${usd(F.ss62Today)} today's $ inflated to ${S.retireYear} × ${F.supplementYears}/40 (years of service, rounded) = ${usd(F.supplementMonthly)}/mo; ends at 62; earnings test $1 per $2 over the SS limit ($24,480 in 2026, indexed)`);
    md.push('', '### Social Security');
    bullet('Your FRA / factor', `${ym(P1.fraMonths / 12)}; claiming at ${ym(P1.claimAge)} = ${pct(P1.factor)} of PIA (−5/9% per month for 36 months early, −5/12% beyond; +2/3% per month delayed to 70)`);
    if (P2) bullet('Spouse FRA / factor', `${ym(P2.fraMonths / 12)}; claiming at ${ym(P2.claimAge)} = ${pct(P2.factor)} of PIA`);
    bullet('PIA growth', 'PIA (today\'s $) grows with inflation; benefits get COLA = inflation');
    if (P2) bullet('Spousal / survivor', 'spousal excess = max(0, 50% × other PIA − own PIA), reduced if started before FRA; survivor gets the larger of own benefit or the deceased\'s actual benefit (min 82.5% of PIA if claimed early), assumed to start at or after the survivor\'s FRA');
    bullet('Taxation of SS', 'provisional income = AGI excl. SS + 50% of SS; base $32k/$44k joint, $25k/$34k single (not indexed); up to 85% taxable');
    md.push('', '### TSP, IRAs, RMDs and taxes');
    bullet('RMDs', `start at ${S.rmdStartAge} (73 for births 1951–59, 75 for 1960+), IRS Uniform Lifetime divisor (24.6 at 75) on the prior year-end traditional TSP and traditional IRA balances (the TSP's still-working exception does not apply to IRAs); Roth TSP and Roth IRA have none; accounts pass to the surviving spouse`);
    bullet('TSP withdrawals', 'traditional-only or Roth-only withdrawals are allowed (5 CFR 1650), so the two TSP balances are separate steps in the withdrawal order; both earn the same return');
    bullet('Conversions and transfers', 'at the start of the year after the RMDs; conversions (traditional TSP or IRA → Roth TSP or Roth IRA) are ordinary income that year and their tax is paid from outside the converted money; transfers (Roth TSP → Roth IRA, traditional TSP → traditional IRA) are not taxed and carry their basis');
    bullet('IRA rules', '10% penalty on traditional IRA withdrawals before 59½ (the year you turn 60 is the first penalty-free year; conversions exempt); Roth IRA 5-year rules assumed met; Roth IRA withdrawals before 59½ beyond contributions and conversions (US ordering rules) are flagged, not taxed');
    bullet('Federal tax', 'IRS Rev. Proc. 2025-32 (2026): MFJ brackets 10/12/22/24/32/35/37% with tops $24,800 / $100,800 / $211,400 / $403,550 / $512,450 / $768,700; standard deduction $32,200 MFJ / $16,100 single, +$1,650 per spouse 65+ (MFJ) or +$2,050 (single); 2025–28 senior deduction $6,000 per person 65+; LTCG 0/15/20% stacked on ordinary income; NIIT 3.8%; brackets, standard deduction, 65+ amounts and LTCG breakpoints indexed at inflation minus the chained-CPI gap (IRC §1(f)(3) uses chained CPI, which runs below CPI), other amounts with inflation; no IRS rounding to $25/$50');
    bullet('Filing status', 'MFJ while both alive (including the year of the first death), single afterwards');
    bullet('Cash flow', 'each year: income → RMD → conversions and transfers → taxes → spending → shortfall withdrawals (money market first, then the withdrawal strategy, checking last) or surplus saved → growth (start-of-year flows). Conversion tax is paid from surplus, then the money market, brokerage, traditional TSP and IRA, Roth TSP and IRA, checking');
    bullet('Surplus', 'leftover money tops checking up to its target first, then the money market up to its limit (if surplus is kept there), and the rest is invested in brokerage; checking above its target moves to the money market, and money market above its limit moves to brokerage (except in settling-in years)');
    bullet('Brokerage investments', 'a regular taxable brokerage account holding stock and bond funds (money market funds belong in the money market); cost basis tracked at average cost: surplus deposits, one-time inflows and money market above the limit add basis; each withdrawal realizes gain = withdrawal × (1 − basis ÷ balance at the start of the year), taxed as a long-term gain (and abroad if gains are selected). After losses (balance below basis) no gain is realized and the extra basis offsets later gains; losses are not deducted from other income');
    bullet('Cash-flow check', '(non-salary income incl. RMDs + all withdrawals) − (spending + taxes paid from this cash flow + saved − unfunded), every year; must be ≈ $0. While working, salary, benefits spent with it and the tax on them are outside this flow (pre-retirement living costs are not modeled)');
    bullet('Withdrawal rates', 'all-in = net portfolio draw (every withdrawal incl. RMDs, minus amounts saved back) ÷ start-of-year portfolio; core = what the portfolio must supply for recurring spending + taxes beyond guaranteed income, excluding one-time events and the tax caused by Roth conversions and taxable one-time inflows, ÷ start-of-year portfolio');
    if (WD.bridgeBucket.enabled) bullet('Bridge bucket', `a deterministic projection without the bucket gives the planned net draws for the first ${WD.bridgeBucket.yearsCovered} retirement years. From ${WD.bridgeBucket.buildYearsBeforeRetirement} years before retirement the bucket is held at the present value of those draws at ${pct(WD.bridgeBucket.return)}; in the bridge years each year's net draw comes out of it first, it is not refilled, and any remainder rejoins the portfolio after the last bridge year. It overlays the accounts (their returns are blended by bucket ÷ invested balance), so tax treatment is unchanged, and it has zero volatility in Monte Carlo. Each Monte Carlo run funds the same planned bucket and spends it by that run's actual draws`);
    if (FT.enabled) {
      bullet('Foreign tax base', `selected income types (TSP, FERS and supplement removed if the art. 20 toggle is on; IRAs never are; transfers are not counted); Roth = ${FT.appliesTo.rothAmountTaxed === 'earningsShare' ? 'earnings share of each withdrawal, pro rata (1 − basis ÷ Roth balance at the start of the year); conversions and contributions are basis, so they are never taxed again' : `${pct(FT.appliesTo.rothTaxedShare, 0)} of withdrawals`}`);
      bullet('Foreign tax amount', FT.method === 'mexicoIsr'
        ? `Mexico's 2026 annual ISR tariff (art. 152 LISR, 1.92% to 35%; e.g. MXN 1,000,000 → MXN 224,833), limits and fixed fees indexed ${pct(FT.isrIndexing)}/yr, applied to the income converted at the year's FX rate` +
          (FT.retirementIncomeExemption ? `; pension-type income (TSP, IRA, Roth, FERS, supplement) exempt up to ${FT.umaMultiple} × UMA (MXN ${FT.umaDailyMxn}/day in 2026, indexed) × 365` : '')
        : `flat ${pct(FT.flatRate)} × (selected income − ${usd(FT.flatExemptAmount)} today's $)`);
      bullet('Double-tax relief', {
        usCreditsForeignTax: "Mexico taxes as the residence country. The US credits that tax against US federal tax, limited to the US tax attributable to the same income (its share of AGI, one basket). This year's Mexican tax is used first, then the oldest carryforwards; unused credits carry forward 10 years and then expire (the 1-year carryback is not modeled).",
        foreignCountryCreditsUsTax: 'Mexico credits the US federal tax attributable to the same income (pro rata by AGI); only the excess is paid to Mexico.',
        none: 'none; both countries tax in full.' }[FT.relief]);
    }

    h2('Milestones');
    for (const m of res.milestones || []) md.push(`- ${m.year}${m.endYear ? '–' + m.endYear : ''}: ${m.label} — ${m.detail}`);

    h2('Warnings and notes from the model');
    if (!res.warnings || !res.warnings.length) md.push('- none');
    for (const w of res.warnings || []) md.push(`- [${{ danger: 'Critical', warn: 'Caution', info: 'Note' }[w.level]}] ${w.text}`);

    h2('Monte Carlo');
    if (suite) {
      const Fx = suite.fixed, St = suite.stochastic;
      const acct = (l, r, sa, sb) => `${l} ${pct(r.beforeRetirement)} / ${pct(sa)} → ${pct(r.afterRetirement)} / ${pct(sb)}`;
      md.push(`${num(Fx.runs)} runs per lifespan mode, seed ${Fx.seed}; lognormal returns by account (mean / SD before → after retirement: ` +
        [acct('TSP', T.returns, V.beforeRetirement.tsp, V.afterRetirement.tsp), acct('brokerage', BR.returns, V.beforeRetirement.brokerage, V.afterRetirement.brokerage),
          iraT && acct('traditional IRA', IR.traditional.returns, V.beforeRetirement.traditionalIra, V.afterRetirement.traditionalIra),
          iraR && acct('Roth IRA', IR.roth.returns, V.beforeRetirement.rothIra, V.afterRetirement.rothIra)].filter(Boolean).join('; ') + '; one shared market shock per year); ' +
        `inflation SD ${pct(MC.inflation.volatility)}, AR(1) φ ${MC.inflation.persistence}. Each run has its own random streams, so run i sees the same market path in both modes. ` +
        `Fixed lifespans stop at the plan-to age; stochastic mortality samples both death ages per run from the SSA 2023 period life table (given current ages) and runs until the last death. ` +
        `Success = no unfunded retirement year.${opts.mcStale ? ' **Inputs changed after this run; results may be stale.**' : ''}`, '');
      const r1 = (v) => Math.round(v * 10) / 10; // percentiles of year counts interpolate; show one decimal at most
      const d = (x) => (x ? `${r1(x.p50)} / ${r1(x.p90)} yrs` : '—');
      const rowsMc = [
        ['Success (never depleted)', (m) => pct(m.successRate, 1)],
        ['Runs with any unfunded year', (m) => pct(m.shortfall.anyRate, 1)],
        ['Years unfunded in failing runs (median / 90th)', (m) => d(m.shortfall.durationFailing)],
        ['Runs by years unfunded', (m) => m.shortfall.durationHistogram.map((h) => `${h.label}: ${h.runs}`).join(', ')],
        ["Total unfunded, all runs, today's $ (50th / 90th / 95th)", (m) => `${usd(m.shortfall.totalRealAll.p50)} / ${usd(m.shortfall.totalRealAll.p90)} / ${usd(m.shortfall.totalRealAll.p95)}`],
        ["Total unfunded, failing runs, today's $ (50th / 90th)", (m) => (m.shortfall.totalRealFailing ? `${usd(m.shortfall.totalRealFailing.p50)} / ${usd(m.shortfall.totalRealFailing.p90)}` : '—')],
        ["Worst single-year shortfall, today's $ (95th / max)", (m) => `${usd(m.shortfall.worstYearReal.p95)} / ${usd(m.shortfall.worstYearReal.max)}`],
        ['Unfunded dollars by cause (base spending / one-time events)', (m) => (m.shortfall.cause.baseShare === null ? '—' : `${pct(m.shortfall.cause.baseShare, 0)} / ${pct(1 - m.shortfall.cause.baseShare, 0)}`)],
        ["Ending balance, today's $ (10th / 50th / 90th)", (m) => `${usd(m.endingBalanceReal.p10)} / ${usd(m.endingBalanceReal.p50)} / ${usd(m.endingBalanceReal.p90)}`],
        ['Ending balance, nominal (10th / 50th / 90th)', (m) => `${usd(m.endingBalance.p10)} / ${usd(m.endingBalance.p50)} / ${usd(m.endingBalance.p90)}`],
        ["After-tax inheritance, today's $ (10th / 50th / 90th)", (m) => `${usd(m.afterTaxReal.p10)} / ${usd(m.afterTaxReal.p50)} / ${usd(m.afterTaxReal.p90)}`],
        ['After-tax inheritance, nominal (10th / 50th / 90th)', (m) => `${usd(m.afterTax.p10)} / ${usd(m.afterTax.p50)} / ${usd(m.afterTax.p90)}`],
        ['Median depletion: your age in the first unfunded year (failing runs; you may no longer be alive)', (m) => (m.medianDepletionAge === null ? '—' : m.medianDepletionAge.toFixed(1))],
        ['Your death age (10th / 50th / 90th)', (m) => (m.mortality ? [m.mortality.youDeathAge.p10, m.mortality.youDeathAge.p50, m.mortality.youDeathAge.p90].map(Math.round).join(' / ') : `fixed ${H.you.lifespan}`)],
      ];
      if (hasSp) rowsMc.push(['Spouse death age (10th / 50th / 90th)', (m) => (m.mortality ? [m.mortality.spouseDeathAge.p10, m.mortality.spouseDeathAge.p50, m.mortality.spouseDeathAge.p90].map(Math.round).join(' / ') : `fixed ${H.spouse.lifespan}`)]);
      if (GR.enabled) {
        rowsMc.push(['Guardrails: runs with a spending cut', (m) => pct(m.rules.guardrails.runsWithCut, 0)]);
        rowsMc.push(['Guardrails: cut years when cut (median / 90th)', (m) => d(m.rules.guardrails.cutYears)]);
        rowsMc.push(['Guardrails: runs with deferred events (total deferrals)', (m) => `${pct(m.rules.guardrails.runsWithDeferral, 0)} (${m.rules.guardrails.deferrals})`]);
      }
      if (ES.enabled) {
        rowsMc.push(['Early SS claim triggered: you (median claim age)', (m) => `${pct(m.rules.contingentSS.you.triggeredRate, 0)}${m.rules.contingentSS.you.claimAge ? ` (${m.rules.contingentSS.you.claimAge.p50})` : ''}`]);
        if (hasSp) rowsMc.push(['Early SS claim triggered: spouse (median claim age)', (m) => `${pct(m.rules.contingentSS.spouse.triggeredRate, 0)}${m.rules.contingentSS.spouse.claimAge ? ` (${m.rules.contingentSS.spouse.claimAge.p50})` : ''}`]);
      }
      md.push('| Metric | Fixed lifespans | Stochastic mortality |', '| --- | --- | --- |');
      for (const [label, f] of rowsMc) md.push(`| ${label} | ${f(Fx)} | ${f(St)} |`);
      const m = mcSel;
      const pick = m.years.map((y, i) => i).filter((i) => i % 5 === 0 || i === m.years.length - 1);
      md.push('', `Portfolio percentiles by year (${mcSelKey} lifespans${mcSelKey === 'stochastic' ? '; runs where someone is still alive' : ''}):`, '');
      md.push("| Year | p10 nominal | p50 nominal | p90 nominal | p10 today's $ | p50 today's $ | p90 today's $ |" + (mcSelKey === 'stochastic' ? ' Alive |' : ''),
        '| --- | --- | --- | --- | --- | --- | --- |' + (mcSelKey === 'stochastic' ? ' --- |' : ''));
      for (const i of pick) {
        md.push(`| ${m.years[i]} | ${num(m.p10.nominal[i])} | ${num(m.p50.nominal[i])} | ${num(m.p90.nominal[i])} | ${num(m.p10.real[i])} | ${num(m.p50.real[i])} | ${num(m.p90.real[i])} |` +
          (mcSelKey === 'stochastic' ? ` ${pct(m.alive[i], 0)} |` : ''));
      }
    } else md.push(MC.enabled ? 'Not run for this report: run Monte Carlo in the calculator, then copy the packet again, to include success rates and percentiles.' : 'Off in this plan.');

    if (opts.comparison && opts.comparison.length) {
      h2('Scenario comparison');
      const C = opts.comparison;
      md.push(`Same seed (${C[0].seed}) and ${num(C[0].runs)} runs per lifespan mode for every scenario; Monte Carlo metrics below use ${C[0].modeLabel}.`, '');
      md.push('| Metric | ' + C.map((c) => c.name).join(' | ') + ' |', '|' + ' --- |'.repeat(C.length + 1));
      const line = (label, f) => md.push(`| ${label} | ${C.map(f).join(' | ')} |`);
      line('Success, fixed lifespans', (c) => pct(c.fixed.successRate, 1));
      line('Success, stochastic mortality', (c) => pct(c.stochastic.successRate, 1));
      line('Runs with any unfunded year', (c) => pct(c.sel.anyRate, 1));
      line("Total unfunded, 95th percentile (today's $)", (c) => usd(c.sel.unfundedP95));
      line('Years unfunded in failing runs (median)', (c) => (c.sel.durationP50 === null ? '—' : c.sel.durationP50));
      line('Lifetime federal income tax', (c) => usd(c.det.lifetimeFederalTax));
      line('Lifetime foreign income tax', (c) => usd(c.det.lifetimeForeignTax));
      line('Ending balance, nominal (deterministic)', (c) => usd(c.det.endingBalance));
      line("Ending balance, today's $ (deterministic)", (c) => usd(c.det.endingBalanceReal));
      line("After-tax inheritance, today's $ (deterministic)", (c) => usd(c.det.afterTaxReal));
      line("After-tax inheritance, today's $ (Monte Carlo median)", (c) => usd(c.sel.afterTaxRealP50));
    }

    const TL = opts.tools || {};
    if (TL.spending || TL.retire || TL.optimize || TL.sensitivity) {
      h2('Planning tools');
      const stale = (k) => (opts.toolsStale && opts.toolsStale[k] ? ' **(inputs changed since this result)**' : '');
      const head = (r) => `Monte Carlo at seed ${r.seed}, ${num(r.runs)} runs per candidate, ${r.mode} lifespans.`;
      if (TL.spending) {
        const r = TL.spending, c = r.currency === 'USD' ? usd : (v) => `${num(v)} ${r.currency}`;
        md.push(`- **Highest base spending with at least ${pct(r.target, 0)} success:** ${c(r.monthly)}/mo today's money (${pct(r.success)} success); the plan's ${c(r.base.monthly)}/mo gives ${pct(r.base.success)}. ${head(r)}${stale('spending')}`);
      }
      if (TL.retire) {
        const r = TL.retire;
        md.push(`- **Earliest retirement age with at least ${pct(r.target, 0)} success:** ${r.earliest === null ? 'none in the range searched' : r.earliest} (planned ${r.planned}; service adjusted per age). ${head(r)}${stale('retire')}`);
        md.push('', '| Age | Service | Retirement type | Success | Median after-tax inheritance (today\'s $) |', '| --- | --- | --- | --- | --- |');
        for (const x of r.rows) md.push(`| ${x.age} | ${x.service} | ${x.rule} | ${pct(x.success)} | ${usd(x.inheritanceReal)} |`);
        md.push('');
      }
      if (TL.optimize) {
        const r = TL.optimize;
        // Today's dollars / future (nominal) dollars.
        const both = (today, future) => `${usd(today)} / ${usd(future)}`;
        const score = (m) => `${pct(m.success)} success, median inheritance ${both(m.inheritanceReal, m.inheritance)}, lifetime tax ${both(m.lifetimeTaxReal, m.lifetimeTax)}`;
        md.push(`- **Optimizer** (goal: ${r.goal}; ${head(r)}) — money as today's $ / future $: plan ${score(r.base)}; best combination ${score(r.best)}.${stale('optimize')} ` +
          `Median inheritance is the after-tax amount left in the middle Monte Carlo run${r.base.inheritanceRuns === 2 ? ' (the middle two averaged)' : ''}, ` +
          `${r.mode === 'stochastic' ? 'at the last death in that run' : `at the end of ${r.base.detEndYear}, when the plan ends`}; lifetime tax is from the projection at average returns. ` +
          `Today's $ are ${r.currentYear} dollars. For comparison, the projection at average returns leaves ${both(r.base.detAfterTaxReal, r.base.detAfterTax)} after tax at the end of ${r.base.detEndYear}.`);
        for (const [title, rows] of [['Claim ages', r.ss], ['Roth conversion windows', r.roth]]) {
          if (!rows.length) continue;
          md.push('', `| ${title} (top ${rows.length}) | Success | Median inheritance (today's $ / future $) | Lifetime tax (today's $ / future $) |`, '| --- | --- | --- | --- |');
          for (const x of rows) md.push(`| ${x.label} | ${pct(x.metrics.success)} | ${both(x.metrics.inheritanceReal, x.metrics.inheritance)} | ${both(x.metrics.lifetimeTaxReal, x.metrics.lifetimeTax)} |`);
        }
        md.push('');
      }
      if (TL.sensitivity) {
        const r = TL.sensitivity;
        md.push(`- **Sensitivity** (one assumption at a time; ${head(r)})${stale('sensitivity')}: plan ${pct(r.base.success)} success, ${usd(r.base.inheritanceReal)} median inheritance (today's $).`, '');
        md.push("| Assumption | Setting | Success | Inheritance (today's $) | Setting | Success | Inheritance (today's $) |", '| --- | --- | --- | --- | --- | --- | --- |');
        for (const e of r.entries) md.push(`| ${e.label} | ${e.loText} | ${pct(e.lo.success)} | ${usd(e.lo.inheritanceReal)} | ${e.hiText} | ${pct(e.hi.success)} | ${usd(e.hi.inheritanceReal)} |`);
      }
    }

    h2('Year-by-year projection (nominal dollars)');
    const ftc = FT.enabled && FT.relief === 'usCreditsForeignTax', adv = TX.mode === 'advanced';
    md.push('Columns: Earned = salary + spouse + post-retirement earnings; 1x in / 1x out = one-time event inflows and outflows; Trad W = traditional TSP withdrawals including its RMD (RMD = total RMDs)' + (iraT ? '; TIRA W = traditional IRA withdrawals including its RMD' : '') + (iraR ? '; RIRA W = Roth IRA withdrawals' : '') +
      (xferW.length ? '; Transfers = untaxed moves between accounts (Roth TSP → Roth IRA, traditional TSP → traditional IRA)' : '') + '; Brokerage W / MM W' + (hasChk ? ' / Chk W' : '') + ' = withdrawals from brokerage investments (stock and bond funds), the money market (money market funds, savings)' + (hasChk ? ' and checking' : '') + '; Brokerage gain = long-term gain in the brokerage withdrawal (the rest is cost basis); ' +
      'Spending = recurring spending + healthcare + one-time outflows; Taxes = federal + state (+ foreign); Saved = surplus to ' + (hasChk ? 'checking, ' : '') + 'the money market or brokerage; Unfunded = spending not covered; ' +
      (WD.bridgeBucket.enabled ? 'Bucket = bridge-bucket balance at year end (part of the invested balances, not extra money); ' : '') +
      (ftc ? 'Fed tax = US federal tax after the foreign tax credit; Foreign = tax paid to ' + (FT.country || 'the foreign country') + '; US FTC = credit used; FTC c/f = credits carried forward at year end; ' : '') +
      (adv ? 'Ord taxable = ordinary taxable income (AGI − deduction, excluding long-term gains; what the brackets apply to); Bracket = its federal rate; Headroom = taxable income left before the next bracket (unused deduction when below it); ' : '') +
      'Check = cash-flow check (0 when sources equal uses; ⚠ if off by more than $5); ' +
      'balances are end of year; Infl = cumulative inflation index (divide nominal by it for today\'s dollars).', '');
    const cols = ['Year', 'Ages', 'Phase', 'Earned', 'FERS', 'Surv ann', 'Supp', 'SS you', 'SS sp', '1x in', '1x out', 'RMD', 'Trad W', 'Roth W'].concat(iraT ? ['TIRA W'] : [], iraR ? ['RIRA W'] : [], ['Brokerage W', 'Brokerage gain', 'MM W'], hasChk ? ['Chk W'] : [], ['Roth conv'], xferW.length ? ['Transfers'] : [])
      .concat(adv ? ['Ord taxable', 'Bracket', 'Headroom'] : [], ['Spending', 'Fed tax', 'State', 'Foreign'], ftc ? ['US FTC', 'FTC c/f'] : [], ['Saved', 'Unfunded', 'MM'], hasChk ? ['Checking'] : [], ['Brokerage', 'Trad TSP', 'Roth TSP'], iraT ? ['Trad IRA'] : [], iraR ? ['Roth IRA'] : [], ['Total'], WD.bridgeBucket.enabled ? ['Bucket'] : [], ['Check', 'Infl']);
    md.push('| ' + cols.join(' | ') + ' |', '|' + cols.map(() => ' --- ').join('|') + '|');
    for (const r of Y) {
      md.push('| ' + [
        r.year, `${r.ageYou === null ? '—' : r.ageYou}/${r.ageSpouse === null ? '—' : r.ageSpouse}`, r.phase, num(r.earned), num(r.pension), num(r.survivorAnnuity),
        num(r.supplement), num(r.ssYou), num(r.ssSpouse), num(r.oneTimeIn), num(r.oneTimeOut), num(r.rmd), num(r.tradTotal), num(r.wRoth),
      ].concat(iraT ? [num(r.ira.trad.withdraw + r.ira.trad.rmd)] : [], iraR ? [num(r.ira.roth.withdraw)] : [], [num(r.wTaxable), num(r.basis.taxableGain), num(r.wCash)],
        hasChk ? [num(r.checking.withdraw)] : [], [num(r.conversion)], xferW.length ? [num(xferW.reduce((a, w) => a + (r.moves[moveKey(w)] || 0), 0))] : [], adv ? [num(r.ordTaxable), pct(r.marginal, 0), r.bracket && r.bracket.headroom !== null ? num(r.bracket.headroom) : '—'] : [],
        [num(r.spending), num(r.federalTax), num(r.stateTax), num(r.foreignTax)], ftc ? [num(r.usFtc), num(r.ftcCarryforward)] : [], [num(r.deposit), num(r.shortfall), num(r.balCash)], hasChk ? [num(r.checking.bal)] : [], [num(r.balTaxable),
        num(r.balTrad), num(r.balRoth)], iraT ? [num(r.ira.trad.bal)] : [], iraR ? [num(r.ira.roth.bal)] : [], [num(r.total)], WD.bridgeBucket.enabled ? [num(r.bucket)] : [], [Math.abs(r.cashCheck) <= 5 ? '0' : `${num(r.cashCheck)} ⚠`, r.idx.toFixed(3)]).join(' | ') + ' |');
    }

    h2('Model limitations (not modeled or simplified)');
    [
      'Annual steps; no partial years, birth months, or prorated first COLA. The current year counts as a full year.',
      'PIA grows with inflation rather than a wage-indexed earnings history. No SS earnings test for early claimers, no survivor-benefit reduction before the survivor\'s FRA, no family maximum.',
      'While working, salary is assumed to cover living costs; pre-retirement spending is not modeled.',
      'Pay: GS step increases assume acceptable performance and the standard waiting periods; no promotions, quality step increases or grade changes, and GS-1 and GS-2\'s uneven steps are not modeled.',
      'Each account has its own expected return and volatility before and after retirement (the TSP\'s traditional and Roth balances share one), and one market shock per year moves them all. Monte Carlo uses lognormal annual returns (no fat tails, no return–inflation correlation).',
      'IRAs: Roth IRA 5-year rules are assumed met; Roth IRA contributions ignore the income limit; moves out of the TSP are assumed allowed when made (the TSP permits them after separation or from 59½); a foreign country is assumed not to tax direct rollovers.',
      'Stochastic mortality uses the SSA 2023 period life table: no projected mortality improvement, no health or wealth adjustment, and the two spouses\' deaths are independent.',
      'Adaptive rules (contingent SS claiming, guardrails, deferrable events) run only in Monte Carlo. They compare the run\'s start-of-year real portfolio with the deterministic projection, which uses mean returns, so the median run trails it; thresholds near 100% trigger in most runs. Beyond the deterministic projection\'s last year (longer stochastic lives) the guardrail state is held.',
      'Monte Carlo shortfall causes are split pro rata between recurring spending and one-time outflows in each unfunded year.',
      'After-tax inheritance applies one flat heirs\' rate to traditional TSP and IRA money, assumes a step-up in basis for brokerage investments, and ignores estate/inheritance taxes, the timing of heirs\' withdrawals (10-year rule) and the value of real estate.',
      'The bridge bucket is an overlay: it changes returns (a fixed-return slice of the invested balance) but not which account is withdrawn. Real TSP withdrawals come out pro rata across funds, so "spend from the G Fund first" means withdraw and then rebalance. Its size comes from the deterministic plan, so in Monte Carlo it can run out early or have money left over.',
      'The cash-flow check covers the portfolio cash flow only: salary-funded living costs before retirement are not modeled, so they are outside it.',
      'The 10% early-withdrawal penalty on TSP money taken before 59½ after separating before 55 is flagged in a warning but not added (the traditional IRA penalty is added). No TSP installment or annuity options, and no annual tax on brokerage dividends; brokerage gains use average cost basis (no choice of tax lots, no deduction of capital losses).',
      'No itemized deductions, credits, AMT, or payroll taxes. State tax is a flat rate. Medicare Part D, Medigap, and long-term care costs are not modeled.',
      'FERS: no death-in-service benefits, deposits/redeposits, part-time proration, or tax-free recovery of employee contributions.',
      'Planning tools score candidates with Monte Carlo at one seed and a limited number of runs; differences of about one run (1 ÷ runs) are noise. The optimizer searches whole-year claim ages and a fixed set of conversion windows, claim ages first, then conversions; it is a guide, not a proof of optimality.',
      'Events tied to a person are skipped after that person dies; household events (and the plan’s spending) are not tied to anyone.',
      'Foreign tax: Mexico ISR uses the 2026 annual tariff indexed at a fixed rate (Mexico actually updates it in steps after more than 10% cumulative inflation); no Mexican personal deductions, no currency gains, Mexican inflation not randomized in Monte Carlo. The flat method is a single effective rate.',
      'Double-tax relief is simplified: one foreign-tax-credit basket (no passive/general split), the limitation is the US tax times the income\'s share of AGI, no carryback, and income the US may tax as the source country (e.g. US dividends) is not credited by Mexico first. Which treaty article governs TSP and Roth distributions is uncertain; the art. 20 toggle and the income checkboxes bracket it.',
      'Checking and the money market earn only their interest rates, so their real value erodes when that is below inflation. The model works in whole years: checking is held at its target and does not rise and fall within the year.',
    ].forEach((t) => md.push(`- ${t}`));

    h2('Questions for the reviewer');
    const q = [];
    if (hasSp) {
      const gap = H.you.birthYear - H.spouse.birthYear;
      q.push(`Survivor protection: your spouse is ${Math.abs(gap)} years ${gap > 0 ? 'older' : 'younger'} than you. Is the ${P.survivorElection} survivor election adequate given the ${usd(F.initialAnnuity * F.survivorPct / 12)}/mo survivor annuity, the need for any survivor annuity to keep FEHB, and the Social Security survivor benefit?`);
      q.push(`Claiming: you claim at ${ym(P1.claimAge)} and your spouse at ${ym(P2.claimAge)}. Since the survivor keeps the larger benefit, is this the best pairing for joint lifetime income and survivor protection?`);
    } else {
      q.push(`Claiming: is claiming Social Security at ${ym(P1.claimAge)} sensible given the assumed lifespan of ${H.you.lifespan}?`);
    }
    if (F.supplementEligible) q.push(`The FERS supplement contributes about ${usd(sum(Y, (r) => r.supplement))} in total. How exposed is the plan if Congress eliminates it?`);
    if (convW.length && S.totalConversions > 0.5) {
      q.push(`The plan converts ${usd(S.totalConversions)} from traditional to Roth (${convW.map(moveText).join('; ')}). Are the size and timing right, given the brackets before and after Social Security and RMDs, IRMAA's two-year lookback${FT.enabled ? `, and ${FT.country || 'foreign'} tax residency from ${FT.residentFromYear}` : ''}?`);
    } else if (res.warnings && res.warnings.some((w) => w.code === 'rmdBracket')) {
      q.push('RMDs push income into a higher bracket. Would Roth conversions during the low-income years before RMDs (and before Social Security) lower lifetime taxes, and how large should they be?');
    }
    if (S.peakCoreWithdrawalRate > 0.04) q.push(`The peak core withdrawal rate is ${pct(S.peakCoreWithdrawalRate)} in ${S.peakCoreWithdrawalYear} (all-in ${pct(S.peakWithdrawalRate)} in ${S.peakWithdrawalYear}). How large is the sequence-of-returns risk, and what buffer or spending rule would you add?`);
    {
      const rets = [`TSP ${beforeAfter(T.returns)}`, `brokerage ${beforeAfter(BR.returns)}`].concat(iraT ? [`traditional IRA ${beforeAfter(IR.traditional.returns)}`] : [], iraR ? [`Roth IRA ${beforeAfter(IR.roth.returns)}`] : []);
      q.push(`Are these expected returns reasonable for the likely allocations and horizon: ${list(rets)}; with ${pct(inp.inflation.rate)} inflation?`);
    }
    if (MM.keepSurplus) q.push(`Surplus is held in the money market up to ${usd(MM.moveToBrokerageAbove)} (today's $) at a ${pct(MM.yield, 2)} yield. Is that buffer size sensible, and what is the cost of the cash drag?`);
    if (FT.enabled || FX.enabled) {
      q.push(`Cross-border tax (${FT.country || 'country of residence'}): how will the residence country tax traditional TSP and IRA withdrawals, Roth withdrawals (contributions vs earnings) and Roth conversions for a US citizen who is a tax resident there? Which treaty articles apply (US–Mexico art. 19 pensions vs art. 20 government service, and the saving clause), and can a US foreign tax credit be claimed on US-source income?`);
      q.push('Should Roth conversions be completed before becoming a foreign tax resident, and does that change the order in which accounts should be drawn?');
      q.push('Healthcare abroad: Medicare generally does not pay for care outside the US while FEHB does. Is the Medicare Part B decision right, given late-enrollment penalties if you return?');
      if (FX.enabled) q.push(`Currency: spending is in ${FX.code}. How should a ±20% currency move and the FX drift assumption affect the spending plan?`);
    }
    q.push('What material risks are missing (long-term care, a large one-time health cost, the cost of FEHB abroad, legislative changes to FERS COLAs or contributions)?');
    q.forEach((t, i) => md.push(`${i + 1}. ${t}`));

    h2('Plan settings (JSON)');
    md.push('The complete settings of this plan, as the calculator saves them with Export JSON. Edit values here (see "howToRead") and import the file to try a change.', '');
    md.push('```json', opts.planFile || JSON.stringify({ name: opts.scenarioName || 'Plan', inputs: res.inputs }, null, 2), '```');

    return { story, markdown: md.join('\n') + '\n' };
  }

  return { buildPlanReport };
});
