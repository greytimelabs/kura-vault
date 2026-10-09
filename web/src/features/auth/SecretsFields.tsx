import { Field } from '@/components/ui/Field';

export const MIN_PASSPHRASE_LENGTH = 12;

export interface Secrets {
  password: string;
  confirmPassword: string;
  passphrase: string;
  confirmPassphrase: string;
}

export const EMPTY_SECRETS: Secrets = { password: '', confirmPassword: '', passphrase: '', confirmPassphrase: '' };

// The same rule the server enforces, so the form can say so before sending
const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,128}$/;

/** First problem with each secret, or null. */
export function secretErrors(s: Secrets): Record<keyof Secrets, string | null> {
  return {
    password: PASSWORD_RULE.test(s.password)
      ? null
      : 'At least 12 characters with upper and lower case, a number and a symbol',
    confirmPassword: s.password === s.confirmPassword ? null : 'Passwords do not match',
    passphrase:
      s.passphrase.length < MIN_PASSPHRASE_LENGTH
        ? `Use at least ${MIN_PASSPHRASE_LENGTH} characters`
        : s.passphrase === s.password
          ? 'Must be different from the password'
          : null,
    confirmPassphrase: s.passphrase === s.confirmPassphrase ? null : 'Passphrases do not match',
  };
}

export const secretsValid = (s: Secrets) => Object.values(secretErrors(s)).every((e) => e === null);

interface SecretsFieldsProps {
  value: Secrets;
  onChange(value: Secrets): void;
  /** Show problems. False until the form has been submitted once. */
  touched: boolean;
  disabled?: boolean;
}

/**
 * The two secrets every account has. The password signs in to the server. The
 * master passphrase never leaves this device: it unlocks the account's keys.
 */
export function SecretsFields({ value, onChange, touched, disabled }: SecretsFieldsProps) {
  const errors = secretErrors(value);
  const field = (name: keyof Secrets) => ({
    value: value[name],
    onChange: (event: { target: { value: string } }) => onChange({ ...value, [name]: event.target.value }),
    error: touched ? errors[name] : null,
    disabled,
    secret: true,
  });
  return (
    <>
      <Field label="Password" name="password" autoComplete="new-password" hint="Signs you in to this server." {...field('password')} />
      <Field label="Confirm password" autoComplete="new-password" {...field('confirmPassword')} />
      <Field
        label="Master passphrase"
        // Not a login: keep password managers from saving it next to the password
        autoComplete="off"
        hint="Unlocks your keys on this device. It is never sent to the server."
        {...field('passphrase')}
      />
      <Field label="Confirm master passphrase" autoComplete="off" {...field('confirmPassphrase')} />
      <p className="rounded-lg bg-accent-soft px-3 py-2.5 text-[13px] leading-relaxed text-ink">
        There is no way to recover or reset the master passphrase, not even for the server owner. If it is lost,
        everything only this account can open is lost with it.
      </p>
    </>
  );
}
