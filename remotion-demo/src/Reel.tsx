import './chat.css';
import React from 'react';
import { AbsoluteFill, Audio, staticFile } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { AishaDemo } from './AishaDemo';
import { BrandScene } from './BrandScene';

export const REEL_FPS = 30;

const INTRO = 70;
const NXN = 1080;
const OUTRO = 100;
const T_FADE = 16;

// TransitionSeries total = sum(sequences) - sum(transitions).
export const REEL_DURATION = INTRO + NXN + OUTRO - (T_FADE + T_FADE);

export const AishaReel: React.FC = () => (
  <AbsoluteFill style={{ background: '#eef4fb' }}>
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={INTRO}>
        <BrandScene variant="intro" />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: T_FADE })} />

      <TransitionSeries.Sequence durationInFrames={NXN}>
        <AishaDemo />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: T_FADE })} />

      <TransitionSeries.Sequence durationInFrames={OUTRO}>
        <BrandScene variant="outro" />
      </TransitionSeries.Sequence>
    </TransitionSeries>

    {/* Subtle filmic vignette for cohesion. */}
    <AbsoluteFill style={{ pointerEvents: 'none', background: 'radial-gradient(120% 120% at 50% 50%, transparent 66%, rgba(16,24,40,0.11) 100%)' }} />
    {/* Fine film grain. */}
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        opacity: 0.05,
        mixBlendMode: 'overlay',
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        backgroundSize: '160px 160px',
      }}
    />
    {/* Ambient audio bed with a soft chime on the submission. */}
    <Audio src={staticFile('bed.mp3')} volume={0.7} />
  </AbsoluteFill>
);
