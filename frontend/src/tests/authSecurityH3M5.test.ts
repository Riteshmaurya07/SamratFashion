import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { api } from "../lib/api.ts";

test("H3: api client uses withCredentials for httpOnly cookies and does not use localStorage for accessToken", () => {
  // Verify api instance sends cookies with requests
  assert.equal(
    api.defaults.withCredentials,
    true,
    "api Axios instance must have withCredentials = true to send httpOnly cookies"
  );

  // Read api.ts source code to verify static security properties
  const apiFilePath = path.resolve(process.cwd(), "src/lib/api.ts");
  const apiSource = fs.readFileSync(apiFilePath, "utf8");

  // Verify access token is not read from localStorage on every request
  assert.equal(
    apiSource.includes('localStorage.getItem("accessToken")'),
    false,
    "api.ts must not read accessToken from localStorage"
  );

  // Verify access token is not written into localStorage
  assert.equal(
    apiSource.includes('localStorage.setItem("accessToken"'),
    false,
    "api.ts must not write accessToken to localStorage"
  );

  // Verify BroadcastChannel does not send token material
  assert.equal(
    apiSource.includes('type: "access-token"'),
    false,
    "BroadcastChannel must not broadcast raw access token values across tabs"
  );

  // Verify BroadcastChannel only sends the tokenless 'session-refreshed' signal
  assert.equal(
    apiSource.includes('type: "session-refreshed"'),
    true,
    "BroadcastChannel must broadcast session-refreshed signal without token material"
  );
});

test("H3: frontend auth pages and components do not write accessToken into localStorage", () => {
  const authFiles = [
    "src/app/(auth)/login/page.tsx",
    "src/app/(auth)/admin/login/page.tsx",
    "src/app/(auth)/register/page.tsx",
    "src/app/(auth)/verify-email/page.tsx",
    "src/components/auth/GoogleAuthButton.tsx",
  ];

  for (const relPath of authFiles) {
    const fullPath = path.resolve(process.cwd(), relPath);
    if (fs.existsSync(fullPath)) {
      const src = fs.readFileSync(fullPath, "utf8");
      assert.equal(
        src.includes('localStorage.setItem("accessToken"'),
        false,
        `${relPath} must not write accessToken to localStorage`
      );
    }
  }
});

test("M5: Next.js image remotePatterns rejects arbitrary hosts and only allows trusted hosts", () => {
  const nextConfigPath = path.resolve(process.cwd(), "next.config.ts");
  const configSource = fs.readFileSync(nextConfigPath, "utf8");

  // Verify wildcard hostname '**' is completely removed
  assert.equal(
    configSource.includes('hostname: "**"'),
    false,
    "next.config.ts must not permit wildcard hostname '**' in remotePatterns"
  );

  // Verify trusted Cloudinary host is allowed
  assert.equal(
    configSource.includes('hostname: "res.cloudinary.com"'),
    true,
    "next.config.ts must permit res.cloudinary.com"
  );

  // Verify trusted Unsplash host is allowed
  assert.equal(
    configSource.includes('hostname: "images.unsplash.com"'),
    true,
    "next.config.ts must permit images.unsplash.com"
  );
});
