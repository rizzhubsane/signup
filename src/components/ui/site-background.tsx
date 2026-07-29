/**
 * Static CSS dither field used on every device. The animated WebGL path was
 * removed — one composited layer, zero frames, same look everywhere.
 */
export function SiteBackground() {
  return (
    <div aria-hidden="true" className="site-bg">
      <div className="site-bg__dots" />
      <div className="site-bg__veil" />
      <div className="site-bg__glow" />
    </div>
  );
}
