import { z } from "zod";
import crypto from "crypto";

const COMMON_PASSWORDS = new Set([
  "password", "password123", "password1", "password12", "pass1234",
  "qwerty123", "qwertyuiop", "12345678", "123456789", "1234567890",
  "admin123", "welcome123", "letmein123", "iloveyou123", "monkey123",
  "dragon123", "sunshine1", "master123", "samrat123", "fashion123",
  "charlie123", "football123", "shadow123", "trustno1", "superman1"
]);

export function isCommonPassword(pass: string): boolean {
  const normalized = pass.trim().toLowerCase();
  if (COMMON_PASSWORDS.has(normalized)) return true;
  if (/^(password|qwerty|admin|welcome|12345678)/i.test(normalized)) return true;
  return false;
}

export async function checkPwnedPassword(password: string): Promise<boolean> {
  try {
    const sha1 = crypto.createHash("sha1").update(password).digest("hex").toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "User-Agent": "SamratFashion-SecurityCheck" },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return false;
    const text = await res.text();
    const lines = text.split("\n");
    for (const line of lines) {
      const [hashSuffix, countStr] = line.trim().split(":");
      if (hashSuffix === suffix) {
        const count = parseInt(countStr || "0", 10);
        return count > 0;
      }
    }
    return false;
  } catch {
    return false;
  }
}

const passwordSchema = z.string().min(8, "Password must be at least 8 characters long")
  .max(72, "Password must be at most 72 characters long") // bcrypt truncates past 72 bytes
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .refine((val) => !isCommonPassword(val), {
    message: "This password is too common or easily guessable. Please choose a more secure password.",
  });

export const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  phone: z.string().optional(),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Token is required"),
  newPassword: passwordSchema,
});

export const verifyEmailSchema = z.object({
  email: z.string().email("Invalid email address").optional(),
  otp: z.string().min(4, "Verification code is required").max(10).optional(),
  token: z.string().min(1, "Verification token is required").optional(),
}).refine((data) => Boolean((data.email && data.otp) || data.token), {
  message: "Either verification token or email and code must be provided",
  path: ["otp"],
});

export const resendVerificationSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export const googleAuthSchema = z.object({
  credential: z.string().min(1, "Google credential or token is required").optional(),
  code: z.string().min(1).optional(),
  mockUser: z.object({
    email: z.string().email(),
    name: z.string().min(1),
    avatar: z.string().optional(),
    googleId: z.string().optional(),
  }).optional(),
}).refine((data) => Boolean(data.credential || data.code || data.mockUser), {
  message: "Either Google credential, code, or mockUser must be provided",
});
