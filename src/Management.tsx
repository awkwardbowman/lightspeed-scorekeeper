import { useState } from "react";
import { PasswordForm, useAccount } from "./Auth";
import { db, manage } from "./data";
import { Intro, Notice, useAction } from "./ui";
export function Account() {
  const { profile, refresh } = useAccount();
  const [name, setName] = useState(profile.display_name);
  const a = useAction(refresh);
  return (
    <>
      <Intro title="My account">
        {profile.email} · {profile.app_role}
      </Intro>
      <section className="card">
        <form
          className="editor"
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(() => manage({ action: "profile", display_name: name }));
          }}
        >
          <label>
            Display name
            <input
              value={name}
              required
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button className="primary" disabled={a.busy}>
            Save name
          </button>
        </form>
        <Notice error={a.status} />
        <h3>Change password</h3>
        <PasswordForm onDone={refresh} />
        <button className="subtle" onClick={() => void db().auth.signOut()}>
          Sign out
        </button>
      </section>
    </>
  );
}
