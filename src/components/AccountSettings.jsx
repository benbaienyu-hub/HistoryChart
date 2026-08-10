import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  changePassword,
  clearAiSettings,
  fetchAiSettings,
  newRecoveryCode,
  saveAiSettings,
} from '../lib/api';
import { forgetAiStatus } from '../lib/aiFill';
import RecoveryCodePanel from './RecoveryCodePanel';

const FIELD =
  'w-full rounded-xl border border-line2 bg-panel px-3 py-2 text-[13.5px] text-ink placeholder:text-subink/60 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/15';
const LABEL = 'mb-1 block text-[11.5px] font-medium text-subink';
const BUTTON =
  'rounded-xl bg-accent px-3.5 py-2 text-[13px] font-medium text-white disabled:opacity-60';
const QUIET =
  'rounded-xl border border-line2 px-3.5 py-2 text-[13px] text-subink hover:bg-hover hover:text-ink disabled:opacity-60';

// Known-good provider settings, because "paste an OpenAI-compatible base URL" is
// only a helpful instruction to somebody who already knows what that is.
const PROVIDERS = [
  { label: 'OpenAI', baseUrl: '', model: 'gpt-4o', hint: 'platform.openai.com/api-keys' },
  {
    label: 'Groq (free tier)',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    hint: 'console.groq.com/keys',
  },
];

// Everything a person needs to stop depending on whoever set up the server: their
// own password, their own way back in, and their own AI key.
export default function AccountSettings({ user, onClose, onUserChanged }) {
  const [settings, setSettings] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchAiSettings()
      .then((found) => !cancelled && setSettings(found))
      .catch((problem) => !cancelled && setLoadError(problem.message));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 py-10 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 240, damping: 26 }}
        className="w-full max-w-[520px] rounded-3xl border border-line bg-surface p-6 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.35)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight text-ink">Account</h2>
            <p className="mt-0.5 text-[12.5px] text-subink">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-line2 px-3 py-1.5 text-[12.5px] text-subink hover:bg-hover hover:text-ink"
          >
            Done
          </button>
        </div>

        <div className="mt-6 space-y-6">
          <PasswordSection onUserChanged={onUserChanged} />
          <RecoverySection user={user} onUserChanged={onUserChanged} />
          {loadError ? (
            <Section title="AI key">
              <p className="text-[12.5px] text-danger">{loadError}</p>
            </Section>
          ) : settings ? (
            // Mounted only once the settings are known, so the form can seed its
            // fields from them at mount and never re-sync — an effect that copied
            // props into state would fight anyone typing when the parent refreshed.
            <AiKeySection settings={settings} onChange={setSettings} />
          ) : (
            <Section title="AI key">
              <p className="text-[12.5px] text-subink">Loading…</p>
            </Section>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function Section({ title, hint, children }) {
  return (
    <section className="border-t border-line pt-5 first:border-0 first:pt-0">
      <h3 className="text-[13.5px] font-semibold text-ink">{title}</h3>
      {hint && <p className="mt-0.5 text-[12px] leading-snug text-subink">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

// A small status line under a form. Kept as one component so success and failure
// can never be styled inconsistently between the three sections.
function Note({ error, message }) {
  if (!error && !message) return null;
  return (
    <p className={`mt-2 text-[12.5px] ${error ? 'text-danger' : 'text-accent'}`}>
      {error || message}
    </p>
  );
}

function PasswordSection({ onUserChanged }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [state, setState] = useState({});
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setState({});
    setBusy(true);
    try {
      const user = await changePassword({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setState({ message: 'Password changed. Any other browser you were signed in on is now signed out.' });
      onUserChanged?.(user);
    } catch (problem) {
      setState({ error: problem.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Password">
      <form onSubmit={submit} className="space-y-2.5">
        <div>
          <label className={LABEL} htmlFor="current-password">
            Current password
          </label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className={FIELD}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="new-password">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="At least 8 characters"
            className={FIELD}
          />
        </div>
        <button type="submit" disabled={busy || !current || !next} className={BUTTON}>
          {busy ? 'Changing…' : 'Change password'}
        </button>
        <Note {...state} />
      </form>
    </Section>
  );
}

function RecoverySection({ user, onUserChanged }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  async function issue(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      setCode(await newRecoveryCode(password));
      setPassword('');
      setAsking(false);
      // The flag on the user changes the first time a code is issued.
      onUserChanged?.({ ...user, hasRecoveryCode: true });
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Recovery code"
      hint={
        user.hasRecoveryCode
          ? 'This server can’t email you a reset link, so the code you saved is your way back in. Generating a new one replaces the old.'
          : 'You have no recovery code. Without one, a forgotten password can only be fixed by whoever runs this server.'
      }
    >
      <AnimatePresence mode="wait">
        {code ? (
          <motion.div key="code" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <RecoveryCodePanel code={code} onDone={() => setCode(null)} doneLabel="I’ve saved it" />
          </motion.div>
        ) : asking ? (
          <motion.form key="ask" initial={{ opacity: 0 }} animate={{ opacity: 1 }} onSubmit={issue}>
            <label className={LABEL} htmlFor="recovery-password">
              Confirm your password
            </label>
            <input
              id="recovery-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={FIELD}
            />
            <div className="mt-2.5 flex gap-2">
              <button type="submit" disabled={busy || !password} className={BUTTON}>
                {busy ? 'Generating…' : 'Generate code'}
              </button>
              <button type="button" onClick={() => setAsking(false)} className={QUIET}>
                Cancel
              </button>
            </div>
            <Note error={error} />
          </motion.form>
        ) : (
          <motion.button
            key="start"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            type="button"
            onClick={() => setAsking(true)}
            className={user.hasRecoveryCode ? QUIET : BUTTON}
          >
            {user.hasRecoveryCode ? 'Generate a new code' : 'Generate a recovery code'}
          </motion.button>
        )}
      </AnimatePresence>
    </Section>
  );
}

function AiKeySection({ settings, onChange }) {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(settings.own.baseUrl ?? '');
  const [model, setModel] = useState(settings.own.model ?? '');
  const [state, setState] = useState({});
  const [busy, setBusy] = useState(false);

  const own = settings.own;

  async function save(e) {
    e.preventDefault();
    setState({});
    setBusy(true);
    try {
      const updated = await saveAiSettings({ apiKey, baseUrl, model });
      setApiKey('');
      onChange(updated);
      // The canvas asks once whether AI is available; saving a key changes the
      // answer, and it should not take a reload to find that out.
      forgetAiStatus();
      setState({ message: 'Saved. Your requests now use your own key.' });
    } catch (problem) {
      setState({ error: problem.message });
    } finally {
      setBusy(false);
    }
  }

  async function forget() {
    setState({});
    setBusy(true);
    try {
      onChange(await clearAiSettings());
      forgetAiStatus();
      setApiKey('');
      setBaseUrl('');
      setModel('');
      setState({
        message: settings.requiresOwnKey
          ? 'Removed. AI features are off until you add a key.'
          : 'Removed. You’re back to the server’s key.',
      });
    } catch (problem) {
      setState({ error: problem.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="AI key" hint={describeKeyState(settings)}>
      {own.unreadable && (
        <p className="mb-3 rounded-xl border border-warn-line bg-warn-bg px-3 py-2 text-[12.5px] text-ink">
          The saved key can’t be read — this database was probably restored without its
          encryption key. Paste yours again to fix it.
        </p>
      )}

      <form onSubmit={save} className="space-y-2.5">
        <div>
          <label className={LABEL} htmlFor="api-key">
            {own.configured ? 'Replace your key' : 'Your API key'}
          </label>
          <input
            id="api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={own.configured ? `Saved: ${own.preview}` : 'sk-…'}
            className={FIELD}
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {PROVIDERS.map((provider) => (
            <button
              key={provider.label}
              type="button"
              onClick={() => {
                setBaseUrl(provider.baseUrl);
                setModel(provider.model);
              }}
              className="rounded-full border border-line2 px-2.5 py-1 text-[11.5px] text-subink hover:bg-hover hover:text-ink"
            >
              {provider.label}
            </button>
          ))}
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="base-url">
              Provider URL <span className="font-normal text-subink/70">(blank = OpenAI)</span>
            </label>
            <input
              id="base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.groq.com/openai/v1"
              spellCheck={false}
              className={FIELD}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="model">
              Model
            </label>
            <input
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-4o"
              spellCheck={false}
              className={FIELD}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button type="submit" disabled={busy} className={BUTTON}>
            {busy ? 'Saving…' : own.configured ? 'Save' : 'Use my own key'}
          </button>
          {own.configured && (
            <button type="button" onClick={forget} disabled={busy} className={QUIET}>
              Forget my key
            </button>
          )}
        </div>
        <Note {...state} />
      </form>

      <p className="mt-3 text-[11.5px] leading-snug text-subink/80">
        Your key is encrypted before it is stored, and is never sent back to this page — you’ll
        only ever see the last four characters. Get one from{' '}
        {PROVIDERS.map((provider, i) => (
          <span key={provider.label}>
            {i > 0 && ' or '}
            <span className="text-subink">{provider.hint}</span>
          </span>
        ))}
        .
      </p>
    </Section>
  );
}

function describeKeyState({ own, serverKeyAvailable, requiresOwnKey }) {
  if (own.configured) {
    return `Your requests use your own key${own.model ? ` and ${own.model}` : ''}. Nobody else’s quota is involved.`;
  }
  if (requiresOwnKey) {
    return 'This server asks everyone to bring their own key. AI features are off until you add one.';
  }
  if (serverKeyAvailable) {
    // Optional, and worded that way. Sharing the server's key is a perfectly fine
    // way to use this; a key of your own is for people who would rather not share
    // a rate limit, or who want the AI to keep working if the server's key changes.
    return 'You’re using this server’s shared key, which is fine. Add your own if you’d rather not share its rate limit.';
  }
  return 'This server has no AI key at all, so AI features are off. Add your own to turn them on.';
}
