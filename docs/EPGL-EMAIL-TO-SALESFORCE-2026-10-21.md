**Subject:** EPG Licensing — tested, status push ready, three questions

---

Hi Hussein,

Thank you for the pack. We have tested all of it against the NewLaw sandbox and it works as you describe — document slots, agent channel, the HTTP 404, licence retrieval and the PDF, and the application id.

We also confirmed the two that needed writing to the sandbox: a re-sent create returned the same application (`LR-54039`), and a 6.27 MB file uploaded via `ContentVersion` and attached to its slot.

**Status push — ready for your test event.**

Endpoint: `POST https://7xagents.7x-lab.com/api/epgl/status`

It is built exactly to the spec we sent you, so your signature should verify as-is. The secret is configured our side; we will send it by one-time link rather than email — just tell us which address.

**Three things back to you:**

1. **The catalogue still asks for the application id.** `applicationFields` still lists `applicationId__c` as `required: yes`, described as the portal's id. We build our application form from the catalogue, so as it stands we would ask the applicant to type one in. Is it coming out, or should we ignore it?

2. **Failures carry your success code.** Both a 200 and a 404 return `"code": "RTA-S-0000"`. The HTTP status is right, so nothing is blocked — but the code field cannot be used to tell them apart.

3. **The credentials are in the pack again**, across seven files, and the previous pack's still authenticate. Could you rotate them, and send credentials separately from the specs in future?

One housekeeping note: our tests created a company called `7X TEST - DO NOT PROCESS - 20261021A` — please clear it down when convenient.

Thanks again,

Emre
