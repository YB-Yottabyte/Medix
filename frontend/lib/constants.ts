import { generateDummyPassword } from "./db/utils";

export const isProductionEnvironment = process.env.NODE_ENV === "production";
export const isDevelopmentEnvironment = process.env.NODE_ENV === "development";
export const isLocalAuthBypassed =
  isDevelopmentEnvironment && process.env.LOCAL_AUTH_BYPASS === "true";
export const isTestEnvironment = Boolean(
  process.env.PLAYWRIGHT_TEST_BASE_URL ||
    process.env.PLAYWRIGHT ||
    process.env.CI_PLAYWRIGHT
);

export const guestRegex = /^guest-\d+$/;

export const DUMMY_PASSWORD = generateDummyPassword();

export const suggestions = [
  "How do I perform CPR on an adult?",
  "How should I clean and dress a minor wound?",
  "What should I check before administering medication?",
  "How can I recognize signs of a medical emergency?",
];
