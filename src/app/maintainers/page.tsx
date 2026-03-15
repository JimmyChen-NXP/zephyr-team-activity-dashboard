import { Suspense } from "react";

import { MaintainersPage } from "@/components/maintainers-page";

function LoadingShell() {
  return (
    <div className="dashboard-shell">
      <div className="title-bar">
        <span className="title-bar-name">Zephyr team activity</span>
      </div>
      <section className="panel">
        <p className="eyebrow">Roster</p>
        <p className="token-copy">Loading…</p>
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <MaintainersPage />
    </Suspense>
  );
}
