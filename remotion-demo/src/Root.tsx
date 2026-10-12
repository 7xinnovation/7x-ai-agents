import { Composition } from 'remotion';
import { AishaDemo, DEMO_FPS, DEMO_DURATION } from './AishaDemo';
import { AishaReel, REEL_FPS, REEL_DURATION } from './Reel';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="AishaReel"
      component={AishaReel}
      durationInFrames={REEL_DURATION}
      fps={REEL_FPS}
      width={1600}
      height={1000}
    />
    <Composition
      id="AishaDemo"
      component={AishaDemo}
      durationInFrames={DEMO_DURATION}
      fps={DEMO_FPS}
      width={1600}
      height={1000}
    />
  </>
);
