import { Link } from 'react-router-dom';
import { ArrowLeft, Trash2, Mail } from 'lucide-react';

/*
 * =============================================================================
 * Public account-deletion request page
 * =============================================================================
 *
 * The web half of the store requirement. Google Play's User Data policy asks
 * for two routes to account deletion: one inside the app, and one reachable
 * from a browser by someone who has already uninstalled it. The second URL is
 * submitted in the Play Console Data Safety form and is checked, so it has to
 * be a real page that loads without signing in — hence this route sitting
 * outside ProtectedRoute, with no API calls of its own.
 *
 * The in-app half is components/common/DeleteAccountCard.jsx, under
 * Settings -> Password & Security. The two must describe the same process and
 * the same retention split, because this page is what a reviewer reads and the
 * app is what they then check it against.
 *
 * Submit this as:  https://foodloss.ca/delete-account
 * =============================================================================
 */

const SUPPORT_EMAIL = 'support@foodloss.ca';
const RESPONSE_DAYS = 30;

const SUBJECT = 'Account deletion request';
const BODY = [
  'I would like my IWM Smart Scale account deleted.',
  '',
  'Account email: ',
  'Name: ',
  'Organization: ',
  '',
  'Please confirm once the account and my personal details have been removed.',
].join('\n');

export default function DeleteAccount() {
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    SUBJECT
  )}&body=${encodeURIComponent(BODY)}`;

  return (
    <div className="ww-mesh min-h-screen">
      <div
        className="max-w-2xl mx-auto px-5 sm:px-8 py-10"
        style={{
          paddingTop: 'calc(2.5rem + var(--safe-top))',
          paddingBottom: 'calc(2.5rem + var(--safe-bottom))',
        }}
      >
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors mb-8 inline-link"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>

        <div className="flex items-center gap-2.5 mb-2">
          <Trash2 className="w-5 h-5 text-danger" />
          <span className="text-xs uppercase tracking-[0.22em] text-danger font-semibold">
            Account deletion
          </span>
        </div>
        <h1 className="font-display font-bold text-2xl sm:text-3xl text-white">
          Delete your IWM account
        </h1>
        <p className="text-sm text-slate-400 mt-2 mb-9">
          For the IWM Smart Scale apps (Android and iOS) and foodloss.ca.
        </p>

        <div className="space-y-6">
          {/* Deliberately first. Someone arriving here wants to know what
              happens to their data before they are asked to do anything. */}
          <div className="rounded-2xl border border-ink-600 bg-ink-800/40 p-5 space-y-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-danger font-semibold mb-2">
                Deleted permanently
              </div>
              <ul className="text-sm text-slate-300 space-y-1.5 list-disc pl-5">
                <li>Your name, email address, phone number and city</li>
                <li>Your organization name and your sign-in credentials</li>
                <li>Your access to every scale assigned to you</li>
              </ul>
            </div>
            <div className="pt-4 border-t border-ink-600/60">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2">
                Kept
              </div>
              <p className="text-sm text-slate-400 leading-relaxed">
                The waste readings recorded by your scales. Those measurements
                belong to the organization that operates the hardware rather
                than to an individual login, and more than one person may be
                assigned to the same scale. The scales stay registered and
                become unassigned.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="font-display font-semibold text-lg text-white">
              How to request it
            </h2>
            <ol className="text-sm text-slate-300 space-y-2.5 list-decimal pl-5 leading-relaxed">
              <li>
                Email{' '}
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="text-sky hover:underline inline-link font-mono"
                >
                  {SUPPORT_EMAIL}
                </a>{' '}
                from the address your account uses, with the subject
                &ldquo;{SUBJECT}&rdquo;.
              </li>
              <li>
                We reply to confirm the request really came from you. If you
                write from a different address we will ask for something that
                proves you own the account.
              </li>
              <li>
                The account and your personal details are deleted within{' '}
                <strong className="text-white">{RESPONSE_DAYS} days</strong>,
                and we email you to confirm it is done.
              </li>
            </ol>
          </div>

          <a
            href={mailto}
            data-testid="public-delete-mailto"
            className="inline-flex items-center gap-2 h-12 px-6 rounded-xl bg-danger
                       text-white text-sm font-semibold hover:bg-danger/90 transition-colors"
          >
            <Mail className="w-4 h-4" />
            Email your deletion request
          </a>

          <p className="text-xs text-slate-500 pt-2">
            Still have the app installed? You can start the same request from{' '}
            <strong className="text-slate-400">
              Settings → Password &amp; Security
            </strong>{' '}
            without leaving the app. See our{' '}
            <Link to="/privacy" className="text-sky hover:underline inline-link">
              privacy policy
            </Link>{' '}
            for what we hold and why.
          </p>
        </div>
      </div>
    </div>
  );
}
