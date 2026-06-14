export default function Home() {
  return (
    <main className="page">
      <h1>Dialog Platform</h1>
      <p>
        Multi-tenant conversational AI. Each agent is defined as data (branding, languages, journeys,
        guardrails, integrations) and ships as a floating widget that expands into a full-page split
        screen: chat on the left, a realtime case builder on the right.
      </p>

      <h3>Try it</h3>
      <p>
        <a href="/admin">Admin console — generate & configure agents →</a>
        <br />
        <a href="/embed/epgl-dialog?embedded=0">Open the EPGL full-page experience →</a>
        <br />
        <a href="/demo">Open a host page with the floating widget →</a>
      </p>

      <h3>Embed snippet</h3>
      <pre>{`<script src="HOST/dialog.js"
        data-agent="epgl-dialog"
        data-host="HOST"
        data-locale="en"></script>`}</pre>

      <h3>Add another company</h3>
      <p>
        Insert one row in <code>agents</code> with a new <code>AgentDefinition</code> — no code changes.
        See <code>packages/db/src/seed.ts</code> for the EPGL example.
      </p>
    </main>
  );
}
