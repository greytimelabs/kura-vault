import { Link } from 'react-router-dom';
import { ContactLink, LegalLayout, LegalList, LegalSection } from './LegalLayout';

/**
 * The privacy policy for the Kura Vault apps and the hosted web client. Store
 * listings link here, so keep it true to docs/security.md.
 */
export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy policy" updated="15 October 2026">
      <p>
        Kura Vault is an end-to-end encrypted photo and video vault. Greytimelabs publishes the Kura Vault apps for
        Android and iOS and the web client at kura.greytimelabs.com. This policy explains what those clients do with
        your data.
      </p>

      <LegalSection title="Who holds your data">
        <p>
          Kura Vault is a client. It connects to a Kura Vault server whose address you enter, and your account and
          encrypted media live on that server. Whoever runs the server, whether you, your family, your organisation or
          Greytimelabs, is responsible for the data stored there and for its own privacy terms. Greytimelabs has no
          access to servers it does not run.
        </p>
        <p>
          Accounts are never open for anyone to sign up. Each one is created from an invite link issued by the
          server&rsquo;s owner.
        </p>
      </LegalSection>

      <LegalSection title="What the apps collect">
        <p>
          Nothing for Greytimelabs. The apps contain no analytics, advertising, crash reporting or tracking of any
          kind, and they send data only to the server you connect to.
        </p>
      </LegalSection>

      <LegalSection title="What the server receives">
        <p>
          Your photos, videos, file names, location data, album names and vault names are encrypted on your device
          before they leave it. The keys come from passphrases that never leave your device, so the server operator
          cannot see your media, and neither can Greytimelabs or the storage provider.
        </p>
        <p>To sort, share and authorise, the server does see:</p>
        <LegalList>
          <li>Your username, role and public keys.</li>
          <li>A one-way hash of your password, which is checked when you sign in. The password itself is not stored.</li>
          <li>
            For each photo or video: whether it is a photo or a video, its capture time, dimensions, duration, file size
            and who uploaded it.
          </li>
          <li>How many vaults, albums and items exist, and who they are shared with.</li>
          <li>When you sign in and what you request, as any web server does, including your IP address.</li>
        </LegalList>
        <p>All of this travels over HTTPS. The apps accept plain HTTP only for servers on your local network.</p>
      </LegalSection>

      <LegalSection title="What stays on your device">
        <LegalList>
          <li>Sign-in tokens, kept in the platform keystore and never in a device backup.</li>
          <li>
            Your keys, held in memory only, and erased when the app locks, closes or stays idle past the lock time you
            choose.
          </li>
          <li>
            If you turn on fingerprint or face unlock, your account key, encrypted by a hardware key that only your
            biometric can release. It is off unless you turn it on.
          </li>
          <li>
            Brief plaintext copies of photos you pick or take, deleted once they are uploaded or when the vault locks.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Permissions">
        <LegalList>
          <li>
            <strong>Internet</strong>, to reach your server.
          </li>
          <li>
            <strong>Photos and camera</strong>, through the system photo picker and camera app. The app sees only what
            you pick or take and never reads your photo library.
          </li>
          <li>
            <strong>Storage</strong> (Android 9 and earlier only), to save a photo to your gallery when you ask.
          </li>
          <li>
            <strong>Biometrics</strong>, only if you turn on fingerprint or face unlock.
          </li>
        </LegalList>
        <p>
          A photo you save to your gallery or files is no longer encrypted, and other apps and cloud photo sync can
          read it.
        </p>
      </LegalSection>

      <LegalSection title="Sharing">
        <p>
          Greytimelabs does not sell, rent or share your data. Media is shared only with people you share a vault or
          album with on the same server, and only in encrypted form.
        </p>
      </LegalSection>

      <LegalSection title="Retention and deletion">
        <p>
          Data stays on the server until it is deleted. Deleting an item, album or vault erases it and its encrypted
          files from the server. Deleting an account erases the account and the vaults it created. See{' '}
          <Link to="/delete-account" className="font-medium text-accent underline underline-offset-2">
            how to delete your account
          </Link>
          .
        </p>
        <p>
          There is no passphrase recovery. If you forget your master passphrase, nobody, including the server&rsquo;s
          owner and Greytimelabs, can recover what only your account could open.
        </p>
      </LegalSection>

      <LegalSection title="Children">
        <p>Kura Vault is not directed to children under 13.</p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          If this policy changes, the new version is published on this page with a new date. Significant changes will
          also be noted in the app&rsquo;s release notes.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about this policy: <ContactLink />. For data on a server run by someone else, contact that
          server&rsquo;s owner.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
