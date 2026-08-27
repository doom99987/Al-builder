# Draft clauses — automated build tools & support

Drafts for review. **Nothing here has been applied to the live site.** Written by
Claude, not by a lawyer — read them as a starting point you'd be comfortable
having reviewed, not as finished legal work.

Delete this file once you've used it.

---

## Where these go, and why

Both paragraphs are written to be **appended to the end of section 19,
DISCLAIMER**, in `html/terms.html`.

That placement is deliberate. Adding a new numbered section would mean
renumbering `26. CONTACT US` and editing the table of contents to match — two
more places to get wrong, in a generated file. Appending to section 19 needs one
paste, changes no numbering, and puts the text exactly where a reader (or a
court) would look for it.

**On the ALL CAPS question:** section 19's existing text is capitalised because
US law (UCC §2-316) wants a warranty disclaimer to be *conspicuous*, and caps is
the traditional way to do that. The blanket disclaimer already in section 19 does
that job. These two paragraphs are supplementary specificity sitting underneath
it, so they're in sentence case with a bold lead-in — readable, and still
conspicuous by any modern reading. If you'd rather match the surrounding caps,
uppercase them; nothing else changes.

---

## Clause 1 — automated build tools

### Plain English (this is the part to actually read)

> **Automated build tools.** Parts of the Services — including the build maker,
> the damage calculator, and any feature described as "AI" — are automated tools
> that run entirely in your own browser. They produce estimates from a stored
> snapshot of game data and a set of stated assumptions, not from the live game.
> That snapshot may be incomplete, out of date, or wrong, and the game itself
> changes without notice. Any build, number, rotation, or recommendation these
> tools produce is a suggestion for you to evaluate, not advice and not a
> statement of fact about the game. You are solely responsible for what you
> choose to do in the game as a result, including any loss of in-game items,
> currency, levels, or progress. We do not guarantee that any output is accurate,
> optimal, achievable, or currently valid. These tools do not transmit what you
> enter into them to us or to any third party; they run locally on your device.
> Saving or sharing a build is a separate feature, covered by our Privacy Notice.

**Why each part is there**

| Sentence | Doing what |
|---|---|
| "run entirely in your own browser" | True today, and it's the fact that keeps this out of scope of the generative-AI transparency laws. Also the reason no privacy-policy change is needed. |
| "stored snapshot… not from the live game" | The single most likely complaint. Pre-empts it in your own words. |
| "suggestion… not advice" | Keeps it clear of anything that could be read as a professional or reliance-inducing recommendation. |
| "solely responsible… loss of in-game items" | Names the actual harm someone would come to you about. Generic disclaimers get read narrowly; named ones don't. |
| "do not transmit what you enter" | A real promise — so it has to stay true. If the AI ever calls a server, this sentence must be removed in the same commit. |

### Paste-ready HTML

```html
<div class="MsoNormal" style="line-height: 1.5; text-align: left;"><br></div><div class="MsoNormal" data-custom-class="body_text" style="line-height: 1.5; text-align: left;"><span style="font-size:11.0pt;line-height:115%;font-family:Arial;Calibri;color:#595959;"><strong>Automated build tools.</strong> Parts of the Services &mdash; including the build maker, the damage calculator, and any feature described as &ldquo;AI&rdquo; &mdash; are automated tools that run entirely in your own browser. They produce estimates from a stored snapshot of game data and a set of stated assumptions, not from the live game. That snapshot may be incomplete, out of date, or wrong, and the game itself changes without notice. Any build, number, rotation, or recommendation these tools produce is a suggestion for you to evaluate, not advice and not a statement of fact about the game. You are solely responsible for what you choose to do in the game as a result, including any loss of in-game items, currency, levels, or progress. We do not guarantee that any output is accurate, optimal, achievable, or currently valid. These tools do not transmit what you enter into them to us or to any third party; they run locally on your device. Saving or sharing a build is a separate feature, covered by our Privacy Notice.</span></div>
```

---

## Clause 2 — no guaranteed support

### Plain English

> **No guaranteed support.** The Services are a free, unofficial project
> maintained in the operator's own time. We provide no support, service level,
> uptime, or response-time guarantee of any kind. You can reach us at
> arcanelineagebuilder@gmail.com and we read what we can, but except where the
> law requires us to respond — for example a privacy request described in our
> Privacy Notice — we are under no obligation to reply to any message, to fix any
> bug, to restore any lost account or data, or to keep any feature available.
> Features may change, break, or be removed at any time without notice.

**The carve-out matters.** "We don't have to reply to anything" would be both
unenforceable and misleading, because you *do* have a legal duty to answer GDPR
and US state privacy requests — your Privacy Notice promises it in writing, in
several places, with an appeals process. The exception keeps the clause honest
and keeps it standing.

### Paste-ready HTML

```html
<div class="MsoNormal" style="line-height: 1.5; text-align: left;"><br></div><div class="MsoNormal" data-custom-class="body_text" style="line-height: 1.5; text-align: left;"><span style="font-size:11.0pt;line-height:115%;font-family:Arial;Calibri;color:#595959;"><strong>No guaranteed support.</strong> The Services are a free, unofficial project maintained in the operator&rsquo;s own time. We provide no support, service level, uptime, or response-time guarantee of any kind. You can reach us at arcanelineagebuilder@gmail.com and we read what we can, but except where the law requires us to respond &mdash; for example a privacy request described in our Privacy Notice &mdash; we are under no obligation to reply to any message, to fix any bug, to restore any lost account or data, or to keep any feature available. Features may change, break, or be removed at any time without notice.</span></div>
```

---

## How to insert both

In `html/terms.html`, find this string — it appears exactly once, and it is the
last line of section 19 before the `20. LIMITATIONS OF LIABILITY` heading:

```
AND EXERCISE CAUTION WHERE APPROPRIATE.</span></div>
```

Paste **clause 1's HTML, then clause 2's HTML**, immediately after that closing
`</div>`. Both snippets already begin with their own `<br>` spacer, so the
spacing stays consistent with the rest of the document.

Then bump the "Last updated" date near the top of the file — currently
`May 09, 2026`. It's inside a `<bdt class="question"><strong>` tag.

---

## In-panel line

The WIP banner is dismissible by design, so the permanent wording belongs in the
subtitle underneath it — `js/build-ai.js`, the `bai-sub` paragraph.

**Current:**

> Ask for a build. It is computed with the builder's own maths — no guessing and
> no API. Every request returns something, and it will tell you what it had to
> assume.

**Proposed — one sentence added to the end:**

> Ask for a build. It is computed with the builder's own maths — no guessing and
> no API. Every request returns something, and it will tell you what it had to
> assume. **Everything here is an estimate from a stored copy of the game's
> numbers, not the live game — check a build before you spend anything on it.**

This is the line that does the most practical good. It's always visible, it's in
plain language a 13-year-old reads without effort, and it sets the expectation at
the moment of use rather than in a document nobody opens. Courts care about
conspicuous notice at the point of use; so do users.

Say the word and I'll make that edit — it's a one-line change to the string at
`js/build-ai.js:156`.

---

## Not covered here

The three things worth more attention than any of the above are untouched:

1. The Privacy Notice promises a cookie/ads consent banner that doesn't exist in
   the code, while AdSense loads unconditionally at `index.html:13`.
2. The Privacy Notice asserts users are 18+, on a fan site for a Roblox game.
3. Your home address is published in section 14 of the Privacy Notice.

Those are the ones I'd put in front of an actual lawyer.
