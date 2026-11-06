import { z } from "zod";

const passwordSchema = z.string().min(8, "Password must be at least 8 characters long")
  .max(72, "Password must be at most 72 characters long") // bcrypt truncates past 72 bytes
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number");

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
