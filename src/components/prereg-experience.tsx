"use client";

import Image from "next/image";
import Script from "next/script";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { CONSENT_VERSION, COUNTER_BASE } from "@/lib/config";
import type { CounterPayload } from "@/lib/schemas";
import RotatingText from "@/components/ui/rotating-text";
import SpecularButton from "@/components/ui/specular-button";
import { SiteBackground } from "@/components/ui/site-background";
import { LearnMoreLinks } from "@/components/learn-more-links";
import { SocialLinks } from "@/components/social-links";

type Step = "identity" | "type" | "startup" | "campus" | "success";
type RegistrationKind = "individual" | "startup";

type IdentityForm = {
  fullName: string;
  email: string;
  phone: string;
};

type StartupForm = {
  name: string;
  linkedinUrl: string;
  websiteUrl: string;
  about: string;
};

type CampusAmbassadorForm = {
  college: string;
  city: string;
  yearOfStudy: string;
  socialUrl: string;
  motivation: string;
};

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          theme: "dark";
          callback: (token: string) => void;
          "expired-callback": () => void;
          "error-callback": () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove?: (widgetId: string) => void;
    };
  }
}

const initialIdentity: IdentityForm = {
  fullName: "",
  email: "",
  phone: "",
};

const initialStartup: StartupForm = {
  name: "",
  linkedinUrl: "",
  websiteUrl: "",
  about: "",
};

const initialCampusAmbassador: CampusAmbassadorForm = {
  college: "",
  city: "",
  yearOfStudy: "",
  socialUrl: "",
  motivation: "",
};

export function PreregExperience({ editionSlug }: { editionSlug: string }) {
  const [counter, setCounter] = useState<CounterPayload | null>(null);
  const [counterError, setCounterError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<Step>("identity");
  const [registrationKind, setRegistrationKind] =
    useState<RegistrationKind>("individual");
  const [identity, setIdentity] = useState<IdentityForm>(initialIdentity);
  const [startup, setStartup] = useState<StartupForm>(initialStartup);
  const [campusAmbassador, setCampusAmbassador] =
    useState<CampusAmbassadorForm>(initialCampusAmbassador);
  const [registrantId, setRegistrantId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState(
    "You're pre-registered for BECon.",
  );
  const [turnstileToken, setTurnstileToken] = useState<string | undefined>();
  // Honeypot — must stay empty. Autofill bots that stamp every input get discarded.
  const [honeypot, setHoneypot] = useState("");

  const turnstileConfigured = Boolean(
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim(),
  );

  const refreshCounters = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/v1/counters/${encodeURIComponent(editionSlug)}`,
        {
          headers: { accept: "application/json" },
          cache: "no-store",
        },
      );

      if (!response.ok) {
        throw new Error("Counters are temporarily unavailable.");
      }

      const payload = (await response.json()) as CounterPayload;
      setCounter(payload);
      setCounterError(null);
    } catch {
      setCounterError("Live counters will reconnect shortly.");
    }
  }, [editionSlug]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void refreshCounters();
    }, 0);

    // Realtime is the main path; this slow poll is only a resilience fallback.
    const interval = window.setInterval(() => {
      void refreshCounters();
    }, 60000);

    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [refreshCounters]);

  useEffect(() => {
    if (!counter?.editionId) {
      return;
    }

    let isSubscribed = true;
    let unsubscribe: (() => void) | undefined;

    void import("@/lib/supabase-browser")
      .then(({ createSupabaseBrowserClient }) => {
        if (!isSubscribed) {
          return;
        }

        const supabase = createSupabaseBrowserClient();

        if (!supabase) {
          return;
        }

        const channel = supabase
          .channel(`edition-counter:${counter.editionId}`)
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "edition_counters",
              filter: `edition_id=eq.${counter.editionId}`,
            },
            (payload) => {
              const next = payload.new as {
                people_count: number;
                startup_count: number;
                sponsor_count: number;
                campus_ambassador_count: number;
                updated_at: string;
              };

              setCounter((current) =>
                current
                  ? {
                      ...current,
                      people: next.people_count,
                      startups: next.startup_count,
                      sponsors: next.sponsor_count,
                      campusAmbassadors: next.campus_ambassador_count,
                      updatedAt: next.updated_at,
                    }
                  : current,
              );
            },
          )
          .subscribe();

        unsubscribe = () => {
          void supabase.removeChannel(channel);
        };
      })
      .catch(() => {
        // Polling remains active as the fallback if the realtime chunk fails.
      });

    return () => {
      isSubscribed = false;
      unsubscribe?.();
    };
  }, [counter?.editionId]);

  function openModal() {
    setIsOpen(true);
    goToStep("type");
  }

  function closeModal() {
    if (isSubmitting) {
      return;
    }

    setIsOpen(false);
  }

  function trackingParams() {
    const params = new URLSearchParams(window.location.search);

    return {
      utmSource: params.get("utm_source") ?? undefined,
      utmMedium: params.get("utm_medium") ?? undefined,
      utmCampaign: params.get("utm_campaign") ?? undefined,
      referralCode: params.get("ref") ?? params.get("referral") ?? undefined,
    };
  }

  function goToStep(nextStep: Step) {
    setTurnstileToken(undefined);
    setError(null);
    setStep(nextStep);
  }

  async function submitRegistration(
    type: "individual" | "startup",
    startupPayload?: StartupForm,
  ) {
    if (turnstileConfigured && !turnstileToken) {
      setError("Please complete the verification challenge.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/v1/registrants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          editionSlug,
          fullName: identity.fullName,
          email: identity.email,
          phone: identity.phone,
          type,
          startup:
            type === "startup" && startupPayload
              ? {
                  name: startupPayload.name,
                  linkedinUrl: startupPayload.linkedinUrl,
                  websiteUrl: startupPayload.websiteUrl,
                  about: startupPayload.about,
                }
              : undefined,
          consentVersion: CONSENT_VERSION,
          turnstileToken,
          website: honeypot,
          ...trackingParams(),
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.error?.message || "Registration failed. Please try again.",
        );
      }

      setRegistrantId(payload.registrantId);
      setSuccessMessage(
        type === "startup"
          ? "Your startup is pre-registered for BECon."
          : "You're pre-registered for BECon.",
      );
      await refreshCounters();
      goToStep(type === "individual" ? "campus" : "success");
    } catch (registrationError) {
      setError(
        registrationError instanceof Error
          ? registrationError.message
          : "Registration failed. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitCampusAmbassador(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!registrantId) {
      goToStep("success");
      return;
    }

    if (turnstileConfigured && !turnstileToken) {
      setError("Please complete the verification challenge.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/v1/campus-ambassador/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          registrantId,
          ...campusAmbassador,
          turnstileToken,
          website: honeypot,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.error?.message ||
            "Campus ambassador application failed. Please try again.",
        );
      }

      setSuccessMessage(
        "You're pre-registered and your campus ambassador application is in.",
      );
      await refreshCounters();
      goToStep("success");
    } catch (applicationError) {
      setError(
        applicationError instanceof Error
          ? applicationError.message
          : "Campus ambassador application failed. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="page-shell">
      <SiteBackground />

      <header className="site-header">
        <Image
          alt="Entrepreneurship Development Cell, IIT Delhi"
          className="site-header__logo site-header__logo--edc"
          height={200}
          src="/edc-logo.png"
          width={200}
        />
        <Image
          alt="Indian Institute of Technology Delhi"
          className="site-header__logo site-header__logo--iitd"
          height={458}
          src="/iitd-logo.png"
          width={436}
        />
      </header>

      <section className="hero-card" aria-labelledby="hero-title">
        <div className="brand-lockup">
          <h1 className="sr-only" id="hero-title">
            BECon Pre-Registration
          </h1>
          <Image
            className="becon-logo"
            src="/becon_logo.png"
            alt="BECon"
            width={1009}
            height={686}
            priority
          />
        </div>

        <p className="hero-copy">
          eDC IIT Delhi&apos;s flagship entrepreneurship summit. Pre-register
          to lock in your spot and get updates first.
        </p>

        <div className="hero-actions">
          <SpecularButton
            size="lg"
            radius={18}
            tint="#ffffff"
            tintOpacity={0}
            blur={0}
            textColor="#f5f5f5"
            lineColor="#ffffff"
            baseColor="#525252"
            intensity={1}
            shineSize={10}
            shineFade={40}
            thickness={1}
            speed={0.35}
            followMouse
            proximity={250}
            autoAnimate={false}
            paused={isOpen}
            type="button"
            onClick={openModal}
          >
            Pre-register
          </SpecularButton>
        </div>

        <div className="counter-panel">
          <CounterGrid counter={counter} />
          {counterError ? (
            <p className="counter-note" aria-live="polite">
              {counterError}
            </p>
          ) : null}
        </div>
      </section>

      <footer className="site-footer">
        <LearnMoreLinks />
        <SocialLinks />
      </footer>

      {isOpen ? (
        <RegistrationModal
          step={step}
          registrationKind={registrationKind}
          identity={identity}
          startup={startup}
          campusAmbassador={campusAmbassador}
          isSubmitting={isSubmitting}
          error={error}
          successMessage={successMessage}
          onClose={closeModal}
          onIdentityChange={setIdentity}
          onStartupChange={setStartup}
          onCampusAmbassadorChange={setCampusAmbassador}
          onIdentitySubmit={() => {
            if (registrationKind === "individual") {
              void submitRegistration("individual");
              return;
            }

            goToStep("startup");
          }}
          onIndividualChoice={() => {
            setRegistrationKind("individual");
            goToStep("identity");
          }}
          onStartupChoice={() => {
            setRegistrationKind("startup");
            goToStep("identity");
          }}
          onStartupSubmit={(event) => {
            event.preventDefault();
            void submitRegistration("startup", startup);
          }}
          onCampusAmbassadorSubmit={submitCampusAmbassador}
          onSkipCampusAmbassador={() => goToStep("success")}
          onBack={() => {
            if (step === "identity") {
              goToStep("type");
              return;
            }

            if (step === "startup") {
              goToStep("identity");
              return;
            }

            goToStep("type");
          }}
          onTurnstileToken={setTurnstileToken}
          honeypot={honeypot}
          onHoneypotChange={setHoneypot}
          botProtectionMissing={false}
        />
      ) : null}
    </main>
  );
}

function CounterGrid({ counter }: { counter: CounterPayload | null }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const labels = ["Attendees", "Startups"] as const;
  // Base floor always shows; real edition_counters rows stack on top.
  const people = COUNTER_BASE.people + (counter?.people ?? 0);
  const startups = COUNTER_BASE.startups + (counter?.startups ?? 0);
  const texts = [formatCount(people), formatCount(startups)];

  return (
    <div className="counter-grid" aria-label="BECon live counters">
      <div className="counter-card">
        <RotatingText
          texts={texts}
          mainClassName="counter-rotate"
          staggerFrom="last"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "-120%" }}
          staggerDuration={0.025}
          splitLevelClassName="counter-rotate__split"
          transition={{ type: "spring", damping: 30, stiffness: 400 }}
          rotationInterval={2000}
          splitBy="characters"
          auto
          loop
          onNext={setActiveIndex}
        />
        <span className="counter-label">{labels[activeIndex]}</span>
      </div>
    </div>
  );
}

function RegistrationModal({
  step,
  registrationKind,
  identity,
  startup,
  campusAmbassador,
  isSubmitting,
  error,
  successMessage,
  onClose,
  onIdentityChange,
  onStartupChange,
  onCampusAmbassadorChange,
  onIdentitySubmit,
  onIndividualChoice,
  onStartupChoice,
  onStartupSubmit,
  onCampusAmbassadorSubmit,
  onSkipCampusAmbassador,
  onBack,
  onTurnstileToken,
  honeypot,
  onHoneypotChange,
  botProtectionMissing,
}: {
  step: Step;
  registrationKind: RegistrationKind;
  identity: IdentityForm;
  startup: StartupForm;
  campusAmbassador: CampusAmbassadorForm;
  isSubmitting: boolean;
  error: string | null;
  successMessage: string;
  onClose: () => void;
  onIdentityChange: (value: IdentityForm) => void;
  onStartupChange: (value: StartupForm) => void;
  onCampusAmbassadorChange: (value: CampusAmbassadorForm) => void;
  onIdentitySubmit: () => void;
  onIndividualChoice: () => void;
  onStartupChoice: () => void;
  onStartupSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCampusAmbassadorSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSkipCampusAmbassador: () => void;
  onBack: () => void;
  onTurnstileToken: (token: string | undefined) => void;
  honeypot: string;
  onHoneypotChange: (value: string) => void;
  botProtectionMissing: boolean;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div
        aria-labelledby="modal-title"
        aria-modal="true"
        className="modal"
        role="dialog"
      >
        <div className="modal-header">
          <div>
            <h2 className="modal-title" id="modal-title">
              {modalTitle(step, registrationKind)}
            </h2>
            <p className="modal-subtitle">
              {modalSubtitle(step, registrationKind)}
            </p>
          </div>
          <button
            aria-label="Close registration modal"
            className="close-button"
            disabled={isSubmitting}
            type="button"
            onClick={onClose}
          >
            x
          </button>
        </div>

        {step === "identity" ? (
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              onIdentitySubmit();
            }}
          >
            <TextField
              autoComplete="name"
              label="Full name"
              name="fullName"
              required
              value={identity.fullName}
              onChange={(fullName) =>
                onIdentityChange({ ...identity, fullName })
              }
            />
            <TextField
              autoComplete="email"
              label="Email ID"
              name="email"
              required
              type="email"
              value={identity.email}
              onChange={(email) => onIdentityChange({ ...identity, email })}
            />
            <TextField
              autoComplete="tel"
              label="Contact number"
              name="phone"
              required
              type="tel"
              value={identity.phone}
              onChange={(phone) => onIdentityChange({ ...identity, phone })}
            />
            <HoneypotField value={honeypot} onChange={onHoneypotChange} />
            {registrationKind === "individual" ? (
              <TurnstileField onToken={onTurnstileToken} />
            ) : null}
            {botProtectionMissing ? (
              <div className="error-box">
                Registration is temporarily unavailable. Please try again later.
              </div>
            ) : null}
            {error ? <div className="error-box">{error}</div> : null}
            <div className="actions">
              <button
                className="btn-primary"
                disabled={isSubmitting || botProtectionMissing}
                type="submit"
              >
                {registrationKind === "individual"
                  ? isSubmitting
                    ? "Registering..."
                    : "Pre-register"
                  : "Continue"}
              </button>
              <button
                className="btn-secondary"
                disabled={isSubmitting}
                type="button"
                onClick={onBack}
              >
                Back
              </button>
            </div>
          </form>
        ) : null}

        {step === "type" ? (
          <div className="form">
            {error ? <div className="error-box">{error}</div> : null}
            <div className="choice-grid">
              <button
                className="choice-card"
                disabled={isSubmitting}
                type="button"
                onClick={onIndividualChoice}
              >
                Individual
              </button>
              <button
                className="choice-card"
                disabled={isSubmitting}
                type="button"
                onClick={onStartupChoice}
              >
                Startup
              </button>
            </div>
          </div>
        ) : null}

        {step === "startup" ? (
          <form className="form" onSubmit={onStartupSubmit}>
            <TextField
              label="Startup name"
              name="startupName"
              required
              value={startup.name}
              onChange={(name) => onStartupChange({ ...startup, name })}
            />
            <TextField
              label="Startup LinkedIn URL (optional)"
              name="linkedinUrl"
              type="url"
              value={startup.linkedinUrl}
              onChange={(linkedinUrl) =>
                onStartupChange({ ...startup, linkedinUrl })
              }
            />
            <TextField
              label="Startup website URL (optional)"
              name="websiteUrl"
              type="url"
              value={startup.websiteUrl}
              onChange={(websiteUrl) =>
                onStartupChange({ ...startup, websiteUrl })
              }
            />
            <TextareaField
              label="About the startup (optional)"
              name="about"
              value={startup.about}
              onChange={(about) => onStartupChange({ ...startup, about })}
            />
            <HoneypotField value={honeypot} onChange={onHoneypotChange} />
            <TurnstileField onToken={onTurnstileToken} />
            {botProtectionMissing ? (
              <div className="error-box">
                Registration is temporarily unavailable. Please try again later.
              </div>
            ) : null}
            {error ? <div className="error-box">{error}</div> : null}
            <div className="actions">
              <button
                className="btn-primary"
                disabled={isSubmitting || botProtectionMissing}
                type="submit"
              >
                {isSubmitting ? "Registering..." : "Done"}
              </button>
              <button
                className="btn-secondary"
                disabled={isSubmitting}
                type="button"
                onClick={onBack}
              >
                Back
              </button>
            </div>
          </form>
        ) : null}

        {step === "campus" ? (
          <form className="form" onSubmit={onCampusAmbassadorSubmit}>
            <div className="success-box">
              You are pre-registered. You can also apply for the campus
              ambassador program now.
            </div>
            <TextField
              label="College (optional)"
              name="college"
              value={campusAmbassador.college}
              onChange={(college) =>
                onCampusAmbassadorChange({ ...campusAmbassador, college })
              }
            />
            <TextField
              label="City (optional)"
              name="city"
              value={campusAmbassador.city}
              onChange={(city) =>
                onCampusAmbassadorChange({ ...campusAmbassador, city })
              }
            />
            <TextField
              label="Year of study (optional)"
              name="yearOfStudy"
              value={campusAmbassador.yearOfStudy}
              onChange={(yearOfStudy) =>
                onCampusAmbassadorChange({
                  ...campusAmbassador,
                  yearOfStudy,
                })
              }
            />
            <TextField
              label="LinkedIn or Instagram URL (optional)"
              name="socialUrl"
              type="url"
              value={campusAmbassador.socialUrl}
              onChange={(socialUrl) =>
                onCampusAmbassadorChange({ ...campusAmbassador, socialUrl })
              }
            />
            <TextareaField
              label="Why do you want to represent BECon? (optional)"
              name="motivation"
              value={campusAmbassador.motivation}
              onChange={(motivation) =>
                onCampusAmbassadorChange({
                  ...campusAmbassador,
                  motivation,
                })
              }
            />
            <HoneypotField value={honeypot} onChange={onHoneypotChange} />
            <TurnstileField onToken={onTurnstileToken} />
            {botProtectionMissing ? (
              <div className="error-box">
                Applications are temporarily unavailable. Please try again later.
              </div>
            ) : null}
            {error ? <div className="error-box">{error}</div> : null}
            <div className="actions">
              <button
                className="btn-primary"
                disabled={isSubmitting || botProtectionMissing}
                type="submit"
              >
                {isSubmitting ? "Applying..." : "Apply now"}
              </button>
              <button
                className="btn-secondary"
                disabled={isSubmitting}
                type="button"
                onClick={onSkipCampusAmbassador}
              >
                Skip for now
              </button>
            </div>
          </form>
        ) : null}

        {step === "success" ? (
          <div className="form">
            <div className="success-box">{successMessage}</div>
            <p className="modal-subtitle">
              We will use your details only for BECon updates and related eDC
              opportunities.
            </p>
            <div className="actions">
              <button
                className="btn-primary"
                type="button"
                onClick={onClose}
              >
                Done
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TextField({
  label,
  name,
  value,
  onChange,
  type = "text",
  required = false,
  autoComplete,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  autoComplete?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <input
        autoComplete={autoComplete}
        id={name}
        name={name}
        required={required}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function TextareaField({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <textarea
        id={name}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function HoneypotField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div aria-hidden="true" className="hp-field">
      <label htmlFor="company_website">Website</label>
      <input
        autoComplete="off"
        id="company_website"
        name="website"
        tabIndex={-1}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function TurnstileField({
  onToken,
}: {
  onToken: (token: string | undefined) => void;
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey) {
      onToken(undefined);
      return;
    }

    const resolvedSiteKey = siteKey;
    function renderWidget() {
      if (!containerRef.current || !window.turnstile || widgetIdRef.current) {
        return;
      }

      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: resolvedSiteKey,
        theme: "dark",
        callback: (token) => onToken(token),
        "expired-callback": () => onToken(undefined),
        "error-callback": () => onToken(undefined),
      });
    }

    const interval = window.setInterval(renderWidget, 250);
    renderWidget();

    return () => {
      window.clearInterval(interval);

      if (widgetIdRef.current && window.turnstile?.remove) {
        window.turnstile.remove(widgetIdRef.current);
      }

      widgetIdRef.current = null;
    };
  }, [onToken, siteKey]);

  if (!siteKey) {
    return null;
  }

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
      />
      <div className="turnstile-slot" ref={containerRef} />
    </>
  );
}

function modalTitle(step: Step, registrationKind: RegistrationKind) {
  switch (step) {
    case "identity":
      return registrationKind === "startup"
        ? "Your contact details"
        : "Attendee details";
    case "type":
      return "How are you joining BECon?";
    case "startup":
      return "Startup details";
    case "campus":
      return "Campus ambassador";
    case "success":
      return "You're in";
  }
}

function modalSubtitle(step: Step, registrationKind: RegistrationKind) {
  switch (step) {
    case "identity":
      return registrationKind === "startup"
        ? "First, tell us who from the startup team is registering."
        : "Tell us who is attending. You can apply for the campus ambassador program after this.";
    case "type":
      return "Choose one path first so the form only asks for relevant details.";
    case "startup":
      return "Only the startup name is required. Links and description can be added now or later.";
    case "campus":
      return "Optional, but useful if you want to help bring BECon to your campus network.";
    case "success":
      return "Thanks for pre-registering.";
  }
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

