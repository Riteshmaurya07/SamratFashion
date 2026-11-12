import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/AppError";
import { isTurnstileEnabled, verifyTurnstileToken } from "../services/turnstileService";

const CAPTCHA_TOKEN_FIELD = "captchaToken";

function readCaptchaToken(req: Request): string | undefined {
  const body = req.body as Record<string, unknown> | undefined;
  const fromBody = body?.[CAPTCHA_TOKEN_FIELD];
  if (typeof fromBody === "string" && fromBody) {
    return fromBody;
  }

  // Cloudflare's widget optionally posts the token under this header.
  const header = req.headers["cf-turnstile-response"];
  if (Array.isArray(header)) {
    return header[0];
  }
  return header;
}

/**
 * Express middleware that requires a valid Turnstile token when CAPTCHA is
 * enabled (TURNSTILE_ENABLED=true). When disabled, it is a no-op so local
 * development and the existing test suites keep working.
 */
export function requireTurnstile(expectedAction: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!isTurnstileEnabled()) {
      next();
      return;
    }

    const token = readCaptchaToken(req);
    if (!token) {
      next(
        new AppError(
          "Please complete the CAPTCHA verification and try again.",
          400,
          "CAPTCHA_REQUIRED"
        )
      );
      return;
    }

    const isValid = await verifyTurnstileToken(token, {
      remoteIp: req.ip,
      expectedAction,
    });

    if (!isValid) {
      next(
        new AppError(
          "CAPTCHA verification failed. Please refresh the page and try again.",
          400,
          "CAPTCHA_FAILED"
        )
      );
      return;
    }

    next();
  };
}
