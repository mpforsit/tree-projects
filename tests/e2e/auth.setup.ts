/** Logs in each seed user once via OTP and stores the session state for
 *  the actual specs (one code request per email per run). */
import { test as setup } from "@playwright/test";
import { authState, loginViaOtp } from "./helpers.ts";

const USERS = [
  ["mb", "mpiksa@forsit.de"],
  ["ik", "igor.kraus@forsit.de"],
  ["ms", "marlene.sommer@forsit.de"],
  ["ad", "aylin.demir@forsit.de"],
  ["jt", "jonas.thal@forsit.de"],
] as const;

for (const [short, email] of USERS) {
  setup(`sign in ${email}`, async ({ page }) => {
    await loginViaOtp(page, email);
    await page.context().storageState({ path: authState(short) });
  });
}
