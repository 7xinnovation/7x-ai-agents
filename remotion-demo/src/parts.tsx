import React from 'react';
import { Easing, interpolate } from 'remotion';

/* Shared chat UI atoms + brand tokens, used by both the NXN and EPGL demos. */

export const AISHA_BLUE = '#2b90ee';

/**
 * Smooth multi-keyframe camera. Cubic in/out easing is applied per segment, so
 * every move accelerates and settles gently (equal in/out values = a calm hold).
 * `shots` are [frame, zoom, focusX, focusY] in 1600×1000 composition space.
 */
/** Cubic in/out eased interpolation — for the scroll track, so vertical
 *  movement glides instead of stepping (very visible once the camera zooms). */
export function eased(frame: number, keys: number[], vals: number[]) {
  return interpolate(frame, keys, vals, {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });
}

export function camera(frame: number, shots: [number, number, number, number][]) {
  const keys = shots.map((s) => s[0]);
  const ease = Easing.inOut(Easing.cubic);
  const opt = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const, easing: ease };
  const z = interpolate(frame, keys, shots.map((s) => s[1]), opt);
  let cx = interpolate(frame, keys, shots.map((s) => s[2]), opt);
  let cy = interpolate(frame, keys, shots.map((s) => s[3]), opt);
  const hw = 800 / z;
  const hh = 500 / z;
  cx = Math.min(Math.max(cx, hw), 1600 - hw);
  cy = Math.min(Math.max(cy, hh), 1000 - hh);
  return { z, tx: 800 - z * cx, ty: 500 - z * cy };
}

export const TOKENS: React.CSSProperties = {
  ['--c-primary' as string]: AISHA_BLUE,
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

export type OrbState = 'idle' | 'thinking' | 'speaking';

export const Orb: React.FC<{ size?: number; state?: OrbState }> = ({ size = 26, state = 'idle' }) => (
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

export function typed(text: string, frame: number, start: number, end: number) {
  if (frame < start) return { shown: '', typing: false, started: false };
  const p = Math.min(1, (frame - start) / (end - start));
  const n = Math.floor(p * text.length);
  return { shown: text.slice(0, n), typing: frame < end, started: true };
}

export const Caret = () => (
  <span style={{ display: 'inline-block', width: 2, height: '1.05em', transform: 'translateY(0.15em)', marginLeft: 2, borderRadius: 2, background: 'color-mix(in srgb, var(--c-text) 55%, transparent)' }} />
);

export const TypingDots = () => (
  <span className="dlg-typing">
    <span />
    <span />
    <span />
  </span>
);

export const enterStyle = (frame: number, at: number, dur = 10): React.CSSProperties => {
  const p = Math.min(1, Math.max(0, (frame - at) / dur));
  const e = 1 - Math.pow(1 - p, 3);
  return { opacity: e, transform: `translateY(${(1 - e) * 8}px)` };
};

export const Turn: React.FC<{
  frame: number;
  appear: number;
  typeStart: number;
  typeEnd: number;
  text: string;
  tool?: boolean;
  state?: OrbState;
  children?: React.ReactNode;
}> = ({ frame, appear, typeStart, typeEnd, text, tool, state, children }) => {
  if (frame < appear) return null;
  const { shown, typing, started } = typed(text, frame, typeStart, typeEnd);
  const enter = Math.min(1, (frame - appear) / 8);
  const orbState: OrbState = tool && frame < typeStart ? 'thinking' : typing ? 'speaking' : state ?? 'idle';
  return (
    <div className="dlg-msg assistant" style={{ opacity: enter, transform: `translateY(${(1 - enter) * 6}px)` }}>
      <Orb size={26} state={orbState} />
      <div className="dlg-turn">
        <span className="dlg-turn-name">Aisha</span>
        <div className="dlg-bubble">
          {tool && frame < typeStart ? (
            <span className="dlg-tool-status"><span className="dlg-tool-spinner" /></span>
          ) : !started ? (
            <TypingDots />
          ) : (
            <p style={{ margin: 0 }}>
              {shown}
              {typing ? <Caret /> : null}
            </p>
          )}
          {children}
        </div>
      </div>
    </div>
  );
};

export const UserMsg: React.FC<{ frame: number; appear: number; text: string }> = ({ frame, appear, text }) => {
  if (frame < appear) return null;
  const enter = Math.min(1, (frame - appear) / 8);
  return (
    <div className="dlg-msg user" style={{ opacity: enter, transform: `translateY(${(1 - enter) * 6}px)` }}>
      <div className="dlg-bubble">{text}</div>
    </div>
  );
};

export const Field: React.FC<{ frame: number; at: number; label: string; value: string }> = ({ frame, at, label, value }) => {
  if (frame < at) return null;
  return (
    <div className="dlg-field" style={enterStyle(frame, at, 8)}>
      <span className="dlg-field-label">{label}</span>
      <span className="dlg-field-value">{value}</span>
    </div>
  );
};

export const Check: React.FC<{ frame: number; at: number; done: boolean; label: string; kind: string }> = ({ done, label, kind }) => (
  <div className={`dlg-check ${done ? 'done' : 'todo'}`}>
    {done ? <CheckCircleIcon color="var(--c-success)" size={18} /> : <CircleIcon />}
    {label}
    <span className="kind">{kind}</span>
  </div>
);

export const ClickCursor: React.FC<{ frame: number; approach: number; click: number }> = ({ frame, approach, click }) => {
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
export const s = (p: React.ReactNode, sz = 18) => (
  <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{p}</svg>
);
export const TranslateIcon = () => s(<><path d="M4 5h10M9 3v2c0 5-3 8-6 9M6 9c0 3 3 5 6 6" /><path d="M14 20l4-9 4 9M15.5 17h5" /></>);
export const MoonIcon = () => s(<path d="M21 12.8A8.5 8.5 0 1111.2 3 6.6 6.6 0 0021 12.8z" />);
export const SignInIcon = () => s(<><path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3" /><path d="M10 17l5-5-5-5M15 12H3" /></>);
export const NewChatIcon = () => s(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></>);
export const CheckUserIcon = () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-4 0-8 2-8 5v1h10.3a6 6 0 01-.3-2 6 6 0 016-6h.5C18.9 15.3 15.7 14 12 14z" opacity=".9" /><path d="M22 16.5l-4.5 4.5L15 18.5" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>);
export const MicIcon = () => s(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0012 0M12 17v4" /></>);
export const SendIcon = () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4L21 12 3.4 3.6l.1 6.5L15 12 3.5 13.9z" /></svg>);
export const UploadIcon = () => s(<><path d="M12 15V4M8 8l4-4 4 4" /><path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" /></>, 15);
export const FileIcon = () => s(<><path d="M14 3v5h5" /><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V8l-6-5z" /></>, 15);
export const CheckIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6" /></svg>);
export const CheckCircleIcon: React.FC<{ color?: string; size?: number }> = ({ color = 'currentColor', size = 16 }) => (<svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm-1 14.4l-4-4L8.4 11l2.6 2.6L15.6 9 17 10.4l-6 6z" /></svg>);
export const CircleIcon = () => s(<circle cx="12" cy="12" r="9" />, 18);
export const ListIcon = () => s(<><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>, 15);
export const ChecksIcon = () => s(<><path d="M4 12l4 4L20 4" /><path d="M4 18l4 4 3-3" /></>, 15);
