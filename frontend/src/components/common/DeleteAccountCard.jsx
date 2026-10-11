import { useState } from 'react';
import { Trash2, Mail, Copy, Check, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import ChartCard from './ChartCard.jsx';
import { openExternal } from '../../native/openExternal.js';
import { isNative } from '../../native/platform.js';

/*
 * =============================================================================
 * Account deletion request
 * =============================================================================
 *
 * WHY THIS SCREEN HAS TO EXIST
 *
 * Both stores require that an app offering account creation also offer account
 * deletion, and both require the route to it to be *inside the app*:
 *
 *   - Apple, guideline 5.1.1(v): apps that support account creation must let
 *     the user initiate deletion from within the app. Directing them to a
 *     website or to customer service as the only option is called out as not
 *     sufficient.
 *   - Google Play, User Data policy: a readily discoverable in-app route, AND
 *     a web-reachable one for people who have already uninstalled. The web URL
 *     is submitted in the Data Safety form and checked.
 *
 * Deletion here is reviewed and carried out by the IWM team rather than
 * executed on the spot. That is a deliberate operational choice: these are
 * organisation accounts, often the only account assigned to a site's scales,
 * so a mis-tap should not be able to orphan a kitchen's hardware. The store
 * requirement this screen satisfies is that the user can *initiate* deletion
 * without leaving the app and without hunting for a support address.
 *
 * It is worth knowing the cost of that choice: Apple review does sometimes
 * push back on a deletion flow with a human in the loop, and the usual remedy
 * is to make the button do the deletion directly. Admins already have
 * DELETE /users/{id}, so the server side of that exists; what would be needed
 * is a self-service endpoint that re-checks the password. Until then, the
 * response time promised below is the thing that has to be true.
 * =============================================================================
 */

const SUPPORT_EMAIL = 'support@foodloss.ca';
const RESPONSE_DAYS = 30;

export default function DeleteAccountCard({ user }) {
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  const subject = 'Account deletion request';
  const body = [
    'I would like my IWM Smart Scale account deleted.',
    '',
    `Account email: ${user?.email || '(your sign-in email)'}`,
    `Name: ${user?.name || ''}`,
    `Organization: ${user?.organization || ''}`,
    '',
    'Please confirm once the account and my personal details have been removed.',
  ].join('\n');

  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;

  const sendRequest = async () => {
    // mailto: is handed to the platform rather than assigned to
    // window.location. openExternal only passes http(s) through, so this one
    // goes direct — but on native a plain assignment inside the WebView does
    // nothing useful, and the Browser plugin will not take a mailto either.
    // `window.open` is what reaches the system mail handler in both cases.
    try {
      window.open(mailto, isNative ? '_system' : '_self');
      toast.success('Opening your email app', {
        description: `Send the message to ${SUPPORT_EMAIL} and we will confirm when it is done.`,
      });
    } catch {
      toast.error('Could not open your email app', {
        description: `Email ${SUPPORT_EMAIL} and we will take it from there.`,
      });
    }
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Address copied');
    } catch {
      // Clipboard access is blocked in some WebView configurations. Showing
      // the address is the fallback, and it is on screen already.
      toast.error(`Copy failed — the address is ${SUPPORT_EMAIL}`);
    }
  };

  return (
    <ChartCard
      testId="delete-account-card"
      title="Delete your account"
      subtitle="Permanently remove your account and personal details"
    >
      <div className="px-4 sm:px-5 pb-5 space-y-4">
        {/* What actually happens — stated before the button, not after.
            This wording has to match the privacy policy and the store
            data-safety answers, because reviewers compare them. */}
        <div className="rounded-xl border border-ink-600 bg-ink-800/40 p-4 space-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-danger font-semibold mb-1.5">
              Deleted permanently
            </div>
            <ul className="text-sm text-slate-300 space-y-1 list-disc pl-5">
              <li>Your name, email address, phone number and city</li>
              <li>Your organization name and sign-in credentials</li>
              <li>Your access to every scale assigned to you</li>
            </ul>
          </div>

          <div className="pt-1 border-t border-ink-600/60">
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5 mt-3">
              Kept
            </div>
            <p className="text-sm text-slate-400">
              The waste readings recorded by your scales. Those measurements
              belong to the organization that operates the hardware, not to an
              individual login, and other people may be assigned to the same
              scale. The scales themselves stay registered and simply become
              unassigned.
            </p>
          </div>
        </div>

        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            data-testid="delete-account-start"
            className="inline-flex items-center gap-2 h-11 px-5 rounded-xl border border-danger/40
                       bg-danger/10 text-danger text-sm font-semibold
                       hover:bg-danger/20 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Request account deletion
          </button>
        ) : (
          <div
            className="rounded-xl border border-danger/40 bg-danger/5 p-4 space-y-3"
            data-testid="delete-account-confirm"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <p className="text-sm text-slate-200">
                This cannot be undone. Your request goes to the IWM team, who
                will verify it is really you and delete the account within{' '}
                <strong className="text-white">{RESPONSE_DAYS} days</strong>.
                You will get an email confirming it is done.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={sendRequest}
                data-testid="delete-account-send"
                className="inline-flex items-center gap-2 h-11 px-5 rounded-xl
                           bg-danger text-white text-sm font-semibold
                           hover:bg-danger/90 transition-colors"
              >
                <Mail className="w-4 h-4" />
                Email the request
              </button>

              <button
                type="button"
                onClick={() => setConfirming(false)}
                data-testid="delete-account-cancel"
                className="h-11 px-5 rounded-xl border border-ink-600 text-sm
                           font-semibold text-slate-300 hover:bg-ink-700/50 transition-colors"
              >
                Cancel
              </button>
            </div>

            {/* The address in plain text, and copyable.
                "Email the request" depends on a mail app being set up, which
                on a shared tablet or a freshly-wiped phone it often is not —
                and a dead button is the one thing that would turn this from a
                compliant deletion route back into a dead end. */}
            <div className="flex items-center gap-2 pt-1 text-xs text-slate-400">
              <span>Or write to</span>
              <code className="text-sky font-mono" data-selectable>
                {SUPPORT_EMAIL}
              </code>
              <button
                type="button"
                onClick={copyEmail}
                aria-label="Copy the support email address"
                data-testid="delete-account-copy"
                className="inline-flex items-center justify-center w-7 h-7 rounded-md
                           text-slate-400 hover:text-white hover:bg-ink-700/60 transition-colors"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-leaf" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </ChartCard>
  );
}
