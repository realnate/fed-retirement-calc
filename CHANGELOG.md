# Changelog

## First public release (October 2026)

- **Public domain** under The Unlicense (`LICENSE`). Use it at your own risk; it is not financial, tax, investment or
  legal advice.
- **A made-up default household** (defaults revision 9): a GS-12, step 5 in the Rest of U.S. locality, ten years into
  federal service and retiring at 62 with 28 years; a working spouse; $150k in the TSP; Social Security at 67 for
  both. See "Default household" in the README.
- **GS step increases from your current step.** Employment asks for your current GS step (default 5) and when the next
  one is due. Steps then follow the within-grade waiting periods (5 CFR 531.405: a year apart up to step 4, two years
  up to step 7, three years up to step 10), and each adds 1/30 of the step-1 rate. This replaces the flat yearly
  "step bump", which overstated pay near the top of the grade (about +18% by retirement at step 9, against one
  real step of 2.6%) and understated it near the bottom. The year table has a GS step column, and the narrative and
  review packet list the step dates. Promotions are not modeled.
- **GS pay cap.** Pay with locality is held at Executive Schedule level IV ("GS pay cap this year", $197,200 in 2026),
  which grows with the annual raise because level IV follows the GS across-the-board raise by law. Step increases add
  nothing above it, the High-3 uses the capped pay, and a note says when it starts to apply.
- **Fixes:**
  - The 3.8% net investment income tax now includes money market and checking interest, not only gains (IRC §1411).
    It applies only above $250,000 of MAGI (joint) or $200,000 (single). Those thresholds aren't indexed, so it can
    matter decades out.
  - Optimizer: the median inheritance in today's and future dollars comes from the same middle Monte Carlo run (the
    middle two averaged for an even number of runs). Taken separately, the two medians could come from different
    runs.
  - Optimizer note: it says whether the median is lower or higher than the "Left to heirs" card, with the reasons
    that apply (it always said lower), and when the amount is measured (at the last death with stochastic
    lifespans, at the end of the plan with fixed ones). Today's dollars are labeled with the year of the inputs the
    result came from, not the current inputs. The review packet says the same.
  - Optimizer tables: a cell's today's and future amounts no longer run together when copied or read aloud.
- **Share links** made with earlier defaults revisions are no longer decoded: they store only differences from
  defaults that are no longer kept, and the app says so. Plan files, saved scenarios and the autosaved working copy
  hold every setting and load as before, including files in schemas 1–8.
- **Tests: 110.** The test households are made up and frozen in the test file, so changing the defaults doesn't move
  their numbers. New tests cover the NIIT on interest, the same-run median, GS step increases and the pay cap.

### Behavior differences for existing saved plans
- Federal tax rises by 3.8% of interest in years whose MAGI is above the NIIT threshold.
- A flat step bump in an older file is dropped: with step increases on, the plan uses GS steps from step 5 until you
  set your step, so its salary, High-3 and annuity change. Importing an older-format file says so.
- Salaries that reach the GS pay cap are now held at it, which lowers their projected pay and High-3.
