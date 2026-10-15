/** The 7X mark on its square blue tile. No glow: the brand is flat. */
export function Mark({ size = 32 }: { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center bg-[#1330f0]" style={{ width: size, height: size, borderRadius: 3 }} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/7xlogo.svg" alt="" style={{ height: Math.round(size * 0.38) }} className="w-auto" />
    </span>
  );
}
