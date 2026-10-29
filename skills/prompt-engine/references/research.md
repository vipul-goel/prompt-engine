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

Rough prompt: "compare the best vector databases for my startup" (quick mode)

Enhanced prompt (excerpt):

```text
# Goal
Compare vector databases for a startup choosing one for a production retrieval-augmented generation (RAG) feature, and recommend the best fit for the constraints below.

# Context
- Today's date: [[today's date]]. Vector databases change quickly, so check current documentation and pricing pages rather than relying on memory, and give an "as of" date.
- Assume a small team with no dedicated database administrator and fewer than [[number]] vectors at launch unless told otherwise.

# Method
Compare 4–6 widely used options on: hosting model (managed or self-hosted), cost at our scale, query latency, filtering support, operational effort, and lock-in. Define each criterion before scoring.

# Sources and honesty
- Prefer official documentation and published benchmarks, and say who ran each benchmark.
- Cite a source for every pricing or performance claim. If something can't be verified, say so instead of estimating.

# Output
A one-paragraph recommendation first, then a comparison table, then caveats and what would change the recommendation.
```
