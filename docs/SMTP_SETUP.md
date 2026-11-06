# Brevo SMTP setup

Find the verified sender address in Brevo under **Settings → Senders, Domains & Dedicated IPs → Senders**. SMTP credentials are separate: open **Settings → SMTP & API → SMTP** to find the SMTP login and create an SMTP key.

In your Supabase project's **Authentication → Email → SMTP settings**, enable custom SMTP and enter:

| Supabase field | Value |
| --- | --- |
| Sender email address | The verified Brevo sender address |
| Sender name | Lightspeed Scorekeeper |
| Host | `smtp-relay.brevo.com` |
| Port | `587` |
| Username | The SMTP login shown by Brevo |
| Password | A Brevo SMTP key, entered directly in Supabase |

Use an SMTP key rather than a Brevo API key or account password. Disable email link tracking so authentication links are preserved. Never commit SMTP credentials or paste them into chat.

Save the settings, then follow the activation order in [RELEASE.md](RELEASE.md). The old Send Email hook must be disabled before Supabase can deliver a recovery test. Confirm the email arrives and its link lets the account owner set a password before enabling invitation readiness. A verified sender or successful API request alone does not establish delivery.

References: [Brevo's Supabase SMTP guide](https://developers.brevo.com/docs/supabase-smtp-integration) and [SMTP key management](https://help.brevo.com/hc/en-us/articles/7959631848850-Create-and-manage-your-SMTP-keys).
