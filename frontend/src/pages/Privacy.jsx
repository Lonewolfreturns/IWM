import { Link } from 'react-router-dom';
import { ArrowLeft, Shield } from 'lucide-react';

/*
 * =============================================================================
 * Privacy policy
 * =============================================================================
 *
 * A reachable privacy policy URL is a hard requirement on both stores: Apple
 * will not let a submission past App Store Connect without one, and Play
 * requires it in the Data Safety form for any app that handles personal data.
 * It must be a public page that works without signing in, which is why this
 * route sits outside ProtectedRoute.
 *
 * WHAT THIS DOCUMENT HAS TO MATCH
 *
 * Reviewers compare this page against the App Privacy answers in App Store
 * Connect, against ios/App/App/PrivacyInfo.xcprivacy, and against the Play
 * Data Safety declaration. A disagreement between any two of them is a
 * rejection, so all four are written from the same list of fields the app
 * actually collects:
 *
 *   name, email, phone, city, organization   (sign-up form)
 *   scale readings                           (device telemetry, not personal)
 *
 * It is written from the code rather than from a template, so every claim here
 * is one the app can be held to. It is not legal advice and has not been
 * reviewed by a lawyer; before launch it is worth having counsel read it,
 * particularly the PIPEDA and retention wording.
 * =============================================================================
 */

const UPDATED = 'October 10, 2026';
const SUPPORT_EMAIL = 'support@foodloss.ca';

function Section({ title, children }) {
  return (
    <section className="space-y-3">
      <h2 className="font-display font-semibold text-lg text-white">{title}</h2>
      <div className="text-sm text-slate-300 space-y-3 leading-relaxed">{children}</div>
    </section>
  );
}

export default function Privacy() {
  return (
    <div className="ww-mesh min-h-screen">
      <div
        className="max-w-3xl mx-auto px-5 sm:px-8 py-10"
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
          <Shield className="w-5 h-5 text-sky" />
          <span className="text-xs uppercase tracking-[0.22em] text-sky font-semibold">
            Privacy
          </span>
        </div>
        <h1 className="font-display font-bold text-2xl sm:text-3xl text-white">
          Privacy Policy
        </h1>
        <p className="text-sm text-slate-400 mt-2 mb-10">
          Innovative Waste Management (IWM) · Last updated {UPDATED}
        </p>

        <div className="space-y-9">
          <Section title="Who we are">
            <p>
              IWM operates the IWM Smart Scale platform: connected weighing
              scales installed in commercial kitchens, and the web and mobile
              apps that show what they record. This policy covers the website
              at foodloss.ca and the IWM Smart Scale apps for Android and iOS.
            </p>
          </Section>

          <Section title="What we collect">
            <p>
              <strong className="text-white">Account details you give us.</strong>{' '}
              When you create an account we collect your name, email address,
              phone number, city and organization name, along with your
              password and the answer to the security question you choose.
              Your password and security answer are stored only as salted
              PBKDF2-HMAC-SHA256 hashes — they are one-way, and we cannot read
              them or recover them for you.
            </p>
            <p>
              <strong className="text-white">Readings from the scales.</strong>{' '}
              Each scale reports the weight of each deposit, a running total,
              status messages, and the date and time its own clock recorded.
              Readings are identified by the scale's device ID, not by a
              person. They describe equipment in a kitchen, not individuals.
            </p>
            <p>
              <strong className="text-white">
                What we do not collect.
              </strong>{' '}
              No location data, no contacts, no photos, no camera or microphone
              access, no advertising identifier, and no third-party analytics
              or tracking of any kind. The mobile apps request only network
              access. We do not track you across other apps or websites.
            </p>
          </Section>

          <Section title="Why we use it">
            <p>
              Account details identify you, let you sign in, and determine
              which scales you are allowed to see. Your email is how we send
              service notices and reply to support requests. Readings are used
              to produce the dashboards, analytics and reports that are the
              purpose of the product.
            </p>
            <p>
              We do not sell personal information, we do not share it with
              advertisers or data brokers, and we do not use it to build
              profiles or to make automated decisions about you.
            </p>
          </Section>

          <Section title="Where it is stored">
            <p>
              Data is held in Amazon Web Services in the US East (Ohio) region,
              in DynamoDB tables that are encrypted at rest. Traffic between
              the apps and our servers is encrypted in transit with TLS; the
              apps refuse unencrypted connections outright.
            </p>
            <p>
              In the mobile apps your sign-in token is kept in the device's
              secure storage — the iOS Keychain or Android's
              EncryptedSharedPreferences, backed by the hardware keystore — and
              is excluded from device backups and from transfers to a new
              phone. On the website it is kept in your browser's local storage
              for the same session purpose.
            </p>
          </Section>

          <Section title="Who else can see it">
            <p>
              Your organization's administrators can see the accounts assigned
              to your scales and the readings those scales produce. IWM staff
              can access data where it is needed to operate or support the
              service. Amazon Web Services hosts the infrastructure as our
              processor. Nobody else receives your data.
            </p>
          </Section>

          <Section title="How long we keep it">
            <p>
              Account details are kept while the account exists, and are
              deleted when it is deleted. Scale readings are retained as the
              operating record of the equipment that produced them, so that
              year-on-year reporting stays possible, and are not removed when
              an individual account is closed.
            </p>
          </Section>

          <Section title="Deleting your account">
            <p>
              You can ask us to delete your account from inside the app, under{' '}
              <strong className="text-white">Settings → Password &amp; Security</strong>,
              or by writing to{' '}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="text-sky hover:underline inline-link"
              >
                {SUPPORT_EMAIL}
              </a>
              . You do not need the app installed to make the request — see{' '}
              <Link to="/delete-account" className="text-sky hover:underline inline-link">
                foodloss.ca/delete-account
              </Link>
              .
            </p>
            <p>
              We verify that the request comes from the account holder and then
              delete your name, email address, phone number, city,
              organization and credentials, and remove your access to every
              scale, within 30 days. The scales themselves stay registered and
              become unassigned, and the readings they have recorded are kept
              as described above.
            </p>
          </Section>

          <Section title="Your rights">
            <p>
              Under Canadian privacy law (PIPEDA) and comparable rules
              elsewhere, you may ask us for a copy of the personal information
              we hold about you, ask us to correct it, or ask us to delete it.
              You can update your own name, phone number and city at any time
              under Settings. For anything else, write to{' '}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="text-sky hover:underline inline-link"
              >
                {SUPPORT_EMAIL}
              </a>{' '}
              and we will respond within 30 days.
            </p>
          </Section>

          <Section title="Children">
            <p>
              IWM Smart Scale is a tool for food-service businesses. It is not
              directed at children, and we do not knowingly collect personal
              information from anyone under 13. If you believe a child has
              created an account, contact us and we will remove it.
            </p>
          </Section>

          <Section title="Changes">
            <p>
              If this policy changes we will update the date at the top of this
              page, and where the change is significant we will tell account
              holders by email before it takes effect.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions about this policy, or about the data we hold:{' '}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="text-sky hover:underline inline-link"
              >
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}
