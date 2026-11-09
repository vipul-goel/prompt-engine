# Domain pack: research and analysis

Use this pack for prompts that ask a model to find, compare, evaluate, summarize or analyze information: market or competitor research, literature reviews, comparisons, explainers, data analysis, reports and recommendations. Signals: research, compare, analyze, evaluate, summarize, report, sources, data, pros and cons, "what's the best", "should we".

## Must-haves in the enhanced prompt

Research prompts fail by sounding authoritative while being wrong or out of date, so build in honesty:

1. **The question and the decision** — what exactly must be answered, and what the answer will be used for.
2. **Source policy** — which sources count (provided documents first, then primary or official sources), and how secondary sources are labelled.
3. **Recency** — today's date and an "as of" date for the findings. For fast-moving topics, tell the model to check current information, or to say it can't.
4. **Citations and uncertainty** — cite non-obvious claims; label confidence; say "not enough evidence" rather than guess; never invent sources, quotes or statistics.
5. **A stop rule** — when the answer is good enough, so the model neither stops too early nor wanders.

## Checklist

★ marks the recommended default.

| # | Item | Example question | ★ Default |
|---|---|---|---|
| 1 | Question and decision | What decision will this inform, and what exactly should be answered? | Restate it as one precise question plus 2–3 sub-questions |
| 2 | Deliverable and depth | A quick answer, a one-page brief, or a full report? | Executive summary plus structured findings |
| 3 | Audience | Who will read it, and how expert are they? | An informed non-specialist; define jargon |
| 4 | Scope | Time window, regions, segments, what to include or exclude? | State the scope chosen; use the most recent available data |
| 5 | Source policy | Only your documents, or outside sources too? Preferred or forbidden sources? | Provided documents first; prefer primary or official sources; label secondary ones |
| 6 | Recency | How current must it be? | Include today's date; give an "as of" date; check anything that may have changed |
| 7 | Citations | Which citation style, and cite every claim? | Cite every non-obvious factual claim; drop claims that can't be supported |
| 8 | Uncertainty | How should uncertainty be shown? | High, medium or low confidence labels; "insufficient evidence" instead of guessing |
| 9 | Method and criteria | A framework or comparison criteria to use? | Define the criteria up front and name any framework used |
| 10 | Definitions and units | How are key metrics defined (units, currency, gross or net)? | Define each metric and unit and state assumptions |
| 11 | Counter-evidence | Should it test a hypothesis or look for disconfirming evidence? | Weigh competing explanations; include the strongest counterarguments |
| 12 | Conflicting sources | Which source wins when sources disagree? | Provided documents win; flag conflicts rather than resolving them silently |
| 13 | Output structure | Preferred sections, tables or length? | Summary, findings, evidence, caveats, implications |
| 14 | Recommend or describe | Should it recommend actions, or stay descriptive? | Keep findings and recommendations separate; recommend only if asked |
| 15 | Show the work | Should it show calculations, queries or search terms? | Show key calculations and sources briefly, as an explanation for the reader |
| 16 | Effort and stop rule | Exhaustive survey or a good-enough answer? | Stop once the core question can be answered with cited evidence; list remaining gaps |
| 17 | Sensitive data | Confidential or personal data constraints? | Use only the personal data needed; respect stated confidentiality |

For data analysis, also ask about the dataset (paste a sample or the columns), the questions to answer, the tools or language for the analysis, and how results should be shown (tables, charts, plain summary).

## Example

Rough prompt: "find out if solar panels are worth it for my house" (quick mode)

Enhanced prompt (excerpt):

```text
# Goal
Find out whether solar panels are worth it for a house in [[country or region]], and recommend whether to go ahead, wait or drop the idea.

# Context
- Today's date: [[today's date]]. Panel prices, electricity rates and subsidy rules change, so check current sources rather than relying on memory, and give an "as of" date.
- Electricity use: [[yearly electricity use]]. Assume the owner lives in the house and the roof is in good condition unless told otherwise.

# Method
Work out three things, each as a range: the cost to install a system, the yearly saving, and the years until it pays for itself. Define each term and unit first, and stop once each range rests on a cited source.

# Sources and honesty
- Prefer government, regulator and utility pages, and say when a figure comes from an installer or a manufacturer.
- Cite a source for every price, rate and subsidy. If something can't be verified for this region, say so instead of guessing.

# Output
A one-paragraph recommendation first, then a table of the three ranges with their sources, then caveats and what would change the recommendation.
```
