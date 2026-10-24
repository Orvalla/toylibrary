// Privacy policy and terms, in plain language. These pages
// describe what the code actually does — if a feature changes
// what data moves where, update this copy in the same change.

export function PrivacyPage() {
  return (
    <main className="page narrow">
      <h1>Privacy policy</h1>
      <p className="muted">Last updated October 24, 2026</p>

      <section className="card">
        <h2>The short version</h2>
        <p>
          Toy Library is run by one person, not an ad company. We collect what
          the site needs to work — your account, your family's lists, and the
          details you choose to add — and we don't sell personal information or
          run third-party trackers. Our visitor counts are our own, stored
          without IP addresses or device fingerprints.
        </p>
      </section>

      <section className="card">
        <h2>What we collect</h2>
        <p>
          <strong>Your account:</strong> your email address and the display
          name you pick. Passwords are stored hashed by our auth provider; we
          never see them.
        </p>
        <p>
          <strong>Your family profiles:</strong> for each child, the first
          name, birthday, and interests you enter, so gift-givers see the right
          list at the right age. This information is entered by a parent or
          guardian — Toy Library is a tool for adults, not a service directed
          at children.
        </p>
        <p>
          <strong>Your lists and activity:</strong> the toys and books you
          mark as owned or wished for, gifts visitors claim on your share page,
          gift suggestions visitors send you, and the relatives you add to
          your gift circle (their name and an email or social handle, which
          you enter) so we can send them occasion reminders.
        </p>
        <p>
          <strong>Gift-page subscriptions:</strong> if a visitor subscribes to
          a family's occasion reminders, we store their email address and use
          it only for those reminders. Every reminder email carries an
          unsubscribe link.
        </p>
        <p>
          <strong>Photos:</strong> when you scan a shelf photo, the image is
          sent to OpenAI's vision service to identify the items, and is not
          kept afterwards. The one exception is an item you add by hand with
          your own photo — that photo becomes the item's picture and is
          stored. If you file a bug report, we store the message and, with
          the report, a screenshot of the page as it looked.
        </p>
        <p>
          <strong>Donations:</strong> donations are handled entirely by
          PayPal; we never receive or store your card details. If you donate,
          we may mark your account as a supporter, which raises some usage
          limits as a thank-you.
        </p>
      </section>

      <section className="card">
        <h2>Your public gift page</h2>
        <p>
          If you turn sharing on, anyone with your family's link can see your
          children's first names, their have-lists and wishlists, and their
          upcoming occasions (like a birthday month). That's the point of the
          link — share it with the people you'd share it with anyway, and you
          can turn sharing off or change your link in Settings at any time.
        </p>
      </section>

      <section className="card">
        <h2>Who processes it</h2>
        <p>
          A short list of services run the site on our behalf: Supabase
          (database and sign-in), Fly.io (web hosting), Resend (sending
          email), OpenAI (identifying items in shelf photos), PayPal
          (donations), and Amazon (product links — some carry an affiliate
          tag that earns a small commission at no cost to the buyer; your
          family can switch that off in Settings). We don't share your
          information with anyone else, and we don't sell it.
        </p>
      </section>

      <section className="card">
        <h2>Your choices</h2>
        <p>
          You can edit or remove your family's information in Settings at any
          time, turn off occasion reminders, and opt out of affiliate links.
          You can also delete your account entirely from Settings — that
          permanently removes your profile, your children's profiles, your
          lists, and your sign-in. Items you added to the shared catalog stay
          in the catalog, unattributed, so other families' lists don't break.
        </p>
        <p>
          Questions or requests: email{' '}
          <a href="mailto:support@toylibrary.store">support@toylibrary.store</a>.
        </p>
      </section>

      <section className="card">
        <h2>Changes</h2>
        <p>
          If this policy changes in a way that matters, we'll update this page
          and note the new date at the top.
        </p>
      </section>
    </main>
  )
}

export function TermsPage() {
  return (
    <main className="page narrow">
      <h1>Terms of use</h1>
      <p className="muted">Last updated October 24, 2026</p>

      <section className="card">
        <h2>The deal, briefly</h2>
        <p>
          Toy Library is a free tool for keeping track of the story toys and
          books your kids own, and for sharing wishlists so gifts don't get
          bought twice. By using it, you agree to these terms.
        </p>
      </section>

      <section className="card">
        <h2>Your account and your content</h2>
        <p>
          You're responsible for your account and for the information you add.
          Only add details about your own family that you're comfortable
          sharing with the people you give your gift-page link to. Don't use
          the site to harass anyone, post other people's private information,
          or try to break, scrape at abusive rates, or overload the service.
          We may remove content or accounts that do.
        </p>
      </section>

      <section className="card">
        <h2>The catalog</h2>
        <p>
          Catalog information (titles, age guidance, ratings) comes from
          publishers, manufacturers, and families, and is provided as a guide
          — always check the real product before buying for a child. Product
          links go to Amazon and manufacturers; purchases happen on their
          sites under their terms. Some Amazon links carry an affiliate tag
          that earns us a commission; families can opt out in Settings.
        </p>
      </section>

      <section className="card">
        <h2>Donations</h2>
        <p>
          Donations are voluntary gifts that go toward the cost of running
          the site. They aren't purchases, and no goods or services are owed
          in return; any supporter perks (like higher photo-scan limits) are
          a thank-you that we may adjust over time. Donations are not
          tax-deductible — Toy Library isn't a charity.
        </p>
      </section>

      <section className="card">
        <h2>No warranties</h2>
        <p>
          The service is provided as-is, without warranties of any kind. We
          work hard to keep it running and your data safe, but we can't
          guarantee it will always be available or error-free, and to the
          extent the law allows, we aren't liable for losses arising from
          using it. Nothing here limits rights you have as a consumer that
          can't be limited by agreement.
        </p>
      </section>

      <section className="card">
        <h2>Changes and contact</h2>
        <p>
          We may update these terms; the current version will always be on
          this page with its date. Questions:{' '}
          <a href="mailto:support@toylibrary.store">support@toylibrary.store</a>.
        </p>
      </section>
    </main>
  )
}
