import type { ReactNode } from "react";

interface GlowCardProps {
  children: ReactNode;
  className?: string;
}

export function GlowCard({ children, className = "" }: GlowCardProps) {
  return (
    <div className={`spotlight-card ${className}`}>
      <span className="spotlight-card__wash" aria-hidden="true" />
      {children}
    </div>
  );
}
