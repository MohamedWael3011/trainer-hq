import { describe, expect, it } from 'vitest';
import { GOOGLE_CLOUD_EXPIRED_NOTE, SignInKind, isSignInKind, signInsNeeded } from '../src/shared/signIn';

describe('signInsNeeded', () => {
  it('spots Google Cloud sign-in requests in replies, errors and notes', () => {
    expect(signInsNeeded('To unblock me, run `! /opt/homebrew/bin/gcloud auth login` and ask again.')).toEqual([SignInKind.GOOGLE_CLOUD]);
    expect(signInsNeeded('Reauthentication failed. cannot prompt during non-interactive execution.')).toEqual([SignInKind.GOOGLE_CLOUD]);
    expect(signInsNeeded("Porygon couldn't run any queries because its BigQuery auth has expired")).toEqual([SignInKind.GOOGLE_CLOUD]);
    expect(signInsNeeded(GOOGLE_CLOUD_EXPIRED_NOTE)).toEqual([SignInKind.GOOGLE_CLOUD]);
  });

  it('spots GitHub sign-in requests', () => {
    expect(signInsNeeded('Run `gh auth login` first.')).toEqual([SignInKind.GITHUB]);
  });

  it('stays quiet for ordinary text', () => {
    expect(signInsNeeded('The icon swap looks safe. BigQuery returned 3 rows.')).toEqual([]);
  });

  it('only accepts known sign-ins from the renderer', () => {
    expect(isSignInKind(SignInKind.GITHUB)).toBe(true);
    expect(isSignInKind('gh auth login; rm -rf ~')).toBe(false);
  });
});
