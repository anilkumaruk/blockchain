import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, CheckCircle2 } from 'lucide-react';
import Spinner from '../components/Spinner';
import { registerInstitution, USE_BACKEND } from '../lib/api';

const INPUT =
  'w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal';

const KINDS = [
  ['university', 'University / college'],
  ['certifying_body', 'Certifying or licensing body'],
  ['other', 'Other education provider'],
];

/**
 * Self-service registration for colleges and other issuers. New institutions
 * stay "pending" until the platform administrator approves them; approval
 * creates their own on-chain issuer wallet.
 */
export default function InstitutionRegister() {
  const [form, setForm] = useState({ name: '', kind: 'university', email: '', website: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim() || !form.email.trim()) return setError('Enter the institution name and official email.');
    if (form.password.length < 8) return setError('Use at least 8 characters for the password.');
    if (form.password !== form.confirm) return setError('The two passwords do not match.');
    setLoading(true);
    try {
      const res = await registerInstitution({
        name: form.name.trim(),
        kind: form.kind,
        email: form.email.trim(),
        website: form.website.trim() || undefined,
        password: form.password,
      });
      setDone(res.institution);
    } catch (err) {
      setError(err.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  if (!USE_BACKEND) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center text-sm text-ink-soft">
        Institution registration needs the Chain of Record server. This demo runs in mock mode.
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md bg-card border border-border rounded-lg card-shadow p-7 text-center">
          <CheckCircle2 size={34} className="text-valid mx-auto mb-3" />
          <h1 className="text-lg font-semibold mb-1">Registration received</h1>
          <p className="text-sm text-ink-soft mb-5">
            <span className="font-medium text-ink">{done.name}</span> is pending approval. Once the platform
            administrator approves it, your institution gets its own blockchain issuer identity and you can sign in to
            the Credential Center with <span className="font-medium text-ink">{form.email.trim()}</span>.
          </p>
          <Link to="/admin" className="text-sm text-teal font-medium hover:underline">
            Go to the Credential Center sign-in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-card border border-border rounded-lg card-shadow p-7">
        <div className="w-11 h-11 rounded-lg bg-teal-soft flex items-center justify-center mb-4">
          <Building2 size={22} className="text-teal" />
        </div>
        <h1 className="text-lg font-semibold mb-1">Register your institution</h1>
        <p className="text-sm text-ink-soft mb-6">
          Issue tamper-evident, blockchain-verified credentials to your students. Registrations are reviewed by the
          platform administrator before you can issue.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label htmlFor="inst-name" className="block text-xs font-medium text-ink-soft mb-1.5">
              Institution name
            </label>
            <input id="inst-name" value={form.name} onChange={update('name')} placeholder="e.g. RV College of Engineering" className={INPUT} />
          </div>
          <div>
            <label htmlFor="inst-kind" className="block text-xs font-medium text-ink-soft mb-1.5">
              Type
            </label>
            <select id="inst-kind" value={form.kind} onChange={update('kind')} className={INPUT}>
              {KINDS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="inst-email" className="block text-xs font-medium text-ink-soft mb-1.5">
              Official registrar email
            </label>
            <input id="inst-email" type="email" autoComplete="email" value={form.email} onChange={update('email')} placeholder="registrar@college.edu" className={INPUT} />
          </div>
          <div>
            <label htmlFor="inst-website" className="block text-xs font-medium text-ink-soft mb-1.5">
              Website <span className="font-normal">(optional)</span>
            </label>
            <input id="inst-website" type="url" value={form.website} onChange={update('website')} placeholder="https://college.edu" className={INPUT} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="inst-password" className="block text-xs font-medium text-ink-soft mb-1.5">
                Password
              </label>
              <input id="inst-password" type="password" autoComplete="new-password" value={form.password} onChange={update('password')} placeholder="8+ characters" className={INPUT} />
            </div>
            <div>
              <label htmlFor="inst-confirm" className="block text-xs font-medium text-ink-soft mb-1.5">
                Confirm
              </label>
              <input id="inst-confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={update('confirm')} className={INPUT} />
            </div>
          </div>
          {error && <p className="text-xs text-invalid">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-teal text-white text-sm font-medium rounded-md py-2.5 hover:bg-teal/90 disabled:opacity-60"
          >
            {loading ? <Spinner size={15} /> : <Building2 size={15} />}
            {loading ? 'Submitting…' : 'Submit for approval'}
          </button>
        </form>
        <p className="text-xs text-ink-soft mt-5 text-center">
          Already approved?{' '}
          <Link to="/admin" className="text-teal font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
