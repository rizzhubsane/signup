"use client";

import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";

type SocialLink = {
  name: string;
  href: string;
  icon: () => ReactElement;
};

function InstagramIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <rect height="18.5" rx="5.2" width="18.5" x="2.75" y="2.75" />
      <circle cx="12" cy="12" r="4.1" />
      <circle cx="17.5" cy="6.6" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function YoutubeIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814ZM9.545 15.568V8.432L15.818 12l-6.273 3.568Z" />
    </svg>
  );
}

function LinkedinIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286ZM5.337 7.433a2.063 2.063 0 1 1 0-4.126 2.063 2.063 0 0 1 0 4.126Zm1.782 13.019H3.555V9h3.564v11.452ZM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003Z" />
    </svg>
  );
}

const SOCIAL_LINKS: SocialLink[] = [
  {
    name: "Instagram",
    href: "https://www.instagram.com/edc_iitd/",
    icon: InstagramIcon,
  },
  {
    name: "X",
    href: "https://x.com/edciitdelhi",
    icon: XIcon,
  },
  {
    name: "YouTube",
    href: "https://www.youtube.com/@edciitd6869",
    icon: YoutubeIcon,
  },
  {
    name: "LinkedIn",
    href: "https://www.linkedin.com/company/edc-iit-delhi/",
    icon: LinkedinIcon,
  },
];

/** Influence radius along the vertical axis, in CSS pixels. */
const DOCK_DISTANCE = 72;
/** Peak scale of the nearest icon. Modest on purpose — keeps neighbors from overlapping. */
const DOCK_MAX_SCALE = 1.42;

/**
 * Dock magnification without the `motion` library.
 *
 * The React Bits Dock runs springs + AnimatePresence on every item for the life
 * of the page. Here the cost is zero until a fine pointer enters this 4-item
 * nav, then four CSS custom properties are written per move (transform only,
 * no layout). Touch / reduced-motion devices keep the static icons.
 */
export function SocialLinks() {
  const navRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const centersRef = useRef<number[]>([]);
  const rafRef = useRef(0);
  const pendingYRef = useRef<number | null>(null);
  // Capability is stored in a ref so touch devices pay only a boolean check
  // inside the handlers — no setState, no re-render, no cascading effects.
  const dockEnabledRef = useRef(false);

  useEffect(() => {
    dockEnabledRef.current =
      window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  function cacheCenters() {
    centersRef.current = itemRefs.current.map((el) => {
      if (!el) {
        return 0;
      }

      const rect = el.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
  }

  function applyScales(clientY: number) {
    const centers = centersRef.current;

    for (let i = 0; i < itemRefs.current.length; i++) {
      const el = itemRefs.current[i];

      if (!el) {
        continue;
      }

      const distance = Math.abs(clientY - centers[i]);
      const t = Math.max(0, 1 - distance / DOCK_DISTANCE);
      // Ease the falloff so the peak feels local, like macOS.
      const scale = 1 + (DOCK_MAX_SCALE - 1) * t * t;
      el.style.setProperty("--dock-scale", scale.toFixed(3));
      el.style.zIndex = String(Math.round(scale * 10));
    }
  }

  function flushPending() {
    rafRef.current = 0;
    const y = pendingYRef.current;

    if (y == null) {
      return;
    }

    applyScales(y);
  }

  function onPointerEnter() {
    if (!dockEnabledRef.current || !navRef.current) {
      return;
    }

    navRef.current.classList.add("is-tracking");
    cacheCenters();
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    if (!dockEnabledRef.current) {
      return;
    }

    pendingYRef.current = event.clientY;

    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(flushPending);
    }
  }

  function onPointerLeave() {
    if (!dockEnabledRef.current || !navRef.current) {
      return;
    }

    navRef.current.classList.remove("is-tracking");
    pendingYRef.current = null;

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }

    for (const el of itemRefs.current) {
      if (!el) {
        continue;
      }

      el.style.setProperty("--dock-scale", "1");
      el.style.zIndex = "";
    }
  }

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return (
    <nav
      aria-label="eDC IIT Delhi on social media"
      className="social-bar"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerMove={onPointerMove}
      ref={navRef}
    >
      {SOCIAL_LINKS.map(({ name, href, icon: Icon }, index) => (
        <a
          aria-label={`eDC IIT Delhi on ${name}`}
          className="social-link"
          data-label={name}
          href={href}
          key={name}
          ref={(node) => {
            itemRefs.current[index] = node;
          }}
          rel="noopener noreferrer"
          target="_blank"
        >
          <Icon />
        </a>
      ))}
    </nav>
  );
}
