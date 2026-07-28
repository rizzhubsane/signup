const LEARN_MORE_LINKS = [
  {
    label: "eDC",
    href: "https://edciitd.com",
  },
  {
    label: "BECon",
    href: "https://becon.edciitd.com",
  },
] as const;

export function LearnMoreLinks() {
  return (
    <nav aria-label="Learn more" className="learn-more">
      <p className="learn-more__heading">Know More</p>
      {LEARN_MORE_LINKS.map(({ label, href }) => (
        <a
          className="learn-more__link"
          href={href}
          key={href}
          rel="noopener noreferrer"
          target="_blank"
        >
          <span>{label}</span>
          <span aria-hidden="true" className="learn-more__arrow">
            →
          </span>
        </a>
      ))}
    </nav>
  );
}
