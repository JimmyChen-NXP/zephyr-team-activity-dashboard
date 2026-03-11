import { formatISO9075 } from "date-fns";

import type { ActivityItem } from "@/lib/types";

function formatReviewKind(value?: "authored-by-self" | "authored-by-them" | "authored-external") {
  if (value === "authored-by-self") {
    return "Authored by self";
  }

  if (value === "authored-by-them") {
    return "Authored by teammate";
  }

  if (value === "authored-external") {
    return "Authored externally";
  }

  return "—";
}

function formatTypeLabel(value: string) {
  return value.replaceAll("_", " ");
}

type ReviewedPrsTableProps = {
  items: ActivityItem[];
};

export function ReviewedPrsTable({ items }: ReviewedPrsTableProps) {
  return (
    <section className="panel table-panel detail-panel">
      <div className="panel-header compact">
        <div>
          <p className="eyebrow">Reviewed PRs</p>
          <h2>Review activity</h2>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Reviewed PR</th>
              <th>Repository</th>
              <th>Reviewer</th>
              <th>Author</th>
              <th>Author type</th>
              <th>Created</th>
              <th>Status</th>
              <th>Outcome</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty-state-cell">
                  No reviewed PRs matched the current selection.
                </td>
              </tr>
            ) : (
              items.slice(0, 40).map((item) => (
                <tr key={item.id}>
                  <td>
                    <a href={item.url} target="_blank" rel="noreferrer" className="table-link">
                      {item.title}
                    </a>
                  </td>
                  <td>{item.repo}</td>
                  <td>@{item.contributor}</td>
                  <td>@{item.author}</td>
                  <td>{formatReviewKind(item.reviewedPrKind)}</td>
                  <td>{formatISO9075(new Date(item.createdAt))}</td>
                  <td>{item.statusLabel}</td>
                  <td>{formatTypeLabel(item.state)}</td>
                  <td>{formatISO9075(new Date(item.updatedAt))}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
