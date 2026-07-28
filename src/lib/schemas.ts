import { z } from "zod";

const optionalText = (max: number) =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }

      const trimmed = value.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    },
    z.string().max(max).optional(),
  );

const optionalUrl = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  },
  z.string().url("Enter a valid URL.").max(300).optional(),
);

export const startupDetailsSchema = z.object({
  name: z.string().trim().min(2, "Startup name is required.").max(120),
  linkedinUrl: optionalUrl,
  websiteUrl: optionalUrl,
  about: optionalText(600),
});

export const registrantSchema = z
  .object({
    editionSlug: z.string().trim().min(1).default("becon-26"),
    fullName: z.string().trim().min(2, "Enter your full name.").max(120),
    email: z.string().trim().toLowerCase().email("Enter a valid email."),
    phone: z
      .string()
      .trim()
      .min(7, "Enter a valid contact number.")
      .max(20)
      .regex(/^[+()\-\s0-9]+$/, "Use a valid contact number."),
    type: z.enum(["individual", "startup"]),
    startup: startupDetailsSchema.optional(),
    source: z.string().trim().max(80).default("standalone_prereg"),
    utmSource: optionalText(120),
    utmMedium: optionalText(120),
    utmCampaign: optionalText(120),
    referralCode: optionalText(80),
    consentVersion: z.string().trim().min(1).default("prereg-v1"),
    turnstileToken: optionalText(2048),
    // Bots often autofill every field. Humans never see this.
    website: optionalText(200),
  })
  .superRefine((value, ctx) => {
    if (value.type === "startup" && !value.startup) {
      ctx.addIssue({
        code: "custom",
        path: ["startup"],
        message: "Startup details are required for startup registration.",
      });
    }
  });

export const campusAmbassadorSchema = z.object({
  registrantId: z.string().uuid("Missing registrant id."),
  college: optionalText(160),
  city: optionalText(120),
  yearOfStudy: optionalText(80),
  socialUrl: optionalUrl,
  motivation: optionalText(600),
  turnstileToken: optionalText(2048),
  website: optionalText(200),
});

export type StartupDetailsInput = z.infer<typeof startupDetailsSchema>;
export type RegistrantInput = z.infer<typeof registrantSchema>;
export type CampusAmbassadorInput = z.infer<typeof campusAmbassadorSchema>;

export type CounterPayload = {
  editionId: string;
  edition: string;
  people: number;
  startups: number;
  sponsors: number;
  campusAmbassadors: number;
  updatedAt: string;
};
