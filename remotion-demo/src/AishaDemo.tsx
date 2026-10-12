import './chat.css';
import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { camera, eased } from './parts';

export const DEMO_FPS = 30;
export const DEMO_DURATION = 1080;

/* ── Brand tokens (Aisha azure, light chrome) ──────────────────────────────── */
const TOKENS: React.CSSProperties = {
  ['--c-primary' as string]: '#2b90ee',
  ['--c-primary-fg' as string]: '#ffffff',
  ['--c-surface' as string]: '#ffffff',
  ['--c-surface-muted' as string]: '#f4f6f9',
  ['--c-text' as string]: '#101828',
  ['--c-text-muted' as string]: '#667085',
  ['--c-border' as string]: '#e5e8ee',
  ['--c-success' as string]: '#12a869',
  ['--c-warning' as string]: '#f79009',
  ['--c-danger' as string]: '#f04438',
  position: 'absolute',
  inset: 0,
  height: '100%',
};

const Orb: React.FC<{ size?: number; state?: 'idle' | 'thinking' | 'speaking' }> = ({ size = 26, state = 'idle' }) => (
  <span className="dlg-orb" style={{ ['--orb-size' as string]: `${size}px` }} data-state={state} aria-hidden>
    <span className="dlg-orb-bloom" />
    <span className="dlg-orb-orbit" />
    <span className="dlg-orb-body">
      <span className="dlg-orb-flow a" />
      <span className="dlg-orb-flow b" />
      <span className="dlg-orb-sheen" />
      <span className="dlg-orb-spec" />
    </span>
  </span>
);

/* ── Arabic copy — NXN PO Box renewal (box 5200, Ajman) ────────────────────── */
const GREETING = 'مرحباً بك في NXN. يمكنني مساعدتك في استئجار أو تجديد صندوق بريد، أو تتبّع شحنة، أو الإجابة عن أسئلتك حول خدماتنا. كيف أساعدك؟';
const A_ASK = 'يسعدني مساعدتك في التجديد. ما رقم الصندوق وفي أي إمارة؟';
const A_FOUND = 'وجدته. صندوق بريد 5200 في عجمان، باسم أحمد المنصوري وسارٍ حتى 12-03-2026. لأي مدة تودّ التجديد؟';
const A_SUMMARY = 'ممتاز. إليك ملخص التجديد قبل الدفع.';
const A_PAY = 'نافذة الدفع الآمنة جاهزة. أكمل الدفع لإتمام التجديد.';
const A_DONE = 'تم استلام الدفعة. تم تجديد صندوق البريد 5200 حتى 12-03-2027. رقمك المرجعي هو NXN-5200-AJ-0417.';

function typed(text: string, frame: number, start: number, end: number) {
  if (frame < start) return { shown: '', typing: false, started: false };
  const p = Math.min(1, (frame - start) / (end - start));
  const n = Math.floor(p * text.length);
  return { shown: text.slice(0, n), typing: frame < end, started: true };
}

const Caret = () => (
  <span style={{ display: 'inline-block', width: 2, height: '1.05em', transform: 'translateY(0.15em)', marginInlineStart: 2, borderRadius: 2, background: 'color-mix(in srgb, var(--c-text) 55%, transparent)' }} />
);

const TypingDots = () => (
  <span className="dlg-typing"><span /><span /><span /></span>
);

const Turn: React.FC<{
  frame: number; appear: number; typeStart: number; typeEnd: number; text: string;
  tool?: boolean; children?: React.ReactNode;
}> = ({ frame, appear, typeStart, typeEnd, text, tool, children }) => {
  if (frame < appear) return null;
  const { shown, typing, started } = typed(text, frame, typeStart, typeEnd);
  const enter = Math.min(1, (frame - appear) / 8);
  const orbState = tool && frame < typeStart ? 'thinking' : typing ? 'speaking' : 'idle';
  return (
    <div className="dlg-msg assistant" style={{ opacity: enter, transform: `translateY(${(1 - enter) * 6}px)` }}>
      <Orb size={26} state={orbState} />
      <div className="dlg-turn">
        <span className="dlg-turn-name">عائشة</span>
        <div className="dlg-bubble">
          {tool && frame < typeStart ? (
            <span className="dlg-tool-status"><span className="dlg-tool-spinner" /></span>
          ) : !started ? (
            <TypingDots />
          ) : (
            <p style={{ margin: 0 }}>{shown}{typing ? <Caret /> : null}</p>
          )}
          {children}
        </div>
      </div>
    </div>
  );
};

const UserMsg: React.FC<{ frame: number; appear: number; text: string }> = ({ frame, appear, text }) => {
  if (frame < appear) return null;
  const enter = Math.min(1, (frame - appear) / 8);
  return (
    <div className="dlg-msg user" style={{ opacity: enter, transform: `translateY(${(1 - enter) * 6}px)` }}>
      <div className="dlg-bubble">{text}</div>
    </div>
  );
};

const enterStyle = (frame: number, at: number, dur = 10): React.CSSProperties => {
  const p = Math.min(1, Math.max(0, (frame - at) / dur));
  const e = 1 - Math.pow(1 - p, 3);
  return { opacity: e, transform: `translateY(${(1 - e) * 8}px)` };
};

/* Auto-detect direction per value so Latin numbers/dates read correctly in RTL. */
const V: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <span className={className} style={{ unicodeBidi: 'plaintext' }}>{children}</span>
);

const DUR = {
  greetType: [10, 70] as const,
  startersAt: 78,
  clickRenewal: 116,
  uRenewal: 122,
  aAsk: 150,
  aAskType: [172, 222] as const,
  uBoxType: [232, 258] as const,
  uBox: 262,
  aFound: 292,
  aFoundType: [334, 410] as const,
  fieldsAt: 346,
  optionsAt: 416,
  clickTerm: 476,
  uTerm: 494,
  aSummary: 522,
  aSummaryType: [522, 560] as const,
  summaryAt: 566,
  termFeeAt: 566,
  togglesAt: 606,
  clickToggle: 664,
  clickProceed: 718,
  aPay: 742,
  aPayType: [742, 776] as const,
  payAt: 784,
  clickPay: 844,
  paidAt: 874,
  aDone: 892,
  aDoneType: [892, 972] as const,
  submitAt: 892,
  outroAt: 1030,
};

export const AishaDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const authed = frame >= DUR.aFound + 20;
  const hasFields = frame >= DUR.fieldsAt;
  const hasTermFee = frame >= DUR.termFeeAt;
  const autoRenewOn = frame >= DUR.clickToggle;
  const submitted = frame >= DUR.submitAt;
  const paid = frame >= DUR.paidAt;
  const showPanel = hasFields;

  const progressPct = interpolate(
    frame,
    [DUR.fieldsAt, DUR.fieldsAt + 20, DUR.termFeeAt, DUR.termFeeAt + 20, DUR.submitAt, DUR.submitAt + 24],
    [0, 42, 42, 70, 70, 100],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const pressed = (click: number): React.CSSProperties => ({ position: 'relative', ...(Math.abs(frame - click) < 5 ? { transform: 'scale(0.98)' } : {}) });

  const showStarters = frame >= DUR.startersAt && frame < DUR.uRenewal;
  const composerText = (() => {
    const t = typed('صندوق 5200، عجمان', frame, DUR.uBoxType[0], DUR.uBoxType[1]);
    return frame >= DUR.uBoxType[0] && frame < DUR.uBox ? t.shown : '';
  })();

  const outro = interpolate(frame, [DUR.outroAt, DEMO_DURATION - 4], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const intro = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });

  const scrollY = eased(
    frame,
    [0, 430, 500, 560, 640, 720, 800, 880, 940, 1080],
    [0, 0, 90, 175, 300, 420, 545, 660, 700, 700],
  );

  // Camera — RTL: the application panel is on the LEFT, the chat on the RIGHT.
  const { z: zc, tx: camTx, ty: camTy } = camera(frame, [
    [0, 1.0, 800, 500],
    [110, 1.0, 800, 500],     // greeting / starters — wide
    [230, 1.06, 900, 470],    // ease toward the chat (right)
    [356, 1.06, 900, 470],
    [386, 1.12, 380, 440],    // panel assembles (left)
    [470, 1.12, 380, 440],
    [520, 1.05, 900, 520],
    [606, 1.1, 980, 540],     // summary + consent (chat, right)
    [720, 1.1, 980, 540],
    [742, 1.05, 900, 520],
    [800, 1.13, 980, 560],    // payment (chat, right)
    [874, 1.13, 980, 560],
    [905, 1.0, 800, 500],     // pull wide for the confirmation
    [1080, 1.0, 800, 500],
  ]);

  const readyCount = Math.round((progressPct / 100) * 4);

  return (
    <AbsoluteFill style={{ background: '#e9edf3', overflow: 'hidden' }}>
      <style>{`
        .dlg-msg,.dlg-starters,.dlg-starter,.dlg-field,.dlg-card,.dlg-cards .dlg-card-opt,
        .dlg-summary,.dlg-paycard,.dlg-reference,.dlg-case,.dlg-root.is-full .dlg-case,
        .dlg-empty-ghost,.dlg-progress-fill,.dlg-header-progress,.dlg-status,.dlg-doc-status,
        .dlg-toggles{animation:none!important;}
        .dlg-messages{display:block!important;}
        .dlg-messages::-webkit-scrollbar{width:0!important;}
        *:focus,*:focus-visible{outline:none!important;box-shadow:none!important;}
        textarea{caret-color:transparent;}
      `}</style>

      <div style={{ position: 'absolute', inset: 0, transformOrigin: '0 0', transform: `translate3d(${camTx}px, ${camTy}px, 0) scale(${zc})` }}>
        <div className="dlg-root" data-theme="light" dir="rtl" style={{ ...TOKENS, opacity: intro * outro }}>
          {/* Header */}
          <header className="dlg-header">
            <div className="dlg-brand">
              <Img className="dlg-header-logo" src={staticFile('aisha-onlight.jpg')} alt="عائشة" />
            </div>
            <div className="dlg-actions">
              <button className="dlg-iconbtn lang"><TranslateIcon /><span className="dlg-iconbtn-tag">EN</span></button>
              <button className="dlg-iconbtn"><MoonIcon /></button>
              <span className="dlg-actions-sep" />
              {authed ? (
                <span className="dlg-identity"><CheckUserIcon /><span className="dlg-identity-label">تم تسجيل الدخول</span></span>
              ) : (
                <button className="dlg-iconbtn"><SignInIcon /></button>
              )}
              <button className="dlg-iconbtn"><NewChatIcon /></button>
            </div>
            {progressPct > 0 ? <div className="dlg-header-progress" style={{ width: `${progressPct}%` }} /> : null}
          </header>

          <div className="dlg-split">
            {/* Conversation */}
            <section className="dlg-chat">
              <div className="dlg-messages" style={{ overflowY: 'hidden' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24, transform: `translateY(${-scrollY}px)`, willChange: 'transform' }}>
                  <Turn frame={frame} appear={0} typeStart={DUR.greetType[0]} typeEnd={DUR.greetType[1]} text={GREETING} />

                  {showStarters ? (
                    <div className="dlg-starters">
                      <span className="dlg-starters-label">اسأل أي شيء، أو ابدأ بـ</span>
                      <div className="dlg-starters-grid">
                        {['صندوق بريد شخصي جديد', 'تجديد صندوق بريد شخصي', 'صندوق بريد للشركات', 'إدارة صندوق قائم'].map((sName, i) => (
                          <button key={sName} className="dlg-starter" style={i === 1 ? pressed(DUR.clickRenewal) : undefined}>
                            <span>{sName}</span>
                            <ArrowIcon />
                            {i === 1 ? <ClickCursor frame={frame} approach={84} click={DUR.clickRenewal} /> : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <UserMsg frame={frame} appear={DUR.uRenewal} text="تجديد صندوق بريد شخصي" />
                  <Turn frame={frame} appear={DUR.aAsk} typeStart={DUR.aAskType[0]} typeEnd={DUR.aAskType[1]} text={A_ASK} />
                  <UserMsg frame={frame} appear={DUR.uBox} text="صندوق 5200، عجمان" />

                  <Turn frame={frame} appear={DUR.aFound} typeStart={DUR.aFoundType[0]} typeEnd={DUR.aFoundType[1]} text={A_FOUND} tool>
                    {frame >= DUR.optionsAt ? (
                      <div className="dlg-cards">
                        {[
                          { t: 'سنة واحدة', d: 'يُجدَّد حتى 12-03-2027.', p: '300 درهم', key: 'term1', badge: '' },
                          { t: 'سنتان', d: 'تغطية سنتين بدفعة واحدة.', p: '560 درهم', key: '', badge: 'وفّر 8%' },
                          { t: '3 سنوات', d: 'أطول تغطية وأفضل سعر.', p: '780 درهم', key: '', badge: 'الأفضل قيمة' },
                        ].map((o) => (
                          <button
                            key={o.t}
                            className={`dlg-card-opt is-tappable${o.key === 'term1' && frame >= DUR.clickTerm ? ' is-selected' : ''}`}
                            style={{ ...enterStyle(frame, DUR.optionsAt + 4), ...(o.key === 'term1' ? pressed(DUR.clickTerm) : {}) }}
                          >
                            <div className="dlg-card-opt-head">
                              <span className="dlg-card-opt-title">{o.t}</span>
                              {o.badge ? <span className="dlg-card-opt-badge">{o.badge}</span> : null}
                            </div>
                            <p className="dlg-card-opt-desc">{o.d}</p>
                            <div className="dlg-card-opt-price"><V>{o.p}</V></div>
                            {o.key === 'term1' ? <ClickCursor frame={frame} approach={436} click={DUR.clickTerm} /> : null}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </Turn>

                  <UserMsg frame={frame} appear={DUR.uTerm} text="سنة واحدة، من فضلك" />

                  <Turn frame={frame} appear={DUR.aSummary} typeStart={DUR.aSummaryType[0]} typeEnd={DUR.aSummaryType[1]} text={A_SUMMARY}>
                    {frame >= DUR.summaryAt ? (
                      <div className="dlg-summary" style={enterStyle(frame, DUR.summaryAt)}>
                        <div className="dlg-summary-title">الملخّص</div>
                        <div className="dlg-summary-rows">
                          {[
                            ['صندوق البريد', '5200'],
                            ['الإمارة', 'عجمان'],
                            ['المدة', 'سنة واحدة'],
                            ['سارٍ حتى', '12-03-2027'],
                          ].map(([k, v]) => (
                            <div className="dlg-summary-row" key={k}>
                              <span className="dlg-summary-k">{k}</span>
                              <span className="dlg-summary-v"><V>{v}</V></span>
                            </div>
                          ))}
                        </div>
                        <div className="dlg-summary-total">
                          <span className="dlg-summary-k">الإجمالي</span>
                          <span className="dlg-summary-v"><V>300.00 درهم</V></span>
                        </div>
                      </div>
                    ) : null}

                    {/* Before-payment consent toggles (a real NXN step). */}
                    {frame >= DUR.togglesAt ? (
                      <div className="dlg-toggles" style={enterStyle(frame, DUR.togglesAt)}>
                        <div className="dlg-toggles-title">قبل الدفع</div>
                        <button className="dlg-toggle">
                          <span className="dlg-toggle-label">حفظ بطاقتي للمدفوعات المستقبلية</span>
                          <span className="dlg-toggle-track"><span className="dlg-toggle-thumb" /></span>
                        </button>
                        <button className={`dlg-toggle ${autoRenewOn ? 'is-on' : ''}`}>
                          <span className="dlg-toggle-label">تفعيل التجديد التلقائي لصندوقي</span>
                          <span className="dlg-toggle-track"><span className="dlg-toggle-thumb" /></span>
                          <ClickCursor frame={frame} approach={612} click={DUR.clickToggle} />
                        </button>
                        <button className="dlg-toggles-confirm" style={pressed(DUR.clickProceed)}>
                          المتابعة إلى الدفع
                          <ClickCursor frame={frame} approach={674} click={DUR.clickProceed} />
                        </button>
                      </div>
                    ) : null}
                  </Turn>

                  <Turn frame={frame} appear={DUR.aPay} typeStart={DUR.aPayType[0]} typeEnd={DUR.aPayType[1]} text={A_PAY}>
                    {frame >= DUR.payAt ? (
                      <div className={`dlg-paycard${paid ? ' paid' : ''}`} style={enterStyle(frame, DUR.payAt)}>
                        <div className="dlg-paycard-head">
                          <span className="dlg-paycard-icon">{paid ? <CheckIcon /> : <LockIcon />}</span>
                          <span className="dlg-paycard-title">دفع آمن</span>
                          <span className="dlg-paycard-amount"><V>300.00 درهم</V></span>
                        </div>
                        {paid ? (
                          <div className="dlg-paycard-status paid"><CheckCircleIcon /> تم استلام الدفعة</div>
                        ) : (
                          <>
                            <button className="dlg-paybtn" style={pressed(DUR.clickPay)}>
                              ادفع الآن
                              <ClickCursor frame={frame} approach={806} click={DUR.clickPay} />
                            </button>
                            <div className="dlg-paycard-note">تتم المعالجة عبر بوابة الدفع. بيانات البطاقة لا تمرّ عبر هذه المحادثة.</div>
                          </>
                        )}
                      </div>
                    ) : null}
                  </Turn>

                  <Turn frame={frame} appear={DUR.aDone} typeStart={DUR.aDoneType[0]} typeEnd={DUR.aDoneType[1]} text={A_DONE} />
                  <div style={{ height: 8 }} />
                </div>
              </div>

              {/* Composer */}
              <div className="dlg-input-wrap">
                <div className="dlg-input">
                  <textarea readOnly rows={1} value={composerText} placeholder="اكتب رسالتك…" style={{ resize: 'none' }} />
                  <button className="dlg-mic"><MicIcon /></button>
                  <button className="dlg-send"><SendIcon /></button>
                </div>
              </div>
            </section>

            {/* Application panel */}
            <aside className="dlg-case" style={{ display: 'block' }}>
              <div className="dlg-case-inner">
                <div className="dlg-case-head">
                  <h2>طلبك</h2>
                  {submitted ? <span className="dlg-status submitted">تم الإرسال</span> : hasFields ? <span className="dlg-status">مسودة</span> : null}
                </div>

                {!showPanel ? (
                  <div className="dlg-empty">
                    <div className="dlg-empty-head">
                      <span className="dlg-empty-icon"><ListIcon /></span>
                      <div className="dlg-empty-copy">
                        <h4>لا يوجد ما يُجمع بعد</h4>
                        <p>أثناء المحادثة، يتشكّل طلبك هنا: التفاصيل والمستندات وما تبقّى.</p>
                      </div>
                    </div>
                    <div className="dlg-empty-preview">
                      {['التفاصيل', 'المستندات', 'جاهزية الإرسال'].map((l, gi) => (
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
                        <span className="ref-label">الرقم المرجعي</span>
                        <strong><V>NXN-5200-AJ-0417</V></strong>
                      </div>
                    ) : null}

                    <div className="dlg-progress">
                      <div className="dlg-progress-row">
                        <span>{progressPct >= 100 ? 'جاهز للإرسال' : 'جاهزية الإرسال'}</span>
                        <span><strong>{readyCount}</strong> / 4 جاهز</span>
                      </div>
                      <div className="dlg-progress-track">
                        <div className={`dlg-progress-fill${progressPct >= 100 ? ' done' : ''}`} style={{ width: `${progressPct}%` }} />
                      </div>
                    </div>

                    <div className="dlg-card">
                      <h3><ListIcon /> التفاصيل</h3>
                      <Field frame={frame} at={DUR.fieldsAt} label="الحامل" value="أحمد المنصوري" />
                      <Field frame={frame} at={DUR.fieldsAt + 6} label="صندوق البريد" value="5200" />
                      <Field frame={frame} at={DUR.fieldsAt + 12} label="الإمارة" value="عجمان" />
                      {hasTermFee ? <Field frame={frame} at={DUR.termFeeAt} label="المدة" value="سنة واحدة" /> : null}
                      {hasTermFee ? <Field frame={frame} at={DUR.termFeeAt + 6} label="الرسوم" value="300 درهم" /> : null}
                    </div>

                    <div className="dlg-card">
                      <h3><ChecksIcon /> جاهزية الإرسال</h3>
                      <Check done label="رقم الصندوق" kind="حقل" />
                      <Check done label="الإمارة" kind="حقل" />
                      <Check done={hasTermFee} label="مدة التجديد" kind="حقل" />
                      <Check done={submitted} label="الدفع" kind="حقل" />
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

/* ── Panel sub-parts ───────────────────────────────────────────────────────── */
const Field: React.FC<{ frame: number; at: number; label: string; value: string }> = ({ frame, at, label, value }) => {
  if (frame < at) return null;
  return (
    <div className="dlg-field" style={enterStyle(frame, at, 8)}>
      <span className="dlg-field-label">{label}</span>
      <span className="dlg-field-value"><V>{value}</V></span>
    </div>
  );
};

const Check: React.FC<{ done: boolean; label: string; kind: string }> = ({ done, label, kind }) => (
  <div className={`dlg-check ${done ? 'done' : 'todo'}`}>
    {done ? <CheckCircleIcon color="var(--c-success)" size={18} /> : <CircleIcon />}
    {label}
    <span className="kind">{kind}</span>
  </div>
);

/* Animated cursor — child of its target, so it tracks scroll/layout. */
const ClickCursor: React.FC<{ frame: number; approach: number; click: number }> = ({ frame, approach, click }) => {
  if (frame < approach || frame > click + 12) return null;
  const p = Math.min(1, Math.max(0, (frame - approach) / (click - approach)));
  const e = 1 - Math.pow(1 - p, 3);
  const ox = 42 * (1 - e);
  const oy = 36 * (1 - e);
  const press = Math.max(0, 1 - Math.abs(frame - click) / 5);
  return (
    <div style={{ position: 'absolute', left: '50%', top: '50%', transform: `translate(calc(-3px + ${ox}px), calc(-2px + ${oy}px)) scale(${1 - press * 0.14})`, transformOrigin: '3px 2px', pointerEvents: 'none', zIndex: 90, filter: 'drop-shadow(0 3px 6px rgba(16,24,40,.35))' }}>
      {press > 0.35 ? (
        <span style={{ position: 'absolute', left: 3, top: 2, width: 34, height: 34, borderRadius: '50%', border: '2px solid var(--c-primary)', transform: `translate(-50%,-50%) scale(${0.4 + press})`, opacity: press * 0.65 }} />
      ) : null}
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
        <path d="M4 3l6.5 16 2.3-6.6 6.6-2.3L4 3z" fill="#fff" stroke="#101828" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </div>
  );
};

/* ── Icons ─────────────────────────────────────────────────────────────────── */
const s = (p: React.ReactNode, sz = 18) => (
  <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{p}</svg>
);
const TranslateIcon = () => s(<><path d="M4 5h10M9 3v2c0 5-3 8-6 9M6 9c0 3 3 5 6 6" /><path d="M14 20l4-9 4 9M15.5 17h5" /></>);
const MoonIcon = () => s(<path d="M21 12.8A8.5 8.5 0 1111.2 3 6.6 6.6 0 0021 12.8z" />);
const SignInIcon = () => s(<><path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3" /><path d="M10 17l5-5-5-5M15 12H3" /></>);
const NewChatIcon = () => s(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></>);
const CheckUserIcon = () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-4 0-8 2-8 5v1h10.3a6 6 0 01-.3-2 6 6 0 016-6h.5C18.9 15.3 15.7 14 12 14z" opacity=".9" /><path d="M22 16.5l-4.5 4.5L15 18.5" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>);
const ArrowIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'scaleX(-1)' }}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
const MicIcon = () => s(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0012 0M12 17v4" /></>);
const SendIcon = () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ transform: 'scaleX(-1)' }}><path d="M3.4 20.4L21 12 3.4 3.6l.1 6.5L15 12 3.5 13.9z" /></svg>);
const LockIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17 9V7a5 5 0 00-10 0v2H5v12h14V9h-2zm-8 0V7a3 3 0 016 0v2H9z" /></svg>);
const CheckIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6" /></svg>);
const CheckCircleIcon: React.FC<{ color?: string; size?: number }> = ({ color = 'currentColor', size = 16 }) => (<svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm-1 14.4l-4-4L8.4 11l2.6 2.6L15.6 9 17 10.4l-6 6z" /></svg>);
const CircleIcon = () => s(<circle cx="12" cy="12" r="9" />, 18);
const ListIcon = () => s(<><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>, 15);
const ChecksIcon = () => s(<><path d="M4 12l4 4L20 4" /><path d="M4 18l4 4 3-3" /></>, 15);
