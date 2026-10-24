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
  const ACCOUNT = { brokerage: 'brokerage investments', traditionalWorkplace: 'traditional TSP / 401(k)', rothWorkplace: 'Roth TSP / 401(k)', traditionalIra: 'traditional IRA', rothIra: 'Roth IRA' };
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
  // The income types a state, local or foreign tax can count (otherTaxes[].appliesTo), as the report names them.
  const OT_LABELS = { wages: 'wages', fersAnnuity: 'FERS annuities', otherPensions: 'other pensions', fersSupplement: 'the FERS supplement',
    socialSecurity: 'Social Security (its taxable part)', traditionalTsp: 'traditional TSP', traditional401k: 'traditional 401(k)', traditionalIra: 'traditional IRA',
    rothTsp: 'Roth TSP', roth401k: 'Roth 401(k)', rothIra: 'Roth IRA', rothConversions: 'Roth conversions', brokerageGains: 'brokerage gains', interest: 'interest',
    oneTimeIncome: 'taxable one-time income' };
  // [2038, 2052, 2053, 2054] → "2038 and 2052–2054"
  const yearRanges = (ys) => {
    const out = [];
    for (const y of ys) { const r = out[out.length - 1]; if (r && y === r[1] + 1) r[1] = y; else out.push([y, y]); }
    return list(out.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)));
  };
  // Conversions (traditional → Roth, taxed) and transfers (same tax type, not taxed) between accounts.
  const isConv = (w) => /^traditional/.test(w.fromAccount) && /^roth/.test(w.toAccount);
  const moveKey = (w) => `${w.fromAccount}To${w.toAccount[0].toUpperCase()}${w.toAccount.slice(1)}`;
  // "7% before → 5% after retirement"
  const beforeAfter = (r) => `${pct(r.beforeRetirement)} before → ${pct(r.afterRetirement)} after retirement`;

  function buildPlanReport(res, opts) {
    opts = opts || {};
    // opts.mc is a Monte Carlo suite { fixed, stochastic, selected } (both lifespan modes, same seeds).
    const suite = opts.mc && opts.mc.fixed ? opts.mc : null;
    const mcSelKey = res.inputs.household.monteCarloLifespans === 'stochastic' ? 'stochastic' : 'fixed';
    const mcSel = suite ? suite[mcSelKey] : null;
    const inp = res.inputs, S = res.summary, Y = res.years;
    const H = inp.household, EMP = inp.employment, PLN = inp.workplacePlans, IRS = inp.iras, BR = inp.brokerage;
    const CK = inp.checkingAndMoneyMarket.checking, MM = inp.checkingAndMoneyMarket.moneyMarket, WD = inp.withdrawals;
    const FP = inp.fersPension, SS = inp.socialSecurity, SP = inp.spending, TX = inp.taxes;
    const OTX = inp.otherTaxes, MC = inp.monteCarlo, RUL = MC.adaptiveRules, HC = SP.healthcare, FX = SP.foreignCurrency;
    const moves = TX.conversionsAndTransfers;
    const convW = moves.filter(isConv), xferW = moves.filter((w) => !isConv(w));
    const Y0 = H.currentYear, hasSp = H.married;
    // The people in the plan, how sentences name them, and their workplace plan (the TSP for a federal employee).
    const WHO = hasSp ? ['you', 'spouse'] : ['you'];
    const N = (w) => (w === 'you' ? { who: 'you', Who: 'You', your: 'your', Your: 'Your', s: '', label: 'You', they: 'you' }
      : { who: 'your spouse', Who: 'Your spouse', your: "your spouse's", Your: "Your spouse's", s: 's', label: 'Spouse', they: 'they' });
    const PS = (w) => S.people[w];
    const fed = (w) => EMP[w].federal;
    const feds = WHO.filter(fed);
    const planName = (w) => (fed(w) ? 'TSP' : '401(k)');
    const ownerOf = (w) => (w.owner === 'spouse' && hasSp ? 'spouse' : 'you');
    // A workplace plan or IRA is in use with a balance, contributions, or a conversion or transfer that touches it.
    const hasPlan = (w) => PLN[w].balances.traditional + PLN[w].balances.roth > 0 || (EMP[w].salary > 0 && PLN[w].contributions.rate > 0);
    const usesIra = (w, kind) => (kind === 'traditional' ? IRS[w].traditional.balance > 0 : IRS[w].roth.balance > 0 || IRS[w].roth.contributionsWhileWorking > 0) ||
      moves.some((m) => ownerOf(m) === w && (m.fromAccount === kind + 'Ira' || m.toAccount === kind + 'Ira'));
    const iraT = WHO.some((w) => usesIra(w, 'traditional')), iraR = WHO.some((w) => usesIra(w, 'roth'));
    const planUsers = WHO.filter(hasPlan);
    // "TSP", "401(k)", "TSP and 401(k)" or "TSPs": the household's workplace plans.
    const plansTxt = planUsers.length === 2 ? (planName('you') === planName('spouse') ? `${planName('you')}s` : `${planName('you')} and ${planName('spouse')}`) : planName(planUsers[0] || 'you');
    const typeName = (a) => (a === 'traditionalWorkplace' ? `traditional ${plansTxt}` : a === 'rothWorkplace' ? `Roth ${plansTxt}` : ACCOUNT[a]);
    const acctName = (w, a) => (a === 'traditionalWorkplace' ? `traditional ${planName(w)}` : a === 'rothWorkplace' ? `Roth ${planName(w)}` : ACCOUNT[a]);
    // "traditional TSP → Roth IRA at ages 62–65: fill to the top of the 22% bracket" (the spouse's rows say so).
    const moveText = (w) => { const o = ownerOf(w); return `${o === 'spouse' ? 'spouse: ' : ''}${acctName(o, w.fromAccount)} → ${acctName(o, w.toAccount)} at ages ${w.fromAge}–${w.throughAge}: ` +
      (w.howMuch === 'fillBracket' && isConv(w) ? `fill to the top of the ${pct(w.fillToTopOfBracket, 0)} bracket` : w.howMuch === 'wholeBalance' ? 'the whole balance' : `${usd(w.fixedAmount)}/yr (today's $)`); };
    const row = (y) => Y.find((r) => r.year === y);
    const today = (v, y) => { const r = row(y); return r ? v / r.idx : v; };
    // "$2,345 in today's dollars ($3,153 in 2038 dollars)"; a year now or past is in today's dollars already.
    const dual = (v, y, per) => (y > Y0 && row(y) ? `${usd(today(v, y))}${per || ''} in today's dollars (${usd(v)}${per || ''} in ${y} dollars)` : `${usd(v)}${per || ''}`);
    // "$203,441, the average of 2035–2037 pay ($158,934 in today's dollars; projected)"; a manual High-3 is entered that way.
    const high3Text = (F, w) => (F.high3Years
      ? `${usd(F.high3)}, the average of ${F.high3Years[0]}–${F.high3Years[1]} pay (${usd(F.high3Today)} in today's dollars; ${FP[w].high3Mode === 'manual' ? 'entered, not inflated' : 'projected'})`
      : usd(F.high3));
    const first = Y[0], last = Y[Y.length - 1];
    const working = Y.filter((r) => r.phase === 'Working');
    const retired = Y.filter((r) => r.phase !== 'Working');
    const sum = (rows, f) => rows.reduce((t, r) => t + f(r), 0);
    const youAgeNow = Y0 - H.you.birthYear, spAgeNow = Y0 - H.spouse.birthYear;
    const hasChk = CK.balance > 0 || CK.keepInChecking > 0;
    const orderText = WD.order.map(typeName);
    // A state, local or foreign tax: "2026–2044; flat 5% after a $8,000 deduction; on wages and interest; ..." (today's $).
    const otName = (e, k) => e.name || `Tax ${k + 1}`;
    const otYears = (e) => (e.fromYear > 0 ? (e.throughYear > 0 ? `${e.fromYear}–${e.throughYear}` : `${e.fromYear} on`) : e.throughYear > 0 ? `${Y0}–${e.throughYear}` : 'every year');
    const otRates = (e) => (e.rates === 'brackets'
      ? `brackets ${e.brackets.slice().sort((a, b) => a.from - b.from).map((b) => `${pct(b.rate)} from ${usd(b.from)}`).join(', ')}` : `flat ${pct(e.flatRate)}`);
    const otText = (e) => {
      const types = Object.keys(OT_LABELS).filter((k) => e.appliesTo[k]), roth = types.some((k) => /^roth(Tsp|401k|Ira)$/.test(k));
      return `${otYears(e)}; ${otRates(e)}` +
        (e.deduction > 0 ? ` after a ${usd(e.deduction)} deduction${e.filing === 'separate' ? ' per return' : ''}` : '') +
        (e.retirementExclusion > 0 ? `; retirement income excluded up to ${usd(e.retirementExclusion)} a person${e.exclusionFromAge > 0 ? ` from age ${e.exclusionFromAge}` : ''}` : '') +
        `; on ${types.length ? list(types.map((k) => OT_LABELS[k])) : 'no income'}` +
        (roth ? `; Roth withdrawals taxed on ${e.rothAmountTaxed === 'earnings' ? 'their earnings' : 'the whole amount'}` : '') +
        (e.filing === 'separate' ? '; each spouse files separately (joint income split evenly)' : '') +
        (e.creditsFederalTax ? '; credits federal tax on the same income' : '') +
        (e.thresholdGrowthBelowInflation ? `; amounts grow ${pct(e.thresholdGrowthBelowInflation, 2)} slower than inflation` : '');
    };
    const abroad = OTX.some((e) => e.creditsFederalTax) || FX.enabled; // likely living abroad
    const nSettle = Math.round(MM.settlingInYears || 0);
    const settle = MM.keepSurplus && nSettle > 0 && S.retireYear <= S.endYear ? [S.retireYear, Math.min(S.endYear, S.retireYear + nSettle - 1)] : null;
    const settleTxt = settle ? `${settle[0]}${settle[1] > settle[0] ? `–${settle[1]}` : ''}` : '';
    const typeText = (F) => ({ immediate: 'immediate, unreduced', mra10: 'MRA+10 (reduced, no supplement)', deferred: 'deferred', none: 'no annuity (not vested)' }[F.retirementType]);
    const electionText = (F) => ({ none: 'no survivor annuity', partial: 'partial survivor annuity (−5%, survivor gets 25%)', full: 'full survivor annuity (−10%, survivor gets 50%)' }[F.election]);
    const strategyText = {
      fixedOrder: 'the accounts in a fixed order',
      proportional: `the brokerage, ${plansTxt} and IRA balances in proportion to their size`,
      bracketFill: `traditional ${plansTxt} and IRA money first, up to the top of the ${pct(WD.fillToTopOfBracket, 0)} bracket each year, then the other accounts in order`,
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
      `It runs from ${Y0} to ${S.endYear} with ${pct(inp.inflation.rate)} inflation. Every input is in today's (${Y0}) dollars; amounts below say whether they are today's dollars or the dollars of a future year (future dollars, after inflation). ` +
      `Assumed lifespans: you through age ${S.youDeathYear - H.you.birthYear} (${S.youDeathYear})` +
      (hasSp ? `, your spouse through age ${S.spouseDeathYear - H.spouse.birthYear} (${S.spouseDeathYear})` : '') + '.' +
      (H.longevityStress ? ' Longevity stress is on: the last survivor is extended to the plan-to age.' : ''));

    {
      // Savings today and the returns each account is expected to earn.
      const held = [], rets = [];
      let total = BR.balance + MM.balance + CK.balance;
      for (const w of WHO) {
        const n = N(w), B = PLN[w].balances, IA = IRS[w];
        if (hasPlan(w)) {
          held.push(`${n.your} ${planName(w)} ${usd(B.traditional + B.roth)} (traditional ${usd(B.traditional)}, Roth ${usd(B.roth)})`);
          rets.push(`${n.your} ${planName(w)} ${beforeAfter(PLN[w].returns)}`);
        }
        if (IA.traditional.balance > 0) held.push(`${n.your} traditional IRA ${usd(IA.traditional.balance)}`);
        if (IA.roth.balance > 0) held.push(`${n.your} Roth IRA ${usd(IA.roth.balance)}`);
        if (usesIra(w, 'traditional')) rets.push(`${n.your} traditional IRA ${beforeAfter(IA.traditional.returns)}`);
        if (usesIra(w, 'roth')) rets.push(`${n.your} Roth IRA ${beforeAfter(IA.roth.returns)}`);
        total += B.traditional + B.roth + IA.traditional.balance + IA.roth.balance;
      }
      if (BR.balance > 0) held.push(`brokerage investments ${usd(BR.balance)} (${pct(BR.unrealizedGainShare, 0)} of it unrealized gain)`);
      if (MM.balance > 0) held.push(`the money market ${usd(MM.balance)}`);
      if (CK.balance > 0) held.push(`checking ${usd(CK.balance)}`);
      rets.push(`brokerage investments ${beforeAfter(BR.returns)}`);
      story.push(`Savings today total ${usd(total)}: ${held.length ? list(held) : 'nothing yet'}. Expected yearly returns: ${list(rets)}` +
        `; the money market yields ${pct(MM.yield, 2)}${hasChk ? ` and checking ${pct(CK.interestRate, 2)}` : ''}.` +
        (MC.enabled ? ' Monte Carlo varies these returns around their expected values (see Monte Carlo).' : ''));
    }

    {
      // Each person's working years: pay, steps and the pay cap, and workplace-plan contributions.
      const parts = [];
      for (const w of WHO) {
        const n = N(w), J = EMP[w], PL = PLN[w], PSw = PS(w);
        const rowsW = Y.filter((r) => r.per[w] && r.per[w].salary > 0);
        if (!rowsW.length) continue;
        const r0 = rowsW[0].per[w], rN = rowsW[rowsW.length - 1];
        // ", plus GS step increases from step 5: step 6 in 2027, 7 in 2029 and 8 in 2032"
        const stepsText = () => {
          if (!fed(w) || !J.addStepIncreases) return '';
          const st = PSw.stepIncreases;
          if (!st.length) return J.currentStep >= 10 ? ', already at GS step 10, the top step' : `; GS step ${J.currentStep}, with no step increase before retiring`;
          const ps = st.map((x, k) => `${k ? '' : 'step '}${x.step} in ${x.year}`);
          return `, plus GS step increases from step ${J.currentStep}: ${ps.length > 1 ? `${ps.slice(0, -1).join(', ')} and ${ps[ps.length - 1]}` : ps[0]}`;
        };
        const cap = fed(w) && PSw.payCapFromYear !== null
          ? `, held at the GS pay cap (Executive Schedule level IV) ${PSw.payCapFromYear > S.startYear ? `from ${PSw.payCapFromYear}` : `throughout${PSw.stepIncreases.length ? ', so the step increases add nothing' : ''}`}` : '';
        let t = `${n.Who} keep${n.s} working through ${rN.year}. ${n.Your} salary rises from ${usd(r0.salary)} to about ${usd(rN.per[w].salary)} (${pct(J.annualRaise)} raises a year${stepsText()})${cap}. `;
        t += PL.contributions.rate > 0 || r0.contribEmployer > 0
          ? `${n.Who} contribute${n.s} ${pct(PL.contributions.rate)} of pay to the ${planName(w)} (${pct(PL.contributions.rothShare, 0)} Roth${PL.contributions.catchUp ? ', plus catch-ups from 50' : ''}) and ${fed(w) ? 'the agency' : 'the employer'} adds ${pct(r0.contribEmployer / r0.salary)}.`
          : `${n.Who} make${n.s} no ${planName(w)} contributions.`;
        const iraContrib = sum(rowsW, (r) => r.per[w].contribRothIra);
        if (iraContrib > 0.5) t += ` ${n.Who} also put${n.s} ${usd(IRS[w].roth.contributionsWhileWorking)}/yr (today's $, capped at the IRA limit) into a Roth IRA, ${usd(iraContrib)} in all.`;
        parts.push(t);
      }
      if (working.length) {
        const plansNow = WHO.reduce((t, w) => t + PLN[w].balances.traditional + PLN[w].balances.roth, 0);
        parts.push(`The ${plansTxt} grow${planUsers.length > 1 || plansTxt.endsWith('s') ? '' : 's'} from ${usd(plansNow)} to ${usd(S.tspAtRetirement)} by the start of ${S.retireYear}, when you retire ` +
          `(${usd(today(S.tspAtRetirement, S.retireYear))} in today's dollars). While you work, the salaries are assumed to cover living costs and taxes` +
          `${BR.savingsWhileWorking > 0 ? `; ${usd(BR.savingsWhileWorking)}/yr (today's $) is saved on top, into the brokerage account` : ''}.` +
          (() => {
            const ww = working.filter((r) => r.ssYou + r.ssSpouse + r.pension + r.supplement > 0.5);
            if (!ww.length) return '';
            return EMP.spendBenefitsThatStartBeforeRetiring
              ? ` Benefits that start before you retire (from ${ww[0].year}, ${usd(sum(ww, (r) => r.coveredIncome))} in total) are assumed to be spent with the salaries, not saved.`
              : ` Benefits that start before you retire (from ${ww[0].year}) are saved, not spent: ${usd(sum(ww, (r) => r.deposit))} in total${MM.keepSurplus ? ', kept in the money market up to the limit' : ''}.`;
          })());
      }
      if (parts.length) story.push(parts.join(' '));
    }

    // Each person's retirement and annuity: FERS (with the supplement) or another pension.
    for (const w of WHO) {
      const n = N(w), J = EMP[w], PSw = PS(w), other = w === 'you' ? 'your spouse' : 'you';
      const after = J.afterRetiring.earnings > 0 ? ` After retiring ${n.who} earn${n.s} ${usd(J.afterRetiring.earnings)}/yr (today's $) until age ${J.afterRetiring.untilAge}.` : '';
      if (!fed(w)) {
        const O = PSw.otherPension, Oin = inp.otherPension[w];
        let t = PSw.retireYear <= Y0 ? (w === 'you' ? 'You are retired; spending starts now. ' : '')
          : J.salary > 0 || w === 'you' ? `${n.Who} retire${n.s} at the start of ${PSw.retireYear} at age ${J.retirementAge}${w === 'you' ? '; spending starts then' : ''}. ` : '';
        if (O.startYear !== null) {
          t += `${n.Your} pension pays ${dual(O.annualAtStart / 12, O.startYear, '/mo')} from ${O.startYear} (age ${O.startAge})` +
            `${Oin.cola > 0 ? `, rising ${pct(Oin.cola)} a year` : ', with no COLA'}` +
            (hasSp ? `; ${O.survivorShare > 0 ? `${pct(O.survivorShare, 0)} of it continues to ${other} after ${w === 'you' ? 'your' : 'their'} death` : `it stops at ${w === 'you' ? 'your' : 'their'} death`}` : '') + '.';
        }
        t += after;
        if (t.trim()) story.push(t.trim());
        continue;
      }
      const F = PSw.fers, P = FP[w], SU = inp.fersSupplement[w];
      if (F.retirementType === 'none') {
        story.push(`${n.Who} separate${n.s} at ${J.retirementAge} with ${F.service} years of service, which is not enough for a FERS annuity (5 years are required).`);
        continue;
      }
      const tt = typeText(F);
      let t = `${n.Who} retire${n.s} at the start of ${PSw.retireYear} at age ${J.retirementAge} with ${F.service} years of service` +
        (P.sickLeaveHours > 0 ? ` (plus ${P.sickLeaveHours} sick-leave hours, giving ${F.compService.toFixed(2)} years for the computation)` : '') +
        `: ${/^[aeiou]/i.test(tt) ? 'an' : 'a'} ${tt} retirement under the ${F.rule} rule (${n.your} MRA is ${ym(F.mra)}). `;
      if (P.useOpmEstimate) t += `The annuity is taken from ${n.your} OPM estimate: ${dual(F.initialAnnuity / 12, F.pensionStartYear, '/mo')} gross. `;
      else t += `High-${F.highN} is ${high3Text(F, w)}${F.highN === 5 ? ' (High-5 proposal scenario)' : ''}, so the basic annuity is ${F.specialFormula ? '1.7% × 20 yrs + 1% × the rest' : pct(F.multiplier)} × High-${F.highN} × service = ${dual(F.basicAnnuity, PSw.retireYear, '/yr')}. `;
      if (F.ageReduction > 0) t += `It is permanently reduced ${pct(F.ageReduction)} because it starts at ${F.pensionStartAge}, before 62. `;
      if (F.pensionStartYear !== PSw.retireYear && F.pensionStartYear !== null) t += `Payments start in ${F.pensionStartYear} (age ${F.pensionStartAge}). `;
      t += `With ${electionText(F)}, ${n.who} receive${n.s} ${dual(F.initialMonthlyToRetiree, F.pensionStartYear, '/mo')} at the start`;
      if (F.survivorPct > 0) t += `, and ${other} would receive ${usd(today(F.initialAnnuity * F.survivorPct / 12, F.pensionStartYear))}/mo in today's dollars (plus later COLAs) if ${n.who} die${n.s} first`;
      t += `. ${FP.colaMode === 'none' ? 'Scenario: no COLAs on the annuity or survivor annuity.' : `${FP.colaMode === 'reduced' ? `Scenario: COLAs are the diet COLA minus ${pct(FP.colaReducedBy, 2)} (never below 0); they` : 'Diet COLAs'} ${P.specialCategory ? 'apply right away (special category).' : `begin the year after ${n.who} turn${n.s} 62 (${H[w].birthYear + 63}).`}`}`;
      story.push(t + after);
      if (F.supplementEligible) {
        story.push(`${w === 'you' ? 'The' : "Your spouse's"} FERS supplement of ${usd(today(F.supplementMonthly, PSw.retireYear))}/mo in today's dollars (${usd(F.supplementMonthly)}/mo in ${PSw.retireYear} dollars; fixed, no COLA) is paid from ${PSw.retireYear} through ${F.supplementEndYear - 1}. ` +
          (SU.mode === 'manual' ? 'It is a manual amount.' : `It is estimated as Social Security at 62 from FERS earnings (${usd(F.ss62Today)}/mo in today's $) × ${F.supplementYears} years of service (rounded to the nearest year) ÷ 40, inflated to ${PSw.retireYear}.`) +
          (J.afterRetiring.earnings > 0 ? ` ${n.Your} post-retirement earnings are subject to its earnings test.` : ''));
      } else if (SU.mode === 'off') {
        story.push(`The FERS supplement is switched off${hasSp ? ` for ${n.who}` : ''} (a "supplement eliminated" scenario).`);
      }
    }

    {
      // The first full year of benefits: the claim year, or the next one when the claim starts during the year.
      const ssRow = (P) => (Math.abs(P.claimAge - Math.round(P.claimAge)) < 1e-9 ? row(P.claimYear) : null) || row(P.claimYear + 1) || row(P.claimYear);
      const ssYear = (r, P) => `${r ? r.year : P.claimYear} dollars${r && r.year !== P.claimYear ? ', the first full year' : ''}`;
      const yr = ssRow(P1);
      let t = `You claim Social Security at ${ym(P1.claimAge)} in ${P1.claimYear}: ${pct(P1.factor)} of your ${usd(P1.pia)}/mo PIA (today's $), ` +
        `about ${usd(yr ? yr.ssYou : 0)} a year in ${ssYear(yr, P1)} (benefits rise with inflation).`;
      if (P2) {
        const yr2 = ssRow(P2);
        t += ` Your spouse claims at ${ym(P2.claimAge)} in ${P2.claimYear}: ${pct(P2.factor)} of a ${usd(P2.pia)}/mo PIA (today's $), about ${usd(yr2 ? yr2.ssSpouse : 0)} a year in ${ssYear(yr2, P2)}.`;
        const sp = Y.reduce((m, r) => m + r.ssDetail.spouseSpousal + r.ssDetail.youSpousal, 0);
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
        (HC.medicarePartBYou || HC.medicarePartBSpouse ? `, plus Medicare Part B for ${list([HC.medicarePartBYou ? 'you' : null, HC.medicarePartBSpouse ? 'your spouse' : null].filter(Boolean))} from 65` : '') + '.' +
        (hasSp ? ` After the first death, ${list([`living spending drops to ${pct(SP.survivorShare, 0)}`].concat(HC.fehbMonthly > 0 ? [`FEHB to ${pct(HC.fehbSelfOnlyShare, 0)} (self only)`] : [],
          HC.medicarePartBYou || HC.medicarePartBSpouse ? ["the deceased's Part B stops"] : []))}.` : '');
      const evs = (SP.oneTimeEvents || []).filter((e) => e.amount > 0);
      if (evs.length) t += ' One-time events: ' + evs.map(eventText).join('; ') + '.';
      const bridgeRows = Y.filter((r) => r.year >= S.bridgeStartYear && r.year < S.bridgeEndYear);
      if (bridgeRows.length) {
        const net = S.bridgePortfolioUsed, saved = S.bridgeSaved, cvt = S.bridgeConversionTax, without = net - cvt, gross = net + saved;
        t += ` During the bridge years ${S.bridgeStartYear}–${S.bridgeEndYear - 1}, before ${hasSp ? 'both Social Security claims' : 'Social Security'} start, ` + (net > 0.5
          ? `the portfolio supplies ${usd(net)} net (${usd(gross)} withdrawn` +
            (S.bridgeTspUsed > gross - 0.5 ? `, all from the ${plansTxt}` : S.bridgeTspUsed > 0.5 ? `, ${usd(S.bridgeTspUsed)} of it from the ${plansTxt}` : '') +
            (saved > 0.5 ? `, less ${usd(saved)} saved` : '') + ').' +
            (cvt > 0.5 ? (without > 0.5 ? ` ${usd(cvt)} of it pays Roth-conversion tax, leaving ${usd(without)} for spending and the other taxes.`
              : ` Roth-conversion tax (${usd(cvt)} in these years) accounts for all of it: without the conversions, income would cover spending and taxes with ${usd(-without)} to spare.`) : '')
          : `income covers spending and taxes${cvt > 0.5 ? `, including ${usd(cvt)} of Roth-conversion tax` : ''}, so on balance the portfolio is not drawn${-net > 0.5 ? ` (${usd(-net)} more is saved than withdrawn)` : ''}.`);
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
      (S.maxCash > 0.5 ? ` The money market balance peaks at ${usd(S.maxCash)} (future dollars${MM.keepSurplus ? '; the limit rises with inflation' : ''}).` : ''));

    {
      const rmdRow = row(S.rmdStartYear);
      const fed = S.lifetimeFederalTax, fedRet = S.retirementFederalTax;
      const margins = retired.map((r) => r.marginal);
      // Each person's RMDs start at their own age; the survivor's age drives an inherited account's.
      let t = rmdRow
        ? `Required minimum distributions start in ${S.rmdStartYear} at age ${S.rmdStartAge}; that year they total ${usd(rmdRow.rmd)} (traditional ${plansTxt}${iraT ? ' and IRA' : ''} balances ÷ the IRS divisor). `
        : `RMDs would start in ${S.rmdStartYear} (age ${S.rmdStartAge}), after the projection ends. `;
      if (hasSp && P2) {
        const y2 = H.spouse.birthYear + P2.rmdStartAge, own = Y.find((r) => r.per.spouse && r.per.spouse.rmd > 0);
        if (own && own.year !== S.rmdStartYear) t += `Your spouse's own RMDs start in ${own.year} (age ${P2.rmdStartAge}). `;
        else if (!own && y2 <= S.endYear && (PLN.spouse.balances.traditional > 0 || IRS.spouse.traditional.balance > 0)) t += `Your spouse's RMD age is ${P2.rmdStartAge} (${y2}). `;
      }
      t += `Federal income tax totals ${usd(fed)} (${usd(fedRet)} in retirement), with retirement marginal brackets from ${pct(Math.min(...margins), 0)} to ${pct(Math.max(...margins), 0)}` +
        ` (${TX.mode === 'advanced' ? `2026 brackets and deductions, indexed ${pct(inp.inflation.rate - TX.bracketGrowthBelowInflation, 2)}/yr` : `simple effective rates ${pct(TX.simpleRateJoint)} joint / ${pct(TX.simpleRateSingle)} single`}).`;
      if (convW.length) {
        const conv = Y.filter((r) => r.conversion > 0);
        const irmaaRows = Y.filter((r) => r.irmaaFromConversion > 0.5);
        t += conv.length ? ` Roth conversions (${convW.map(moveText).join('; ')}) move ${usd(S.totalConversions)} in ${yearRanges(conv.map((r) => r.year))}, costing ${usd(S.totalConversionTax)} in tax ` +
            `(${pct(S.totalConversionTax / S.totalConversions)} of the amount converted; the year's tax minus the tax with neither the conversion nor the withdrawals that pay for it)` +
            (irmaaRows.length ? ` plus ${usd(S.lifetimeIrmaaFromConversions)} of Medicare IRMAA surcharges in ${yearRanges(irmaaRows.map((r) => r.year))} that their income triggers two years later` : '') + '.'
          : ' Roth conversions are set but none happen (no room under the target or no traditional balance).';
      }
      if (xferW.length) {
        const moved = (r) => xferW.reduce((a, w) => a + (r.moves[moveKey(w)] || 0), 0);
        const xr = Y.filter((r) => moved(r) > 0.5);
        if (xr.length) t += ` Transfers (${xferW.map(moveText).join('; ')}) move ${usd(sum(xr, moved))} in ${yearRanges(xr.map((r) => r.year))}, untaxed.`;
      }
      const pen = sum(Y, (r) => r.ira.trad.penalty);
      if (pen > 0.5) t += ` Traditional IRA withdrawals before 59½ add ${usd(pen)} of 10% early-withdrawal penalty.`;
      if (OTX.length) {
        t += ` State, local and foreign income tax: ${list(OTX.map((e, k) => `${otName(e, k)} (${otYears(e)}, ${otRates(e)}) costs ${usd(S.lifetimeOtherByEntry[k])}`))}` +
          (S.lifetimeOtherCredit > 0.5 ? `, after ${usd(S.lifetimeOtherCredit)} of credit for federal tax on the same income` : '') + '.';
      } else t += ' No state, local or foreign income tax is included.';
      story.push(t);
    }

    if (hasSp && S.firstDeathYear !== null && S.firstDeathYear < S.endYear) {
      const spouseFirst = S.spouseDeathYear <= S.youDeathYear;
      const after = row(S.firstDeathYear + 1);
      let t = `The first assumed death is ${spouseFirst ? 'your spouse' : 'you'} in ${S.firstDeathYear}. From ${S.firstDeathYear + 1} the survivor files single`;
      if (after) {
        const sv = spouseFirst ? 'you' : 'spouse', ns = N(sv), Fs = PS(sv).fers;
        if (Fs && Fs.survivorReduction > 0) t += `, ${ns.your} annuity's survivor reduction ends`;
        t += `, ${ns.who} receive${ns.s} ${usd(after.pension + after.survivorAnnuity)}/yr of annuities` +
          (after.survivorAnnuity > 0.5 ? ` (${usd(after.survivorAnnuity)} of it a survivor annuity)` : '') +
          ` and ${usd(spouseFirst ? after.ssYou : after.ssSpouse)}/yr of Social Security (the larger of ${spouseFirst ? "your own or your spouse's" : 'their own or yours'} benefit)`;
        t += `, and living spending drops to ${pct(SP.survivorShare, 0)}. Marginal bracket: ${pct(row(S.firstDeathYear).marginal, 0)} the year of death, ${pct(after.marginal, 0)} the next year.`;
      } else t += '.';
      story.push(t);
    }

    {
      let t = S.depletionYear === null
        ? `The portfolio is never depleted. `
        : `The portfolio runs out in ${S.depletionYear} (your age ${S.depletionAge}); ${usd(S.totalShortfall)} of spending is unfunded through ${S.endYear}. `;
      const parts = [`traditional ${plansTxt} ${usd(last.balTrad)}`, `Roth ${plansTxt} ${usd(last.balRoth)}`].concat(
        iraT ? [`traditional IRA ${usd(last.ira.trad.bal)}`] : [], iraR ? [`Roth IRA ${usd(last.ira.roth.bal)}`] : [],
        [`brokerage ${usd(last.balTaxable)}`, `money market ${usd(last.balCash)}`], last.checking.bal > 0.5 ? [`checking ${usd(last.checking.bal)}`] : []);
      t += `At the end of ${S.endYear}, with every account earning its expected return each year, it holds ${usd(S.endingBalance)} (${usd(S.endingBalanceReal)} in today's dollars): ${list(parts)}. ` +
        `After the heirs' ${pct(TX.heirsRate, 0)} tax on the traditional ${plansTxt}${iraT ? ' and IRA' : ''} money, about ${usd(S.afterTaxInheritance)} (${usd(S.afterTaxInheritanceReal)} today's $) is left to heirs (real estate not included).` +
        (S.lifetimeIrmaa > 0.5 ? ` Medicare IRMAA surcharges add ${usd(S.lifetimeIrmaa)} in Part B premiums` +
          (S.lifetimeIrmaaFromConversions > 0.5 ? ` (${S.lifetimeIrmaaFromConversions > S.lifetimeIrmaa - 0.5 ? 'all' : usd(S.lifetimeIrmaaFromConversions)} of it caused by the Roth conversions)` : '') + '.' : '');
      if (suite) {
        const Fx = suite.fixed, St = suite.stochastic;
        // With fixed lifespans the runs end when the projection does, so their median is comparable with it.
        const fxMed = Fx.endingBalanceReal.p50;
        t += ` Monte Carlo (${num(Fx.runs)} runs, seed ${Fx.seed}): ${pct(Fx.successRate, 0)} of runs never deplete with fixed lifespans and ${pct(St.successRate, 0)} with ` +
          `lifespans drawn from the SSA life table; the median run ends with ${usd(fxMed)} in today's dollars with fixed lifespans` +
          (mcSelKey === 'stochastic' ? ` and ${usd(St.endingBalanceReal.p50)} with stochastic lifespans` : '') +
          `${opts.mcStale ? ' (inputs changed since this run)' : ''}.` +
          (fxMed < S.endingBalanceReal * 0.95 ? ` That is below the ${usd(S.endingBalanceReal)} above because returns that vary compound to less than their average: the projection is an optimistic path, not the median one.` : '');
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
    const d = new Date(), localDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    md.push(`Generated ${opts.generatedAt || localDate} by a FERS household retirement calculator (an educational model, not advice).`);

    h2('Instructions for the reviewer');
    md.push(`You are reviewing a retirement cash-flow projection for a household with ${feds.length === 2 ? 'two federal employees' : feds.length ? 'a federal employee' : 'no federal employee'} under FERS. Act as a skeptical, ` +
      'fee-only planner who knows FERS, the TSP, 401(k)s, IRAs, Social Security, US federal income tax' + (abroad ? ', and US citizens retiring abroad (cross-border tax)' : '') + '. Please:');
    md.push('1. Check that every input below is plausible and internally consistent, and flag anything that looks wrong or optimistic.');
    md.push('2. Verify the rules applied (see "Rules applied and computed values"): retirement eligibility, annuity formula, survivor election, supplement, Social Security factors, RMDs and taxes. Recompute a few numbers yourself.');
    md.push('3. Spot-check rows of the year-by-year table. Each year, cash sources (income, including interest, + withdrawals) equal uses (spending + taxes + surplus saved − unfunded), and balances roll forward.');
    md.push('4. Identify risks the model ignores (see "Model limitations") and say how material they are for this household.');
    md.push('5. Recommend concrete changes (claiming ages, survivor election, Roth conversions and transfers, withdrawal order, spending, cash buffer) with their trade-offs, and answer the questions at the end.');
    md.push('6. If you recommend changes to the settings, also give the complete edited settings file from "Plan settings (JSON)" at the end, changing only the values you recommend, so it can be imported into the calculator with Import JSON. Its "howToRead" notes explain the units and allowed values.');
    md.push('', 'Conventions: annual steps; age in a year = year − birth year; events take effect at the start of the year the age is reached; ' +
      `every input is in today's (${Y0}) dollars; results are in future (nominal) dollars, the amounts paid in each year, unless marked "today's $". ` +
      `For today's dollars, divide a year's flows by that year's inflation index (Infl, the index at the start of the year) and its end-of-year balances by the next year's (the index at the end of ${S.endYear} is ${last.idxEnd.toFixed(3)}). ` +
      'The Inputs headings follow the calculator\'s input panels, and the name in backticks is that panel\'s section in the settings JSON.');

    h2('Plan narrative');
    for (const p of story) md.push(p, '');

    h2('Key results');
    md.push('| Metric | Value |', '| --- | --- |');
    const retRow = row(S.retireYear);
    const kr = [
      [`${plansTxt} (traditional + Roth) at your retirement`, `${usd(S.tspAtRetirement)} at start of ${S.retireYear} (${usd(today(S.tspAtRetirement, S.retireYear))} today's $)`],
      (iraT || iraR) && retRow && ['IRAs at your retirement', `traditional ${usd(retRow.ira.trad.start)}, Roth ${usd(retRow.ira.roth.start)} at start of ${S.retireYear}`],
      [`${plansTxt} when RMDs start`, S.tspAtRmdStart !== null ? `${usd(S.tspAtRmdStart)} at start of ${S.rmdStartYear}` : '—'],
      ...feds.map((w) => { const F = PS(w).fers; return [`FERS annuity at start${hasSp ? ` (${N(w).who})` : ''}`, F.retirementType === 'none' ? 'none' : `${dual(F.initialMonthlyToRetiree, F.pensionStartYear, '/mo')}, from ${F.pensionStartYear}`]; }),
      ...feds.map((w) => { const F = PS(w).fers; return [`FERS supplement${hasSp ? ` (${N(w).who})` : ''}`, F.supplementEligible ? `${dual(F.supplementMonthly, PS(w).retireYear, '/mo')}, ${PS(w).retireYear}–${F.supplementEndYear - 1}` : 'none']; }),
      ...WHO.filter((w) => !fed(w) && PS(w).otherPension.startYear !== null).map((w) => [`Pension (${N(w).who})`, `${dual(PS(w).otherPension.annualAtStart / 12, PS(w).otherPension.startYear, '/mo')} from ${PS(w).otherPension.startYear}`]),
      ['Ending balance (left to heirs)', `${usd(S.endingBalance)} future $ / ${usd(S.endingBalanceReal)} today's $ (end of ${S.endYear}, at expected returns every year; Monte Carlo has the median); ${usd(tradEnd)} of it is traditional ${plansTxt}${iraT ? ' and IRA' : ''} money, which is pre-tax to heirs; real estate is not included`],
      ['Lifetime spending (retired years)', `${usd(S.lifetimeSpending)} recurring (living + healthcare), plus ${usd(S.lifetimeOneTimeOut)} of one-time outflows${S.totalShortfall > 0.5 ? `; ${usd(S.totalShortfall)} unfunded` : ''}`],
      ['Lifetime income taxes', `${usd(S.lifetimeTax)} total = federal ${usd(S.lifetimeFederalTax)} + state, local & foreign ${usd(S.lifetimeOtherTax)} (includes tax on salary while working)`],
      ['Depletion', S.depletionYear === null ? 'never' : `${S.depletionYear} (age ${S.depletionAge}); unfunded ${usd(S.totalShortfall)}`],
      ['Peak withdrawal rate (core)', S.peakCoreWithdrawalRate > 0 ? `${pct(S.peakCoreWithdrawalRate)} in ${S.peakCoreWithdrawalYear} (recurring spending + taxes, excl. one-time events and conversion tax)` : '0% (portfolio not needed)'],
      ['Peak withdrawal rate (all-in)', S.peakWithdrawalRate > 0 ? `${pct(S.peakWithdrawalRate)} in ${S.peakWithdrawalYear} (every net draw, incl. one-time events and conversion tax)` : '0% (portfolio not needed)'],
      ['Bridge bucket', S.bucket ? `${usd(S.bucket.sizeAtFund)} funded in ${S.bucket.fundYear} at a fixed ${pct(S.bucket.rate)}; covers ${S.bucket.retireYear}–${S.bucket.endYear}; ${usd(S.bucket.drawn)} drawn` : 'off'],
      ['Cash-flow check', S.maxCashCheck <= 5 ? `passes every year (largest difference ${usd(S.maxCashCheck)})` : `FAILS: largest difference ${usd(S.maxCashCheck)}`],
      ['Federal income tax', `${usd(S.lifetimeFederalTax)} lifetime, ${usd(S.retirementFederalTax)} in retirement`],
      ['State, local & foreign tax', OTX.length ? list(OTX.map((e, k) => `${otName(e, k)} ${usd(S.lifetimeOtherByEntry[k])}`)) +
        (S.lifetimeOtherCredit > 0.5 ? ` (after ${usd(S.lifetimeOtherCredit)} of credit for federal tax)` : '') : 'none'],
      ['Roth conversions', convW.length ? `${usd(S.totalConversions)} (${convW.map(moveText).join('; ')})` +
        (S.totalConversions > 0.5 ? `; tax ${usd(S.totalConversionTax)} (${pct(S.totalConversionTax / S.totalConversions)} of the amount converted, incl. tax on the withdrawals that pay it)` +
          (S.lifetimeIrmaaFromConversions > 0.5 ? ` + ${usd(S.lifetimeIrmaaFromConversions)} of IRMAA` : '') : '') : 'none'],
      xferW.length && ['Transfers between accounts', `${usd(sum(Y, (r) => xferW.reduce((a, w) => a + (r.moves[moveKey(w)] || 0), 0)))} (${xferW.map(moveText).join('; ')}); not taxed`],
      ['After-tax inheritance', `${usd(S.afterTaxInheritance)} future $ / ${usd(S.afterTaxInheritanceReal)} today's $ = Roth ${usd(S.inheritance.roth)} + brokerage ${usd(S.inheritance.taxable)} + money market ${usd(S.inheritance.cash)}${S.inheritance.checking > 0.5 ? ` + checking ${usd(S.inheritance.checking)}` : ''} + traditional ${usd(S.inheritance.trad)} × (1 − ${pct(TX.heirsRate, 0)})`],
      ['Medicare IRMAA surcharges', S.lifetimeIrmaa > 0.5 ? `${usd(S.lifetimeIrmaa)} of extra Part B premiums` + (S.lifetimeIrmaaFromConversions > 0.5 ? `, ${S.lifetimeIrmaaFromConversions > S.lifetimeIrmaa - 0.5 ? 'all' : usd(S.lifetimeIrmaaFromConversions)} of it caused by Roth conversions` : '') : (HC.medicarePartBYou || HC.medicarePartBSpouse ? 'none' : 'n/a (Part B not enrolled)')],
      ['Bridge years (retirement → SS)', S.bridgeEndYear > S.bridgeStartYear ? `${S.bridgeStartYear}–${S.bridgeEndYear - 1}: ` + (S.bridgePortfolioUsed > 0.5
        ? `net portfolio draw ${usd(S.bridgePortfolioUsed)} (withdrawals ${usd(S.bridgePortfolioUsed + S.bridgeSaved)} − saved ${usd(S.bridgeSaved)}; ${plansTxt} ${usd(S.bridgeTspUsed)})`
        : `no net portfolio draw (withdrawals ${usd(S.bridgePortfolioUsed + S.bridgeSaved)}, saved ${usd(S.bridgeSaved)})`) +
        (S.bridgeConversionTax > 0.5 ? `; Roth-conversion tax ${usd(S.bridgeConversionTax)}, so without the conversions ` +
          (S.bridgePortfolioUsed - S.bridgeConversionTax > 0.5 ? `a draw of ${usd(S.bridgePortfolioUsed - S.bridgeConversionTax)}` : `a surplus of ${usd(S.bridgeConversionTax - S.bridgePortfolioUsed)}`) : '') : 'none'],
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
    for (const w of WHO) {
      const J = EMP[w], PSw = PS(w), n = N(w);
      const kind = fed(w) ? 'federal employee (FERS)' : 'not a federal employee';
      if (!(J.salary > 0)) bullet(n.label, `${kind}; not working (salary $0); retirement age ${J.retirementAge}`);
      else {
        const nextStep = PSw.stepIncreases.length ? `next step in ${PSw.stepIncreases[0].year}` : J.currentStep >= 10 ? 'the top step' : 'no step increase before retiring';
        bullet(n.label, `${kind}; salary ${usd(J.salary)} (this year); raises ${pct(J.annualRaise)} a year` +
          (fed(w) ? `; ${J.addStepIncreases ? `GS step ${J.currentStep} with step increases (${nextStep})` : 'no step increases'}; GS pay cap ` +
            (J.gsPayCap > 0 ? `${usd(J.gsPayCap)} in ${S.startYear}, growing with the raise${PSw.payCapFromYear !== null ? `; pay is held at it from ${PSw.payCapFromYear}` : '; pay stays below it'}` : 'none') : '') +
          `; retires at ${J.retirementAge}`);
      }
      bullet(`${n.label}: earnings after retiring`, J.afterRetiring.earnings > 0 ? `${usd(J.afterRetiring.earnings)}/yr until age ${J.afterRetiring.untilAge}` : 'none');
    }
    bullet('Benefits that start before you retire', EMP.spendBenefitsThatStartBeforeRetiring ? 'spent with the salaries (not saved)' : 'saved (the salaries cover living costs)');
    h3('Workplace plans (TSP / 401(k))', 'workplacePlans');
    for (const w of WHO) {
      const PL = PLN[w], B = PL.balances, Cn = PL.contributions, EC = PL.employerContributions;
      bullet(`${N(w).label}: ${planName(w)}`, `traditional ${usd(B.traditional)}, Roth ${usd(B.roth)} (${pct(B.rothBasisShare, 0)} of the Roth balance is contributions); ` +
        `contributions ${pct(Cn.rate)} of salary, ${pct(Cn.rothShare, 0)} Roth; catch-up ${yesNo(Cn.catchUp)}; ` +
        (fed(w) ? 'the agency adds 1% + match (to traditional)' : `the employer adds ${pct(EC.automatic)} of pay + ${pct(EC.match, 0)} of contributions up to ${pct(EC.matchUpTo)} of pay (to traditional)`) +
        `; returns ${beforeAfter(PL.returns)} (one fund allocation for traditional and Roth)${hasPlan(w) ? '' : ' (not used)'}`);
    }
    bullet('Volatility', `${pct(MC.volatility.beforeRetirement.workplacePlans)} → ${pct(MC.volatility.afterRetirement.workplacePlans)}`);
    h3('IRAs', 'iras');
    for (const w of WHO) {
      const IA = IRS[w], pre = `${N(w).label}: `;
      bullet(`${pre}traditional IRA`, `${usd(IA.traditional.balance)}; returns ${beforeAfter(IA.traditional.returns)}${usesIra(w, 'traditional') ? '' : ' (not used)'}`);
      bullet(`${pre}Roth IRA`, `${usd(IA.roth.balance)} (${pct(IA.roth.basisShare, 0)} contributions and conversions); returns ${beforeAfter(IA.roth.returns)}; ` +
        `contributions while working ${IA.roth.contributionsWhileWorking > 0 ? `${usd(IA.roth.contributionsWhileWorking)}/yr (capped at the IRA limit)` : 'none'}${usesIra(w, 'roth') ? '' : ' (not used)'}`);
    }
    bullet('Volatility', `traditional IRA ${pct(MC.volatility.beforeRetirement.traditionalIra)} → ${pct(MC.volatility.afterRetirement.traditionalIra)}, Roth IRA ${pct(MC.volatility.beforeRetirement.rothIra)} → ${pct(MC.volatility.afterRetirement.rothIra)}`);
    h3('Brokerage investments', 'brokerage');
    bullet('Balance', `${usd(BR.balance)} (${pct(BR.unrealizedGainShare, 0)} of it unrealized gain)`);
    bullet('Savings while you work', BR.savingsWhileWorking > 0 ? `${usd(BR.savingsWhileWorking)}/yr` : 'none');
    bullet('Returns', `${beforeAfter(BR.returns)}; volatility ${pct(MC.volatility.beforeRetirement.brokerage)} → ${pct(MC.volatility.afterRetirement.brokerage)}`);
    h3('Checking & money market', 'checkingAndMoneyMarket');
    bullet('Checking', hasChk ? `${usd(CK.balance)} today; keep ${usd(CK.keepInChecking)} in checking; interest ${pct(CK.interestRate, 2)}` : 'not in the plan ($0 balance, nothing kept)');
    bullet('Money market', `${usd(MM.balance)} today; yield ${pct(MM.yield, 2)}; ` +
      (MM.keepSurplus ? `surplus is kept here up to ${usd(MM.moveToBrokerageAbove)} and the excess moves to brokerage; settling-in years ${nSettle}${settle ? ` (${settleTxt}, no limit)` : ''}` : 'surplus is not kept here (all of it is invested in brokerage)'));
    h3('Withdrawals', 'withdrawals');
    bullet('Strategy', { fixedOrder: 'fixed order', proportional: `proportional to the brokerage, ${plansTxt} and IRA balances`, bracketFill: `traditional ${plansTxt} and IRA first up to the top of the ${pct(WD.fillToTopOfBracket, 0)} bracket, then the order` }[WD.strategy]);
    bullet('One-time outflows from Roth accounts first', yesNo(WD.oneTimeOutflowsFromRothFirst));
    bullet('Order', `money market first, then ${orderText.join(' → ')}${hasChk ? ', checking last' : ''}${WD.strategy === 'proportional' ? ' (not used by the proportional strategy)' : ''}` +
      (hasSp ? '; within a type, the account of a spouse who can withdraw without a penalty first, then the older spouse\'s' : ''));
    bullet('Bridge bucket', WD.bridgeBucket.enabled ? `pre-funds the planned net draws of the first ${WD.bridgeBucket.yearsCovered} retirement years; built ${WD.bridgeBucket.buildYearsBeforeRetirement} years before retirement; fixed ${pct(WD.bridgeBucket.return)} return` : 'off');
    h3('FERS pension', 'fersPension');
    if (!feds.length) bullet('FERS', 'no one in the household is a federal employee');
    for (const w of feds) {
      const P = FP[w], F = PS(w).fers, pre = hasSp ? `${N(w).label}: ` : '';
      bullet(`${pre}service`, `${P.serviceYears} years + ${P.sickLeaveHours} sick-leave hours; FEHB ${P.fehbYearsBeforeRetirement} years before retirement; special category ${yesNo(P.specialCategory)}`);
      bullet(`${pre}High-${F.highN}`, `${P.high3Mode}: ${high3Text(F, w)}`);
      bullet(`${pre}survivor election`, P.survivorElection + (hasSp ? '' : ' (no spouse, so treated as none)'));
      bullet(`${pre}postpone annuity to age`, P.postponeToAge > 0 ? P.postponeToAge : 'no (automatic start)');
      bullet(`${pre}OPM estimate`, P.useOpmEstimate ? `${usd(P.opmEstimateMonthly)}/mo gross (today's $, inflated to the first year paid) replaces the computed annuity` : 'not used (computed)');
    }
    bullet('Average salary used', FP.averageSalaryYears === 5 ? 'highest 5 years (High-5 proposal scenario)' : 'highest 3 years (current law)');
    bullet('COLA', { diet: 'current-law diet COLA', reduced: `diet COLA minus ${pct(FP.colaReducedBy, 2)} (scenario)`, none: 'none (scenario)' }[FP.colaMode]);
    h3('FERS supplement', 'fersSupplement');
    if (!feds.length) bullet('Supplement', 'no one in the household is a federal employee');
    for (const w of feds) {
      const SU = inp.fersSupplement[w], F = PS(w).fers;
      bullet(hasSp ? `${N(w).label}` : 'Supplement', SU.mode === 'auto' ? `auto; SS at 62 from FERS earnings ${usd(F.ss62Today)}/mo${SU.ssAt62FromFersMonthly > 0 ? '' : ` (70% of ${N(w).your} PIA)`}` : SU.mode === 'manual' ? `manual ${usd(SU.manualMonthly)}/mo (today's $, inflated to the retirement year)` : 'off (eliminated scenario)');
    }
    h3('Other pension', 'otherPension');
    const nonFeds = WHO.filter((w) => !fed(w));
    if (!nonFeds.length) bullet('Other pension', 'not used (everyone is under FERS)');
    for (const w of nonFeds) {
      const O = inp.otherPension[w];
      bullet(N(w).label, O.monthly > 0 ? `${usd(O.monthly)}/mo (today's $) from age ${O.startAge}; COLA ${pct(O.cola)}; survivor keeps ${pct(O.survivorShare, 0)}` : 'none');
    }
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
      'off');
    h3('Taxes, conversions & transfers', 'taxes');
    bullet('Federal tax', TX.mode === 'advanced' ? `advanced (brackets and deductions); senior deduction ${yesNo(TX.seniorDeduction)}; brackets grow ${pct(TX.bracketGrowthBelowInflation, 2)} slower than inflation (chained CPI)` : `simple: ${pct(TX.simpleRateJoint)} joint / ${pct(TX.simpleRateSingle)} single`);
    bullet("Heirs' marginal tax rate", `${pct(TX.heirsRate, 0)} (applied to inherited traditional TSP and IRA money)`);
    bullet('Conversions and transfers', moves.length ? moves.map((w) => `${moveText(w)} (${isConv(w) ? 'conversion' : 'transfer'})`).join('; ') +
      " (in a year, the first conversion row covering its owner's age applies; every transfer row applies)" : 'none');
    h3('State, local & foreign tax', 'otherTaxes');
    if (!OTX.length) bullet('Taxes', 'none');
    OTX.forEach((e, k) => bullet(otName(e, k), otText(e)));
    h3('Monte Carlo', 'monteCarlo');
    bullet('Runs', `${MC.enabled ? 'on' : 'off'}; ${num(MC.runs)} runs, seed ${MC.seed}`);
    const V = MC.volatility;
    bullet('Volatility (SD of yearly returns) before → after retirement', `workplace plans ${pct(V.beforeRetirement.workplacePlans)} → ${pct(V.afterRetirement.workplacePlans)}, brokerage ${pct(V.beforeRetirement.brokerage)} → ${pct(V.afterRetirement.brokerage)}, ` +
      `traditional IRA ${pct(V.beforeRetirement.traditionalIra)} → ${pct(V.afterRetirement.traditionalIra)}, Roth IRA ${pct(V.beforeRetirement.rothIra)} → ${pct(V.afterRetirement.rothIra)}`);
    bullet('Inflation', `volatility ${pct(MC.inflation.volatility)}; persistence AR(1) φ = ${MC.inflation.persistence} (the long-run SD stays the volatility)`);
    const ES = RUL.earlySocialSecurity, GR = RUL.spendingGuardrails;
    bullet('Claim Social Security early if the portfolio is low', ES.enabled ? `on: ages ${ES.fromAge}–${ES.throughAge}, claim early if the start-of-year portfolio is below ${ES.threshold === 'shareOfPlan' ? pct(ES.shareOfPlan, 0) + ' of the deterministic plan (real $)' : usd(ES.dollarAmount) + " today's $"} (Monte Carlo runs only)` : 'off');
    bullet('Spending guardrails', GR.enabled ? `on: cut base living spending ${pct(GR.spendingCut, 0)} when the portfolio is below ${pct(GR.cutBelowShareOfPlan, 0)} of plan until above ${pct(GR.restoreAboveShareOfPlan, 0)}; deferrable events slide up to ${GR.deferEventsUpToYears} years (Monte Carlo runs only)` : 'off');

    h2('Rules applied and computed values');
    const payFeds = feds.filter((w) => EMP[w].salary > 0 && (EMP[w].addStepIncreases || EMP[w].gsPayCap > 0));
    if (payFeds.length) {
      md.push('### Pay');
      for (const w of payFeds) {
        const J = EMP[w], PSw = PS(w), pre = hasSp ? `${N(w).label}: ` : '';
        if (J.addStepIncreases) {
          bullet(`${pre}GS step increases`, 'after 1 year at steps 1–3, 2 years at steps 4–6 and 3 years at steps 7–9 (5 CFR 531.405); each step adds 1/30 of the step-1 rate, on top of the yearly raise' +
            (PSw.stepIncreases.length ? `: ${PSw.stepIncreases.map((x) => `step ${x.step} in ${x.year}`).join(', ')}` : ''));
        }
        if (J.gsPayCap > 0) {
          bullet(`${pre}GS pay cap`, `pay with locality is held at or below Executive Schedule level IV (5 USC 5304(g)): ${usd(J.gsPayCap)} in ${S.startYear}, ` +
            `growing with the ${pct(J.annualRaise)} raise because level IV follows the GS across-the-board raise (5 USC 5318)` + (PSw.payCapFromYear !== null ? `; the cap applies from ${PSw.payCapFromYear}` : ''));
        }
      }
      md.push('');
    }
    for (const w of feds) {
      const F = PS(w).fers, P = FP[w];
      md.push(`### FERS${hasSp ? ` (${N(w).who})` : ''}`);
      bullet('Eligibility', `age ${EMP[w].retirementAge}, ${F.service} yrs, MRA ${ym(F.mra)} → ${F.rule} (${F.retirementType})`);
      if (F.retirementType !== 'none' && !P.useOpmEstimate) {
        bullet('Formula', F.specialFormula
          ? `(1.7% × min(service, 20) + 1% × rest) × ${usd(F.high3)} = ${usd(F.basicAnnuity)}/yr`
          : `${pct(F.multiplier)} × ${usd(F.high3)} × ${F.compService.toFixed(2)} yrs = ${usd(F.basicAnnuity)}/yr (1.1% only if 62+ with 20+ yrs at separation)`);
      }
      bullet('Age reduction', F.ageReduction > 0 ? `${pct(F.ageReduction)} (5%/yr under 62 at start)` : 'none');
      bullet('Survivor', `${electionText(F)}; reduction applies while the spouse is alive and stops after the spouse dies; survivor annuity base = annuity after any age reduction, with COLAs`);
      bullet('COLA', 'diet COLA (CPI ≤2% → CPI; 2–3% → 2%; >3% → CPI−1%), from the year after age 62 for regular retirees; survivor annuities always');
      if (F.supplementEligible) bullet('Supplement', `${usd(F.ss62Today)} today's $ inflated to ${PS(w).retireYear} × ${F.supplementYears}/40 (years of service, rounded) = ${usd(F.supplementMonthly)}/mo; ends at 62; earnings test $1 per $2 over the SS limit ($24,480 in 2026, indexed)`);
      md.push('');
    }
    if (nonFeds.some((w) => inp.otherPension[w].monthly > 0)) {
      md.push('### Other pension');
      bullet('Amount', "the monthly amount in today's dollars, inflated to the year it starts, then raised by its own COLA each year; after the holder's death the surviving spouse keeps the survivor share");
      md.push('');
    }
    md.push('### Social Security');
    bullet('Your FRA / factor', `${ym(P1.fraMonths / 12)}; claiming at ${ym(P1.claimAge)} = ${pct(P1.factor)} of PIA (−5/9% per month for 36 months early, −5/12% beyond; +2/3% per month delayed to 70)`);
    if (P2) bullet('Spouse FRA / factor', `${ym(P2.fraMonths / 12)}; claiming at ${ym(P2.claimAge)} = ${pct(P2.factor)} of PIA`);
    bullet('PIA growth', 'PIA (today\'s $) grows with inflation; benefits get COLA = inflation');
    if (P2) bullet('Spousal / survivor', 'spousal excess = max(0, 50% × other PIA − own PIA), reduced if started before FRA; survivor gets the larger of own benefit or the deceased\'s actual benefit (min 82.5% of PIA if claimed early), assumed to start at or after the survivor\'s FRA');
    bullet('Taxation of SS', 'provisional income = AGI excl. SS + 50% of SS; base $32k/$44k joint, $25k/$34k single (not indexed); up to 85% taxable');
    md.push('', '### Workplace plans, IRAs, RMDs and taxes');
    bullet('RMDs', `each person's at their own age (73 for births 1951–59, 75 for 1960+; yours start at ${S.rmdStartAge}), IRS Uniform Lifetime divisor (24.6 at 75) on the prior year-end traditional workplace-plan and IRA balances (a workplace plan's still-working exception does not apply to IRAs); Roth accounts have none; after a death the survivor owns the accounts and their age drives the RMDs`);
    bullet('Workplace-plan withdrawals', 'traditional-only or Roth-only withdrawals are allowed (5 CFR 1650 for the TSP; assumed for a 401(k)), so the two balances are separate steps in the withdrawal order; both earn the plan\'s return. Within each account type, the account of a spouse who can withdraw without a penalty comes first, then the older spouse\'s');
    bullet('Conversions and transfers', "at the start of the year after the RMDs, between one person's own accounts; conversions (traditional TSP / 401(k) or IRA → Roth) are ordinary income that year and their tax is paid from outside the converted money; transfers (Roth TSP / 401(k) → Roth IRA, traditional TSP / 401(k) → traditional IRA) are not taxed and carry their basis");
    bullet('IRA rules', '10% penalty on traditional IRA withdrawals before 59½ (the year you turn 60 is the first penalty-free year; conversions exempt); Roth IRA 5-year rules assumed met; Roth IRA withdrawals before 59½ beyond contributions and conversions (US ordering rules) are flagged, not taxed');
    bullet('Federal tax', 'IRS Rev. Proc. 2025-32 (2026): MFJ brackets 10/12/22/24/32/35/37% with tops $24,800 / $100,800 / $211,400 / $403,550 / $512,450 / $768,700; standard deduction $32,200 MFJ / $16,100 single, +$1,650 per spouse 65+ (MFJ) or +$2,050 (single); 2025–28 senior deduction $6,000 per person 65+; LTCG 0/15/20% stacked on ordinary income; NIIT 3.8%; brackets, standard deduction, 65+ amounts and LTCG breakpoints indexed at inflation minus the chained-CPI gap (IRC §1(f)(3) uses chained CPI, which runs below CPI), other amounts with inflation; no IRS rounding to $25/$50');
    bullet('Filing status', 'MFJ while both alive (including the year of the first death), single afterwards');
    bullet('Cash flow', 'each year: income → RMD → conversions and transfers → taxes → spending → shortfall withdrawals (money market first, then the withdrawal strategy, checking last) or surplus saved → growth (start-of-year flows). Conversion tax (the year\'s tax minus the tax with neither the conversion nor the withdrawals that pay for it) is paid from surplus, then the money market, brokerage, traditional plans and IRAs, Roth plans and IRAs, checking');
    bullet('Surplus', 'leftover money tops checking up to its target first, then the money market up to its limit (if surplus is kept there), and the rest is invested in brokerage; checking above its target moves to the money market, and money market above its limit moves to brokerage (except in settling-in years)');
    bullet('Brokerage investments', 'a regular taxable brokerage account holding stock and bond funds (money market funds belong in the money market); cost basis tracked at average cost: surplus deposits, one-time inflows and money market above the limit add basis; each withdrawal realizes gain = withdrawal × (1 − basis ÷ balance at the start of the year), taxed as a long-term gain (and abroad if gains are selected). After losses (balance below basis) no gain is realized and the extra basis offsets later gains; losses are not deducted from other income');
    bullet('Cash-flow check', '(non-salary income incl. RMDs + all withdrawals) − (spending + taxes paid from this cash flow + saved − unfunded), every year; must be ≈ $0. While working, salary, benefits spent with it and the tax on them are outside this flow (pre-retirement living costs are not modeled)');
    bullet('Withdrawal rates', 'all-in = net portfolio draw (every withdrawal incl. RMDs, minus amounts saved back) ÷ start-of-year portfolio; core = what the portfolio must supply for recurring spending + taxes beyond guaranteed income, excluding one-time events and the tax caused by Roth conversions and taxable one-time inflows, ÷ start-of-year portfolio');
    if (WD.bridgeBucket.enabled) bullet('Bridge bucket', `a deterministic projection without the bucket gives the planned net draws for the first ${WD.bridgeBucket.yearsCovered} retirement years. From ${WD.bridgeBucket.buildYearsBeforeRetirement} years before retirement the bucket is held at the present value of those draws at ${pct(WD.bridgeBucket.return)}; in the bridge years each year's net draw comes out of it first, it is not refilled, and any remainder rejoins the portfolio after the last bridge year. It overlays the accounts (their returns are blended by bucket ÷ invested balance), so tax treatment is unchanged, and it has zero volatility in Monte Carlo. Each Monte Carlo run funds the same planned bucket and spends it by that run's actual draws`);
    if (OTX.length) {
      bullet('State, local & foreign tax', "each tax counts the income types checked for it, by whose income it is (each spouse's accounts, pay, annuities and Social Security; " +
        'brokerage gains, interest and one-time income are joint and split evenly on separate returns); Social Security at its federally taxable amount; Roth withdrawals as ' +
        'their earnings share (pro rata) or in whole. It subtracts the deduction per return and the retirement-income exclusion per person, then applies the flat rate or ' +
        "the brackets; every amount is in today's dollars and grows with inflation less the tax's gap. A tax that credits federal tax is reduced by the federal tax times " +
        "its income's share of AGI, and federal tax on the same income is credited only once (no carryforward). Whole years only (no part-year residency).");
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
      const accts = planUsers.map((w) => acct(`${N(w).your} ${planName(w)}`, PLN[w].returns, V.beforeRetirement.workplacePlans, V.afterRetirement.workplacePlans));
      accts.push(acct('brokerage', BR.returns, V.beforeRetirement.brokerage, V.afterRetirement.brokerage));
      for (const w of WHO) {
        if (usesIra(w, 'traditional')) accts.push(acct(`${N(w).your} traditional IRA`, IRS[w].traditional.returns, V.beforeRetirement.traditionalIra, V.afterRetirement.traditionalIra));
        if (usesIra(w, 'roth')) accts.push(acct(`${N(w).your} Roth IRA`, IRS[w].roth.returns, V.beforeRetirement.rothIra, V.afterRetirement.rothIra));
      }
      md.push(`${num(Fx.runs)} runs per lifespan mode, seed ${Fx.seed}; lognormal returns by account (mean / SD before → after its holder retires: ` +
        accts.join('; ') + '; one shared market shock per year); ' +
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
        ['Ending balance, future $ (10th / 50th / 90th)', (m) => `${usd(m.endingBalance.p10)} / ${usd(m.endingBalance.p50)} / ${usd(m.endingBalance.p90)}`],
        ["After-tax inheritance, today's $ (10th / 50th / 90th)", (m) => `${usd(m.afterTaxReal.p10)} / ${usd(m.afterTaxReal.p50)} / ${usd(m.afterTaxReal.p90)}`],
        ['After-tax inheritance, future $ (10th / 50th / 90th)', (m) => `${usd(m.afterTax.p10)} / ${usd(m.afterTax.p50)} / ${usd(m.afterTax.p90)}`],
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
      md.push("| Year | p10 future $ | p50 future $ | p90 future $ | p10 today's $ | p50 today's $ | p90 today's $ |" + (mcSelKey === 'stochastic' ? ' Alive |' : ''),
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
      line('Lifetime state, local & foreign tax', (c) => usd(c.det.lifetimeOtherTax));
      line('Ending balance, future $ (deterministic)', (c) => usd(c.det.endingBalance));
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

    h2('Year-by-year projection (future dollars: the amounts paid each year)');
    const otc = OTX.some((e) => e.creditsFederalTax), adv = TX.mode === 'advanced';
    const interestOf = (r) => r.cashInterest + r.checking.interest, hasInt = Y.some((r) => interestOf(r) > 0.5);
    const planCol = planUsers.length === 1 ? planName(planUsers[0]) : 'plans', annCol = WHO.some((w) => !fed(w) && inp.otherPension[w].monthly > 0) ? 'Pensions' : 'FERS';
    md.push(`Columns: Earned = salaries + post-retirement earnings; ${annCol} = annuities to the living (${annCol === 'FERS' ? 'FERS' : 'FERS and other pensions'}); ${hasInt ? `Interest = money market${hasChk ? ' and checking' : ''} interest (start-of-year balance × its rate, paid out as taxable income); ` : ''}1x in / 1x out = one-time event inflows and outflows; Trad W = traditional ${plansTxt} withdrawals including RMDs (RMD = total RMDs)` + (iraT ? '; TIRA W = traditional IRA withdrawals including RMDs' : '') + (iraR ? '; RIRA W = Roth IRA withdrawals' : '') +
      (xferW.length ? '; Transfers = untaxed moves between accounts (Roth plan → Roth IRA, traditional plan → traditional IRA)' : '') + '; Brokerage W / MM W' + (hasChk ? ' / Chk W' : '') + ' = withdrawals from brokerage investments (stock and bond funds), the money market (money market funds, savings)' + (hasChk ? ' and checking' : '') + '; Brokerage gain = long-term gain in the brokerage withdrawal (the rest is cost basis); ' +
      'Spending = recurring spending + healthcare + one-time outflows; Other tax = state, local and foreign income tax (after any credit for federal tax); Saved = surplus to ' + (hasChk ? 'checking, ' : '') + 'the money market or brokerage; Unfunded = spending not covered; ' +
      (WD.bridgeBucket.enabled ? 'Bucket = bridge-bucket balance at year end (part of the invested balances, not extra money); ' : '') +
      (otc ? 'Credit = the federal tax credited against the other taxes; ' : '') +
      (adv ? 'Ord taxable = ordinary taxable income (AGI − deduction, excluding long-term gains; what the brackets apply to); Bracket = its federal rate; Headroom = taxable income left before the next bracket (unused deduction when below it); ' : '') +
      'Check = cash-flow check (0 when sources equal uses; ⚠ if off by more than $5); ' +
      `balances are end of year; Infl = cumulative inflation index at the start of the year (divide the year's flows by it for today's dollars, and its end-of-year balances by the next row's Infl; ${last.idxEnd.toFixed(3)} at the end of ${S.endYear}).`, '');
    const cols = ['Year', 'Ages', 'Phase', 'Earned', annCol, 'Surv ann', 'Supp', 'SS you', 'SS sp'].concat(hasInt ? ['Interest'] : [], ['1x in', '1x out', 'RMD', 'Trad W', 'Roth W']).concat(iraT ? ['TIRA W'] : [], iraR ? ['RIRA W'] : [], ['Brokerage W', 'Brokerage gain', 'MM W'], hasChk ? ['Chk W'] : [], ['Roth conv'], xferW.length ? ['Transfers'] : [])
      .concat(adv ? ['Ord taxable', 'Bracket', 'Headroom'] : [], ['Spending', 'Fed tax', 'Other tax'], otc ? ['Credit'] : [], ['Saved', 'Unfunded', 'MM'], hasChk ? ['Checking'] : [], ['Brokerage', `Trad ${planCol}`, `Roth ${planCol}`], iraT ? ['Trad IRA'] : [], iraR ? ['Roth IRA'] : [], ['Total'], WD.bridgeBucket.enabled ? ['Bucket'] : [], ['Check', 'Infl']);
    md.push('| ' + cols.join(' | ') + ' |', '|' + cols.map(() => ' --- ').join('|') + '|');
    for (const r of Y) {
      md.push('| ' + [
        r.year, `${r.ageYou === null ? '—' : r.ageYou}/${r.ageSpouse === null ? '—' : r.ageSpouse}`, r.phase, num(r.earned), num(r.pension), num(r.survivorAnnuity),
        num(r.supplement), num(r.ssYou), num(r.ssSpouse)].concat(hasInt ? [num(interestOf(r))] : [], [num(r.oneTimeIn), num(r.oneTimeOut), num(r.rmd), num(r.tradTotal), num(r.wRoth),
      ]).concat(iraT ? [num(r.ira.trad.withdraw + r.ira.trad.rmd)] : [], iraR ? [num(r.ira.roth.withdraw)] : [], [num(r.wTaxable), num(r.basis.taxableGain), num(r.wCash)],
        hasChk ? [num(r.checking.withdraw)] : [], [num(r.conversion)], xferW.length ? [num(xferW.reduce((a, w) => a + (r.moves[moveKey(w)] || 0), 0))] : [], adv ? [num(r.ordTaxable), pct(r.marginal, 0), r.bracket && r.bracket.headroom !== null ? num(r.bracket.headroom) : '—'] : [],
        [num(r.spending), num(r.federalTax), num(r.otherTax)], otc ? [num(r.otherCredit)] : [], [num(r.deposit), num(r.shortfall), num(r.balCash)], hasChk ? [num(r.checking.bal)] : [], [num(r.balTaxable),
        num(r.balTrad), num(r.balRoth)], iraT ? [num(r.ira.trad.bal)] : [], iraR ? [num(r.ira.roth.bal)] : [], [num(r.total)], WD.bridgeBucket.enabled ? [num(r.bucket)] : [], [Math.abs(r.cashCheck) <= 5 ? '0' : `${num(r.cashCheck)} ⚠`, r.idx.toFixed(3)]).join(' | ') + ' |');
    }

    h2('Model limitations (not modeled or simplified)');
    [
      'Annual steps; no partial years, birth months, or prorated first COLA. The current year counts as a full year.',
      'PIA grows with inflation rather than a wage-indexed earnings history. No SS earnings test for early claimers, no survivor-benefit reduction before the survivor\'s FRA, no family maximum.',
      'While you work, the salaries are assumed to cover living costs; spending starts when you retire, and a spouse who works longer adds take-home pay. Pre-retirement spending is not modeled.',
      'A non-federal workplace plan is a generic 401(k)-style plan: employer contributions follow the entered formula, and plan-specific rules (vesting, in-service withdrawals, 457(b) penalty exceptions) are not modeled. A non-federal pension is a fixed monthly amount with a fixed COLA and survivor share.',
      'Pay: GS step increases assume acceptable performance and the standard waiting periods; no promotions, quality step increases or grade changes, and GS-1 and GS-2\'s uneven steps are not modeled.',
      'Each account has its own expected return and volatility before and after retirement (a workplace plan\'s traditional and Roth balances share one), and one market shock per year moves them all. Monte Carlo uses lognormal annual returns (no fat tails, no return–inflation correlation).',
      'IRAs: Roth IRA 5-year rules are assumed met; Roth IRA contributions ignore the income limit; moves out of a workplace plan are assumed allowed when made (the TSP permits them after separation or from 59½; 401(k) rules vary); a foreign country is assumed not to tax direct rollovers.',
      'Stochastic mortality uses the SSA 2023 period life table: no projected mortality improvement, no health or wealth adjustment, and the two spouses\' deaths are independent.',
      'Adaptive rules (contingent SS claiming, guardrails, deferrable events) run only in Monte Carlo. They compare the run\'s start-of-year real portfolio with the deterministic projection, which uses mean returns, so the median run trails it; thresholds near 100% trigger in most runs. Beyond the deterministic projection\'s last year (longer stochastic lives) the guardrail state is held.',
      'Monte Carlo shortfall causes are split pro rata between recurring spending and one-time outflows in each unfunded year.',
      'After-tax inheritance applies one flat heirs\' rate to traditional plan and IRA money, assumes a step-up in basis for brokerage investments, and ignores estate/inheritance taxes, the timing of heirs\' withdrawals (10-year rule) and the value of real estate.',
      'The bridge bucket is an overlay: it changes returns (a fixed-return slice of the invested balance) but not which account is withdrawn. Real TSP withdrawals come out pro rata across funds, so "spend from the G Fund first" means withdraw and then rebalance. Its size comes from the deterministic plan, so in Monte Carlo it can run out early or have money left over.',
      'The cash-flow check covers the portfolio cash flow only: salary-funded living costs before retirement are not modeled, so they are outside it.',
      'The 10% early-withdrawal penalty on workplace-plan money taken before 59½ after separating before 55 is flagged in a warning but not added (the traditional IRA penalty is added). No TSP installment or annuity options, and no annual tax on brokerage dividends; brokerage gains use average cost basis (no choice of tax lots, no deduction of capital losses).',
      'No itemized deductions, credits, AMT, or payroll taxes. State tax is a flat rate. Medicare Part D, Medigap, and long-term care costs are not modeled.',
      'FERS: no death-in-service benefits, deposits/redeposits, part-time proration, or tax-free recovery of employee contributions.',
      'Planning tools score candidates with Monte Carlo at one seed and a limited number of runs; differences of about one run (1 ÷ runs) are noise. The optimizer searches whole-year claim ages and a fixed set of conversion windows, claim ages first, then conversions; it is a guide, not a proof of optimality.',
      'Events tied to a person are skipped after that person dies; household events (and the plan’s spending) are not tied to anyone.',
      "State, local and foreign taxes are simplified: the income types you check, a deduction, an optional retirement-income exclusion, and a flat rate or brackets in today's US dollars (currency moves show up only through the growth gap); no itemized deductions, credits or special rates for gains, no part-year residency, and the federal credit (when chosen) is pro rata by AGI, once, with no carryforward. Which treaty article governs TSP and Roth money abroad is not settled; the income checkboxes bracket it.",
      'Checking and the money market earn only their interest rates, so their real value erodes when that is below inflation. The model works in whole years: checking is held at its target and does not rise and fall within the year.',
    ].forEach((t) => md.push(`- ${t}`));

    h2('Questions for the reviewer');
    const q = [];
    if (hasSp) {
      const gap = H.you.birthYear - H.spouse.birthYear;
      const elections = feds.map((w) => { const F = PS(w).fers; return `${N(w).your} ${FP[w].survivorElection} FERS survivor election (a survivor annuity of ${dual(F.initialAnnuity * F.survivorPct / 12, F.pensionStartYear, '/mo')} at the start)`; });
      q.push(`Survivor protection: your spouse is ${Math.abs(gap)} years ${gap > 0 ? 'older' : 'younger'} than you. ` + (elections.length
        ? `Is ${list(elections)} adequate, given that FEHB continues only with a survivor annuity, and given the Social Security survivor benefit?`
        : 'Is the survivor covered well enough by Social Security survivor benefits, any pension survivor share and the inherited accounts?'));
      q.push(`Claiming: you claim at ${ym(P1.claimAge)} and your spouse at ${ym(P2.claimAge)}. Since the survivor keeps the larger benefit, is this the best pairing for joint lifetime income and survivor protection?`);
    } else {
      q.push(`Claiming: is claiming Social Security at ${ym(P1.claimAge)} sensible given the assumed lifespan of ${H.you.lifespan}?`);
    }
    if (feds.some((w) => PS(w).fers.supplementEligible)) q.push(`The FERS supplement contributes about ${usd(sum(Y, (r) => r.supplement))} in total. How exposed is the plan if Congress eliminates it?`);
    if (convW.length && S.totalConversions > 0.5) {
      q.push(`The plan converts ${usd(S.totalConversions)} from traditional to Roth (${convW.map(moveText).join('; ')}). Are the size and timing right, given the brackets before and after Social Security and RMDs, IRMAA's two-year lookback${OTX.some((e) => e.fromYear > Y0) ? `, and ${list(OTX.filter((e) => e.fromYear > Y0).map((e) => `${e.name || 'a tax'} from ${e.fromYear}`))}` : ''}?`);
    } else if (res.warnings && res.warnings.some((w) => w.code === 'rmdBracket')) {
      q.push('RMDs push income into a higher bracket. Would Roth conversions during the low-income years before RMDs (and before Social Security) lower lifetime taxes, and how large should they be?');
    }
    if (S.peakCoreWithdrawalRate > 0.04) q.push(`The peak core withdrawal rate is ${pct(S.peakCoreWithdrawalRate)} in ${S.peakCoreWithdrawalYear} (all-in ${pct(S.peakWithdrawalRate)} in ${S.peakWithdrawalYear}). How large is the sequence-of-returns risk, and what buffer or spending rule would you add?`);
    {
      const rets = planUsers.map((w) => `${N(w).your} ${planName(w)} ${beforeAfter(PLN[w].returns)}`).concat([`brokerage ${beforeAfter(BR.returns)}`]);
      for (const w of WHO) {
        if (usesIra(w, 'traditional')) rets.push(`${N(w).your} traditional IRA ${beforeAfter(IRS[w].traditional.returns)}`);
        if (usesIra(w, 'roth')) rets.push(`${N(w).your} Roth IRA ${beforeAfter(IRS[w].roth.returns)}`);
      }
      q.push(`Are these expected returns reasonable for the likely allocations and horizon: ${list(rets)}; with ${pct(inp.inflation.rate)} inflation?`);
    }
    if (MM.keepSurplus) q.push(`Surplus is held in the money market up to ${usd(MM.moveToBrokerageAbove)} (today's $) at a ${pct(MM.yield, 2)} yield. Is that buffer size sensible, and what is the cost of the cash drag?`);
    if (abroad) {
      q.push(`Cross-border tax (${(OTX.find((e) => e.creditsFederalTax) || {}).name || 'country of residence'}): how will the residence country tax traditional TSP / 401(k) and IRA withdrawals, Roth withdrawals (contributions vs earnings) and Roth conversions for a US citizen who is a tax resident there? Which treaty articles apply (US–Mexico art. 19 pensions vs art. 20 government service, and the saving clause), and can a US foreign tax credit be claimed on US-source income?`);
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
