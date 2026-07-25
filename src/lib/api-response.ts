import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function jsonOk<T>(payload: T, init?: ResponseInit) {
  return NextResponse.json(payload, init);
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        details,
      },
    },
    { status },
  );
}

export function validationError(error: ZodError) {
  return jsonError(400, "validation_error", "Please check the form fields.", {
    fields: error.flatten().fieldErrors,
  });
}

export function isDuplicateError(error: { code?: string; message?: string }) {
  return (
    error.code === "23505" ||
    error.message?.toLowerCase().includes("duplicate key")
  );
}
