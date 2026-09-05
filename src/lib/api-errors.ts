import { NextResponse } from "next/server";

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
}

/**
 * Standardized error response envelope for all API routes.
 * Ensures consistent shape: { error: { code, message, details? } }
 */
export function apiError(
  code: string,
  message: string,
  status: number = 500,
  details?: Record<string, any>
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    { error: { code, message, details } },
    { status }
  );
}

export function badRequest(message: string, details?: Record<string, any>) {
  return apiError("BAD_REQUEST", message, 400, details);
}

export function unauthorized(message: string = "Authentication required") {
  return apiError("UNAUTHORIZED", message, 401);
}

export function forbidden(message: string = "Insufficient permissions") {
  return apiError("FORBIDDEN", message, 403);
}

export function notFound(message: string = "Resource not found") {
  return apiError("NOT_FOUND", message, 404);
}

export function conflict(message: string, details?: Record<string, any>) {
  return apiError("CONFLICT", message, 409, details);
}

export function unprocessable(message: string, details?: Record<string, any>) {
  return apiError("UNPROCESSABLE_ENTITY", message, 422, details);
}

export function tooManyRequests(message: string = "Rate limit exceeded, try again later") {
  return apiError("RATE_LIMITED", message, 429);
}

export function internalError(message: string = "Internal server error") {
  return apiError("INTERNAL_ERROR", message, 500);
}

/**
 * Wraps an async route handler with standardized error catching.
 * Never exposes internal error messages to the client.
 */
export function withErrorHandling(
  handler: (...args: any[]) => Promise<any>
) {
  return async (...args: any[]): Promise<NextResponse> => {
    try {
      const result = await handler(...args);
      return result;
    } catch (err: any) {
      console.error("[API Error]", err);
      if (err.name === "ZodError") {
        return unprocessable("Validation failed", { issues: err.issues });
      }
      if (err.name === "CastError" && err.kind === "ObjectId") {
        return badRequest("Invalid ID format");
      }
      return internalError();
    }
  };
}
