/** The 7X mark on its blue tile, as the console draws it. */
export function Mark({ size = 36 }: { size?: number }) {
  return (
    <span
      className="grid place-items-center rounded-xl bg-[#0020f5] shadow-[0_8px_20px_-8px_rgba(0,32,245,.6)]"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/7xlogo.svg" alt="" style={{ height: Math.round(size * 0.4) }} className="w-auto" />
    </span>
  );
}
