export interface RecoveredOnboardingState {
  complete: boolean;
  open: boolean;
}

export const recoverOnboardingState = (
  workspace: { onboardingComplete?: unknown } | null,
): RecoveredOnboardingState => {
  const complete = workspace?.onboardingComplete === true;
  return { complete, open: !complete };
};
