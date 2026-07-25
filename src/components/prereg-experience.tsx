"use client";

import Image from "next/image";
import Script from "next/script";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { CONSENT_VERSION } from "@/lib/config";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { CounterPayload } from "@/lib/schemas";

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

  const counterUrl = useMemo(
    () => `/api/v1/counters/${encodeURIComponent(editionSlug)}`,
    [editionSlug],
  );

  const refreshCounters = useCallback(async () => {
    try {
      const response = await fetch(counterUrl, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Counters are temporarily unavailable.");
      }

      const payload = (await response.json()) as CounterPayload;
      setCounter(payload);
      setCounterError(null);
    } catch {
      setCounterError("Live counters will reconnect shortly.");
    }
  }, [counterUrl]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void refreshCounters();
    }, 0);
    const interval = window.setInterval(() => {
      void refreshCounters();
    }, 15000);

    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [refreshCounters]);

  useEffect(() => {
    if (!counter?.editionId) {
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

    return () => {
      void supabase.removeChannel(channel);
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
      <div className="hero-aura" aria-hidden="true" />

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
            unoptimized
          />
        </div>

        <div className="hero-actions">
          <button
            className="cta-button"
            type="button"
            onClick={openModal}
            onPointerDown={openModal}
          >
            Pre-register
          </button>
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
        />
      ) : null}
    </main>
  );
}

function CounterGrid({ counter }: { counter: CounterPayload | null }) {
  const values = [
    { label: "Attendees", value: counter?.people },
    { label: "Startups", value: counter?.startups },
  ];

  return (
    <div className="counter-grid" aria-label="BECon live counters">
      {values.map((item) => (
        <div className="counter-card" key={item.label}>
          <span className="counter-value">
            {typeof item.value === "number" ? formatCount(item.value) : "--"}
          </span>
          <span className="counter-label">{item.label}</span>
        </div>
      ))}
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
            onPointerDown={onClose}
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
            {registrationKind === "individual" ? (
              <TurnstileField onToken={onTurnstileToken} />
            ) : null}
            {error ? <div className="error-box">{error}</div> : null}
            <div className="actions">
              <button
                className="cta-button"
                disabled={isSubmitting}
                type="submit"
              >
                {registrationKind === "individual"
                  ? isSubmitting
                    ? "Registering..."
                    : "Pre-register"
                  : "Continue"}
              </button>
              <button
                className="ghost-button"
                disabled={isSubmitting}
                type="button"
                onClick={onBack}
                onPointerDown={onBack}
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
                className="choice-button"
                disabled={isSubmitting}
                type="button"
                onClick={onIndividualChoice}
                onPointerDown={onIndividualChoice}
              >
                <strong>Individual</strong>
              </button>
              <button
                className="choice-button"
                disabled={isSubmitting}
                type="button"
                onClick={onStartupChoice}
                onPointerDown={onStartupChoice}
              >
                <strong>Startup</strong>
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
            <TurnstileField onToken={onTurnstileToken} />
            {error ? <div className="error-box">{error}</div> : null}
            <div className="actions">
              <button className="cta-button" disabled={isSubmitting} type="submit">
                {isSubmitting ? "Registering..." : "Done"}
              </button>
              <button
                className="ghost-button"
                disabled={isSubmitting}
                type="button"
                onClick={onBack}
                onPointerDown={onBack}
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
            <TurnstileField onToken={onTurnstileToken} />
            {error ? <div className="error-box">{error}</div> : null}
            <div className="actions">
              <button
                className="secondary-button"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? "Applying..." : "Apply now"}
              </button>
              <button
                className="ghost-button"
                disabled={isSubmitting}
                type="button"
                onClick={onSkipCampusAmbassador}
                onPointerDown={onSkipCampusAmbassador}
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
                className="cta-button"
                type="button"
                onClick={onClose}
                onPointerDown={onClose}
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
