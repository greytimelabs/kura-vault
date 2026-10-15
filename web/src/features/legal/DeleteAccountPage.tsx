import { ContactLink, LegalLayout, LegalList, LegalSection } from './LegalLayout';

/**
 * How to delete a Kura Vault account. Play Console requires a page like this
 * that works without the app installed; the apps link here from Settings.
 */
export function DeleteAccountPage() {
  return (
    <LegalLayout title="Delete your Kura Vault account" updated="15 October 2026">
      <p>
        Your Kura Vault account lives on the server you signed in to, so that server&rsquo;s owner is the one who
        deletes it. Pick the case that matches yours.
      </p>

      <LegalSection title="On a server run by someone else">
        <p>
          If a family member, friend or your organisation runs the server, ask its owner to delete your account. The
          owner does this in Kura Vault under <strong>Users</strong>, then <strong>Delete</strong> next to your name.
        </p>
      </LegalSection>

      <LegalSection title="On a server run by Greytimelabs">
        <p>
          Email <ContactLink /> with the subject &ldquo;Delete my account&rdquo;. Include the server address and your
          username. We may ask you to confirm the request from inside the app before deleting. Accounts are deleted
          within 30 days of a confirmed request, and we will reply once it is done.
        </p>
      </LegalSection>

      <LegalSection title="On your own server">
        <p>
          As the owner you can delete any other account under <strong>Users</strong>. To remove everything, including
          the owner account, delete the server&rsquo;s database and storage bucket.
        </p>
      </LegalSection>

      <LegalSection title="What is deleted">
        <LegalList>
          <li>Your account: username, password hash, keys and sign-in sessions.</li>
          <li>
            Every vault you created, with its albums, photos and videos, for everyone it was shared with. Their encrypted
            files are erased from storage.
          </li>
          <li>Your access to vaults and albums others shared with you.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="What is not deleted">
        <LegalList>
          <li>Photos someone downloaded or saved to their device before the deletion.</li>
          <li>Media you uploaded to a vault someone else created. It stays in that vault for its creator.</li>
          <li>Backups the server&rsquo;s operator made, until those backups expire.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Only removing it from this device">
        <p>
          To sign out without deleting anything, open <strong>Settings</strong> in the app and sign out of the account.
          This removes its sign-in tokens and any fingerprint or face unlock from the device; the account and its
          media stay on the server. Uninstalling the app does the same.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
