import { IconMovie, IconMusic, IconPhoto, IconPlayerPlay } from "@tabler/icons-react";
import type { PhaseId } from "@/types/project";

/**
 * Ghost content for locked-phase previews: the phase's structure "as if it
 * had been created and emptied", so first-time users see what will live in
 * each step before unlocking it. Purely presentational.
 */

function Bar({ w, h = 10 }: { w: string; h?: number }) {
  return <span className="skel__bar" style={{ width: w, height: h }} />;
}

function SceneCard({ n }: { n: number }) {
  return (
    <article className="scene skel__card">
      <div className="scene__head">
        <span className="skel__tag">ESC {n}</span>
        <Bar w="38%" h={12} />
      </div>
      <div className="skel__block" style={{ height: 64 }}>
        <Bar w="86%" />
        <Bar w="72%" />
        <Bar w="55%" />
      </div>
      <div className="skel__block" style={{ height: 44 }}>
        <Bar w="48%" />
        <Bar w="30%" />
      </div>
    </article>
  );
}

function ShotCard({ n, video }: { n: number; video?: boolean }) {
  return (
    <div className="skel__shot">
      <div className="skel__thumb">
        {video ? <IconMovie size={22} /> : <IconPhoto size={22} />}
      </div>
      <div className="skel__shotbody">
        <span className="skel__tag">Plano {n}</span>
        <Bar w="88%" />
        <Bar w="64%" />
        <div className="skel__actions">
          <span className="skel__btn" />
          <span className="skel__btn" />
        </div>
      </div>
    </div>
  );
}

export function PhaseSkeleton({ phase }: { phase: PhaseId }) {
  if (phase === "script") {
    return (
      <div className="skel">
        <SceneCard n={1} />
        <SceneCard n={2} />
        <SceneCard n={3} />
      </div>
    );
  }
  if (phase === "storyboard" || phase === "production") {
    const video = phase === "production";
    return (
      <div className="skel">
        <div className="skel__scenehead">
          <span className="skel__tag">ESC 1</span>
          <Bar w="30%" h={12} />
        </div>
        <div className="skel__grid">
          <ShotCard n={1} video={video} />
          <ShotCard n={2} video={video} />
          <ShotCard n={3} video={video} />
        </div>
        <div className="skel__scenehead">
          <span className="skel__tag">ESC 2</span>
          <Bar w="24%" h={12} />
        </div>
        <div className="skel__grid">
          <ShotCard n={4} video={video} />
          <ShotCard n={5} video={video} />
        </div>
      </div>
    );
  }
  // delivery: timeline + final render
  return (
    <div className="skel">
      <div className="skel__player">
        <IconPlayerPlay size={34} />
      </div>
      <div className="skel__timeline">
        <div className="skel__track">
          <IconMovie size={13} />
          <span className="skel__clip" style={{ width: "22%" }} />
          <span className="skel__clip" style={{ width: "16%" }} />
          <span className="skel__clip" style={{ width: "26%" }} />
          <span className="skel__clip" style={{ width: "14%" }} />
        </div>
        <div className="skel__track">
          <IconMusic size={13} />
          <span className="skel__clip skel__clip--audio" style={{ width: "58%" }} />
          <span className="skel__clip skel__clip--audio" style={{ width: "20%" }} />
        </div>
      </div>
      <div className="skel__block" style={{ height: 52 }}>
        <Bar w="34%" />
        <Bar w="22%" />
      </div>
    </div>
  );
}
