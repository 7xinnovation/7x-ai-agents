# One checklist slot, up to eight partners

*29 October 2026. For EPGL. One question, with what we have done in the meantime.*

## The question

Your 2.0 catalogue has **one** `Copy of Passport` and **one** `Copy of Emirates ID`
for the whole application. A licence application can have up to **eight partners**,
and we collect a passport and an Emirates ID from each of them.

`Document_Type` is the slot on your side. Sending partner 2's passport under
`Copy of Passport` after partner 1's would leave partner 2's file standing where
partner 1's was, and the application would arrive holding one passport with no
sign the others were ever sent.

**So we send partner 1's and hold the rest back.** Not sending a document is
visible and recoverable; silently overwriting one is neither.

## Why we think that is what would happen

Your contract 2.0.0 is explicit about the 1.x equivalent:

> "A second call with the same `label__c` under the same parent UPDATES the
> existing document."

and your 16 September answer to section 4 of the LR-37377 note said the same
thing from the other side — that the checklist carries **three** passport names
precisely so that files do not overwrite each other:

> "for passport we have 3 passport document names: Passport, Passport
> copy-Partner and Passport (Of All Branch Partners)"

We have not tested the overwrite on 2.0, because the test would be destructive
on a real application. If `Document_Type` behaves differently from `label__c` —
if a second call creates a second record rather than replacing the first — then
this question answers itself and we will send all eight.

## What we need

Either of these works for us:

1. **Per-partner document types on the 2.0 checklist**, in whatever form you
   prefer — `Copy of Passport - Partner 2`, or one name plus a partner number
   field on `EPG_Document__c`. We will send whatever you name them.
2. **Confirmation that repeated sends under the same `Document_Type` create
   separate records** rather than replacing. Then nothing needs to change on
   your side and we send all of them.

A related one while you are looking: are `Copy of Passport` and `Copy of
Emirates ID` meant to be **the owner's alone**, with the other partners' papers
not expected at this stage? If so the answer is simpler still — we send partner
1's and stop, which is exactly what happens today, and we will say so to the
applicant rather than collecting documents nobody wants.

## What we changed on our side today

Three documents were being asked for twice, because our own slots and the slots
generated from your catalogue were separate rows that nothing reconciled: the
Memorandum of Association, partner 1's passport and partner 1's Emirates ID. The
applicant uploaded the same PDF twice and the second copy was the one that
reached you.

They are now one slot each, carrying your catalogue's name, so the applicant is
asked once and the file reaches your checklist under the name your checklist
knows. Staging only, today.

The trade licence is untouched and is a separate small question: ours is one
slot, and your catalogue has two — `Trade Licence / Initial Name Approval` for
the CEP30 products and `Trade Licence` for the other four. We will condition
ours the same way once we know whether a CEP30 applicant who already holds a
full trade licence should still be filed under the first name.
