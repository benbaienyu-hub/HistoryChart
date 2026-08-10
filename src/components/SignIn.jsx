import { useState } from 'react';
import { motion } from 'framer-motion';
import { isValidEmail } from '../lib/auth';
import { looksLikeRecoveryCode } from '../lib/recoveryCode';
import { logIn, register, resetPassword } from '../lib/api';
import Logo from './Logo';
import RecoveryCodePanel from './RecoveryCodePanel';
import ThemeToggle from './ThemeToggle';

const FIELD =
  'w-full rounded-xl border border-line2 bg-panel px-3 py-2.5 text-[14px] text-ink placeholder:text-subink/60 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/15';

const COPY = {
  login: 'Map what you know, then let AI fill the gaps.',
  register: 'Create an account to sync your canvases and share them.',
  reset: 'Enter the recovery code you saved when you signed up, and pick a new password.',
};

export default function SignIn({ onSignedIn }) {
  // Three modes rather than three screens: the fields largely overlap, and a
  // separate page would mean losing what you had already typed to switch.
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Held between the account existing and the person continuing into it: the
  // recovery code is shown once, and going straight to the library would lose it.
  const [issued, setIssued] = useState(null);

  const registering = mode === 'register';
  const resetting = mode === 'reset';

  function switchTo(next) {
    setMode(next);
    setError('');
  }

  async function submit(e) {
    e.preventDefault();
    if (!isValidEmail(email)) {
      setError('Enter a valid email address.');
      return;
    }
    if ((registering || resetting) && password.length < 8) {
      setError('Use at least 8 characters for your password.');
      return;
    }
    if (resetting && !looksLikeRecoveryCode(code)) {
      // Checked here as well as on the server so an obvious mistype costs nothing
      // and doesn't spend one of the server's rate-limited attempts.
      setError('That doesn’t look like a recovery code. It’s 20 characters in four groups.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      if (registering) {
        const { user, recoveryCode } = await register({ email, name, password });
        setIssued({ user, code: recoveryCode });
      } else if (resetting) {
        const { user, recoveryCode } = await resetPassword({ email, code, password });
        setIssued({ user, code: recoveryCode, replaced: true });
      } else {
        onSignedIn(await logIn({ email, password }));
      }
    } catch (problem) {
      setError(problem.message);
      // setMode, not switchTo: switchTo clears the error, which would throw away
      // the message that was just set and leave a failed sign-in looking like
      // nothing happened at all.
      //
      // The server distinguishes "no account" from "wrong password" internally but
      // deliberately answers the same for both; offering the switch is the useful
      // response either way.
      if (problem.status === 409) setMode('login');
      if (problem.status === 401 && !resetting) setMode('login');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-canvas px-6 py-10">
      <div className="absolute right-5 top-5">
        <ThemeToggle />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 24 }}
        className="w-full max-w-[380px] rounded-3xl border border-line bg-surface p-8 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_24px_48px_-16px_rgba(0,0,0,0.18)] backdrop-blur-xl"
      >
        <div className="flex flex-col items-center gap-2.5">
          <Logo size={40} className="text-accent" label="Lacuna" />
          <h1 className="text-[26px] font-semibold tracking-tight text-ink">Lacuna</h1>
        </div>

        {issued ? (
          <>
            <p className="mt-1.5 text-center text-[13.5px] leading-snug text-subink">
              {issued.replaced
                ? 'Your password is changed and you’re signed in.'
                : `Welcome, ${issued.user.name}. One thing before you start.`}
            </p>
            <div className="mt-6">
              <RecoveryCodePanel
                code={issued.code}
                onDone={() => onSignedIn(issued.user)}
                doneLabel={issued.replaced ? 'I’ve saved it — continue' : 'I’ve saved it — start'}
              />
            </div>
            {issued.replaced && (
              <p className="mt-4 text-[11.5px] leading-snug text-subink/80">
                The code you just used is spent. This is its replacement.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="mt-1.5 text-center text-[13.5px] leading-snug text-subink">
              {COPY[mode]}
            </p>

            <form onSubmit={submit} className="mt-7 space-y-3">
              <div>
                <label className="mb-1 block text-[12px] font-medium text-subink" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={FIELD}
                />
              </div>

              {registering && (
                <div>
                  <label className="mb-1 block text-[12px] font-medium text-subink" htmlFor="name">
                    Display name <span className="font-normal text-subink/70">(optional)</span>
                  </label>
                  <input
                    id="name"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ada Lovelace"
                    className={FIELD}
                  />
                </div>
              )}

              {resetting && (
                <div>
                  <label className="mb-1 block text-[12px] font-medium text-subink" htmlFor="code">
                    Recovery code
                  </label>
                  <input
                    id="code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                    // Off deliberately: a manager has nothing useful to offer here,
                    // and its suggestions cover the field.
                    autoComplete="off"
                    spellCheck={false}
                    className={`${FIELD} tracking-[0.06em]`}
                  />
                </div>
              )}

              <div>
                <label className="mb-1 block text-[12px] font-medium text-subink" htmlFor="password">
                  {resetting ? 'New password' : 'Password'}
                </label>
                <input
                  id="password"
                  type="password"
                  // Tells a password manager whether to offer a saved one or generate
                  // a new one — the wrong value here is a real usability bug.
                  autoComplete={registering || resetting ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={registering || resetting ? 'At least 8 characters' : '••••••••'}
                  className={FIELD}
                />
              </div>

              {error && <p className="text-[12.5px] text-danger">{error}</p>}

              <motion.button
                type="submit"
                disabled={busy}
                whileHover={{ scale: busy ? 1 : 1.01 }}
                whileTap={{ scale: busy ? 1 : 0.985 }}
                className="w-full rounded-xl bg-accent py-2.5 text-[14px] font-medium text-white shadow-[0_2px_10px_rgba(0,113,227,0.35)] disabled:opacity-60"
              >
                {busy
                  ? 'One moment…'
                  : registering
                    ? 'Create account'
                    : resetting
                      ? 'Set new password'
                      : 'Sign in'}
              </motion.button>
            </form>

            <p className="mt-4 text-center text-[12.5px] text-subink">
              {resetting ? (
                <>
                  Remembered it?{' '}
                  <button
                    type="button"
                    onClick={() => switchTo('login')}
                    className="font-medium text-accent hover:underline"
                  >
                    Back to sign in
                  </button>
                </>
              ) : (
                <>
                  {registering ? 'Already have an account?' : 'No account yet?'}{' '}
                  <button
                    type="button"
                    onClick={() => switchTo(registering ? 'login' : 'register')}
                    className="font-medium text-accent hover:underline"
                  >
                    {registering ? 'Sign in' : 'Create one'}
                  </button>
                </>
              )}
            </p>

            {mode === 'login' && (
              <p className="mt-1.5 text-center text-[12.5px] text-subink">
                <button
                  type="button"
                  onClick={() => switchTo('reset')}
                  className="font-medium text-accent hover:underline"
                >
                  Forgot your password?
                </button>
              </p>
            )}

            <p className="mt-6 border-t border-line pt-4 text-[11.5px] leading-snug text-subink/80">
              Your canvases are stored on the server this app is running on, so they follow
              you between browsers and can be shared with other people by email.
            </p>
          </>
        )}
      </motion.div>
    </div>
  );
}
