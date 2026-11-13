export const SignInKind = {
  GOOGLE_CLOUD: 'google-cloud',
  GITHUB: 'github',
} as const;

export type SignInKindType = (typeof SignInKind)[keyof typeof SignInKind];

export const SIGN_IN_LABEL: Record<SignInKindType, string> = {
  [SignInKind.GOOGLE_CLOUD]: 'Sign in to Google Cloud',
  [SignInKind.GITHUB]: 'Sign in to GitHub',
};

export const SIGN_IN_COMMAND: Record<SignInKindType, string> = {
  [SignInKind.GOOGLE_CLOUD]: 'gcloud auth login --update-adc',
  [SignInKind.GITHUB]: 'gh auth login',
};

const SIGN_IN_HINTS: Record<SignInKindType, RegExp> = {
  [SignInKind.GOOGLE_CLOUD]: /gcloud auth (?:application-default )?login|Reauthentication failed|Google Cloud sign-in (?:has )?expired|BigQuery auth(?:entication)? (?:has )?expired/i,
  [SignInKind.GITHUB]: /gh auth (?:login|refresh)/i,
};

export const GOOGLE_CLOUD_EXPIRED_NOTE = 'Google Cloud sign-in has expired, so BigQuery and gcloud commands will fail until you sign in again. Sign in below, then send your message again.';

export const isSignInKind = (value: unknown): value is SignInKindType =>
  Object.values(SignInKind).includes(value as SignInKindType);

export const signInsNeeded = (text: string): SignInKindType[] =>
  Object.values(SignInKind).filter((kind) => SIGN_IN_HINTS[kind].test(text));
