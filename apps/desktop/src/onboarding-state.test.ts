import { describe, expect, it } from "vitest";
import { recoverOnboardingState } from "./onboarding-state.js";

describe("onboarding state recovery", () => {
  it("reopens onboarding when a saved workspace is not complete", () => {
    expect(recoverOnboardingState({ onboardingComplete: false })).toEqual({
      complete: false,
      open: true,
    });
  });
});
