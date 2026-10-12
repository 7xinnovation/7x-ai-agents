import './chat.css';
import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Orb, TOKENS } from './parts';

/**
 * Branded interstitial — the Aisha orb + wordmark on a soft baby-blue field.
 * Used for the reel's intro, the bridge between journeys, and the outro.
 */
export const BrandScene: React.FC<{ variant?: 'intro' | 'bridge' | 'outro' }> = ({ variant = 'intro' }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const rise = spring({ frame, fps, config: { damping: 20, mass: 0.9, stiffness: 120 } });
  const orbScale = 0.8 + 0.2 * rise;
  const drift = Math.sin(frame / 42) * 6;
  const logoOp = interpolate(frame, [10, 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const logoY = interpolate(frame, [10, 30], [16, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 12, durationInFrames - 1], [1, 0], { extrapolateLeft: 'clamp' });
  const bgDrift = Math.sin(frame / 60) * 4;

  return (
    <AbsoluteFill style={{ ...TOKENS, overflow: 'hidden' }}>
      {/* Soft branded field */}
      <AbsoluteFill
        style={{
          background: `
            radial-gradient(46% 42% at ${50 + bgDrift}% 34%, rgba(43,144,238,0.20), transparent 70%),
            radial-gradient(58% 52% at 80% 88%, rgba(120,200,255,0.18), transparent 72%),
            radial-gradient(52% 46% at 16% 82%, rgba(43,144,238,0.12), transparent 72%),
            #eef4fb`,
        }}
      />
      {/* Orb + wordmark */}
      <AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 40, opacity: Math.min(rise * 1.3, 1) * fadeOut }}>
        <div style={{ transform: `scale(${orbScale}) translateY(${drift}px)`, filter: 'drop-shadow(0 24px 60px rgba(43,144,238,0.35))' }}>
          <Orb size={150} state={variant === 'outro' ? 'idle' : 'thinking'} />
        </div>
        <Img
          src={staticFile('aisha-onlight.jpg')}
          style={{ height: 74, objectFit: 'contain', mixBlendMode: 'multiply', opacity: logoOp, transform: `translateY(${logoY}px)` }}
          alt="Aisha"
        />
      </AbsoluteFill>

      {/* Sparkle accents, echoing the wordmark's mark. */}
      <AbsoluteFill style={{ opacity: Math.min(rise * 1.3, 1) * fadeOut, pointerEvents: 'none' }}>
        {[
          { x: 902, y: 322, s: 30, d: 0 },
          { x: 936, y: 288, s: 20, d: 12 },
          { x: 690, y: 356, s: 22, d: 22 },
          { x: 862, y: 470, s: 16, d: 34 },
        ].map((sp, i) => {
          const tw = 0.5 + 0.5 * Math.sin((frame + sp.d) / 9);
          return (
            <div key={i} style={{ position: 'absolute', left: sp.x, top: sp.y, opacity: 0.35 + 0.65 * tw, transform: `translate(-50%,-50%) scale(${0.7 + 0.5 * tw}) rotate(${(frame + sp.d) * 0.4}deg)` }}>
              <svg width={sp.s} height={sp.s} viewBox="0 0 24 24">
                <path d="M12 0C13 8 16 11 24 12C16 13 13 16 12 24C11 16 8 13 0 12C8 11 11 8 12 0Z" fill="url(#spg)" />
                <defs>
                  <linearGradient id="spg" x1="0" y1="0" x2="24" y2="24">
                    <stop offset="0" stopColor="#7cc4f7" />
                    <stop offset="1" stopColor="#2b90ee" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
