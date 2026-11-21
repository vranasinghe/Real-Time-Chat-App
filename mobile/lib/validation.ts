// Shared form validation, used by every screen that checks emails, passwords or ages.
// (The backend re-validates everything; these checks are for fast, friendly feedback.)

export const MIN_AGE_YEARS = 18;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72; // bcrypt ignores anything longer

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const isValidEmail = (value: string): boolean => {
  const v = value.trim();
  return v.length <= 254 && EMAIL_RE.test(v);
};

export interface PasswordCheck {
  id: "length" | "case" | "symbolNum" | "strong";
  label: string;
  satisfied: boolean;
}

export function passwordChecks(password = ""): PasswordCheck[] {
  const length = password.length >= MIN_PASSWORD_LENGTH && password.length <= MAX_PASSWORD_LENGTH;
  const mixedCase = /[A-Z]/.test(password) && /[a-z]/.test(password);
  const symbolNum = /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
  return [
    { id: "length", label: "Minimum 8 characters", satisfied: length },
    { id: "case", label: "Uppercase and lowercase character", satisfied: mixedCase },
    { id: "symbolNum", label: "Minimum 1 number and symbol", satisfied: symbolNum },
    { id: "strong", label: "Strong Password", satisfied: length && mixedCase && symbolNum },
  ];
}

export const isStrongPassword = (password: string): boolean =>
  passwordChecks(password).every((c) => c.satisfied);

/** True when the ISO date (YYYY-MM-DD) is a real date at least MIN_AGE_YEARS ago. */
export function isAdult(birthdate: string, today = new Date()): boolean {
  const dob = new Date(birthdate);
  if (isNaN(dob.getTime())) return false;
  const cutoff = new Date(today);
  cutoff.setFullYear(cutoff.getFullYear() - MIN_AGE_YEARS);
  return dob <= cutoff;
}
