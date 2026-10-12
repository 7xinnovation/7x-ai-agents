import './chat.css';
import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import {
  TOKENS, Orb, Turn, UserMsg, Field, Check, ClickCursor, enterStyle, typed, camera, eased,
  TranslateIcon, MoonIcon, SignInIcon, CheckUserIcon, NewChatIcon, MicIcon, SendIcon,
  UploadIcon, FileIcon, CheckIcon, CheckCircleIcon, ListIcon, ChecksIcon,
} from './parts';

export const EPGL_FPS = 30;
export const EPGL_DURATION = 980;

// Emirates Post Group Licensing (EPGL): applying for a new courier / postal
// activity licence. Documents-first — the trade licence is read to auto-fill
// the company details; payment is requested by EPGL only after their review.
const GREETING = "I can help you apply for a new courier licence with Emirates Post Group Licensing, renew an existing licence, or answer a licensing question. How can I help?";
const A_ASK = "Let's start with your documents. Upload your Trade License and I'll read the company details for you.";
const A_EXTRACT = "I've read your Trade License and captured the company details. Take a look on the right.";
const A_REVIEW = "Please review the auto-filled details, tick the declaration, and I'll submit your licence application.";
const A_DONE = "Submitted for review. Your courier licence application is with EPGL — reference EPGL-2026-04-8842. After the document review, EPGL will issue the payment request for the licensing fee.";

const DUR = {
  greetType: [10, 72] as const,
  startersAt: 78,
  clickIssue: 116,
  uIssue: 122,
  aAsk: 150,
  aAskType: [168, 236] as const,
  uploadAt: 244,
  clickUpload: 302,
  uploadedAt: 318,
  aExtract: 342,
  aExtractType: [392, 470] as const,
  fieldsAt: 412,
  aReview: 486,
  aReviewType: [486, 540] as const,
  declAt: 548,
  clickCheck: 606,
  checkedAt: 612,
  clickConfirm: 664,
  aSubmit: 690,
  aSubmitType: [740, 822] as const,
  submitAt: 762,
  outroAt: 930,
};

export const EpglDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const authed = frame >= DUR.uploadedAt; // recognised once the licence is read
  const uploaded = frame >= DUR.uploadedAt;
  const hasFields = frame >= DUR.fieldsAt;
  const checked = frame >= DUR.checkedAt;
  const submitted = frame >= DUR.submitAt;
  const showStarters = frame >= DUR.startersAt && frame < DUR.uIssue;
  const showPanel = uploaded;

  const progressPct = interpolate(
    frame,
    [DUR.uploadedAt, DUR.uploadedAt + 16, DUR.fieldsAt, DUR.fieldsAt + 20, DUR.clickConfirm, DUR.clickConfirm + 16, DUR.submitAt, DUR.submitAt + 24],
    [0, 25, 25, 55, 55, 78, 78, 100],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const pressed = (click: number): React.CSSProperties => ({ position: 'relative', ...(Math.abs(frame - click) < 5 ? { transform: 'scale(0.98)' } : {}) });

  // Eased so the vertical glide stays smooth under the zoom. Fewer, well-spaced
  // keyframes than before — the content settles between moves.
  const scrollY = eased(
    frame,
    [0, 300, 350, 460, 540, 640, 700, 760, 980],
    [0, 0, 40, 150, 250, 300, 320, 400, 400],
  );

  // A few calm, eased moves: a look at the upload, the extraction filling the
  // panel, and the declaration — otherwise near-neutral.
  const { z: zc, tx: camTx, ty: camTy } = camera(frame, [
    [0, 1.0, 800, 500],
    [110, 1.0, 800, 500],     // greeting / starters
    [240, 1.08, 640, 470],    // ease toward the upload widget
    [332, 1.08, 640, 470],
    [362, 1.12, 1050, 440],   // panel extraction reveal (right)
    [470, 1.12, 1050, 440],
    [520, 1.06, 700, 500],
    [560, 1.13, 640, 560],    // declaration + confirm
    [690, 1.13, 640, 560],
    [730, 1.0, 800, 500],     // pull wide for the reference
    [980, 1.0, 800, 500],
  ]);

  const outro = interpolate(frame, [DUR.outroAt, EPGL_DURATION - 4], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const intro = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: '#e9edf3', overflow: 'hidden' }}>
      <style>{`
        .dlg-msg,.dlg-starters,.dlg-starter,.dlg-field,.dlg-card,.dlg-cards .dlg-card-opt,
        .dlg-summary,.dlg-paycard,.dlg-reference,.dlg-case,.dlg-empty-ghost,.dlg-chat-upload,
        .dlg-toggles,.dlg-progress-fill,.dlg-header-progress,.dlg-status,.dlg-doc-status{animation:none!important;}
        .dlg-messages{display:block!important;}
        .dlg-messages::-webkit-scrollbar{width:0!important;}
        *:focus,*:focus-visible{outline:none!important;box-shadow:none!important;}
        textarea{caret-color:transparent;}
      `}</style>

      <div style={{ position: 'absolute', inset: 0, transformOrigin: '0 0', transform: `translate3d(${camTx}px, ${camTy}px, 0) scale(${zc})` }}>
        <div className="dlg-root" data-theme="light" dir="ltr" style={{ ...TOKENS, opacity: intro * outro }}>
          <header className="dlg-header">
            <div className="dlg-brand">
              <Img className="dlg-header-logo" src={staticFile('aisha-onlight.jpg')} alt="Aisha" />
            </div>
            <div className="dlg-actions">
              <button className="dlg-iconbtn lang"><TranslateIcon /><span className="dlg-iconbtn-tag">عربي</span></button>
              <button className="dlg-iconbtn"><MoonIcon /></button>
              <span className="dlg-actions-sep" />
              {authed ? (
                <span className="dlg-identity"><CheckUserIcon /><span className="dlg-identity-label">Signed in</span></span>
              ) : (
                <button className="dlg-iconbtn"><SignInIcon /></button>
              )}
              <button className="dlg-iconbtn"><NewChatIcon /></button>
            </div>
            {progressPct > 0 ? <div className="dlg-header-progress" style={{ width: `${progressPct}%` }} /> : null}
          </header>

          <div className="dlg-split">
            <section className="dlg-chat">
              <div className="dlg-messages" style={{ overflowY: 'hidden' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24, transform: `translateY(${-scrollY}px)`, willChange: 'transform' }}>
                  <Turn frame={frame} appear={0} typeStart={DUR.greetType[0]} typeEnd={DUR.greetType[1]} text={GREETING} />

                  {showStarters ? (
                    <div className="dlg-starters">
                      <span className="dlg-starters-label">Ask anything, or start with</span>
                      <div className="dlg-starters-grid">
                        {['Apply for a new courier licence', 'Renew a licence', 'Ask a licensing question'].map((sName, i) => (
                          <button key={sName} className="dlg-starter" style={i === 0 ? pressed(DUR.clickIssue) : undefined}>
                            <span>{sName}</span>
                            {i === 0 ? <ClickCursor frame={frame} approach={84} click={DUR.clickIssue} /> : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <UserMsg frame={frame} appear={DUR.uIssue} text="Apply for a new courier licence" />

                  <Turn frame={frame} appear={DUR.aAsk} typeStart={DUR.aAskType[0]} typeEnd={DUR.aAskType[1]} text={A_ASK}>
                    {frame >= DUR.uploadAt ? (
                      <div className={`dlg-chat-upload${uploaded ? ' is-done' : ''}`} style={enterStyle(frame, DUR.uploadAt)}>
                        <div className="dlg-chat-upload-head">
                          <FileIcon />
                          <span className="dlg-chat-upload-name">Trade License{!uploaded ? <em> required</em> : null}</span>
                          {uploaded ? <span className="dlg-chat-upload-status"><CheckCircleIcon color="var(--c-success)" size={14} /> Uploaded</span> : null}
                        </div>
                        {uploaded ? (
                          <div className="dlg-chat-upload-file">
                            <span className="fname">trade-license.pdf</span>
                            <label className="dlg-upload ghost">Replace</label>
                          </div>
                        ) : (
                          <>
                            <div className="dlg-chat-upload-hint">PDF or image, up to 10 MB</div>
                            <div className="dlg-chat-upload-actions">
                              <label className="dlg-upload" style={pressed(DUR.clickUpload)}>
                                <UploadIcon /> Upload
                                <ClickCursor frame={frame} approach={250} click={DUR.clickUpload} />
                              </label>
                            </div>
                          </>
                        )}
                      </div>
                    ) : null}
                  </Turn>

                  <Turn frame={frame} appear={DUR.aExtract} typeStart={DUR.aExtractType[0]} typeEnd={DUR.aExtractType[1]} text={A_EXTRACT} tool />

                  <Turn frame={frame} appear={DUR.aReview} typeStart={DUR.aReviewType[0]} typeEnd={DUR.aReviewType[1]} text={A_REVIEW}>
                    {frame >= DUR.declAt ? (
                      <div className="dlg-toggles is-checkbox" style={enterStyle(frame, DUR.declAt)}>
                        <div className="dlg-toggles-title">Declaration</div>
                        <button className={`dlg-toggle ${checked ? 'is-on' : ''}`} style={pressed(DUR.clickCheck)}>
                          <span className="dlg-checkbox-box">{checked ? <CheckIcon /> : null}</span>
                          <span className="dlg-toggle-label">I confirm the extracted details are accurate and I am authorised to submit on behalf of the company.</span>
                          <ClickCursor frame={frame} approach={558} click={DUR.clickCheck} />
                        </button>
                        <button className="dlg-toggles-confirm" style={pressed(DUR.clickConfirm)} disabled={!checked}>
                          Confirm &amp; submit
                          {checked ? <ClickCursor frame={frame} approach={620} click={DUR.clickConfirm} /> : null}
                        </button>
                      </div>
                    ) : null}
                  </Turn>

                  <Turn frame={frame} appear={DUR.aSubmit} typeStart={DUR.aSubmitType[0]} typeEnd={DUR.aSubmitType[1]} text={A_DONE} tool />
                  <div style={{ height: 8 }} />
                </div>
              </div>

              <div className="dlg-input-wrap">
                <div className="dlg-input">
                  <textarea readOnly rows={1} value="" placeholder="Type your message…" style={{ resize: 'none' }} />
                  <button className="dlg-mic"><MicIcon /></button>
                  <button className="dlg-send"><SendIcon /></button>
                </div>
              </div>
            </section>

            <aside className="dlg-case" style={{ display: 'block' }}>
              <div className="dlg-case-inner">
                <div className="dlg-case-head">
                  <h2>Your application</h2>
                  {submitted ? <span className="dlg-status submitted">Submitted</span> : uploaded ? <span className="dlg-status">Draft</span> : null}
                </div>

                {!showPanel ? (
                  <div className="dlg-empty">
                    <div className="dlg-empty-head">
                      <span className="dlg-empty-icon"><ListIcon /></span>
                      <div className="dlg-empty-copy">
                        <h4>Nothing to assemble yet</h4>
                        <p>Upload your documents and your application takes shape here: details, documents, and what's left.</p>
                      </div>
                    </div>
                    <div className="dlg-empty-preview">
                      {['Documents', 'Details', 'Submission readiness'].map((l, gi) => (
                        <div className="dlg-empty-ghost" key={l} style={{ ['--gi' as string]: gi, opacity: 1 }}>
                          <span className="dlg-empty-ghost-label">{l}</span>
                          <span className="dlg-empty-ghost-lines">
                            <span className="dlg-empty-ghost-line" />
                            {gi !== 1 ? <span className="dlg-empty-ghost-line short" /> : null}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    {submitted ? (
                      <div className="dlg-reference" style={enterStyle(frame, DUR.submitAt)}>
                        <CheckCircleIcon color="var(--c-success)" />
                        <span className="ref-label">Reference</span>
                        <strong>EPGL-2026-04-8842</strong>
                      </div>
                    ) : null}

                    <div className="dlg-progress">
                      <div className="dlg-progress-row">
                        <span>{progressPct >= 100 ? 'Ready to submit' : 'Submission readiness'}</span>
                        <span><strong>{Math.round((progressPct / 100) * 4)}</strong> / 4 ready</span>
                      </div>
                      <div className="dlg-progress-track">
                        <div className={`dlg-progress-fill${progressPct >= 100 ? ' done' : ''}`} style={{ width: `${progressPct}%` }} />
                      </div>
                    </div>

                    <div className="dlg-card">
                      <h3><FileIcon /> Documents</h3>
                      <div className="dlg-docslot">
                        <div className="dlg-docslot-head">
                          <span className="dlg-docslot-name">Trade License</span>
                          <span className="dlg-doc-status accepted"><CheckCircleIcon color="var(--c-success)" size={12} /> accepted</span>
                        </div>
                        <div className="dlg-docslot-meta"><span className="fname">trade-license.pdf</span></div>
                      </div>
                    </div>

                    {hasFields ? (
                      <div className="dlg-card">
                        <h3><ListIcon /> Company details</h3>
                        <Field frame={frame} at={DUR.fieldsAt} label="Company" value="Al Noor Trading LLC" />
                        <Field frame={frame} at={DUR.fieldsAt + 6} label="License no." value="CN-1043882" />
                        <Field frame={frame} at={DUR.fieldsAt + 12} label="Legal form" value="LLC" />
                        <Field frame={frame} at={DUR.fieldsAt + 18} label="Activity" value="General Trading" />
                        <Field frame={frame} at={DUR.fieldsAt + 24} label="Emirate" value="Ajman" />
                        <Field frame={frame} at={DUR.fieldsAt + 30} label="Expiry" value="04-02-2027" />
                      </div>
                    ) : null}

                    <div className="dlg-card">
                      <h3><ChecksIcon /> Submission readiness</h3>
                      <Check frame={frame} at={DUR.uploadedAt} done label="Trade License" kind="document" />
                      <Check frame={frame} at={DUR.fieldsAt} done={hasFields} label="Company details" kind="field" />
                      <Check frame={frame} at={DUR.clickConfirm} done={frame >= DUR.clickConfirm} label="Declaration" kind="field" />
                      <Check frame={frame} at={DUR.submitAt} done={submitted} label="Submitted for review" kind="field" />
                    </div>
                  </>
                )}
              </div>
            </aside>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
